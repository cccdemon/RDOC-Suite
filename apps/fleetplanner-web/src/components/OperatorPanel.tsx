import { useEffect, useState } from "react";
import {
  ApiError,
  answerQuestion,
  assignSeat,
  decideUnit,
  getOperatorView,
} from "../api/client";
import type { OperationDetail, OperatorView } from "../api/types";

/** Operator console (SPA) — pending units, flexible signups → seats,
 *  questions, hangar shares. Data: GET /operator + the loaded op detail. */
export function OperatorPanel({
  op,
  csrf,
  onChanged,
  onError,
}: {
  op: OperationDetail;
  csrf: string;
  onChanged: () => void;
  onError: (msg: string) => void;
}) {
  const [view, setView] = useState<OperatorView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [picks, setPicks] = useState<Record<string, string>>({});

  function reload() {
    getOperatorView(op.id)
      .then(setView)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Operator-Daten nicht ladbar."));
  }
  useEffect(reload, [op.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      reload();
      onChanged();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }

  const pendingUnits = op.units.filter((u) => u.status === "pending");
  const openSeats = op.units
    .filter((u) => u.status === "accepted")
    .flatMap((u) => u.seats.filter((s) => !s.claimedBy).map((s) => ({ id: s.id, label: `${u.name} · ${s.label}` })));

  if (!view)
    return (
      <div className="fpw-state" data-testid="operator-loading">
        <span className="fpw-mono-label">LADE OPERATOR-DATEN…</span>
      </div>
    );

  const openQuestions = view.questions.filter((q) => !q.answer);
  const filled = op.units.filter((u) => u.status === "accepted").reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const openCount = openSeats.length;

  return (
    <div data-testid="operator-panel" style={{ display: "flex", flexDirection: "column", gap: "1rem", margin: "1.2rem 0" }}>
      <div className="fpw-kpis">
        <span className="fpw-kpi" style={{ borderColor: "rgba(0,255,136,.25)" }}>
          <span className="val" style={{ color: "var(--green)" }}>{filled}</span>
          <span className="lab">BESETZT</span>
        </span>
        <span className="fpw-kpi" style={{ borderColor: "rgba(240,165,0,.28)" }}>
          <span className="val" style={{ color: "var(--gold)" }}>{openCount}</span>
          <span className="lab">OFFEN</span>
        </span>
        <span className="fpw-kpi" style={{ borderColor: "rgba(240,165,0,.28)" }}>
          <span className="val" style={{ color: "var(--gold)" }}>{view.crewRequests.length}</span>
          <span className="lab">FLEX</span>
        </span>
        <span className="fpw-kpi" style={{ borderColor: "rgba(0,212,255,.2)" }}>
          <span className="val" style={{ color: "var(--cyan)" }}>{openQuestions.length}</span>
          <span className="lab">FRAGEN</span>
        </span>
      </div>
      {pendingUnits.length > 0 && (
        <section className="fpw-card">
          <div className="fpw-mono-label" style={{ marginBottom: "0.7rem" }}>ANSTEHENDE EINHEITEN ({pendingUnits.length})</div>
          {pendingUnits.map((u) => (
            <div key={u.id} className="fpw-seat">
              <span style={{ flex: 1, color: "var(--text-hi)" }}>
                {u.name} <span className="fpw-meta">· {u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</span>
              </span>
              <button type="button" className="fpw-btn" data-testid={`accept-${u.id}`} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }} onClick={() => run(() => decideUnit(op.id, u.id, "accept", csrf))}>
                Annehmen
              </button>
              <button type="button" className="fpw-btn" data-testid={`reject-${u.id}`} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem", color: "var(--red)", borderColor: "rgba(255,68,68,.45)", background: "rgba(255,68,68,.08)" }} onClick={() => run(() => decideUnit(op.id, u.id, "reject", csrf))}>
                Ablehnen
              </button>
            </div>
          ))}
        </section>
      )}

      <section className="fpw-card">
        <div className="fpw-mono-label" style={{ marginBottom: "0.7rem" }}>FLEXIBEL · TEILT MICH EIN ({view.crewRequests.length})</div>
        {view.crewRequests.length === 0 ? (
          <p className="fpw-meta" style={{ margin: 0 }}>Alle eingeteilt ✓</p>
        ) : (
          view.crewRequests.map((r) => (
            <div key={r.userId} className="fpw-seat">
              <span style={{ flex: 1, minWidth: 0, color: "var(--text-hi)" }}>
                {r.username}
                {r.note && <span className="fpw-meta"> · {r.note}</span>}
              </span>
              <select
                value={picks[r.userId] ?? ""}
                data-testid={`pick-${r.userId}`}
                onChange={(e) => setPicks((p) => ({ ...p, [r.userId]: e.target.value }))}
                style={{ maxWidth: 220, background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", padding: "0.4rem", borderRadius: 8 }}
              >
                <option value="">— Platz wählen —</option>
                {openSeats.map((s) => (
                  <option key={s.id} value={s.id}>{s.label}</option>
                ))}
              </select>
              <button
                type="button"
                className="fpw-btn"
                data-testid={`assign-${r.userId}`}
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}
                disabled={!picks[r.userId]}
                onClick={() => run(() => assignSeat(op.id, picks[r.userId], r.userId, csrf))}
              >
                Einteilen
              </button>
            </div>
          ))
        )}
      </section>

      <section className="fpw-card">
        <div className="fpw-mono-label" style={{ marginBottom: "0.7rem" }}>FRAGEN ({openQuestions.length} offen)</div>
        {view.questions.length === 0 ? (
          <p className="fpw-meta" style={{ margin: 0 }}>Keine Fragen.</p>
        ) : (
          view.questions.map((q) => (
            <div key={q.id} style={{ borderBottom: "1px solid rgba(255,255,255,.06)", padding: "0.5rem 0" }}>
              <div style={{ color: "var(--text-hi)", fontSize: "0.9rem" }}>{q.asker}</div>
              <div className="fpw-meta" style={{ margin: "0.2rem 0 0.4rem" }}>{q.body}</div>
              {q.answer ? (
                <div className="fpw-meta" style={{ color: "var(--green)" }}>✓ {q.answeredBy}: {q.answer}</div>
              ) : (
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  <input
                    type="text"
                    value={drafts[q.id] ?? ""}
                    data-testid={`answer-input-${q.id}`}
                    onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                    placeholder="Antwort…"
                    style={{ flex: 1, background: "var(--bg3)", border: "1px solid rgba(0,212,255,.14)", color: "var(--text)", fontFamily: "var(--body)", padding: "0.45rem 0.6rem", borderRadius: 8, outline: "none" }}
                  />
                  <button
                    type="button"
                    className="fpw-btn"
                    data-testid={`answer-send-${q.id}`}
                    style={{ padding: "0.3rem 0.7rem", fontSize: "0.68rem" }}
                    disabled={!(drafts[q.id] ?? "").trim()}
                    onClick={() => run(() => answerQuestion(op.id, q.id, drafts[q.id].trim(), csrf))}
                  >
                    Senden
                  </button>
                </div>
              )}
            </div>
          ))
        )}
      </section>

      <section className="fpw-card">
        <div className="fpw-mono-label" style={{ marginBottom: "0.5rem" }}>HANGAR-FREIGABEN</div>
        <p className="fpw-meta" style={{ marginTop: 0 }}>Nur für Operatoren sichtbar.</p>
        {view.hangarShares.length === 0 ? (
          <p className="fpw-meta" style={{ margin: 0 }}>Noch keine Freigaben.</p>
        ) : (
          view.hangarShares.map((h) => (
            <div key={h.userId} style={{ padding: "0.35rem 0" }}>
              <span style={{ color: "var(--text-hi)" }}>{h.username}</span>{" "}
              <span className="fpw-meta">{h.ships.map((s) => s.name).join(", ") || "—"}</span>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
