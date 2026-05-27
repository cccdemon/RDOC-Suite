//! Privilege-neutral global keyboard input via Win32 Raw Input.
//!
//! Why not `rdev` / WH_KEYBOARD_LL anymore?
//!  - WH_KEYBOARD_LL on this app's test setup needed Administrator
//!    privileges to actually receive events. Elevating the Companion
//!    in turn broke Discord's own push-to-mute via Windows UIPI (a
//!    non-elevated Discord can't see input while an elevated window
//!    has focus, and a Mouse4 click that happens to land on the
//!    Companion window grabs that focus mid-press — so even the
//!    release event was swallowed).
//!
//! Raw Input avoids both problems:
//!  - It works for non-elevated processes everywhere we've tested.
//!  - It doesn't go through the keyboard-hook chain at all, so it
//!    can't clash with Discord's hook or be suppressed by anti-cheat
//!    middleware.
//!  - With `RIDEV_INPUTSINK` the registered window receives keyboard
//!    events even when it's not the foreground window, which is what
//!    we need for "PTT while gaming."
//!
//! Mouse hotkeys (Mouse4/5) keep using `rdev` — they always worked
//! without elevation and there's no Discord-conflict to fix there.
//!
//! Architecture: a dedicated thread creates an invisible
//! `HWND_MESSAGE` window, registers it for raw keyboard input, and
//! pumps messages. The WndProc parses each WM_INPUT into a
//! `RawKeyEvent` and forwards it on an mpsc channel that the rest of
//! the app subscribes to.

use std::sync::mpsc::Sender;
use std::sync::OnceLock;

use rdev::Key;
use windows::core::{w, PCWSTR};
use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::{
    GetRawInputData, RegisterRawInputDevices, HRAWINPUT, RAWINPUT, RAWINPUTDEVICE,
    RAWINPUTHEADER, RID_INPUT, RIDEV_INPUTSINK, RIM_TYPEKEYBOARD,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW,
    TranslateMessage, HMENU, HWND_MESSAGE, MSG, RI_KEY_BREAK, WINDOW_EX_STYLE, WINDOW_STYLE,
    WM_INPUT, WNDCLASSW,
};

#[derive(Debug, Clone, Copy)]
pub struct RawKeyEvent {
    pub key: Key,
    pub is_release: bool,
}

/// Global tx the WndProc forwards into. Set once when the thread is
/// spawned. `OnceLock` to keep the writer-side ergonomic; the
/// `Sender` itself is `Sync` for our usage (clone for each thread is
/// only done at startup).
static GLOBAL_TX: OnceLock<Sender<RawKeyEvent>> = OnceLock::new();

/// Spawn the raw-input thread. Calling more than once is a no-op
/// after the first call — the WndProc forwards via the channel set
/// the first time. Returns immediately; the thread runs the message
/// loop forever.
pub fn start(tx: Sender<RawKeyEvent>) {
    if GLOBAL_TX.set(tx).is_err() {
        // already started
        return;
    }
    std::thread::spawn(|| unsafe { run() });
}

unsafe fn run() {
    let hinst: HINSTANCE = GetModuleHandleW(None)
        .expect("GetModuleHandleW failed")
        .into();
    let class_name = w!("DcccRawInputClass");

    let wc = WNDCLASSW {
        lpfnWndProc: Some(wnd_proc),
        hInstance: hinst,
        lpszClassName: class_name,
        ..Default::default()
    };
    let atom = RegisterClassW(&wc);
    if atom == 0 {
        log::error!("[raw-input] RegisterClassW failed");
        return;
    }

    let hwnd = CreateWindowExW(
        WINDOW_EX_STYLE::default(),
        PCWSTR(class_name.as_ptr()),
        w!("DcccRawInput"),
        WINDOW_STYLE::default(),
        0,
        0,
        0,
        0,
        Some(HWND_MESSAGE),
        Option::<HMENU>::None,
        Some(hinst),
        None,
    );
    let hwnd = match hwnd {
        Ok(h) => h,
        Err(e) => {
            log::error!("[raw-input] CreateWindowExW failed: {e:?}");
            return;
        }
    };

    // Generic Desktop page (0x01) / Keyboard usage (0x06).
    // RIDEV_INPUTSINK = receive input even when window isn't foreground.
    let device = RAWINPUTDEVICE {
        usUsagePage: 0x01,
        usUsage: 0x06,
        dwFlags: RIDEV_INPUTSINK,
        hwndTarget: hwnd,
    };
    let devices = [device];
    let ok = RegisterRawInputDevices(&devices, std::mem::size_of::<RAWINPUTDEVICE>() as u32);
    if ok.is_err() {
        log::error!("[raw-input] RegisterRawInputDevices failed: {:?}", ok);
        return;
    }
    log::info!("[raw-input] hwnd ready, keyboard registered (RIDEV_INPUTSINK)");

    let mut msg = MSG::default();
    while GetMessageW(&mut msg, Some(hwnd), 0, 0).as_bool() {
        let _ = TranslateMessage(&msg);
        DispatchMessageW(&msg);
    }
    log::warn!("[raw-input] message loop exited");
}

unsafe extern "system" fn wnd_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
) -> LRESULT {
    if msg == WM_INPUT {
        let mut size: u32 = 0;
        let header_size = std::mem::size_of::<RAWINPUTHEADER>() as u32;
        // First call: ask how big the payload is.
        let _ = GetRawInputData(
            HRAWINPUT(lparam.0 as *mut _),
            RID_INPUT,
            None,
            &mut size,
            header_size,
        );
        if size > 0 && size <= 1024 {
            let mut buffer = vec![0u8; size as usize];
            let written = GetRawInputData(
                HRAWINPUT(lparam.0 as *mut _),
                RID_INPUT,
                Some(buffer.as_mut_ptr() as *mut _),
                &mut size,
                header_size,
            );
            if written != u32::MAX && written > 0 {
                let raw = &*(buffer.as_ptr() as *const RAWINPUT);
                if raw.header.dwType == RIM_TYPEKEYBOARD.0 {
                    let kb = &raw.data.keyboard;
                    let vk = kb.VKey;
                    let is_release = (u32::from(kb.Flags) & RI_KEY_BREAK) != 0;
                    let key = vk_to_rdev_key(vk);
                    if let Some(tx) = GLOBAL_TX.get() {
                        let _ = tx.send(RawKeyEvent { key, is_release });
                    }
                }
            }
        }
        // Per docs we must still call DefWindowProcW for WM_INPUT so
        // the OS can clean up the input buffer.
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// Windows Virtual-Key code → rdev::Key. Mirrors the table in
/// `rdev/src/windows/keycodes.rs` so the rest of our pipeline (which
/// still keys off `rdev::Key`) doesn't need to change. Unknown codes
/// fall through to `Key::Unknown(vk)`.
fn vk_to_rdev_key(vk: u16) -> Key {
    match vk {
        164 => Key::Alt,
        165 => Key::AltGr,
        0x08 => Key::Backspace,
        20 => Key::CapsLock,
        162 => Key::ControlLeft,
        163 => Key::ControlRight,
        46 => Key::Delete,
        40 => Key::DownArrow,
        35 => Key::End,
        27 => Key::Escape,
        112 => Key::F1,
        121 => Key::F10,
        122 => Key::F11,
        123 => Key::F12,
        113 => Key::F2,
        114 => Key::F3,
        115 => Key::F4,
        116 => Key::F5,
        117 => Key::F6,
        118 => Key::F7,
        119 => Key::F8,
        120 => Key::F9,
        36 => Key::Home,
        37 => Key::LeftArrow,
        91 => Key::MetaLeft,
        34 => Key::PageDown,
        33 => Key::PageUp,
        0x0D => Key::Return,
        39 => Key::RightArrow,
        160 => Key::ShiftLeft,
        161 => Key::ShiftRight,
        32 => Key::Space,
        0x09 => Key::Tab,
        38 => Key::UpArrow,
        44 => Key::PrintScreen,
        145 => Key::ScrollLock,
        19 => Key::Pause,
        144 => Key::NumLock,
        192 => Key::BackQuote,
        49 => Key::Num1,
        50 => Key::Num2,
        51 => Key::Num3,
        52 => Key::Num4,
        53 => Key::Num5,
        54 => Key::Num6,
        55 => Key::Num7,
        56 => Key::Num8,
        57 => Key::Num9,
        48 => Key::Num0,
        189 => Key::Minus,
        187 => Key::Equal,
        81 => Key::KeyQ,
        87 => Key::KeyW,
        69 => Key::KeyE,
        82 => Key::KeyR,
        84 => Key::KeyT,
        89 => Key::KeyY,
        85 => Key::KeyU,
        73 => Key::KeyI,
        79 => Key::KeyO,
        80 => Key::KeyP,
        219 => Key::LeftBracket,
        221 => Key::RightBracket,
        65 => Key::KeyA,
        83 => Key::KeyS,
        68 => Key::KeyD,
        70 => Key::KeyF,
        71 => Key::KeyG,
        72 => Key::KeyH,
        74 => Key::KeyJ,
        75 => Key::KeyK,
        76 => Key::KeyL,
        186 => Key::SemiColon,
        222 => Key::Quote,
        220 => Key::BackSlash,
        226 => Key::IntlBackslash,
        90 => Key::KeyZ,
        88 => Key::KeyX,
        67 => Key::KeyC,
        86 => Key::KeyV,
        66 => Key::KeyB,
        78 => Key::KeyN,
        77 => Key::KeyM,
        188 => Key::Comma,
        190 => Key::Dot,
        191 => Key::Slash,
        45 => Key::Insert,
        109 => Key::KpMinus,
        107 => Key::KpPlus,
        106 => Key::KpMultiply,
        111 => Key::KpDivide,
        96 => Key::Kp0,
        97 => Key::Kp1,
        98 => Key::Kp2,
        99 => Key::Kp3,
        100 => Key::Kp4,
        101 => Key::Kp5,
        102 => Key::Kp6,
        103 => Key::Kp7,
        104 => Key::Kp8,
        105 => Key::Kp9,
        110 => Key::KpDelete,
        _ => Key::Unknown(vk.into()),
    }
}
