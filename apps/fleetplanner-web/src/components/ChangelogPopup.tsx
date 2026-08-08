import { useEffect, useState } from "react";
import { ackChangelog, getUnseenChangelog, type UnseenChangelog } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "./Icons";

const MONO = "var(--mono)";

// "What's new" popup. After a signed-in user loads the app, we ask the server for
// the player-changelog entries they haven't acknowledged yet (once per release,
// tracked server-side per user). "OK" acks so it never re-shows until the next
// release. Guests and up-to-date users see nothing.
export function ChangelogPopup({ session }: { session: SessionResponse | null }) {
  const csrf = session?.csrfToken ?? null;
  const userId = session?.user?.id ?? null;
  const [data, setData] = useState<UnseenChangelog | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!userId) { setData(null); setDismissed(false); return; }
    let live = true;
    getUnseenChangelog()
      .then((r) => { if (live && r.entries.length > 0) setData(r); })
      .catch(() => { /* non-fatal — a failed fetch just means no popup */ });
    return () => { live = false; };
  }, [userId]);

  if (!data || dismissed) return null;

  function close() {
    setDismissed(true);
    if (csrf) ackChangelog(csrf).catch(() => { /* best-effort; worst case it shows once more */ });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      data-testid="changelog-popup"
      style={{ position: "fixed", inset: 0, zIndex: 11000, background: "rgba(18, 20, 22,0.74)", display: "flex", alignItems: "center", justifyContent: "center", overflowY: "auto", padding: "4vh 1rem" }}
      onClick={close}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "100%", maxWidth: 560, background: "var(--bg, var(--bg2))", border: "1px solid var(--border)", borderRadius: 14, padding: "1.5rem 1.6rem", boxShadow: "0 24px 70px rgba(0,0,0,0.6)" }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="bolt" size={18} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>NEUE VERSION</span>
        </div>
        <h2 style={{ fontWeight: 700, fontSize: "1.35rem", color: "var(--text-hi)", margin: "0 0 0.2rem" }}>Was ist neu?</h2>
        <p style={{ fontSize: "0.82rem", color: "var(--dim)", margin: "0 0 1.1rem" }}>Der Fleetplanner wurde aktualisiert. Die wichtigsten Änderungen:</p>

        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem", maxHeight: "50vh", overflowY: "auto" }}>
          {data.entries.map((e) => (
            <div key={`${e.date}-${e.title}`}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.4rem" }}>
                <span style={{ fontWeight: 700, fontSize: "0.98rem", color: "var(--text-hi)" }}>{e.title}</span>
                <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{e.date}</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                {e.changes.map((c, i) => (
                  <li key={i} style={{ fontSize: "0.86rem", color: "var(--text)", lineHeight: 1.5 }}>{c}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "1.4rem" }}>
          <button
            type="button"
            data-testid="changelog-ok"
            onClick={close}
            style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.55rem 1.5rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.78rem", borderRadius: 10, cursor: "pointer" }}
          >
            <Ic name="check" size={15} sw={1.9} /> OK, verstanden
          </button>
        </div>
      </div>
    </div>
  );
}
