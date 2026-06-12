import { useState } from "react";
import { addLeader, ApiError, removeLeader } from "../api/client";
import type { OperationDetail } from "../api/types";
import { CardHead, MONO, card } from "./ui";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";

// Commanders tab of Op-Management: appoint / remove op leaders. Op-roles
// (Fleet Operator / Raid Leader / Wing Commander) are a later backend slice —
// for now this is add/remove only (addLeader takes just a userId).
export function CommandersPanel({ op, csrf, onChanged, onNotice }: { op: OperationDetail; csrf: string | null; onChanged: () => void; onNotice: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const canManage = op.viewerRole === "fleetoperator";

  async function run(action: () => Promise<unknown>) {
    if (!csrf) return;
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      onNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const leaderIds = new Set(op.leaders.map((l) => l.id));
  const candidates = (() => {
    const seen = new Map<string, string>();
    for (const u of op.units) {
      if (u.status !== "accepted") continue;
      for (const s of u.seats) if (s.claimedBy && !leaderIds.has(s.claimedBy.id)) seen.set(s.claimedBy.id, s.claimedBy.username);
    }
    return [...seen.entries()].map(([id, username]) => ({ id, username }));
  })();

  return (
    <section style={card} data-testid="commanders-panel">
      <CardHead icon="lead" label="EINSATZLEITUNG" tone="gold" />
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {op.leaders.length === 0 && <div style={{ color: "var(--dim2)", fontSize: "0.85rem" }}>Noch keine Leitung benannt.</div>}
        {op.leaders.map((l) => (
          <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.6rem 0.75rem", border: "1px solid rgba(0,212,255,0.1)", borderRadius: 9, background: "var(--row)" }}>
            <Avatar name={l.username} size={28} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: "0.9rem", color: "var(--text-hi)" }}>{l.username}</div>
              <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "var(--dim2)" }}>Leitung</div>
            </div>
            <span className="tag tag-gold">LEITUNG</span>
            {canManage && (
              <button type="button" data-testid={`leader-remove-${l.id}`} title="Leiter entfernen" disabled={busy} onClick={() => run(() => removeLeader(op.id, l.id, csrf!))} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "var(--dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                <Ic name="x" size={12} sw={2} />
              </button>
            )}
          </div>
        ))}
      </div>

      {canManage && (
        <div style={{ marginTop: "1rem", borderTop: "1px solid var(--border)", paddingTop: "0.9rem" }}>
          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim)", marginBottom: "0.6rem" }}>TEILNEHMER ERNENNEN</div>
          {candidates.length === 0 ? (
            <div style={{ color: "var(--dim2)", fontSize: "0.82rem" }}>Keine geeigneten Teilnehmer (Leiter müssen einen Sitz belegen).</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {candidates.map((c) => (
                <button key={c.id} type="button" data-testid={`leader-cand-${c.id}`} disabled={busy} onClick={() => run(() => addLeader(op.id, c.id, csrf!))} style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.45rem 0.55rem", border: "1px solid rgba(0,212,255,0.2)", background: "rgba(0,212,255,0.04)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}>
                  <Avatar name={c.username} size={24} />
                  <span style={{ flex: 1, fontSize: "0.84rem", color: "var(--text-hi)" }}>{c.username}</span>
                  <Ic name="plus" size={14} sw={2} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
