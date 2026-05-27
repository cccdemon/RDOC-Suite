//! Per-application volume control for Discord via WASAPI session API.
//!
//! Lowers ("ducks") Discord's output volume while squad-link audio is
//! active, then restores it — so a commander's PTT or an incoming peer
//! transmission doesn't get drowned out by the regular Discord channel
//! the user is still listening to.
//!
//! Implementation notes:
//!
//!  - Discord process names we match: `Discord.exe`, `DiscordPTB.exe`,
//!    `DiscordCanary.exe`. We don't try to be cleverer (e.g. matching
//!    by window class) because the audio-session-control's process-id
//!    is the only metadata we get cheaply.
//!
//!  - Each `duck()` call re-enumerates audio sessions. Discord can be
//!    restarted, updated, crashed-and-revived, and the session graph
//!    changes accordingly. Re-enumeration is cheap (<10ms) and means
//!    we don't have to manage long-lived COM handles across PTT cycles.
//!
//!  - We cache the "original" volume per process so a repeated duck
//!    doesn't double-store a value we ourselves had already set to
//!    e.g. 25 %. The cache lives across PTT cycles for as long as
//!    Discord's PID is unchanged.
//!
//!  - All COM calls happen on a dedicated worker thread (CoInitialize
//!    must be matched to the thread that uses the interfaces). The
//!    Tauri commands talk to that worker via an mpsc channel + reply
//!    oneshot — cheap, and keeps every COM operation on one thread.

use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;

use windows::core::{Interface, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, MAX_PATH};
use windows::Win32::Media::Audio::{
    eMultimedia, eRender, IAudioSessionControl2, IAudioSessionManager2, IMMDeviceEnumerator,
    ISimpleAudioVolume, MMDeviceEnumerator,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_APARTMENTTHREADED,
};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
};

enum Cmd {
    Duck { target_pct: f32 },
    Restore,
}

static CMD_TX: OnceLock<Sender<Cmd>> = OnceLock::new();

/// Start the WASAPI worker thread. Idempotent — only the first call
/// actually spawns. Subsequent calls are a no-op.
pub fn start() {
    if CMD_TX.get().is_some() {
        return;
    }
    let (tx, rx) = channel::<Cmd>();
    if CMD_TX.set(tx).is_err() {
        return;
    }
    std::thread::spawn(move || {
        // Per-PID cache: PID -> original volume (0.0..1.0) captured the
        // first time we ducked this Discord instance. Re-used on
        // restore. Cleared when restore runs.
        let mut originals: HashMap<u32, f32> = HashMap::new();

        // COM init on this worker thread. Apartment-threaded is fine
        // since we never hand interfaces to other threads.
        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            if hr.is_err() {
                log::error!("[ducking] CoInitializeEx failed: {hr:?}");
                return;
            }
        }
        log::info!("[ducking] WASAPI worker thread ready");

        while let Ok(cmd) = rx.recv() {
            match cmd {
                Cmd::Duck { target_pct } => {
                    let target = (target_pct.clamp(0.0, 100.0)) / 100.0;
                    if let Err(e) = unsafe { apply_duck(&mut originals, target) } {
                        log::warn!("[ducking] duck failed: {e}");
                    }
                }
                Cmd::Restore => {
                    if let Err(e) = unsafe { apply_restore(&mut originals) } {
                        log::warn!("[ducking] restore failed: {e}");
                    }
                }
            }
        }
    });
}

/// Public entry point. Lowers all live Discord audio sessions to
/// `target_pct` (0..100), caching the previous volume so `restore()`
/// can put it back. Cheap; queued onto the worker thread.
pub fn duck(target_pct: f32) {
    if let Some(tx) = CMD_TX.get() {
        let _ = tx.send(Cmd::Duck { target_pct });
    }
}

/// Restore Discord to whatever volume it had before the first
/// `duck()` since the last `restore()`. No-op if no duck has happened
/// yet, or if Discord has restarted (PID change wipes the cache).
pub fn restore() {
    if let Some(tx) = CMD_TX.get() {
        let _ = tx.send(Cmd::Restore);
    }
}

unsafe fn apply_duck(originals: &mut HashMap<u32, f32>, target: f32) -> Result<(), String> {
    for_each_discord_session(|pid, vol| {
        let current = vol
            .GetMasterVolume()
            .map_err(|e| format!("GetMasterVolume failed: {e:?}"))?;
        // First time we ever touched this PID: snapshot its current
        // level. After that, leave the cached snapshot alone — we
        // don't want to "remember" the 25 % we set last cycle as the
        // pre-duck baseline.
        originals.entry(pid).or_insert(current);
        vol.SetMasterVolume(target, std::ptr::null())
            .map_err(|e| format!("SetMasterVolume failed: {e:?}"))?;
        Ok(())
    })
}

unsafe fn apply_restore(originals: &mut HashMap<u32, f32>) -> Result<(), String> {
    if originals.is_empty() {
        return Ok(());
    }
    let to_restore = std::mem::take(originals);
    for_each_discord_session(|pid, vol| {
        if let Some(&original) = to_restore.get(&pid) {
            vol.SetMasterVolume(original, std::ptr::null())
                .map_err(|e| format!("SetMasterVolume restore failed: {e:?}"))?;
        }
        Ok(())
    })
}

/// Visit each `ISimpleAudioVolume` whose owning process matches a
/// Discord exe name. Caller does whatever it needs with each match.
unsafe fn for_each_discord_session<F>(mut callback: F) -> Result<(), String>
where
    F: FnMut(u32, &ISimpleAudioVolume) -> Result<(), String>,
{
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
            .map_err(|e| format!("MMDeviceEnumerator failed: {e:?}"))?;
    let device = enumerator
        .GetDefaultAudioEndpoint(eRender, eMultimedia)
        .map_err(|e| format!("GetDefaultAudioEndpoint failed: {e:?}"))?;
    let session_manager: IAudioSessionManager2 = device
        .Activate(CLSCTX_ALL, None)
        .map_err(|e| format!("Activate IAudioSessionManager2 failed: {e:?}"))?;
    let session_enum = session_manager
        .GetSessionEnumerator()
        .map_err(|e| format!("GetSessionEnumerator failed: {e:?}"))?;
    let count = session_enum
        .GetCount()
        .map_err(|e| format!("GetCount failed: {e:?}"))?;
    for i in 0..count {
        let control = match session_enum.GetSession(i) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let control2: IAudioSessionControl2 = match control.cast() {
            Ok(c) => c,
            Err(_) => continue,
        };
        let pid = match control2.GetProcessId() {
            Ok(p) => p,
            Err(_) => continue,
        };
        if pid == 0 {
            continue; // system sounds session
        }
        if !is_discord(pid) {
            continue;
        }
        let vol: ISimpleAudioVolume = match control2.cast() {
            Ok(v) => v,
            Err(_) => continue,
        };
        callback(pid, &vol)?;
    }
    Ok(())
}

fn is_discord(pid: u32) -> bool {
    let Some(name) = process_image_name(pid) else {
        return false;
    };
    let lower = name.to_lowercase();
    lower == "discord.exe" || lower == "discordptb.exe" || lower == "discordcanary.exe"
}

fn process_image_name(pid: u32) -> Option<String> {
    unsafe {
        let handle: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        if handle.is_invalid() {
            return None;
        }
        let mut buf = vec![0u16; MAX_PATH as usize];
        let mut size = buf.len() as u32;
        let res = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        if res.is_err() || size == 0 {
            return None;
        }
        let full = String::from_utf16_lossy(&buf[..size as usize]);
        // Take the file name portion only.
        let trimmed = full.rsplit(['\\', '/']).next().unwrap_or(&full);
        Some(trimmed.to_string())
    }
}
