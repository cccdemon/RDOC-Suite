import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, claimSeat, cqbSignup, cqbWithdraw, getOperation, setHangarShare, unclaimSeat } from "../api/client";
import type { FleetUnit, OperationDetail, SessionResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { OfferShip } from "../components/OfferShip";
import { OperatorPanel } from "../components/OperatorPanel";
import { unassignSeat as operatorUnassignSeat } from "../api/client";
import { Ic } from "../components/Icons";

function fmtDate(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(iso));
}

const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", color: "#00d4ff", rgb: "0,212,255" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", color: "#f0a500", rgb: "240,165,0" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", color: "#ff7a45", rgb: "255,122,69" },
] as const;

function seatIcon(u: FleetUnit, order: number): string {
  if (u.unitType === "squad") return "fps";
  return order === 0 ? "pilot" : "gunner";
}

export function OpDetailPage({ session }: { session: SessionResponse | null }) {
  const { id } = useParams<{ id: string }>();
  const [op, setOp] = useState<OperationDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySeat, setBusySeat] = useState<string | null>(null);
  const [operatorMode, setOperatorMode] = useState(false);

  const load = useCallback(() => {
    if (!id) return;
    getOperation(id)
      .then(setOp)
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, null)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;

  async function onClaim(seatId: string) {
    if (!id || !csrf) return;
    setBusySeat(seatId);
    setNotice(null);
    try {
      await claimSeat(id, seatId, csrf);
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusySeat(null);
    }
  }

  async function onUnclaim(seatId: string) {
    if (!id || !csrf) return;
    setBusySeat(seatId);
    setNotice(null);
    try {
      await unclaimSeat(id, seatId, csrf);
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusySeat(null);
    }
  }

  async function run(action: () => Promise<unknown>) {
    if (!id || !csrf) return;
    setNotice(null);
    try {
      await action();
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }

  if (error) {
    const code = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 404 ? 404 : 503;
    const msg =
      code === 401
        ? "Diese Operation ist nicht öffentlich — bitte anmelden."
        : code === 404
          ? "Operation nicht gefunden."
          : "Operation konnte nicht geladen werden.";
    return <ErrorState code={code} message={msg} />;
  }
  if (!op)
    return (
      <div className="fpw-state">
        <span className="fpw-mono-label">LADE OPERATION…</span>
      </div>
    );

  const accepted = op.units.filter((u) => u.status === "accepted");
  const lanes = LANES.map((l) => ({ ...l, units: accepted.filter((u) => u.unitType === l.type) })).filter(
    (l) => l.units.length > 0,
  );
  const filled = accepted.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const total = accepted.reduce((a, u) => a + u.seats.length, 0);
  const pct = op.minParticipants > 0 ? Math.min(100, Math.round((filled / op.minParticipants) * 100)) : 0;

  const seatRow = (u: FleetUnit, s: FleetUnit["seats"][number]) => (
    <div key={s.id} className="fpw-seat">
      <span className="fpw-seat-icon">
        <Ic name={seatIcon(u, s.order)} size={15} sw={1.6} />
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
          <span className="fpw-seat-role">{s.label}</span>
          <span className="fpw-tag dim">FEST</span>
        </div>
      </div>
      {s.claimedBy ? (
        <>
          <span className="fpw-meta" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "8rem" }}>
            {s.claimedBy.username}
          </span>
          {operatorMode && op.canManage && s.order !== 0 && s.claimedBy.id !== me?.id && (
            <button
              type="button"
              className="fpw-btn"
              data-testid={`op-free-${s.id}`}
              title="Platz freigeben"
              style={{ padding: "0.25rem 0.5rem", fontSize: "0.68rem", color: "var(--red)", borderColor: "rgba(255,68,68,.45)", background: "rgba(255,68,68,.08)" }}
              onClick={() => run(() => operatorUnassignSeat(id!, s.id, csrf!))}
            >
              <Ic name="x" size={11} sw={2} />
            </button>
          )}
          {me && s.claimedBy.id === me.id && (
            <button
              type="button"
              className="fpw-btn"
              style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}
              disabled={busySeat === s.id}
              onClick={() => onUnclaim(s.id)}
              data-testid={`unclaim-${s.id}`}
            >
              Freigeben
            </button>
          )}
        </>
      ) : me && csrf && op.status === "open" ? (
        <button
          type="button"
          className="fpw-btn"
          style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}
          disabled={busySeat === s.id}
          onClick={() => onClaim(s.id)}
          data-testid={`claim-${s.id}`}
        >
          Platz nehmen <Ic name="arrow" size={12} sw={1.8} />
        </button>
      ) : (
        <span className="fpw-tag dashed">OFFEN</span>
      )}
    </div>
  );

  return (
    <article>
      <section className="fpw-hero">
        <div className="fpw-tagrow">
          <span className="fpw-tag green">
            <span className="fpw-dot" />
            {op.status}
          </span>
          <span className="fpw-tag cyan">{op.visibility}</span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#9fb1c2", fontFamily: "var(--mono)", fontSize: "0.66rem", letterSpacing: "0.06em" }}>
            <Ic name="clock" size={13} />
            {fmtDate(op.scheduledAt, op.guild.timezone).toUpperCase()}
          </span>
          {op.canManage && (
            <button
              type="button"
              className="fpw-btn"
              data-testid="operator-toggle"
              style={{ marginLeft: "auto", padding: "0.35rem 0.7rem", fontSize: "0.7rem", ...(operatorMode ? { background: "var(--gold)", color: "#04060a", borderColor: "var(--gold)" } : { color: "var(--gold)", borderColor: "rgba(240,165,0,.45)", background: "rgba(240,165,0,.08)" }) }}
              onClick={() => setOperatorMode((v) => !v)}
            >
              <Ic name="board" size={13} />
              {operatorMode ? "Operator-Ansicht ✓" : "Operator-Ansicht"}
            </button>
          )}
        </div>
        <h1 data-testid="op-title">{op.title}</h1>
        <div className="fpw-metarow">
          <span><Ic name="pin" size={15} sw={1.6} />{op.meetingLocation}</span>
          <span><Ic name="globe" size={15} sw={1.6} />{op.meetingSystem}</span>
          <span><Ic name="users" size={15} sw={1.6} />{filled} besetzt · min {op.minParticipants}</span>
          <span><Ic name="board" size={15} sw={1.6} />{op.guild.name}</span>
        </div>
      </section>

      {notice && (
        <p className="fpw-tag gold" role="alert" data-testid="op-notice" style={{ display: "inline-flex" }}>
          {notice}
        </p>
      )}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "1.1rem", margin: "1.1rem 0" }}>
        <section className="fpw-card" style={{ flex: "1.7 1 380px", minWidth: 0 }}>
          <div className="fpw-mono-label" style={{ marginBottom: "0.85rem" }}>MISSIONSZIEL</div>
          {op.description ? (
            <p style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: "1.02rem", lineHeight: 1.62, color: "#c2d2de" }}>{op.description}</p>
          ) : (
            <p className="fpw-meta" style={{ margin: 0 }}>Kein Missionsziel hinterlegt.</p>
          )}
          {op.resourceLinks.length > 0 && (
            <div style={{ marginTop: "1.2rem", borderTop: "1px solid rgba(0,212,255,.1)", paddingTop: "1rem" }}>
              <div className="fpw-mono-label" style={{ marginBottom: "0.7rem" }}>BRIEFING / LINKS</div>
              {op.resourceLinks.map((l) => (
                <div key={l.id} style={{ marginBottom: "0.35rem" }}>
                  <a href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", textDecoration: "none" }}>
                    {l.title} <span style={{ color: "var(--dim2)" }}>↗</span>
                  </a>
                </div>
              ))}
            </div>
          )}
        </section>
        <section className="fpw-card" style={{ flex: "1 1 290px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.85rem" }}>
            <span className="fpw-mono-label">ANMELDUNGEN</span>
            <span style={{ fontFamily: "var(--mono)", fontSize: "1.15rem", color: "var(--text-hi)" }}>
              <strong style={{ color: "var(--gold)" }}>{filled}</strong>
              <span style={{ color: "var(--dim2)" }}> / {op.minParticipants}</span>
            </span>
          </div>
          <div className="fpw-progress"><div style={{ width: `${pct}%` }} /></div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem", marginTop: "1rem" }}>
            {[
              { ic: "clock", lab: "ZEIT", val: fmtDate(op.scheduledAt, op.guild.timezone) },
              { ic: "pin", lab: "TREFFPUNKT", val: op.meetingLocation },
              { ic: "globe", lab: "SYSTEM", val: op.meetingSystem },
            ].map((r) => (
              <div key={r.lab} style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
                <span className="fpw-seat-icon"><Ic name={r.ic} size={15} sw={1.6} /></span>
                <span>
                  <span className="fpw-mono-label" style={{ display: "block", fontSize: "0.58rem" }}>{r.lab}</span>
                  <span style={{ fontSize: "0.92rem" }}>{r.val}</span>
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {operatorMode && op.canManage && csrf && (
        <OperatorPanel op={op} csrf={csrf} onChanged={load} onError={(m) => setNotice(m)} />
      )}

      {me && csrf && op.status === "open" && (
        <section className="fpw-card" style={{ margin: "1.2rem 0" }} data-testid="join-card">
          <div className="fpw-mono-label" style={{ marginBottom: "0.8rem" }}>MITMACHEN</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", alignItems: "center" }}>
            {op.viewerCqbSignedUp ? (
              <button type="button" className="fpw-btn" data-testid="cqb-withdraw" onClick={() => run(() => cqbWithdraw(id!, csrf))}>
                <Ic name="check" size={14} sw={2} /> Flexibel angemeldet — zurückziehen
              </button>
            ) : (
              <button type="button" className="fpw-btn" data-testid="cqb-signup" onClick={() => run(() => cqbSignup(id!, csrf))}>
                <Ic name="swap" size={14} /> Teilt mich ein (flexibel anmelden)
              </button>
            )}
            <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={op.viewerHangarShared}
                data-testid="hangar-toggle"
                onChange={(e) => run(() => setHangarShare(id!, csrf, e.target.checked))}
                style={{ accentColor: "var(--cyan)", width: 18, height: 18 }}
              />
              <span className="fpw-meta" style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <Ic name="eye" size={14} /> Operator darf meinen Hangar sehen
              </span>
            </label>
            <OfferShip
              opId={id!}
              csrf={csrf}
              carrierOptions={accepted.filter((u) => u.unitType === "ship").map((u) => ({ id: u.id, name: u.name }))}
              onDone={() => {
                setNotice(null);
                load();
              }}
              onError={(m) => setNotice(m)}
            />
          </div>
        </section>
      )}

      <div className="fpw-legend">
        <span className="fpw-mono-label" style={{ fontSize: "0.62rem" }}>WIE FEST IST EIN PLATZ?</span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="fpw-tag dim">FEST</span>
          <span className="fpw-meta" style={{ fontSize: "0.8rem" }}>Genau dieser Platz</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="fpw-tag dashed">OFFEN</span>
          <span className="fpw-meta" style={{ fontSize: "0.8rem" }}>Noch unbesetzt</span>
        </span>
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span className="fpw-tag gold">FLEX</span>
          <span className="fpw-meta" style={{ fontSize: "0.8rem" }}>Operator teilt dich ein</span>
        </span>
      </div>

      <section>
        <div className="fpw-mono-label" style={{ marginBottom: "1rem", fontSize: "0.72rem", letterSpacing: "0.14em" }}>
          FLOTTEN-BOARD {accepted.length > 0 && <span style={{ color: "var(--dim2)" }}>· {filled}/{total} besetzt</span>}
        </div>
        {lanes.length === 0 ? (
          <p className="fpw-meta">Noch keine Einheiten.</p>
        ) : (
          <div className="fpw-board">
            {lanes.map((lane) => (
              <div key={lane.type} style={{ minWidth: 0 }}>
                <div
                  className="fpw-lanehead"
                  style={{ ["--lane-color" as string]: lane.color, ["--lane-accent" as string]: `rgba(${lane.rgb},0.4)` }}
                >
                  <Ic name={lane.icon} size={15} />
                  {lane.label}
                  <span className="count">
                    {lane.units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0)}/
                    {lane.units.reduce((a, u) => a + u.seats.length, 0)}
                  </span>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.8rem" }}>
                  {lane.units.map((u) => (
                    <div key={u.id} className="fpw-unit" style={{ ["--unit-accent" as string]: lane.rgb }} data-testid="unit-card">
                      <div className="fpw-unit-head">
                        <span className="fpw-unit-icon"><Ic name={lane.icon} size={18} sw={1.6} /></span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="fpw-unit-title">{u.name}</div>
                          <div className="fpw-meta" style={{ fontSize: "0.78rem" }}>
                            {u.unitType}
                            {u.captain ? ` · Captain: ${u.captain.username}` : ""}
                          </div>
                        </div>
                        <span className="fpw-unit-occ">
                          {u.seats.filter((s) => s.claimedBy).length}
                          <span className="total">/{u.seats.length}</span>
                        </span>
                      </div>
                      {u.captainNote && (
                        <div className="fpw-meta" style={{ display: "flex", alignItems: "center", gap: 6, fontStyle: "italic", marginBottom: "0.4rem" }}>
                          <Ic name="bolt" size={13} /> {u.captainNote}
                        </div>
                      )}
                      {u.seats.map((s) => seatRow(u, s))}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
      <p className="fpw-meta" style={{ marginTop: "1.6rem" }}>
        Read-Modell des Mission-Boards — Verwaltung &amp; Spezialflows weiterhin in der{" "}
        <a href={`/fleetplanner/ops/${op.id}`}>klassischen Ansicht</a>.
      </p>
    </article>
  );
}
