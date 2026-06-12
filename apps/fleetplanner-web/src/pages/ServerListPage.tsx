import { Link } from "react-router-dom";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { MONO, lbl } from "../components/ui";

const ROLE_LABELS: Record<string, string> = { fleetoperator: "Flottenoperator", crew: "Crew", superadmin: "Admiral" };

function initials(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "??";
}
function roleStyle(role: string): React.CSSProperties {
  const c = role === "fleetoperator" || role === "superadmin" ? "var(--cyan)" : "#9fb1c2";
  const rgb = role === "fleetoperator" || role === "superadmin" ? "0,212,255" : "159,177,194";
  return { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.05em", padding: "3px 9px", borderRadius: 5, border: `1px solid rgba(${rgb},0.4)`, background: `rgba(${rgb},0.1)`, color: c, whiteSpace: "nowrap" };
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
    <div data-testid="servers-page" style={{ maxWidth: 880, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "0.8rem", marginBottom: "1.3rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="server" size={17} sw={1.7} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>DISCORD // SERVER</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>Deine Server</h1>
        </div>
        <a href="/fleetplanner/guilds/add" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.5rem 1rem", border: "1px solid rgba(0,212,255,0.45)", background: "rgba(0,212,255,0.12)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, textDecoration: "none" }} data-testid="add-bot"><Ic name="plus" size={14} sw={1.9} /> Bot hinzufügen</a>
      </div>

      {guilds.length === 0 ? (
        <div className="fpw-state" data-testid="servers-none">
          <span style={lbl}>KEIN SERVER</span>
          <p className="fpw-meta">Du bist auf keinem Server, auf dem der Fleetplanner-Bot installiert ist.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
          {guilds.map((g) => (
            <div key={g.guildId} data-testid={`server-${g.guildId}`} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.8rem", padding: "0.9rem 1.05rem", border: "1px solid rgba(0,212,255,0.13)", borderRadius: 13, background: "var(--bg2)" }}>
              <span style={{ width: 38, height: 38, borderRadius: 10, flexShrink: 0, background: "rgba(0,212,255,0.12)", border: "1px solid rgba(0,212,255,0.3)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.7rem", fontWeight: 700 }}>{initials(g.guildName)}</span>
              <div style={{ flex: 1, minWidth: 130, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--body)", fontWeight: 600, fontSize: "1.08rem", color: "var(--text-hi)" }}>{g.guildName}</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--green)", border: "1px solid rgba(0,255,136,0.4)", background: "rgba(0,255,136,0.1)", padding: "1px 6px", borderRadius: 4 }}>AKTIV</span>
                </div>
              </div>
              <span style={roleStyle(g.role)}>{ROLE_LABELS[g.role] ?? g.role}</span>
              {(g.role === "fleetoperator" || me.role === "superadmin") && (
                <Link to="/guilds/settings" data-testid={`server-settings-${g.guildId}`} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.75rem", border: "1px solid rgba(255,255,255,0.12)", background: "transparent", color: "#9fb1c2", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 7, textDecoration: "none" }}><Ic name="wrench" size={13} sw={1.6} /> Einstellungen</Link>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
