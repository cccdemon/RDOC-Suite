import { useCallback, useEffect, useState } from "react";
import { Icon } from "./kit/Icon";
import { formatKeyboardAccelerator } from "../lib/hotkey";

type Props = {
  /** Current accelerator string (e.g. "Mouse4", "Alt+F1"). */
  value: string;
  onChange: (next: string) => void;
};

const MODIFIER_KEYS = new Set(["Control", "Alt", "Shift", "Meta", "ContextMenu"]);

export function HotkeyCapture({ value, onChange }: Props): JSX.Element {
  const [capturing, setCapturing] = useState(false);

  const onStart = useCallback(() => setCapturing(true), []);
  const onCancel = useCallback(() => setCapturing(false), []);

  useEffect(() => {
    if (!capturing) return;

    const onKey = (e: KeyboardEvent): void => {
      // Always swallow keys while capturing so typing into other fields
      // can't sneak through.
      e.preventDefault();
      e.stopPropagation();

      // Cancel capture without saving.
      if (e.key === "Escape") {
        setCapturing(false);
        return;
      }
      // Wait for the actual key — modifier-only presses don't count.
      if (MODIFIER_KEYS.has(e.key)) return;

      const formatted = formatKeyboardAccelerator(e);
      if (!formatted) return;
      onChange(formatted);
      setCapturing(false);
    };

    const onMouse = (e: MouseEvent): void => {
      // Button 0 = left click. The user just clicked "Erfassen" to
      // enter capture mode — accepting that left click would always
      // immediately set the hotkey to "Mouse1". Ignore.
      if (e.button === 0) return;
      e.preventDefault();
      e.stopPropagation();

      // rdev / tauri map button N (0-indexed) to "Mouse{N+1}":
      //   button 1 (middle) → Mouse2 (often "Mouse3" in some kits;
      //     we use Tauri convention)
      //   button 2 (right)  → Mouse3 — NOT recommended for PTT (eats
      //     the OS context menu)
      //   button 3 (back)   → Mouse4
      //   button 4 (forward)→ Mouse5
      // The user typed Mouse4 / Mouse5 before so that's the format.
      const accelerator = `Mouse${e.button + 1}`;
      onChange(accelerator);
      setCapturing(false);
    };

    // contextmenu fires on right-click; suppress while capturing so
    // a right-click PTT pick doesn't pop the OS menu.
    const onCtx = (e: Event): void => {
      e.preventDefault();
      e.stopPropagation();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("contextmenu", onCtx, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("contextmenu", onCtx, true);
    };
  }, [capturing, onChange]);

  return (
    <div className="cc-row" style={{ gap: 8, alignItems: "stretch" }}>
      <div
        className="cc-readout"
        style={{ flex: 1, gap: 8, fontSize: 13, color: capturing ? "var(--green)" : "var(--gold)" }}
      >
        {capturing ? (
          <>
            <Icon.radio size={12} className="cc-spin" />
            <span className="val">Drücke jetzt eine Taste oder Maustaste …</span>
          </>
        ) : (
          <>
            <span className="lbl">PTT</span>
            <span className="val">{value || "—"}</span>
          </>
        )}
      </div>
      {capturing ? (
        <button type="button" className="cc-btn ghost" onClick={onCancel} title="Abbrechen (Esc)">
          <Icon.x size={12} />
          ABBRECHEN
        </button>
      ) : (
        <button type="button" className="cc-btn cyan" onClick={onStart} title="Hotkey neu aufnehmen">
          <Icon.key size={12} />
          ERFASSEN
        </button>
      )}
    </div>
  );
}

// formatKeyboardAccelerator now lives in src/lib/hotkey.ts so it can be
// shared with the window-level keydown fallback in App.tsx.
