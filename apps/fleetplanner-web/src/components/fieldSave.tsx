// Operator-console redesign (Variante A "Tabs + Live"): one save-state model for
// EVERY field. Text fields debounce 600 ms then save; toggles/selects/status save
// immediately. Each field shows its own status; a single global badge mirrors
// "something is saving right now". State lives in a context so the badge in the
// sticky header reflects saves happening in any tab/child.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { MONO } from "./ui";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

type Ctx = {
  status: (id: string) => SaveStatus;
  touch: (id: string) => void; // saving → (480ms) saved → (2100ms) idle
  fail: (id: string) => void; // → error
  anySaving: boolean;
};

const FieldSaveContext = createContext<Ctx | null>(null);

export function FieldSaveProvider({ children }: { children: ReactNode }) {
  const [map, setMap] = useState<Record<string, SaveStatus>>({});
  // Per-id timers (saved/idle), cleared on re-touch + unmount.
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);

  const set = useCallback((id: string, s: SaveStatus) => setMap((m) => ({ ...m, [id]: s })), []);

  const touch = useCallback((id: string) => {
    set(id, "saving");
    clearTimeout(timers.current[id + ":s"]);
    clearTimeout(timers.current[id + ":i"]);
    timers.current[id + ":s"] = setTimeout(() => set(id, "saved"), 480);
    timers.current[id + ":i"] = setTimeout(() => set(id, "idle"), 2100);
  }, [set]);

  const fail = useCallback((id: string) => {
    clearTimeout(timers.current[id + ":s"]);
    clearTimeout(timers.current[id + ":i"]);
    set(id, "error");
  }, [set]);

  const status = useCallback((id: string) => map[id] ?? "idle", [map]);
  const anySaving = useMemo(() => Object.values(map).some((s) => s === "saving"), [map]);

  const value = useMemo<Ctx>(() => ({ status, touch, fail, anySaving }), [status, touch, fail, anySaving]);
  return <FieldSaveContext.Provider value={value}>{children}</FieldSaveContext.Provider>;
}

export function useFieldSave(): Ctx {
  const ctx = useContext(FieldSaveContext);
  if (!ctx) throw new Error("useFieldSave must be used within FieldSaveProvider");
  return ctx;
}

const DOT: Record<Exclude<SaveStatus, "idle">, [string, string, string, string]> = {
  // [color, label, border, bg]
  saving: ["var(--cyan)", "speichert…", "var(--border)", "var(--wash)"],
  saved: ["var(--green)", "gespeichert ✓", "var(--edge-green)", "var(--tint-green)"],
  error: ["var(--red2)", "Fehler ⟳", "var(--edge-red)", "var(--tint-red)"],
};

/** Tiny per-field status pill. Renders nothing while idle. */
export function SaveDot({ id }: { id: string }) {
  const { status } = useFieldSave();
  const s = status(id);
  if (s === "idle") return null;
  const [color, label, border, bg] = DOT[s];
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "2px 7px", borderRadius: 6, border: `1px solid ${border}`, background: bg, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.04em", color, whiteSpace: "nowrap" }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, animation: s === "saving" ? "fpwPulseDot 1s infinite" : "none" }} />
      {label}
    </span>
  );
}

/** Header badge: reflects "anything saving right now" across all tabs. */
export function GlobalSaveBadge() {
  const { anySaving } = useFieldSave();
  return (
    <span data-testid="global-save-badge" style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "5px 11px", borderRadius: 8, border: `1px solid ${anySaving ? "var(--border)" : "var(--edge-green)"}`, background: anySaving ? "var(--wash)" : "var(--tint-green)" }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: anySaving ? "var(--cyan)" : "var(--green)", animation: anySaving ? "fpwPulseDot 1s infinite" : "none" }} />
      <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: anySaving ? "var(--cyan)" : "var(--green)" }}>{anySaving ? "SPEICHERT LIVE…" : "ALLE ÄNDERUNGEN LIVE GESPEICHERT"}</span>
    </span>
  );
}

/** Per-key trailing-edge debounce (default 600 ms) for text autosave. */
export function useDebouncer(ms = 600) {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  useEffect(() => {
    const t = timers.current;
    return () => { Object.values(t).forEach(clearTimeout); };
  }, []);
  return useCallback((key: string, fn: () => void) => {
    clearTimeout(timers.current[key]);
    timers.current[key] = setTimeout(fn, ms);
  }, [ms]);
}
