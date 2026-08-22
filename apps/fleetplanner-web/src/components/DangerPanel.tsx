import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ApiError, deleteOperation, setOperationStatus } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { CardHead, DangerZone, MONO, btnGhost, card, inp } from "./ui";

// Handoff §7.4 — the heavy end of managing an operation, kept away from the
// routine controls.
//
// Deleting used to sit in the Eckdaten form, one scroll below the title and the
// start time: the most destructive action in the product shared a box with the
// most ordinary edits. Ending and cancelling were only reachable through the
// status strip in the header, where they look exactly like switching to
// "Startet". Both now have a place that says what they do.

const dangerButton: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 7,
  minHeight: 38,
  padding: "0.5rem 1rem",
  border: "1px solid var(--edge-red)",
  background: "var(--tint-red)",
  color: "var(--red)",
  fontFamily: MONO,
  fontSize: "0.74rem",
  borderRadius: 9,
  cursor: "pointer",
};

export function DangerPanel({
  op,
  opId,
  csrf,
  reload,
  onNotice,
}: {
  op: OperationDetail;
  opId: string;
  csrf: string | null;
  reload: () => void;
  onNotice: (m: string) => void;
}) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [armed, setArmed] = useState(false);
  const [typed, setTyped] = useState("");

  // Typing the name is the point: a confirm button alone is muscle memory, and
  // this is the one action nobody can undo.
  const nameMatches = typed.trim() === op.title.trim();

  async function toStatus(next: "completed" | "cancelled", done: string) {
    if (!csrf || busy) return;
    setBusy(true);
    try {
      await setOperationStatus(opId, csrf, next);
      onNotice(done);
      reload();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Statuswechsel fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!csrf || busy || !nameMatches) return;
    setBusy(true);
    try {
      await deleteOperation(opId, csrf);
      navigate("/operationen");
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Löschen fehlgeschlagen.");
      setBusy(false);
    }
  }

  const done = op.status === "completed";
  const cancelled = op.status === "cancelled";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
      <section style={card} data-card="work" data-testid="op-closeout">
        <CardHead icon="check" label="OPERATION BEENDEN" tone="gold" />
        <p style={{ margin: "0 0 0.9rem", color: "var(--dim)", fontSize: "0.85rem", lineHeight: 1.5 }}>
          Beides ist ein Statuswechsel und bleibt umkehrbar — die Operation und ihre Aufstellung
          bleiben erhalten. <strong style={{ color: "var(--text)" }}>Abgesagt</strong> entfernt
          zusätzlich das Discord-Event.
        </p>
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap" }}>
          <button
            type="button"
            data-testid="op-complete"
            disabled={busy || !csrf || done}
            onClick={() => toStatus("completed", "Operation abgeschlossen.")}
            style={{ ...btnGhost, opacity: done ? 0.5 : 1 }}
          >
            <Ic name="check" size={14} sw={1.8} /> {done ? "Bereits abgeschlossen" : "Operation abschließen"}
          </button>
          <button
            type="button"
            data-testid="op-cancel"
            disabled={busy || !csrf || cancelled}
            onClick={() => toStatus("cancelled", "Operation abgesagt.")}
            style={{ ...dangerButton, opacity: cancelled ? 0.5 : 1 }}
          >
            <Ic name="ban" size={14} sw={1.8} /> {cancelled ? "Bereits abgesagt" : "Operation absagen"}
          </button>
        </div>
      </section>

      <DangerZone
        testid="op-danger-zone"
        description={
          <>
            Löschen entfernt die Operation mit Aufstellung, Sitzen, Fragen und Dokumenten
            <strong style={{ color: "var(--text)" }}> unwiderruflich</strong>. Wer sie nur beenden
            will, nimmt oben „Abschließen" oder „Absagen".
          </>
        }
      >
        {!armed ? (
          <button type="button" data-testid="op-delete" disabled={busy || !csrf} onClick={() => setArmed(true)} style={dangerButton}>
            <Ic name="x" size={14} sw={1.8} /> Operation löschen
          </button>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
            <label htmlFor="op-delete-name" style={{ color: "var(--text)", fontSize: "0.85rem" }}>
              Zum Bestätigen den Namen der Operation eingeben: <strong>{op.title}</strong>
            </label>
            <input
              id="op-delete-name"
              data-testid="op-delete-name"
              type="text"
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={op.title}
              style={inp}
            />
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid="op-delete-confirm"
                disabled={busy || !csrf || !nameMatches}
                onClick={remove}
                style={{ ...dangerButton, opacity: nameMatches ? 1 : 0.45, cursor: nameMatches ? "pointer" : "not-allowed" }}
              >
                Endgültig löschen
              </button>
              <button type="button" data-testid="op-delete-cancel" disabled={busy} onClick={() => { setArmed(false); setTyped(""); }} style={btnGhost}>
                Abbrechen
              </button>
            </div>
          </div>
        )}
      </DangerZone>
    </div>
  );
}
