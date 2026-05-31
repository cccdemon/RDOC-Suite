use serde::Serialize;
use std::collections::HashMap;
use std::sync::mpsc::{channel, Sender};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};

#[cfg(target_os = "windows")]
mod discord_ducking;
#[cfg(target_os = "windows")]
mod raw_input;

#[derive(Clone, Serialize)]
struct HotkeyEvent {
    state: &'static str, // "pressed" | "released"
    accelerator: String,
}

/// Shared registry of the currently-active hotkey. The rdev listener
/// thread reads from this on every event; the JS side updates it via
/// the `set_hotkey` Tauri command. Only one of `keyboard` / `mouse` is
/// `Some(_)` at any time — switching hotkey type clears the other.
#[derive(Clone, Default)]
struct HotkeyRegistry {
    keyboard: Arc<Mutex<Option<KeySpec>>>,
    /// Mouse button raw index (rdev `Button::Unknown(n)`), where the
    /// human-visible label is `Mouse{n+3}` (Mouse4 = Unknown(1)).
    mouse: Arc<Mutex<Option<u8>>>,
    /// Additional named PTT hotkeys (e.g. mission commander / global voice)
    /// that coexist with the primary bridge hotkey. Keyed by a JS-supplied
    /// id so each can be set/cleared independently.
    extra: Arc<Mutex<HashMap<String, HotkeyTarget>>>,
}

/// A single resolved hotkey binding — keyboard combo or mouse side-button.
/// Used for the `extra` (mission) hotkeys that run alongside the primary
/// bridge hotkey.
#[derive(Clone)]
enum HotkeyTarget {
    Keyboard(KeySpec),
    Mouse(u8),
}

#[derive(Clone, Serialize)]
struct OAuthCompletedEvent {
    token: String,
    guild_id: String,
}

#[derive(Clone, Serialize)]
struct OAuthCancelledEvent {}

#[derive(Clone, Serialize)]
struct FleetOAuthCompletedEvent {
    token: String,
}

/// Open a small WebviewWindow that drives the Discord OAuth flow
/// inline (no system browser, no `dccc://` OS scheme registration).
/// The bridge ends its callback HTML with a redirect to the
/// `COMPANION_REDIRECT_URI` (`dccc://auth?token=…&guildId=…`). We
/// intercept that navigation in `on_navigation`, extract the params,
/// emit them to the main window, and close the oauth window.
#[tauri::command]
async fn start_oauth_webview(
    app: AppHandle,
    bridge_url: String,
    guild_id: String,
) -> Result<(), String> {
    // If a prior oauth window is still hanging around (user re-clicked
    // sign-in before the previous flow finished), close it.
    if let Some(existing) = app.get_webview_window("oauth") {
        let _ = existing.close();
    }

    let base = bridge_url.trim_end_matches('/');
    let start_url = format!(
        "{}/auth/start?guildId={}",
        base,
        url::form_urlencoded::byte_serialize(guild_id.as_bytes()).collect::<String>()
    );
    let parsed = url::Url::parse(&start_url).map_err(|e| e.to_string())?;

    let app_for_nav = app.clone();
    let win = WebviewWindowBuilder::new(&app, "oauth", WebviewUrl::External(parsed))
        .title("RDOC Squad Link — Discord Anmeldung")
        .inner_size(520.0, 760.0)
        .resizable(true)
        .focused(true)
        .on_navigation(move |target| {
            // The bridge's success page ends with a JS redirect to
            // `dccc://auth?token=…&guildId=…`. We treat that as the
            // signal that auth is complete, extract the payload, and
            // tear the window down. Returning false blocks the
            // (un-resolvable) dccc:// navigation.
            if target.scheme() == "dccc" {
                let mut token: Option<String> = None;
                let mut gid: Option<String> = None;
                for (k, v) in target.query_pairs() {
                    match k.as_ref() {
                        "token" => token = Some(v.into_owned()),
                        "guildId" => gid = Some(v.into_owned()),
                        _ => {}
                    }
                }
                if let (Some(t), Some(g)) = (token, gid) {
                    let _ = app_for_nav.emit(
                        "oauth-completed",
                        OAuthCompletedEvent {
                            token: t,
                            guild_id: g,
                        },
                    );
                }
                if let Some(w) = app_for_nav.get_webview_window("oauth") {
                    let _ = w.close();
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    // If the user closes the oauth window manually (X button) without
    // completing auth, let the JS side reset its "waiting for OAuth"
    // state. The destroy event fires for both manual close and our
    // on_navigation close — the latter race is fine since we emit
    // oauth-completed first.
    let app_for_close = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = app_for_close.emit("oauth-cancelled", OAuthCancelledEvent {});
        }
    });

    Ok(())
}

/// Opens a WebviewWindow for Fleetplanner companion OAuth.
/// The fleetplanner's /auth/discord/companion/callback redirects to
/// dccc://fleet-auth?token=<bearer> on success or dccc://fleet-auth?error=...
/// on failure. on_navigation intercepts the dccc://fleet-auth URL (host = "fleet-auth"),
/// emits fleet-oauth-completed or fleet-oauth-cancelled, and closes the window.
#[tauri::command]
async fn start_fleet_oauth_webview(
    app: AppHandle,
    fleetplanner_url: String,
) -> Result<(), String> {
    if let Some(existing) = app.get_webview_window("fleet-oauth") {
        let _ = existing.close();
    }

    let base = fleetplanner_url.trim_end_matches('/');
    let start_url = format!("{}/auth/discord/companion/start", base);
    let parsed = url::Url::parse(&start_url).map_err(|e| e.to_string())?;

    let app_for_nav = app.clone();
    let win = WebviewWindowBuilder::new(&app, "fleet-oauth", WebviewUrl::External(parsed))
        .title("RDOC Fleet Commander — Discord Anmeldung")
        .inner_size(520.0, 760.0)
        .resizable(true)
        .focused(true)
        .on_navigation(move |target| {
            if target.scheme() == "dccc" && target.host_str() == Some("fleet-auth") {
                let mut token: Option<String> = None;
                let mut has_error = false;
                for (k, v) in target.query_pairs() {
                    match k.as_ref() {
                        "token" => token = Some(v.into_owned()),
                        "error" => { has_error = true; let _ = v; }
                        _ => {}
                    }
                }
                if let Some(t) = token {
                    let _ = app_for_nav.emit("fleet-oauth-completed", FleetOAuthCompletedEvent { token: t });
                } else if has_error {
                    let _ = app_for_nav.emit("fleet-oauth-cancelled", OAuthCancelledEvent {});
                }
                if let Some(w) = app_for_nav.get_webview_window("fleet-oauth") {
                    let _ = w.close();
                }
                return false;
            }
            true
        })
        .build()
        .map_err(|e| e.to_string())?;

    let app_for_close = app.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = app_for_close.emit("fleet-oauth-cancelled", OAuthCancelledEvent {});
        }
    });

    Ok(())
}

/// Parsed Tauri-style accelerator (e.g. "Control+Shift+T", "Alt+F1").
#[derive(Debug, Clone, PartialEq)]
struct KeySpec {
    key: rdev::Key,
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}

#[derive(Default, Debug)]
struct ModifierState {
    ctrl: bool,
    alt: bool,
    shift: bool,
    meta: bool,
}

fn parse_key(s: &str) -> Option<rdev::Key> {
    use rdev::Key;
    // Single uppercase letter
    if s.len() == 1 {
        let c = s.chars().next().unwrap();
        if c.is_ascii_uppercase() {
            return match c {
                'A' => Some(Key::KeyA), 'B' => Some(Key::KeyB), 'C' => Some(Key::KeyC),
                'D' => Some(Key::KeyD), 'E' => Some(Key::KeyE), 'F' => Some(Key::KeyF),
                'G' => Some(Key::KeyG), 'H' => Some(Key::KeyH), 'I' => Some(Key::KeyI),
                'J' => Some(Key::KeyJ), 'K' => Some(Key::KeyK), 'L' => Some(Key::KeyL),
                'M' => Some(Key::KeyM), 'N' => Some(Key::KeyN), 'O' => Some(Key::KeyO),
                'P' => Some(Key::KeyP), 'Q' => Some(Key::KeyQ), 'R' => Some(Key::KeyR),
                'S' => Some(Key::KeyS), 'T' => Some(Key::KeyT), 'U' => Some(Key::KeyU),
                'V' => Some(Key::KeyV), 'W' => Some(Key::KeyW), 'X' => Some(Key::KeyX),
                'Y' => Some(Key::KeyY), 'Z' => Some(Key::KeyZ),
                _ => None,
            };
        }
        if c.is_ascii_digit() {
            return match c {
                '0' => Some(Key::Num0), '1' => Some(Key::Num1), '2' => Some(Key::Num2),
                '3' => Some(Key::Num3), '4' => Some(Key::Num4), '5' => Some(Key::Num5),
                '6' => Some(Key::Num6), '7' => Some(Key::Num7), '8' => Some(Key::Num8),
                '9' => Some(Key::Num9),
                _ => None,
            };
        }
        // Punctuation (HotkeyCapture uppercases punctuation when sending,
        // but accept both — Tauri accelerators historically allow either).
        return match c {
            '-' => Some(Key::Minus), '=' => Some(Key::Equal),
            ';' => Some(Key::SemiColon), '\'' => Some(Key::Quote),
            ',' => Some(Key::Comma), '.' => Some(Key::Dot),
            '/' => Some(Key::Slash), '\\' => Some(Key::BackSlash),
            '`' => Some(Key::BackQuote),
            '[' => Some(Key::LeftBracket), ']' => Some(Key::RightBracket),
            _ => None,
        };
    }
    // F-keys (rdev 0.5 supports F1..F12).
    if let Some(rest) = s.strip_prefix('F') {
        if let Ok(n) = rest.parse::<u8>() {
            return match n {
                1 => Some(Key::F1), 2 => Some(Key::F2), 3 => Some(Key::F3),
                4 => Some(Key::F4), 5 => Some(Key::F5), 6 => Some(Key::F6),
                7 => Some(Key::F7), 8 => Some(Key::F8), 9 => Some(Key::F9),
                10 => Some(Key::F10), 11 => Some(Key::F11), 12 => Some(Key::F12),
                _ => None,
            };
        }
    }
    // Named keys
    match s {
        "Space" => Some(Key::Space),
        "Tab" => Some(Key::Tab),
        "Enter" | "Return" => Some(Key::Return),
        "Backspace" => Some(Key::Backspace),
        "Escape" | "Esc" => Some(Key::Escape),
        "Left" => Some(Key::LeftArrow),
        "Right" => Some(Key::RightArrow),
        "Up" => Some(Key::UpArrow),
        "Down" => Some(Key::DownArrow),
        "Home" => Some(Key::Home),
        "End" => Some(Key::End),
        "PageUp" => Some(Key::PageUp),
        "PageDown" => Some(Key::PageDown),
        "Insert" => Some(Key::Insert),
        "Delete" | "Del" => Some(Key::Delete),
        "Numpad0" => Some(Key::Kp0), "Numpad1" => Some(Key::Kp1),
        "Numpad2" => Some(Key::Kp2), "Numpad3" => Some(Key::Kp3),
        "Numpad4" => Some(Key::Kp4), "Numpad5" => Some(Key::Kp5),
        "Numpad6" => Some(Key::Kp6), "Numpad7" => Some(Key::Kp7),
        "Numpad8" => Some(Key::Kp8), "Numpad9" => Some(Key::Kp9),
        "NumpadAdd" => Some(Key::KpPlus),
        "NumpadSubtract" => Some(Key::KpMinus),
        "NumpadMultiply" => Some(Key::KpMultiply),
        "NumpadDivide" => Some(Key::KpDivide),
        "NumpadEnter" => Some(Key::KpReturn),
        _ => None,
    }
}

fn parse_accelerator(s: &str) -> Option<KeySpec> {
    let parts: Vec<&str> = s.split('+').collect();
    if parts.is_empty() {
        return None;
    }
    let key_part = parts[parts.len() - 1];
    let mut ctrl = false;
    let mut alt = false;
    let mut shift = false;
    let mut meta = false;
    for m in &parts[..parts.len() - 1] {
        match *m {
            "Control" | "Ctrl" | "CommandOrControl" => ctrl = true,
            "Alt" | "Option" => alt = true,
            "Shift" => shift = true,
            "Super" | "Meta" | "Command" | "Cmd" => meta = true,
            _ => return None,
        }
    }
    Some(KeySpec {
        key: parse_key(key_part)?,
        ctrl,
        alt,
        shift,
        meta,
    })
}

fn key_to_accelerator(spec: &KeySpec) -> String {
    let mut parts: Vec<&str> = Vec::new();
    if spec.ctrl {
        parts.push("Control");
    }
    if spec.alt {
        parts.push("Alt");
    }
    if spec.shift {
        parts.push("Shift");
    }
    if spec.meta {
        parts.push("Super");
    }
    let key_str = key_label(spec.key);
    parts.push(&key_str);
    parts.join("+")
}

/// Inverse of `parse_key` — produces the canonical Tauri-style label
/// for an rdev::Key, so the emitted hotkey event's `accelerator` field
/// matches what the JS side filtered on when calling `set_hotkey`.
fn key_label(k: rdev::Key) -> String {
    use rdev::Key;
    let s: &'static str = match k {
        Key::KeyA => "A", Key::KeyB => "B", Key::KeyC => "C", Key::KeyD => "D",
        Key::KeyE => "E", Key::KeyF => "F", Key::KeyG => "G", Key::KeyH => "H",
        Key::KeyI => "I", Key::KeyJ => "J", Key::KeyK => "K", Key::KeyL => "L",
        Key::KeyM => "M", Key::KeyN => "N", Key::KeyO => "O", Key::KeyP => "P",
        Key::KeyQ => "Q", Key::KeyR => "R", Key::KeyS => "S", Key::KeyT => "T",
        Key::KeyU => "U", Key::KeyV => "V", Key::KeyW => "W", Key::KeyX => "X",
        Key::KeyY => "Y", Key::KeyZ => "Z",
        Key::Num0 => "0", Key::Num1 => "1", Key::Num2 => "2", Key::Num3 => "3",
        Key::Num4 => "4", Key::Num5 => "5", Key::Num6 => "6", Key::Num7 => "7",
        Key::Num8 => "8", Key::Num9 => "9",
        Key::F1 => "F1", Key::F2 => "F2", Key::F3 => "F3", Key::F4 => "F4",
        Key::F5 => "F5", Key::F6 => "F6", Key::F7 => "F7", Key::F8 => "F8",
        Key::F9 => "F9", Key::F10 => "F10", Key::F11 => "F11", Key::F12 => "F12",
        Key::Space => "Space", Key::Tab => "Tab", Key::Return => "Enter",
        Key::Backspace => "Backspace", Key::Escape => "Escape",
        Key::LeftArrow => "Left", Key::RightArrow => "Right",
        Key::UpArrow => "Up", Key::DownArrow => "Down",
        Key::Home => "Home", Key::End => "End",
        Key::PageUp => "PageUp", Key::PageDown => "PageDown",
        Key::Insert => "Insert", Key::Delete => "Delete",
        Key::Kp0 => "Numpad0", Key::Kp1 => "Numpad1", Key::Kp2 => "Numpad2",
        Key::Kp3 => "Numpad3", Key::Kp4 => "Numpad4", Key::Kp5 => "Numpad5",
        Key::Kp6 => "Numpad6", Key::Kp7 => "Numpad7", Key::Kp8 => "Numpad8",
        Key::Kp9 => "Numpad9",
        Key::KpPlus => "NumpadAdd", Key::KpMinus => "NumpadSubtract",
        Key::KpMultiply => "NumpadMultiply", Key::KpDivide => "NumpadDivide",
        Key::KpReturn => "NumpadEnter",
        Key::Minus => "-", Key::Equal => "=", Key::SemiColon => ";",
        Key::Quote => "'", Key::Comma => ",", Key::Dot => ".",
        Key::Slash => "/", Key::BackSlash => "\\", Key::BackQuote => "`",
        Key::LeftBracket => "[", Key::RightBracket => "]",
        _ => return format!("{:?}", k),
    };
    s.to_string()
}

/// Updates the active hotkey from JS. Pass a Mouse{N}-format string for
/// mouse buttons, or any Tauri-style accelerator (e.g. "Control+Shift+T")
/// for keyboard. Whichever kind the new hotkey is, the other kind is
/// cleared so they can't fire simultaneously.
#[tauri::command]
fn set_hotkey(accelerator: String, registry: State<'_, HotkeyRegistry>) -> Result<(), String> {
    if let Some(rest) = accelerator.strip_prefix("Mouse") {
        let n: u32 = rest.parse().map_err(|_| format!("invalid mouse hotkey: {accelerator}"))?;
        if n < 3 {
            return Err(format!(
                "mouse buttons must be >= Mouse3 (got {accelerator}) — Mouse1/Mouse2 are left/middle click"
            ));
        }
        let raw = (n - 3) as u8;
        *registry.keyboard.lock().unwrap() = None;
        *registry.mouse.lock().unwrap() = Some(raw);
        log::info!("hotkey set: mouse Unknown({raw}) (={accelerator})");
    } else {
        let spec = parse_accelerator(&accelerator)
            .ok_or_else(|| format!("unsupported hotkey: {accelerator}"))?;
        let canonical = key_to_accelerator(&spec);
        *registry.mouse.lock().unwrap() = None;
        *registry.keyboard.lock().unwrap() = Some(spec);
        log::info!("hotkey set: keyboard {accelerator} (canonical: {canonical})");
    }
    Ok(())
}

/// Clears the active hotkey from JS — no events will fire until the
/// next `set_hotkey` call. Used during teardown.
#[tauri::command]
fn clear_hotkey(registry: State<'_, HotkeyRegistry>) -> Result<(), String> {
    *registry.keyboard.lock().unwrap() = None;
    *registry.mouse.lock().unwrap() = None;
    log::info!("hotkey cleared");
    Ok(())
}

/// Registers an additional named PTT hotkey that coexists with the primary
/// bridge hotkey (used for mission commander / global voice). Accepts the
/// same accelerator formats as `set_hotkey`. The native listener emits a
/// "hotkey" event with this accelerator on press/release.
#[tauri::command]
fn set_extra_hotkey(
    id: String,
    accelerator: String,
    registry: State<'_, HotkeyRegistry>,
) -> Result<(), String> {
    let target = if let Some(rest) = accelerator.strip_prefix("Mouse") {
        let n: u32 = rest.parse().map_err(|_| format!("invalid mouse hotkey: {accelerator}"))?;
        if n < 3 {
            return Err(format!(
                "mouse buttons must be >= Mouse3 (got {accelerator}) — Mouse1/Mouse2 are left/middle click"
            ));
        }
        HotkeyTarget::Mouse((n - 3) as u8)
    } else {
        let spec = parse_accelerator(&accelerator)
            .ok_or_else(|| format!("unsupported hotkey: {accelerator}"))?;
        HotkeyTarget::Keyboard(spec)
    };
    registry.extra.lock().unwrap().insert(id.clone(), target);
    log::info!("extra hotkey set: {id} = {accelerator}");
    Ok(())
}

/// Removes a named extra hotkey previously set with `set_extra_hotkey`.
#[tauri::command]
fn clear_extra_hotkey(id: String, registry: State<'_, HotkeyRegistry>) -> Result<(), String> {
    registry.extra.lock().unwrap().remove(&id);
    log::info!("extra hotkey cleared: {id}");
    Ok(())
}

/// Lower every Discord audio session's per-app volume to `target_pct`
/// (0..100). Used by the Companion to "duck" the regular Discord channel
/// while squad-link audio is playing or while the user is talking.
/// Idempotent + safe to call when Discord isn't running.
#[tauri::command]
#[cfg(target_os = "windows")]
fn duck_discord(target_pct: f32) -> Result<(), String> {
    discord_ducking::duck(target_pct);
    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn duck_discord(_target_pct: f32) -> Result<(), String> {
    Ok(()) // ducking is win-only for now
}

/// Restore Discord's per-app volume to whatever it was before the
/// first duck_discord call since the last restore. No-op if no ducking
/// has happened or if Discord has been restarted.
#[tauri::command]
#[cfg(target_os = "windows")]
fn restore_discord_volume() -> Result<(), String> {
    discord_ducking::restore();
    Ok(())
}

#[tauri::command]
#[cfg(not(target_os = "windows"))]
fn restore_discord_volume() -> Result<(), String> {
    Ok(())
}

#[cfg(target_os = "windows")]
fn spawn_hotkey_listener(app: AppHandle, registry: HotkeyRegistry) {
    use rdev::{listen, Button, EventType};

    // Shared emitter — every input source (mouse via rdev, keyboard
    // via Raw Input) funnels HotkeyEvent through this channel. The
    // emitter thread owns app.emit so listener callbacks never block
    // on Tauri IPC.
    let (emit_tx, emit_rx) = channel::<HotkeyEvent>();
    let app_for_emit = app.clone();
    std::thread::spawn(move || {
        while let Ok(evt) = emit_rx.recv() {
            if let Err(e) = app_for_emit.emit("hotkey", evt) {
                log::error!("[hotkey] emit failed: {e:?}");
            }
        }
    });

    // KEYBOARD path: Raw Input (WM_INPUT). Privilege-neutral and
    // independent of the keyboard-hook chain, so Discord's own PTT
    // and our PTT can coexist on the same key.
    let (raw_kb_tx, raw_kb_rx) = channel::<raw_input::RawKeyEvent>();
    raw_input::start(raw_kb_tx);
    let kb_registry = registry.clone();
    let kb_emit_tx = emit_tx.clone();
    std::thread::spawn(move || {
        let mut mods = ModifierState::default();
        // Tracks whether the configured hotkey is currently held. Raw
        // Input delivers a WM_INPUT for every Windows auto-repeat tick
        // (~30/s) with RI_KEY_BREAK unset, so without this guard every
        // repeat would re-fire "pressed" and replay the PTT click.
        let mut hotkey_down = false;
        let mut extra_down: HashMap<String, bool> = HashMap::new();
        while let Ok(evt) = raw_kb_rx.recv() {
            handle_raw_key(&evt, &mut mods, &mut hotkey_down, &mut extra_down, &kb_registry, &kb_emit_tx);
        }
    });

    // MOUSE path: rdev's WH_MOUSE_LL. Mouse hooks don't have the
    // privilege / Discord-conflict problems the keyboard hook had,
    // and rdev's mouse path has worked reliably from day one.
    let mouse_registry = registry;
    let mouse_emit_tx = emit_tx;
    std::thread::spawn(move || {
        let res = listen(move |event| {
            match event.event_type {
                EventType::ButtonPress(Button::Unknown(n)) => {
                    if mouse_button_is_bound(&mouse_registry, n) {
                        let _ = mouse_emit_tx.send(HotkeyEvent {
                            state: "pressed",
                            accelerator: format!("Mouse{}", n as u32 + 3),
                        });
                    }
                }
                EventType::ButtonRelease(Button::Unknown(n)) => {
                    if mouse_button_is_bound(&mouse_registry, n) {
                        let _ = mouse_emit_tx.send(HotkeyEvent {
                            state: "released",
                            accelerator: format!("Mouse{}", n as u32 + 3),
                        });
                    }
                }
                _ => {
                    // We DELIBERATELY don't act on KeyPress/KeyRelease here
                    // even though rdev's listen() also installs WH_KEYBOARD_LL.
                    // The keyboard path is owned by raw_input. rdev's
                    // keyboard hook stays passive (never returns suppress)
                    // so Discord / TeamSpeak see every key as if we weren't
                    // installed.
                }
            }
        });
        if let Err(e) = res {
            eprintln!("rdev listener error: {e:?}");
        }
    });
}

#[cfg(target_os = "windows")]
fn mouse_button_is_bound(registry: &HotkeyRegistry, n: u8) -> bool {
    if *registry.mouse.lock().unwrap() == Some(n) {
        return true;
    }
    registry
        .extra
        .lock()
        .unwrap()
        .values()
        .any(|t| matches!(t, HotkeyTarget::Mouse(m) if *m == n))
}

#[cfg(target_os = "windows")]
fn handle_raw_key(
    evt: &raw_input::RawKeyEvent,
    mods: &mut ModifierState,
    hotkey_down: &mut bool,
    extra_down: &mut HashMap<String, bool>,
    registry: &HotkeyRegistry,
    emit_tx: &Sender<HotkeyEvent>,
) {
    use rdev::Key;
    if evt.is_release {
        // Match release BEFORE updating modifier mirror, so releasing
        // the main key still fires "released" even if a modifier comes
        // loose at the same instant.
        let spec_opt = registry.keyboard.lock().unwrap().clone();
        if let Some(spec) = spec_opt.as_ref() {
            if spec.key == evt.key && *hotkey_down {
                *hotkey_down = false;
                let _ = emit_tx.send(HotkeyEvent {
                    state: "released",
                    accelerator: key_to_accelerator(spec),
                });
            }
        }
        // Extra (mission) keyboard hotkeys — release on main-key up.
        for (id, target) in registry.extra.lock().unwrap().iter() {
            if let HotkeyTarget::Keyboard(spec) = target {
                if spec.key == evt.key && extra_down.get(id).copied().unwrap_or(false) {
                    extra_down.insert(id.clone(), false);
                    let _ = emit_tx.send(HotkeyEvent {
                        state: "released",
                        accelerator: key_to_accelerator(spec),
                    });
                }
            }
        }
        match evt.key {
            Key::ControlLeft | Key::ControlRight => mods.ctrl = false,
            Key::ShiftLeft | Key::ShiftRight => mods.shift = false,
            Key::Alt | Key::AltGr => mods.alt = false,
            Key::MetaLeft | Key::MetaRight => mods.meta = false,
            _ => {}
        }
        return;
    }
    match evt.key {
        Key::ControlLeft | Key::ControlRight => mods.ctrl = true,
        Key::ShiftLeft | Key::ShiftRight => mods.shift = true,
        Key::Alt | Key::AltGr => mods.alt = true,
        Key::MetaLeft | Key::MetaRight => mods.meta = true,
        _ => {
            let spec_opt = registry.keyboard.lock().unwrap().clone();
            if let Some(spec) = spec_opt.as_ref() {
                if spec.key == evt.key
                    && spec.ctrl == mods.ctrl
                    && spec.alt == mods.alt
                    && spec.shift == mods.shift
                    && spec.meta == mods.meta
                    && !*hotkey_down
                {
                    *hotkey_down = true;
                    let _ = emit_tx.send(HotkeyEvent {
                        state: "pressed",
                        accelerator: key_to_accelerator(spec),
                    });
                }
            }
            // Extra (mission) keyboard hotkeys — press on full-combo match.
            for (id, target) in registry.extra.lock().unwrap().iter() {
                if let HotkeyTarget::Keyboard(spec) = target {
                    let down = extra_down.get(id).copied().unwrap_or(false);
                    if spec.key == evt.key
                        && spec.ctrl == mods.ctrl
                        && spec.alt == mods.alt
                        && spec.shift == mods.shift
                        && spec.meta == mods.meta
                        && !down
                    {
                        extra_down.insert(id.clone(), true);
                        let _ = emit_tx.send(HotkeyEvent {
                            state: "pressed",
                            accelerator: key_to_accelerator(spec),
                        });
                    }
                }
            }
        }
    }
}

#[cfg(not(target_os = "windows"))]
fn spawn_hotkey_listener(_app: AppHandle, _registry: HotkeyRegistry) {
    // Global low-level hotkeys are not yet wired up on non-Windows
    // platforms. The Tauri global-shortcut plugin is still loaded as a
    // fallback there.
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    builder
        // single-instance MUST be the first plugin so a second launch (e.g. the
        // OS `dccc://` scheme handler spawning a new process) forwards its args
        // to the already-running instance instead of opening a second window.
        // The "deep-link" feature forwards the URL to the deep-link plugin's
        // onOpenUrl listener (consumed by the frontend).
        .plugin(tauri_plugin_single_instance::init(|_app, _argv, _cwd| {}))
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            start_oauth_webview,
            start_fleet_oauth_webview,
            set_hotkey,
            clear_hotkey,
            set_extra_hotkey,
            clear_extra_hotkey,
            duck_discord,
            restore_discord_volume
        ])
        // Logger captures JS console.* + Rust log macros into a rotating
        // file at the OS app-log dir (Windows: %APPDATA%\<identifier>\logs\).
        // File name is `companion.log`; older runs get rotated to .1, .2, …
        .plugin(
            tauri_plugin_log::Builder::default()
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: Some("companion".into()),
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Webview),
                ])
                .level(log::LevelFilter::Info)
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::default().build())
        // tauri-plugin-global-shortcut used to handle keyboard hotkeys
        // via Win32 `RegisterHotKey`. That API is swallowed by DirectX
        // exclusive-fullscreen games, so PTT silently stopped working
        // mid-game. Keyboard hotkeys now go through the same rdev
        // low-level hook as mouse hotkeys (set_hotkey command +
        // spawn_hotkey_listener), which receives events even when a
        // game owns input capture.
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.open_devtools();
                }
            }
            // Register the dccc:// scheme at runtime (covers dev + portable runs;
            // the NSIS installer also registers it via the tauri.conf schemes).
            #[cfg(desktop)]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                let _ = app.deep_link().register("dccc");
            }

            let registry = HotkeyRegistry::default();
            app.manage(registry.clone());
            spawn_hotkey_listener(app.handle().clone(), registry);
            #[cfg(target_os = "windows")]
            discord_ducking::start();
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
