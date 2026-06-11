import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ApiError, claimSeat, getOperation, unclaimSeat } from "../api/client";
import type { OperationDetail, SessionResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";

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

export function OpDetailPage({ session }: { session: SessionResponse | null }) {
  const { id } = useParams<{ id: string }>();
  const [op, setOp] = useState<OperationDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySeat, setBusySeat] = useState<string | null>(null);

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

  return (
    <article>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
        <span className="fpw-tag green">{op.status}</span>
        <span className="fpw-tag cyan">{op.visibility}</span>
        {op.canManage && <span className="fpw-tag gold">OPERATOR</span>}
      </div>
      <h1 className="fpw-h1" data-testid="op-title">{op.title}</h1>
      {notice && (
        <p className="fpw-tag gold" role="alert" data-testid="op-notice" style={{ display: "inline-flex" }}>
          {notice}
        </p>
      )}
      <p className="fpw-meta">
        {fmtDate(op.scheduledAt, op.guild.timezone)} · {op.meetingLocation} · {op.meetingSystem} · {op.guild.name}
      </p>

      {op.description && (
        <section className="fpw-card" style={{ margin: "1.2rem 0" }}>
          <div className="fpw-mono-label" style={{ marginBottom: "0.6rem" }}>MISSIONSZIEL</div>
          <p style={{ margin: 0, whiteSpace: "pre-wrap" }}>{op.description}</p>
        </section>
      )}

      {op.resourceLinks.length > 0 && (
        <section className="fpw-card" style={{ margin: "1.2rem 0" }}>
          <div className="fpw-mono-label" style={{ marginBottom: "0.6rem" }}>BRIEFING / LINKS</div>
          {op.resourceLinks.map((l) => (
            <div key={l.id}>
              <a href={l.url} target="_blank" rel="noopener noreferrer">
                {l.title} ↗
              </a>
            </div>
          ))}
        </section>
      )}

      <section style={{ marginTop: "1.4rem" }}>
        <div className="fpw-mono-label" style={{ marginBottom: "0.8rem" }}>FLOTTE</div>
        {op.units.filter((u) => u.status === "accepted").length === 0 ? (
          <p className="fpw-meta">Noch keine Einheiten.</p>
        ) : (
          <div className="fpw-grid">
            {op.units
              .filter((u) => u.status === "accepted")
              .map((u) => (
                <div key={u.id} className="fpw-card" data-testid="unit-card">
                  <div className="fpw-h2">{u.name}</div>
                  <div className="fpw-meta" style={{ marginBottom: "0.5rem" }}>
                    {u.unitType}
                    {u.captain ? ` · Captain: ${u.captain.username}` : ""}
                  </div>
                  {u.seats.map((s) => (
                    <div key={s.id} className="fpw-seat">
                      <span style={{ flex: 1, color: "var(--text-hi)" }}>{s.label}</span>
                      {s.claimedBy ? (
                        <>
                          <span className="fpw-meta">{s.claimedBy.username}</span>
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
                          Platz nehmen
                        </button>
                      ) : (
                        <span className="fpw-tag dim">OFFEN</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
          </div>
        )}
      </section>
      <p className="fpw-meta" style={{ marginTop: "1.6rem" }}>
        Read-only-Vorschau — Plätze übernehmen &amp; verwalten weiterhin in der{" "}
        <a href={`/fleetplanner/ops/${op.id}`}>klassischen Ansicht</a>.
      </p>
    </article>
  );
}
