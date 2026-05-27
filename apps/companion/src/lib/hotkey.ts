import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type HotkeyState = "pressed" | "released";

export type HotkeyEventPayload = {
  state: HotkeyState;
  accelerator: string;
};

let currentAccelerator: string | null = null;
let eventUnlisten: (() => void) | null = null;

/**
 * Registers a hotkey with the Rust-side rdev listener and forwards
 * incoming "hotkey" events that match the configured accelerator.
 *
 * Both keyboard AND mouse hotkeys now go through the same Win32
 * low-level hook (`SetWindowsHookEx`) via rdev — this matters because
 * the previous keyboard path (`tauri-plugin-global-shortcut`, which
 * wraps Win32 `RegisterHotKey`) is swallowed by DirectX-exclusive
 * fullscreen games. Low-level hooks see those keys even when a game
 * owns input capture.
 */
export async function setupHotkey(
  accelerator: string,
  onEvent: (event: HotkeyEventPayload) => void,
): Promise<() => Promise<void>> {
  await teardownHotkey();

  await invoke("set_hotkey", { accelerator });
  currentAccelerator = accelerator;

  eventUnlisten = await listen<HotkeyEventPayload>("hotkey", (e) => {
    // The Rust side already filters by the configured hotkey, but keep
    // the JS-side accelerator check as defence-in-depth in case a stale
    // event slips through during a hot-swap.
    if (e.payload.accelerator === accelerator) {
      onEvent(e.payload);
    }
  });

  return teardownHotkey;
}

export async function teardownHotkey(): Promise<void> {
  if (eventUnlisten) {
    eventUnlisten();
    eventUnlisten = null;
  }
  if (currentAccelerator) {
    try {
      await invoke("clear_hotkey");
    } catch {
      // ignore — clearing a non-existent hotkey is a no-op
    }
  }
  currentAccelerator = null;
}

export function isMouseHotkey(accelerator: string): boolean {
  return /^Mouse\d+$/i.test(accelerator);
}

/** Map a browser KeyboardEvent to the same Tauri-accelerator string
 *  format used by HotkeyCapture and by the Rust-side rdev path. Used
 *  by the window-level keydown fallback in App.tsx so that PTT also
 *  triggers when the Companion window has focus — WebView2 swallows
 *  keystrokes from the global WH_KEYBOARD_LL when focused, but the
 *  document-level keydown handler still sees them. */
export function formatKeyboardAccelerator(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Control");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");

  const code = e.code;
  let key: string | null = null;

  if (/^Key[A-Z]$/.test(code)) {
    key = code.slice(3);
  } else if (/^Digit[0-9]$/.test(code)) {
    key = code.slice(5);
  } else if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) {
    key = code;
  } else if (code === "Space") {
    key = "Space";
  } else if (code === "Tab") {
    key = "Tab";
  } else if (code === "Enter" || code === "NumpadEnter") {
    key = "Enter";
  } else if (code === "Backspace") {
    key = "Backspace";
  } else if (code === "ArrowLeft") {
    key = "Left";
  } else if (code === "ArrowRight") {
    key = "Right";
  } else if (code === "ArrowUp") {
    key = "Up";
  } else if (code === "ArrowDown") {
    key = "Down";
  } else if (code === "Home") {
    key = "Home";
  } else if (code === "End") {
    key = "End";
  } else if (code === "PageUp") {
    key = "PageUp";
  } else if (code === "PageDown") {
    key = "PageDown";
  } else if (code === "Insert") {
    key = "Insert";
  } else if (code === "Delete") {
    key = "Delete";
  } else if (code.startsWith("Numpad")) {
    key = code;
  } else if (/^[!-~]$/.test(e.key)) {
    key = e.key.toUpperCase();
  }

  if (!key) return null;
  return [...mods, key].join("+");
}

/** Same as formatKeyboardAccelerator but for keyup events, where the
 *  modifier mask (ctrlKey/shiftKey/etc.) may already be off because
 *  the user released the modifier slightly before the main key. We
 *  ignore modifier state on release and just match the main key part. */
export function keyReleaseMatchesAccelerator(e: KeyboardEvent, accelerator: string): boolean {
  if (isMouseHotkey(accelerator)) return false;
  const expectedMain = accelerator.split("+").pop();
  if (!expectedMain) return false;
  // Reuse formatKeyboardAccelerator's mapping by faking the event with
  // no modifiers, so we only compare the main key.
  const fake = new KeyboardEvent("keyup", {
    code: e.code,
    key: e.key,
  });
  const formatted = formatKeyboardAccelerator(fake);
  return formatted === expectedMain;
}
