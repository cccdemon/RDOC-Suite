import { useState } from "react";
import { Ic } from "./Icons";

const MONO = "var(--mono)";

// #1 Late-arrival ("nachkommen"): shows an amber "⏱ EST HH:MM" marker when set.
// Editable people (the person themselves or an operator) get a compact control to
// set/clear the ETA via an HH:MM time input. Read-only viewers just see the marker.
export function LateArrival({
  eta,
  canEdit,
  onSet,
  testid,
}: {
  eta: string | null;
  canEdit: boolean;
  onSet: (eta: string | null) => void;
  testid?: string;
}) {
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState(eta ?? "");

  // Amber marker (always shown when late, regardless of edit rights).
  const marker = eta ? (
    <span
      data-testid={testid ? `${testid}-marker` : undefined}
      title="Kommt später"
      style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "1px 7px", fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.04em", borderRadius: 4, border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", color: "var(--gold)", whiteSpace: "nowrap" }}
    >
      <Ic name="bolt" size={11} sw={2} /> EST {eta}
    </span>
  ) : null;

  if (!canEdit) return marker;

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      {marker}
      {open ? (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <input
            type="time"
            data-testid={testid ? `${testid}-input` : undefined}
            value={val}
            autoFocus
            onChange={(e) => setVal(e.target.value)}
            style={{ background: "var(--bg3)", border: "1px solid var(--edge-gold)", color: "var(--text)", fontFamily: MONO, fontSize: "0.66rem", padding: "0.12rem 0.3rem", borderRadius: 5, outline: "none" }}
          />
          <button type="button" data-testid={testid ? `${testid}-save` : undefined} title="Speichern" onClick={() => { if (/^([01]\d|2[0-3]):[0-5]\d$/.test(val)) { onSet(val); setOpen(false); } }} style={{ display: "inline-flex", padding: "0.15rem 0.3rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)", borderRadius: 5, cursor: "pointer" }}><Ic name="check" size={11} sw={2} /></button>
          <button type="button" title="Abbrechen" onClick={() => { setOpen(false); setVal(eta ?? ""); }} style={{ display: "inline-flex", padding: "0.15rem 0.3rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim2)", borderRadius: 5, cursor: "pointer" }}><Ic name="x" size={11} sw={2} /></button>
        </span>
      ) : (
        <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }} onClick={(e) => e.stopPropagation()}>
          <button type="button" data-testid={testid ? `${testid}-open` : undefined} title="Als Nachzügler markieren (Ankunftszeit)" onClick={() => { setVal(eta ?? ""); setOpen(true); }} style={{ display: "inline-flex", alignItems: "center", gap: 3, padding: "0.12rem 0.4rem", border: "1px solid var(--edge-gold)", background: "transparent", color: "var(--gold)", fontFamily: MONO, fontSize: "0.58rem", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap" }}>
            <Ic name="bolt" size={10} sw={1.8} /> {eta ? "ändern" : "Verspätung eintragen"}
          </button>
          {eta && (
            <button type="button" data-testid={testid ? `${testid}-clear` : undefined} title="Nachzügler-Markierung entfernen" onClick={() => onSet(null)} style={{ display: "inline-flex", padding: "0.12rem 0.3rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim2)", borderRadius: 5, cursor: "pointer" }}><Ic name="x" size={10} sw={2} /></button>
          )}
        </span>
      )}
    </span>
  );
}
