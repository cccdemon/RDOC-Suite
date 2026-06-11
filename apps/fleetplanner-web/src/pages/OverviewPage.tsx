import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, listOperations } from "../api/client";
import type { OperationSummary, SessionResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";

function fmtDate(iso: string): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function OverviewPage({ session }: { session: SessionResponse | null }) {
  const [ops, setOps] = useState<OperationSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    listOperations()
      .then((r) => setOps(r.operations))
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, null)));
  }, []);

  if (error)
    return <ErrorState code={error.status === 503 ? 503 : error.status || 503} message="Operationen konnten nicht geladen werden." />;
  if (ops === null)
    return (
      <div className="fpw-state">
        <span className="fpw-mono-label">LADE OPERATIONEN…</span>
      </div>
    );

  return (
    <section>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "1rem" }}>
        <h1 className="fpw-h2" style={{ margin: 0 }}>Operationen</h1>
        {!session?.user && (
          <Link to="/login" className="fpw-mono-label" data-testid="login-cta" style={{ color: "var(--cyan)" }}>
            ANMELDEN →
          </Link>
        )}
      </div>
      {ops.length === 0 ? (
        <p className="fpw-meta">Keine anstehenden Operationen.</p>
      ) : (
        <div className="fpw-grid" data-testid="op-grid">
          {ops.map((op) => (
            <Link key={op.id} to={`/ops/${op.id}`} className="fpw-card fpw-cardlink" data-testid="op-card">
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                <span className="fpw-tag green">
                  <span className="fpw-dot" />
                  {op.status}
                </span>
                <span className="fpw-tag cyan">{op.visibility}</span>
                {op.signupState === "joined" && <span className="fpw-tag green">DABEI</span>}
                {op.signupState === "waitlist" && <span className="fpw-tag gold">WARTELISTE</span>}
              </div>
              <div className="fpw-h2">{op.title}</div>
              <div className="fpw-meta">
                {fmtDate(op.scheduledAt)} · {op.meetingSystem} · {op.guild.name}
              </div>
              <div className="fpw-mono-label" style={{ marginTop: "0.6rem", fontSize: "0.62rem" }}>
                {op.acceptedUnitCount} EINHEITEN · {op.opType.toUpperCase()}
              </div>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
