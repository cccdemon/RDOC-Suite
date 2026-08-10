import { Link } from "react-router-dom";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { MONO, lbl, tint } from "../components/ui";

const ROLE_LABELS: Record<string, string> = { fleetoperator: "Flottenoperator", crew: "Crew", superadmin: "Admiral" };

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "??";
}
function roleStyle(role: string): React.CSSProperties {
  const c = role === "fleetoperator" || role === "superadmin" ? "var(--cyan)" : "var(--dim)";
  return { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.05em", padding: "3px 9px", borderRadius: 5, border: `1px solid ${tint(c, 40)}`, background: `${tint(c, 10)}`, color: c, whiteSpace: "nowrap" };
}

export function ServerListPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const guilds = session?.memberships ?? [];

  if (session === null) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="servers-anon">
        <span style={lbl}>ANMELDUNG ERFORDERLICH</span>
        <Link className="fpw-btn" to="/login">Anmelden</Link>
      </div>
    );

  return (
    <div data-testid="servers-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "0.8rem", marginBottom: "1.3rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="server" size={17} sw={1.7} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>DISCORD // SERVER</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>Deine Server</h1>
        </div>
        <a href="/fleetplanner/guilds/add" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, textDecoration: "none" }} data-testid="add-bot"><Ic name="plus" size={14} sw={1.9} /> Bot hinzufügen</a>
      </div>

      {guilds.length === 0 ? (
        <div data-testid="servers-none" style={{ maxWidth: 560, margin: "2.5rem auto", textAlign: "center", padding: "0 1rem" }}>
          <span style={{ width: 60, height: 60, borderRadius: 15, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "var(--wash)", border: "1px solid var(--border-hi)", color: "var(--cyan)", marginBottom: "1.1rem" }}>
            <Ic name="server" size={28} sw={1.6} />
          </span>
          <h2 style={{ fontWeight: 700, fontSize: "1.5rem", color: "var(--text-hi)", margin: "0 0 0.6rem" }}>Kein Server verbunden</h2>
          <p style={{ color: "var(--dim)", fontSize: "0.95rem", lineHeight: 1.6, maxWidth: "44ch", margin: "0 auto 1.6rem" }}>
            Du bist auf keinem Discord-Server, auf dem der Fleetplanner-Bot installiert ist. Lade den Bot
            auf deinen Server, um Operationen zu planen, Sitze zu vergeben und deine Flotte zu organisieren.
          </p>
          <a href="/fleetplanner/guilds/add" className="btn" data-testid="servers-none-add"><Ic name="plus" size={14} sw={1.9} /> Bot hinzufügen</a>
          <p style={{ color: "var(--dim2)", fontSize: "0.82rem", marginTop: "1.3rem" }}>
            Öffentliche Operationen kannst du auch ohne Server <Link to="/operationen" style={{ color: "var(--cyan)" }}>ansehen</Link>.
          </p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {guilds.map((g) => (
            <div key={g.guildId} data-testid={`server-${g.guildId}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.8rem", padding: "0.9rem 1.05rem", border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: "var(--wash)", border: "1px solid var(--border-hi)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.7rem", fontWeight: 700 }}>{initials(g.guildName)}</span>
              <div style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--body)", fontWeight: 600, fontSize: "1.08rem", color: "var(--text-hi)" }}>{g.guildName}</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--green)", border: "1px solid var(--edge-green)", background: "var(--tint-green)", padding: "1px 6px", borderRadius: 4 }}>AKTIV</span>
                </div>
              </div>
              <span style={roleStyle(g.role)}>{ROLE_LABELS[g.role] ?? g.role}</span>
              {/* Only the guild's own fleet operators manage its settings — a
                  partner/crew membership (or instance superadmin status) must NOT
                  expose another guild's settings here. Link carries the guild id. */}
              {g.role === "fleetoperator" && (
                <Link to={`/guilds/settings?guild=${encodeURIComponent(g.guildId)}`} data-testid={`server-settings-${g.guildId}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.75rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, textDecoration: "none" }}><Ic name="wrench" size={13} sw={1.6} /> Einstellungen</Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
