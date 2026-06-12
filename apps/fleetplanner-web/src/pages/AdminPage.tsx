import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, banGuild, getAdminGuilds, unbanGuild } from "../api/client";
import type { AdminGuild, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.7rem" };

function statusOf(g: AdminGuild): { text: string; cls: "green" | "gold" | "dim" } {
  if (g.bannedAt) return { text: "GEBANNT", cls: "gold" };
  if (!g.active) return { text: "INAKTIV", cls: "dim" };
  return { text: "AKTIV", cls: "green" };
}

export function AdminPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;

  const [guilds, setGuilds] = useState<AdminGuild[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reload() {
    getAdminGuilds()
      .then((r) => setGuilds(r.guilds))
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "Nicht ladbar."));
  }
  useEffect(() => {
    if (me?.role === "superadmin") reload();
  }, [me]);

  async function run(action: () => Promise<unknown>) {
    if (!csrf) return;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      reload();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (me?.role !== "superadmin")
    return (
      <div className="fpw-state" data-testid="admin-forbidden">
        <span style={label}>NUR SUPERADMIN</span>
        <Link className="fpw-btn" to="/">Zur Übersicht</Link>
      </div>
    );

  return (
    <div data-testid="admin-page" style={{ maxWidth: 820, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.2rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="board" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Admin · Server</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="admin-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <section className="fpw-card">
        <div style={label}>ALLE DISCORD-SERVER</div>
        {guilds === null ? (
          <p className="fpw-meta">Lade…</p>
        ) : guilds.length === 0 ? (
          <p className="fpw-meta">Keine Server.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {guilds.map((g) => {
              const st = statusOf(g);
              return (
                <div key={g.id} className="fpw-seat" data-testid={`admin-guild-${g.id}`}>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: "block", color: "var(--text-hi)" }}>{g.name}</span>
                    <span className="fpw-meta">{g.memberCount} Mitglieder</span>
                  </span>
                  <span className={`fpw-tag ${st.cls}`} style={{ display: "inline-flex" }}>{st.text}</span>
                  {g.bannedAt ? (
                    <button type="button" data-testid={`admin-unban-${g.id}`} className="fpw-btn" disabled={busy || !csrf} onClick={() => run(() => unbanGuild(g.id, csrf!))} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}>Entbannen</button>
                  ) : (
                    <button type="button" data-testid={`admin-ban-${g.id}`} disabled={busy || !csrf} onClick={() => run(() => banGuild(g.id, csrf!))} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem", borderRadius: 7, border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.08)", color: "#ff6b6b", cursor: "pointer", fontFamily: MONO }}>Bannen</button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
