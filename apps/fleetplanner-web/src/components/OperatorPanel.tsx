import { useEffect, useState } from "react";
import {
  ApiError,
  answerQuestion,
  assignSeat,
  decideUnit,
  getOperatorView,
  unassignSeat,
} from "../api/client";
import type { FleetUnit, OperationDetail, OperatorView } from "../api/types";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";

const MONO = "var(--mono)";

// design lanes (same as the player board)
const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", accent: "#00d4ff", rgb: "0,212,255" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "#f0a500", rgb: "240,165,0" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "#ff7a45", rgb: "255,122,69" },
] as const;

const card: React.CSSProperties = {
  border: "1px solid rgba(0,212,255,0.13)",
  borderRadius: 14,
  background: "#090f18",
  padding: "1.1rem 1.2rem",
};
const railLabel: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.66rem",
  letterSpacing: "0.12em",
  color: "#9fb1c2",
  marginBottom: "0.7rem",
};
const opActBtn = (danger: boolean): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  justifyContent: "flex-start",
  padding: "0.6rem 0.8rem",
  fontFamily: MONO,
  fontSize: "0.74rem",
  letterSpacing: "0.03em",
  borderRadius: 8,
  cursor: "pointer",
  border: danger ? "1px solid rgba(255,68,68,0.32)" : "1px solid rgba(0,212,255,0.18)",
  background: danger ? "rgba(255,68,68,0.05)" : "rgba(0,212,255,0.04)",
  color: danger ? "#ff6b6b" : "#c2d2de",
  textDecoration: "none",
});

function seatIcon(u: FleetUnit, order: number): string {
  if (u.unitType === "squad") return "fps";
  return order === 0 ? "pilot" : "gunner";
}

/** Operator console — design "Befehlsstand" layout: sticky control rail (fill
 *  ring, category bars, actions, leadership) + hero panels (Flex / Bedarfe /
 *  Fragen) over the fleet board with place-mode assignment. */
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
  const [placing, setPlacing] = useState<{ userId: string; name: string } | null>(null);
  const [picker, setPicker] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);

  function reload() {
    getOperatorView(op.id)
      .then(setView)
      .catch((e) => onError(e instanceof ApiError ? e.message : "Operator-Daten nicht ladbar."));
  }
  useEffect(reload, [op.id]); // eslint-disable-line react-hooks/exhaustive-deps

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      setPlacing(null);
      setPicker(null);
      reload();
      onChanged();
    } catch (e) {
      onError(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }

  const accepted = op.units.filter((u) => u.status === "accepted");
  const pendingUnits = op.units.filter((u) => u.status === "pending");
  const lanes = LANES.map((l) => ({ ...l, units: accepted.filter((u) => u.unitType === l.type) })).filter(
    (l) => l.units.length > 0,
  );
  const filled = accepted.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const total = accepted.reduce((a, u) => a + u.seats.length, 0);
  const open = total - filled;
  const fillPct = total ? Math.round((filled / total) * 100) : 0;
  const flexWaiting = view?.crewRequests.length ?? 0;
  const openQ = view?.questions.filter((q) => !q.answer).length ?? 0;

  const bars = LANES.map((l) => {
    const units = accepted.filter((u) => u.unitType === l.type);
    const f = units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
    const t = units.reduce((a, u) => a + u.seats.length, 0);
    return { label: l.label, accent: l.accent, f, t, pct: t ? Math.round((f / t) * 100) : 0 };
  }).filter((b) => b.t > 0);

  if (!view)
    return (
      <div className="fpw-state" data-testid="operator-loading">
        <span style={railLabel}>LADE OPERATOR-DATEN…</span>
      </div>
    );

  const kpi = (val: number, lab: string, color: string, border: string) => (
    <div key={lab} style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.42rem 0.7rem", border: `1px solid ${border}`, background: "rgba(255,255,255,0.01)", borderRadius: 8 }}>
      <span style={{ fontFamily: MONO, fontSize: "1.02rem", color, lineHeight: 1 }}>{val}</span>
      <span style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.08em", color: "#5b6b7a" }}>{lab}</span>
    </div>
  );

  // operator seat row (board): open seats are place-mode targets / picker triggers
  const opSeatRow = (u: FleetUnit, s: FleetUnit["seats"][number]) => {
    const isTarget = !!placing && !s.claimedBy;
    return (
      <div key={s.id} style={{ border: "1px solid rgba(0,212,255,0.06)", borderRadius: 9, overflow: "hidden" }}>
        <div
          data-testid={!s.claimedBy ? `op-target-${s.id}` : undefined}
          onClick={() => {
            if (s.claimedBy) return;
            if (placing) {
              run(() => assignSeat(op.id, s.id, placing.userId, csrf));
            } else {
              setPicker(picker === s.id ? null : s.id);
            }
          }}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.55rem 0.65rem",
            background: "rgba(255,255,255,0.013)",
            minWidth: 0,
            cursor: s.claimedBy ? "default" : "pointer",
            boxShadow: isTarget ? "0 0 0 1px rgba(0,255,136,0.5)" : "none",
          }}
        >
          <span style={{ width: 28, height: 28, borderRadius: 7, background: "#0e1926", border: "1px solid rgba(255,255,255,0.06)", color: "#9fb1c2", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Ic name={seatIcon(u, s.order)} size={15} sw={1.6} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <strong style={{ fontWeight: 600, fontSize: "0.9rem", color: "#dce8f0" }}>{s.label}</strong>
          </div>
          {s.claimedBy ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
              <Avatar name={s.claimedBy.username} />
              <span style={{ fontSize: "0.8rem", color: "#ccdde8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "6.5rem" }}>{s.claimedBy.username}</span>
              {s.order !== 0 && (
                <button
                  type="button"
                  data-testid={`op-free-${s.id}`}
                  title="Platz freigeben"
                  onClick={(e) => {
                    e.stopPropagation();
                    run(() => unassignSeat(op.id, s.id, csrf));
                  }}
                  style={{ flexShrink: 0, width: 21, height: 21, borderRadius: 6, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#7e92a4", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}
                >
                  <Ic name="x" size={11} sw={2} />
                </button>
              )}
            </div>
          ) : isTarget ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "#00ff88", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.05em" }}>
              HIER <Ic name="arrow" size={13} sw={1.9} />
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 4, flexShrink: 0, color: "#00d4ff", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.03em" }}>
              <Ic name="plus" size={13} sw={1.9} /> Einteilen
            </span>
          )}
        </div>
        {picker === s.id && !s.claimedBy && !placing && (
          <div style={{ borderTop: "1px solid rgba(0,212,255,0.12)", padding: "0.6rem", display: "flex", flexDirection: "column", gap: "0.35rem", background: "#0a121c" }}>
            <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>WER SOLL HIER REIN?</div>
            {view.crewRequests.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.78rem" }}>Keine flexiblen Anmeldungen.</div>}
            {view.crewRequests.map((r) => (
              <button
                key={r.userId}
                type="button"
                data-testid={`op-pick-${r.userId}`}
                onClick={(e) => {
                  e.stopPropagation();
                  run(() => assignSeat(op.id, s.id, r.userId, csrf));
                }}
                style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", textAlign: "left", padding: "0.4rem 0.5rem", border: "1px solid rgba(240,165,0,0.28)", background: "rgba(240,165,0,0.05)", borderRadius: 7, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}
              >
                <Avatar name={r.username} />
                <span style={{ flex: 1, fontSize: "0.84rem", color: "#eaf4fb" }}>{r.username}</span>
                <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#f0a500" }}>FLEX</span>
              </button>
            ))}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPicker(null);
              }}
              style={{ padding: "0.4rem 0.6rem", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.64rem", borderRadius: 7, cursor: "pointer" }}
            >
              Schließen
            </button>
          </div>
        )}
      </div>
    );
  };

  return (
    <div data-testid="operator-panel">
      {/* PLACE-MODE BANNER */}
      {placing && (
        <div
          style={{
            position: "sticky",
            top: 58,
            zIndex: 60,
            display: "flex",
            alignItems: "center",
            gap: "0.7rem",
            padding: "0.7rem 1rem",
            marginBottom: "1.1rem",
            border: "1px solid rgba(240,165,0,0.55)",
            background: "linear-gradient(90deg,rgba(240,165,0,0.16),rgba(240,165,0,0.04))",
            borderRadius: 10,
            boxShadow: "0 8px 28px rgba(0,0,0,0.45)",
          }}
        >
          <span style={{ color: "#f0a500", display: "inline-flex", flexShrink: 0 }}><Ic name="swap" size={17} sw={1.8} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.12em", color: "#f0a500" }}>EINTEILEN-MODUS</span>
            <div style={{ color: "#eaf4fb", fontSize: "0.92rem", marginTop: 1 }}>
              <strong>{placing.name}</strong> — wähle unten einen offenen Platz <span style={{ color: "#f0c97a" }}>(grün markiert)</span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setPlacing(null)}
            style={{ flexShrink: 0, padding: "0.42rem 0.8rem", border: "1px solid rgba(255,255,255,0.18)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}
          >
            Abbrechen
          </button>
        </div>
      )}

      {/* KPI STRIP */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "flex-end", gap: "0.5rem", marginBottom: "1.4rem" }}>
        {kpi(filled, "BESETZT", "#00ff88", "rgba(0,255,136,0.25)")}
        {kpi(open, "OFFEN", "#f0a500", "rgba(240,165,0,0.28)")}
        {kpi(flexWaiting, "FLEX", "#f0a500", "rgba(240,165,0,0.28)")}
        {kpi(openQ, "FRAGEN", "#00d4ff", "rgba(0,212,255,0.2)")}
      </div>

      {/* LAYOUT A · BEFEHLSSTAND */}
      <div style={{ display: "flex", gap: "1.3rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* LEFT CONTROL RAIL */}
        <aside style={{ flex: "0 0 286px", maxWidth: "100%", position: "sticky", top: 84, alignSelf: "flex-start", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <section style={card}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.9rem", marginBottom: bars.length ? "1rem" : 0 }}>
              <div
                style={{
                  width: 88,
                  height: 88,
                  borderRadius: "50%",
                  flexShrink: 0,
                  position: "relative",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: `conic-gradient(#00ff88 ${fillPct * 3.6}deg, #0e1926 ${fillPct * 3.6}deg)`,
                }}
              >
                <div style={{ position: "absolute", inset: 7, borderRadius: "50%", background: "#090f18", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: "#eaf4fb", lineHeight: 1 }}>{fillPct}%</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.48rem", letterSpacing: "0.1em", color: "#5b6b7a" }}>VOLL</span>
                </div>
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 5, border: "1px solid rgba(0,255,136,0.4)", color: "#00ff88", background: "rgba(0,255,136,0.08)", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.08em", padding: "0.16rem 0.45rem", borderRadius: 4, textTransform: "uppercase" }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 6px #00ff88" }} />
                  {op.status}
                </span>
                <div style={{ fontWeight: 700, fontSize: "1rem", color: "#eaf4fb", marginTop: "0.4rem", lineHeight: 1.1 }}>
                  {filled} / {total} Plätze
                </div>
                <div style={{ color: "#7e92a4", fontSize: "0.76rem", marginTop: 1 }}>
                  {open} offen · {flexWaiting} flexibel
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
              {bars.map((b) => (
                <div key={b.label}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "0.28rem" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.78rem", color: "#c2d2de" }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: b.accent }} />
                      {b.label}
                    </span>
                    <span style={{ fontFamily: MONO, fontSize: "0.74rem", color: "#9fb1c2" }}>{b.f}/{b.t}</span>
                  </div>
                  <div style={{ height: 5, borderRadius: 4, background: "#0e1926", overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${b.pct}%`, background: b.accent, borderRadius: 4 }} />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section style={card}>
            <div style={railLabel}>OPERATOR-AKTIONEN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <a href={`/fleetplanner/ops/${op.id}/manage?tab=overview`} style={opActBtn(false)}>
                <Ic name="board" size={14} /> Operation bearbeiten
              </a>
              <a href={`/fleetplanner/ops/${op.id}/manage?tab=fleet`} style={opActBtn(false)}>
                <Ic name="ship" size={14} /> Slots verwalten
              </a>
              <a href={`/fleetplanner/ops/${op.id}/manage?tab=admin`} style={opActBtn(false)}>
                <Ic name="bolt" size={14} /> Admin / Status
              </a>
            </div>
          </section>

          {op.leaders.length > 0 && (
            <section style={card}>
              <div style={railLabel}>LEITUNG</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {op.leaders.map((l) => (
                  <div key={l.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                    <Avatar name={l.username} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: "0.85rem", color: "#eaf4fb" }}>{l.username}</div>
                      <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "#5b6b7a" }}>Leitung</div>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </aside>

        {/* MAIN WORK AREA */}
        <div style={{ flex: "1 1 380px", minWidth: 0 }}>
          {/* HERO PANELS */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginBottom: "1.6rem" }}>
            <section style={{ ...card, flex: "1 1 270px", minWidth: 0, border: "1px solid rgba(240,165,0,0.22)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
                <span style={{ color: "#f0a500", display: "inline-flex" }}><Ic name="swap" size={15} /></span>
                <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: "#f0a500" }}>FLEXIBEL</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "#5b6b7a" }}>{flexWaiting} wartet</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {view.crewRequests.length === 0 ? (
                  <div style={{ padding: "0.7rem", textAlign: "center", color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Alle eingeteilt ✓</div>
                ) : (
                  view.crewRequests.map((r) => {
                    const isPlacing = placing?.userId === r.userId;
                    return (
                      <div
                        key={r.userId}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "0.6rem",
                          padding: "0.6rem 0.7rem",
                          borderRadius: 9,
                          border: isPlacing ? "1px solid rgba(240,165,0,0.6)" : "1px solid rgba(255,255,255,0.06)",
                          background: isPlacing ? "rgba(240,165,0,0.08)" : "transparent",
                        }}
                      >
                        <Avatar name={r.username} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontSize: "0.9rem", color: "#eaf4fb" }}>{r.username}</strong>
                          {r.note && (
                            <div style={{ color: "#7e92a4", fontSize: "0.76rem", marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{r.note}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          data-testid={`op-place-${r.userId}`}
                          onClick={() => setPlacing(isPlacing ? null : { userId: r.userId, name: r.username })}
                          style={{
                            flexShrink: 0,
                            padding: "0.38rem 0.7rem",
                            borderRadius: 7,
                            cursor: "pointer",
                            fontFamily: MONO,
                            fontSize: "0.7rem",
                            letterSpacing: "0.03em",
                            border: isPlacing ? "1px solid rgba(255,68,68,0.45)" : "1px solid rgba(240,165,0,0.45)",
                            background: isPlacing ? "rgba(255,68,68,0.08)" : "rgba(240,165,0,0.1)",
                            color: isPlacing ? "#ff6b6b" : "#f0a500",
                          }}
                        >
                          {isPlacing ? "Abbrechen" : "Einteilen"}
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </section>

            <section style={{ ...card, flex: "1 1 270px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
                <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="alert" size={15} /></span>
                <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>OFFENE BEDARFE</span>
                <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.66rem", color: "#5b6b7a" }}>{open} offen</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.42rem" }}>
                {lanes.flatMap((lane) =>
                  lane.units
                    .map((u) => ({ u, lane, openN: u.seats.filter((s) => !s.claimedBy).length }))
                    .filter((x) => x.openN > 0)
                    .map(({ u, lane, openN }) => (
                      <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.45rem 0.55rem", border: "1px solid rgba(255,255,255,0.05)", borderRadius: 8 }}>
                        <span style={{ width: 8, height: 8, borderRadius: 2, background: lane.accent, flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.85rem", color: "#dce8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</div>
                          <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.04em", color: "#5b6b7a", marginTop: 1 }}>{lane.label}</div>
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: "0.9rem", color: "#f0a500", flexShrink: 0 }}>{openN}</span>
                      </div>
                    )),
                )}
                {open === 0 && <div style={{ padding: "0.5rem", color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Keine offenen Plätze ✓</div>}
              </div>
            </section>

            <section style={{ ...card, flex: "1 1 270px", minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.8rem" }}>
                <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="chat" size={15} /></span>
                <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>FRAGEN</span>
                {openQ > 0 && (
                  <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.58rem", color: "#f0a500", border: "1px solid rgba(240,165,0,0.4)", background: "rgba(240,165,0,0.08)", padding: "0.08rem 0.4rem", borderRadius: 10 }}>{openQ} offen</span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
                {view.questions.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem", fontFamily: MONO }}>Keine Fragen.</div>}
                {view.questions.map((q) => (
                  <div key={q.id} style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 9, padding: "0.6rem 0.65rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.4rem" }}>
                      <Avatar name={q.asker} />
                      <strong style={{ fontSize: "0.82rem", color: "#eaf4fb" }}>{q.asker}</strong>
                    </div>
                    <div style={{ color: "#c2d2de", fontSize: "0.84rem", lineHeight: 1.42, marginBottom: "0.5rem" }}>{q.body}</div>
                    {q.answer ? (
                      <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", padding: "0.45rem 0.55rem", border: "1px solid rgba(0,255,136,0.28)", background: "rgba(0,255,136,0.05)", borderRadius: 8 }}>
                        <span style={{ color: "#00ff88", display: "inline-flex", flexShrink: 0, marginTop: 2 }}><Ic name="check" size={13} sw={2} /></span>
                        <div style={{ minWidth: 0 }}>
                          <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#00ff88" }}>{q.answeredBy ?? ""}</span>
                          <div style={{ color: "#c2d2de", fontSize: "0.82rem", lineHeight: 1.4 }}>{q.answer}</div>
                        </div>
                      </div>
                    ) : (
                      <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
                        <textarea
                          value={drafts[q.id] ?? ""}
                          data-testid={`answer-input-${q.id}`}
                          onChange={(e) => setDrafts((d) => ({ ...d, [q.id]: e.target.value }))}
                          placeholder="Antwort…"
                          style={{ flex: 1, minWidth: 0, minHeight: 36, background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.84rem", padding: "0.42rem 0.55rem", borderRadius: 8, outline: "none", resize: "vertical" }}
                        />
                        <button
                          type="button"
                          data-testid={`answer-send-${q.id}`}
                          disabled={!(drafts[q.id] ?? "").trim()}
                          onClick={() => run(() => answerQuestion(op.id, q.id, drafts[q.id].trim(), csrf))}
                          style={{ flexShrink: 0, padding: "0.5rem 0.65rem", border: "1px solid rgba(0,255,136,0.45)", background: "rgba(0,255,136,0.12)", color: "#00ff88", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 8, cursor: "pointer" }}
                        >
                          Senden
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* PENDING UNITS */}
          {pendingUnits.length > 0 && (
            <section style={{ ...card, marginBottom: "1.6rem", border: "1px solid rgba(240,165,0,0.22)" }}>
              <div style={railLabel}>ANSTEHENDE EINHEITEN ({pendingUnits.length})</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                {pendingUnits.map((u) => (
                  <div key={u.id} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.6rem 0.7rem", background: "rgba(255,255,255,0.013)", border: "1px solid rgba(240,165,0,0.14)", borderRadius: 9 }}>
                    <span style={{ flex: 1, minWidth: 0, color: "#eaf4fb", fontWeight: 600 }}>
                      {u.name} <span style={{ color: "#7e92a4", fontWeight: 400, fontSize: "0.84rem" }}>· {u.unitType}{u.captain ? ` · ${u.captain.username}` : ""}</span>
                    </span>
                    <button type="button" data-testid={`accept-${u.id}`} onClick={() => run(() => decideUnit(op.id, u.id, "accept", csrf))} style={{ padding: "0.38rem 0.7rem", border: "1px solid rgba(0,255,136,0.45)", background: "rgba(0,255,136,0.1)", color: "#00ff88", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, cursor: "pointer" }}>
                      Annehmen
                    </button>
                    <button type="button" data-testid={`reject-${u.id}`} onClick={() => run(() => decideUnit(op.id, u.id, "reject", csrf))} style={{ padding: "0.38rem 0.7rem", border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, cursor: "pointer" }}>
                      Ablehnen
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* FLEET BOARD */}
          <div style={{ fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.14em", color: "#9fb1c2", marginBottom: "1rem" }}>
            FLOTTEN-BOARD <span style={{ color: "#5b6b7a" }}>· Platz anklicken zum Besetzen</span>
          </div>
          <div className="fpw-board" style={{ gap: "0.85rem" }}>
            {lanes.map((lane) => (
              <div key={lane.type} style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", marginBottom: "0.8rem", paddingBottom: "0.5rem", borderBottom: `1px solid rgba(${lane.rgb},0.4)` }}>
                  <span style={{ color: lane.accent, display: "inline-flex", flexShrink: 0 }}><Ic name={lane.icon} size={15} /></span>
                  <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.06em", color: lane.accent, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{lane.label}</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "#9fb1c2", flexShrink: 0 }}>
                    {lane.units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0)}/
                    {lane.units.reduce((a, u) => a + u.seats.length, 0)}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                  {lane.units.map((u) => (
                    <div key={u.id} style={{ border: `1px solid rgba(${lane.rgb},0.16)`, borderRadius: 13, background: "#0b1019", padding: "1rem 1.1rem" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
                        <span style={{ width: 36, height: 36, borderRadius: 9, background: `rgba(${lane.rgb},0.1)`, border: `1px solid rgba(${lane.rgb},0.26)`, color: lane.accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                          <Ic name={lane.icon} size={18} sw={1.6} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong style={{ fontWeight: 700, fontSize: "1.02rem", color: "#eaf4fb", lineHeight: 1.15 }}>{u.name}</strong>
                          <div style={{ color: "#7e92a4", fontSize: "0.78rem", marginTop: 1 }}>
                            {u.unitType}
                            {u.captain ? ` · ${u.captain.username}` : ""}
                          </div>
                        </div>
                        <span style={{ fontFamily: MONO, fontSize: "0.95rem", color: "#eaf4fb", flexShrink: 0 }}>
                          {u.seats.filter((s) => s.claimedBy).length}
                          <span style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>/{u.seats.length}</span>
                        </span>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>{u.seats.map((s) => opSeatRow(u, s))}</div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* TOOLS */}
          <div style={{ marginTop: "1.2rem" }}>
            <button
              type="button"
              onClick={() => setToolsOpen((v) => !v)}
              style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0.85rem", border: "1px solid rgba(0,212,255,0.16)", background: "rgba(0,212,255,0.03)", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 8, cursor: "pointer" }}
            >
              <span style={{ display: "inline-flex", transform: toolsOpen ? "rotate(90deg)" : "none", transition: "transform .15s" }}><Ic name="chevron" size={14} /></span>
              Werkzeuge / Aktivität
            </button>
            {toolsOpen && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "1rem", marginTop: "0.9rem" }}>
                <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
                  <div style={railLabel}>AKTIVITÄT</div>
                  <div style={{ display: "flex", flexDirection: "column" }}>
                    {view.auditLogs.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>—</div>}
                    {view.auditLogs.slice(0, 12).map((a, i) => (
                      <div key={i} style={{ display: "flex", gap: "0.6rem", padding: "0.32rem 0", borderBottom: "1px solid rgba(255,255,255,0.05)", fontSize: "0.82rem" }}>
                        <span style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#5b6b7a", flexShrink: 0 }}>
                          {new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(new Date(a.createdAt))}
                        </span>
                        <span style={{ color: "#c2d2de" }}>
                          <strong style={{ color: "#eaf4fb" }}>{a.actor}</strong> {a.action}
                          {a.detail && <span style={{ color: "#7e92a4" }}> · {a.detail}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
                <section style={{ ...card, flex: "1 1 300px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                    <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="eye" size={15} /></span>
                    <span style={{ fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.12em", color: "#9fb1c2" }}>HANGAR-FREIGABEN</span>
                  </div>
                  <p style={{ margin: "0 0 0.9rem", color: "#7e92a4", fontSize: "0.78rem" }}>Nur für Operatoren sichtbar.</p>
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                    {view.hangarShares.length === 0 && <div style={{ color: "#5b6b7a", fontSize: "0.8rem" }}>Noch keine Freigaben.</div>}
                    {view.hangarShares.map((h) => (
                      <div key={h.userId} style={{ border: "1px solid rgba(0,212,255,0.1)", borderRadius: 10, padding: "0.7rem 0.8rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: h.ships.length ? "0.55rem" : 0 }}>
                          <Avatar name={h.username} />
                          <strong style={{ fontSize: "0.9rem", color: "#eaf4fb" }}>{h.username}</strong>
                          <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "#5b6b7a" }}>{h.ships.length} Schiffe</span>
                        </div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
                          {h.ships.map((sh) => (
                            <span key={sh.id} style={{ fontFamily: MONO, fontSize: "0.7rem", color: "#c2d2de", border: "1px solid rgba(0,212,255,0.16)", background: "#0e1926", padding: "0.22rem 0.5rem", borderRadius: 5 }}>
                              {sh.name}
                            </span>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
