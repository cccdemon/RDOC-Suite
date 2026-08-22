import { useEffect, useMemo, useState } from "react";
import { ApiError, getOrgFleet } from "../api/client";
import type { OrgFleetEntry, OrgFleetResponse, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { useGuildSelection } from "../serverContext";
import { ServerScope } from "../components/ui";
import { Breadcrumbs } from "../components/Breadcrumbs";

const MONO = "var(--mono)";

// Discord contact: deep link to the member's profile. Zero bot work (FR-P3 tier 1).
function discordUrl(id: string): string {
  return `https://discord.com/users/${id}`;
}

function DiscordLink({ id, handle }: { id: string | null; handle: string | null }) {
  if (!id) return <span style={{ color: "var(--dim3)", fontFamily: MONO, fontSize: "0.72rem" }}>kein Discord</span>;
  return (
    <a
      href={discordUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      title="Im Discord anschreiben"
      style={{
        display: "inline-flex", alignItems: "center", gap: "0.4rem", padding: "0.26rem 0.6rem",
        borderRadius: 6, border: "1px solid rgba(88,101,242,0.5)", background: "rgba(88,101,242,0.14)",
        color: "var(--purple)", textDecoration: "none", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.06em",
      }}
    >
      <Ic name="chat" size={12} sw={1.6} />
      {handle ? `@${handle}` : "Anschreiben"}
    </a>
  );
}

type ShipGroup = {
  shipId: string; shipName: string; manufacturer: string; shipClass: string;
  totalQty: number; owners: OrgFleetEntry[]; imageUrl: string | null; sourceUrl: string | null;
};
type MemberGroup = {
  userId: string; username: string; discordId: string | null; discordHandle: string | null;
  totalHulls: number; ships: OrgFleetEntry[];
};

export function OrgFleetPage({ session }: { session: SessionResponse | null }) {
  const memberships = session?.memberships ?? [];
  // Org-Flotte is Orgamember-only: members with the configured Discord role
  // (admiralRoleId → fleetoperator), who may create events + are in the fleet.
  const orgaServers = memberships.filter((m) => m.role === "fleetoperator");
  const [guildId, setGuildId] = useGuildSelection(orgaServers);
  const [data, setData] = useState<OrgFleetResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [pivot, setPivot] = useState<"ship" | "member">("ship");
  const [q, setQ] = useState("");
  const [openShips, setOpenShips] = useState<Set<string>>(new Set());
  const [lightbox, setLightbox] = useState<string | null>(null);

  useEffect(() => {
    if (!guildId) return;
    setLoading(true);
    setError(null);
    getOrgFleet(guildId)
      .then(setData)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Flotte nicht ladbar."))
      .finally(() => setLoading(false));
  }, [guildId]);

  const needle = q.trim().toLowerCase();
  const entries = data?.entries ?? [];

  const byShip = useMemo<ShipGroup[]>(() => {
    const m = new Map<string, ShipGroup>();
    for (const e of entries) {
      let g = m.get(e.shipId);
      if (!g) {
        g = { shipId: e.shipId, shipName: e.shipName, manufacturer: e.manufacturer, shipClass: e.shipClass, totalQty: 0, owners: [], imageUrl: e.imageUrl, sourceUrl: e.sourceUrl };
        m.set(e.shipId, g);
      }
      g.totalQty += e.quantity;
      g.owners.push(e);
    }
    let list = [...m.values()].sort((a, b) => b.totalQty - a.totalQty || a.shipName.localeCompare(b.shipName));
    if (needle) {
      list = list.filter(
        (g) => g.shipName.toLowerCase().includes(needle) || g.owners.some((o) => o.user.username.toLowerCase().includes(needle)),
      );
    }
    return list;
  }, [entries, needle]);

  const byMember = useMemo<MemberGroup[]>(() => {
    const m = new Map<string, MemberGroup>();
    for (const e of entries) {
      let g = m.get(e.user.id);
      if (!g) {
        g = { userId: e.user.id, username: e.user.username, discordId: e.user.discordId, discordHandle: e.user.discordHandle, totalHulls: 0, ships: [] };
        m.set(e.user.id, g);
      }
      g.totalHulls += e.quantity;
      g.ships.push(e);
    }
    let list = [...m.values()].sort((a, b) => b.totalHulls - a.totalHulls || a.username.localeCompare(b.username));
    if (needle) {
      list = list.filter(
        (g) => g.username.toLowerCase().includes(needle) || g.ships.some((s) => s.shipName.toLowerCase().includes(needle)),
      );
    }
    return list;
  }, [entries, needle]);

  function toggleShip(id: string) {
    setOpenShips((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (!session?.user) return <p className="fpw-meta">Bitte einloggen, um die Org-Flotte zu sehen.</p>;
  if (orgaServers.length === 0)
    return <p className="fpw-meta">Die Org-Flotte ist Orgamembern vorbehalten — Mitgliedern mit der dafür konfigurierten Discord-Rolle (berechtigt zum Anlegen von Events). Du hast diese Rolle auf keinem deiner Server.</p>;

  const segOn: React.CSSProperties = { background: "var(--wash)", borderColor: "var(--border-hi)", color: "var(--cyan)" };
  const seg: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 6, padding: "0.42rem 0.8rem", fontFamily: MONO,
    fontSize: "0.7rem", borderRadius: 7, cursor: "pointer", border: "1px solid transparent", background: "transparent", color: "var(--dim)",
  };

  return (
    <div data-testid="org-fleet-page" style={{ width: "100%" }}>
      {/* The server context is part of the address: which server these
          settings belong to must never be a guess (IA goal 4). */}
      <Breadcrumbs
        items={[
          { label: "Discord-Server", to: "/guilds" },
          { label: orgaServers.find((m) => m.guildId === guildId)?.guildName ?? "Server", to: guildId ? `/guilds?guild=${encodeURIComponent(guildId)}` : "/guilds" },
          { label: "Org-Flotte" },
        ]}
      />
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.25rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="ship" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>Org-Flotte</h1>
      </div>
      <div style={{ color: "var(--dim)", fontSize: "0.9rem", marginBottom: "0.8rem" }}>
        Schiffe der Orgamember (Mitglieder mit der Org-Rolle) — zum Ausleihen, Ansehen oder Anfragen.
      </div>
      <ServerScope
        guildName={(session?.memberships ?? []).find((m) => m.guildId === guildId)?.guildName}
        role={(session?.memberships ?? []).find((m) => m.guildId === guildId)?.role}
      />

      {/* server picker (only when on several servers) */}
      {orgaServers.length > 1 && (
        <select
          value={guildId ?? ""}
          onChange={(e) => setGuildId(e.target.value)}
          style={{ marginBottom: "1rem", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.95rem", padding: "0.5rem 0.7rem", borderRadius: 8 }}
        >
          {orgaServers.map((m) => <option key={m.guildId} value={m.guildId}>{m.guildName}</option>)}
        </select>
      )}

      {data && (
        <div style={{ display: "flex", gap: "0.6rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          {([["Schiffe gesamt", data.totals.hulls], ["Modelle", data.totals.models], ["Mitglieder m. Hangar", data.totals.membersWithHangar]] as const).map(([lab, val]) => (
            <div key={lab} style={{ border: "1px solid var(--wash)", borderLeft: "3px solid var(--cyan)", borderRadius: 12, background: "var(--bg2)", padding: "0.7rem 0.95rem", minWidth: 120 }}>
              <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "var(--dim2)", textTransform: "uppercase" }}>{lab}</div>
              <div style={{ fontFamily: MONO, fontSize: "1.35rem", lineHeight: 1.1, color: "var(--text-hi)" }}>{val}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: "0.7rem", alignItems: "center", marginBottom: "1rem", flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", gap: 6, background: "var(--bg2)", border: "1px solid var(--wash)", padding: 4, borderRadius: 10 }}>
          <span data-testid="pivot-ship" style={pivot === "ship" ? { ...seg, ...segOn } : seg} onClick={() => setPivot("ship")}><Ic name="board" size={13} /> Nach Schiff</span>
          <span data-testid="pivot-member" style={pivot === "member" ? { ...seg, ...segOn } : seg} onClick={() => setPivot("member")}><Ic name="users" size={13} /> Nach Mitglied</span>
        </div>
        <input
          type="search"
          data-testid="org-fleet-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Schiff oder Mitglied suchen…"
          style={{ flex: 1, minWidth: 220, boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.98rem", padding: "0.6rem 0.8rem", borderRadius: 8, outline: "none" }}
        />
      </div>

      {loading ? (
        <p className="fpw-meta">Lade…</p>
      ) : error ? (
        <p className="fpw-meta" style={{ color: "var(--red)" }}>{error}</p>
      ) : entries.length === 0 ? (
        <p className="fpw-meta">Noch keine Schiffe hinterlegt. Mitglieder pflegen ihren Hangar im Konto-Tab (oder per Flotten-Import).</p>
      ) : pivot === "ship" ? (
        /* ── BY SHIP ── */
        <div className="fpw-card fpw-table" data-card="work" data-testid="fleet-by-ship">
          <div className="fpw-trow" style={{ display: "grid", gridTemplateColumns: "1.7fr 0.9fr 0.8fr 0.7fr 1.1fr", gap: 0, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim3)", padding: "0.7rem 1rem", borderBottom: "1px solid var(--border)", textTransform: "uppercase" }}>
            <span>Schiff</span><span>Hersteller</span><span>Klasse</span><span style={{ textAlign: "right" }}>Anzahl</span><span style={{ textAlign: "right" }}>Besitzer</span>
          </div>
          {byShip.map((g) => {
            const open = openShips.has(g.shipId);
            return (
              <div key={g.shipId} style={{ borderBottom: "1px solid var(--wash)" }}>
                <div
                  data-testid={`ship-grp-${g.shipId}`}
                  className="fpw-trow"
                  onClick={() => toggleShip(g.shipId)}
                  style={{ display: "grid", gridTemplateColumns: "1.7fr 0.9fr 0.8fr 0.7fr 1.1fr", gap: 0, padding: "0.62rem 1rem", alignItems: "center", fontSize: "0.92rem", cursor: "pointer" }}
                >
                  <span style={{ color: "var(--text-hi)", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.5rem", minWidth: 0 }}>
                    <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : "none", transition: "transform 0.15s", color: "var(--dim3)" }}><Ic name="arrow" size={13} sw={2} /></span>
                    {g.imageUrl && (
                      <img
                        src={g.imageUrl}
                        alt=""
                        loading="lazy"
                        title="Vergrößern"
                        onClick={(ev) => { ev.stopPropagation(); setLightbox(g.imageUrl); }}
                        onError={(ev) => { (ev.currentTarget as HTMLImageElement).style.display = "none"; }}
                        style={{ width: 46, height: 28, objectFit: "cover", borderRadius: 4, border: "1px solid var(--border)", cursor: "zoom-in", flex: "none" }}
                      />
                    )}
                    {g.sourceUrl ? (
                      <a href={g.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={(ev) => ev.stopPropagation()} title="Auf Fleetyards öffnen" style={{ color: "var(--text-hi)", textDecoration: "none" }}>
                        {g.shipName} <span style={{ color: "var(--dim3)" }}>↗</span>
                      </a>
                    ) : (
                      g.shipName
                    )}
                  </span>
                  <span className="fpw-meta">{g.manufacturer || "—"}</span>
                  <span className="fpw-meta">{g.shipClass || "—"}</span>
                  <span style={{ fontFamily: MONO, color: "var(--gold)", textAlign: "right" }}>×{g.totalQty}</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.82rem", color: "var(--dim)", textAlign: "right" }}>{g.owners.length} {g.owners.length === 1 ? "Mitglied" : "Mitglieder"}</span>
                </div>
                {open && (
                  <div style={{ background: "var(--bg)" }}>
                    {g.owners.map((o) => (
                      <div key={o.user.id} className="fpw-trow fpw-trow-sub" style={{ display: "grid", gridTemplateColumns: "1.7fr 0.9fr 0.8fr 0.7fr 1.1fr", gap: 0, padding: "0.5rem 1rem 0.5rem 2.1rem", alignItems: "center", borderTop: "1px solid var(--wash)", fontSize: "0.88rem" }}>
                        <span style={{ color: "var(--text)" }}>{o.user.username}</span>
                        <span className="fpw-meta" style={{ gridColumn: "2 / 4" }}>{o.nickname ? `„${o.nickname}“` : "—"}</span>
                        <span style={{ fontFamily: MONO, color: "var(--gold)", textAlign: "right" }}>×{o.quantity}</span>
                        <span style={{ textAlign: "right" }}><DiscordLink id={o.user.discordId} handle={o.user.discordHandle} /></span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        /* ── BY MEMBER ── */
        <div className="fpw-card fpw-table" data-card="work" data-testid="fleet-by-member">
          <div className="fpw-trow" style={{ display: "grid", gridTemplateColumns: "1.6fr 2.4fr 0.7fr 1.2fr", gap: 0, fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim3)", padding: "0.7rem 1rem", borderBottom: "1px solid var(--border)", textTransform: "uppercase" }}>
            <span>Mitglied</span><span>Schiffe</span><span style={{ textAlign: "right" }}>Hulls</span><span style={{ textAlign: "right" }}>Kontakt</span>
          </div>
          {byMember.map((g) => (
            <div key={g.userId} data-testid={`member-row-${g.userId}`} className="fpw-trow" style={{ display: "grid", gridTemplateColumns: "1.6fr 2.4fr 0.7fr 1.2fr", gap: 0, padding: "0.62rem 1rem", alignItems: "center", borderBottom: "1px solid var(--wash)", fontSize: "0.92rem" }}>
              <span style={{ color: "var(--text-hi)", fontWeight: 600 }}>{g.username}</span>
              <span className="fpw-meta">{g.ships.map((s) => `${s.shipName}·${s.quantity}`).join(" · ")}</span>
              <span style={{ fontFamily: MONO, color: "var(--gold)", textAlign: "right" }}>{g.totalHulls}</span>
              <span style={{ textAlign: "right" }}><DiscordLink id={g.discordId} handle={g.discordHandle} /></span>
            </div>
          ))}
        </div>
      )}

      {lightbox && (
        <div
          data-testid="ship-lightbox"
          onClick={() => setLightbox(null)}
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.85)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, cursor: "zoom-out" }}
        >
          <img src={lightbox} alt="" style={{ maxWidth: "92vw", maxHeight: "92vh", objectFit: "contain", borderRadius: 8, border: "1px solid var(--border)" }} />
        </div>
      )}
    </div>
  );
}
