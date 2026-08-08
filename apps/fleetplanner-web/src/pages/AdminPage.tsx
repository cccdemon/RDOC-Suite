import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  ApiError,
  banGuild,
  getAdminGuilds,
  getAdminSettings,
  getAdminUsers,
  setCatalogConfig,
  setFeedbackChannel,
  setMaintenanceMode,
  setUserRole,
  syncCatalog,
  toggleUserActive,
  unbanGuild,
} from "../api/client";
import type { AdminGuild, AdminSettingsResponse, AdminUser, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { tint } from "../components/ui";

const MONO = "'Share Tech Mono',ui-monospace,monospace";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.7rem" };

const ROLE_LABELS: Record<string, string> = { superadmin: "Admiral", fleetoperator: "Fleet Op", crew: "Crew" };

function initialsOf(name: string): string {
  return name.replace(/[^A-Za-z0-9 ]/g, "").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "??";
}
function fmtNum(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}
function fmtRel(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "gerade eben";
  if (min < 60) return `vor ${min} Min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} Std`;
  const days = Math.floor(h / 24);
  if (days === 1) return "gestern";
  return `vor ${days} Tagen`;
}
function roleChip(role: string): React.CSSProperties {
  const map: Record<string, { c: string }> = { superadmin: { c: "var(--gold)" }, fleetoperator: { c: "var(--cyan)" }, crew: { c: "var(--dim)" } };
  const c = (map[role] ?? map.crew).c;
  return { display: "inline-flex", alignItems: "center", padding: "2px 7px", fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", borderRadius: "4px", border: `1px solid ${c}55`, background: `${c}14`, color: c, whiteSpace: "nowrap" };
}
function miniRole(role: string): React.CSSProperties {
  const c = role === "fleetoperator" ? "var(--cyan)" : "var(--dim2)";
  return { display: "inline-flex", alignItems: "center", padding: "1px 5px", fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.04em", borderRadius: "3px", border: `1px solid ${c}44`, background: `${c}12`, color: c, whiteSpace: "nowrap" };
}
function statusChip(active: boolean): React.CSSProperties {
  const c = active ? "var(--green)" : "var(--red)";
  return { display: "inline-flex", alignItems: "center", padding: "2px 7px", fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", borderRadius: "4px", border: `1px solid ${c}55`, background: `${c}14`, color: c, whiteSpace: "nowrap", cursor: "pointer" };
}
function avatarColor(role: string): string {
  return role === "superadmin" ? "var(--gold)" : role === "fleetoperator" ? "var(--cyan)" : "var(--dim3)";
}
const field: React.CSSProperties = { background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.78rem", padding: "0.4rem 0.55rem", borderRadius: "6px" };
const colHead: React.CSSProperties = { textAlign: "left", fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim2)", padding: "0.55rem 0.8rem", borderBottom: "1px solid var(--border)", fontWeight: 400 };
const cell: React.CSSProperties = { padding: "0.55rem 0.8rem", borderBottom: "1px solid var(--border)", verticalAlign: "middle" };
const monoSub = (extra?: React.CSSProperties): React.CSSProperties => ({ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.08em", color: "var(--dim3)", ...extra });

export function AdminPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;

  const [settings, setSettings] = useState<AdminSettingsResponse | null>(null);
  const [guilds, setGuilds] = useState<AdminGuild[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [feedbackInput, setFeedbackInput] = useState("");
  const [shipInterval, setShipInterval] = useState(7);
  const [locInterval, setLocInterval] = useState(7);
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);

  function flash(msg: string) {
    setToast(msg);
    window.clearTimeout((flash as unknown as { _t?: number })._t);
    (flash as unknown as { _t?: number })._t = window.setTimeout(() => setToast(null), 2600);
  }

  function reload() {
    getAdminSettings()
      .then((s) => {
        setSettings(s);
        setFeedbackInput(s.feedbackChannelId);
        setShipInterval(s.shipCatalog.intervalDays);
        setLocInterval(s.locationCatalog.intervalDays);
      })
      .catch(() => {});
    getAdminGuilds().then((r) => setGuilds(r.guilds)).catch((e) => flash(e instanceof ApiError ? e.message : "Server nicht ladbar."));
    getAdminUsers().then((r) => setUsers(r.users)).catch((e) => flash(e instanceof ApiError ? e.message : "Nutzer nicht ladbar."));
  }
  useEffect(() => {
    if (me?.role === "superadmin") reload();
  }, [me]);

  useEffect(() => {
    const onResize = () => { const w = window.innerWidth; setVw((p) => (Math.abs(w - p) > 16 ? w : p)); };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  async function run(action: () => Promise<unknown>, msg?: string) {
    if (!csrf) return;
    setBusy(true);
    try {
      await action();
      if (msg) flash(msg);
      reload();
    } catch (e) {
      flash(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
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

  const mobile = vw < 760;
  const narrow = vw < 1180;
  const activeUsers = users.filter((u) => u.active).length;
  const activeServers = guilds.filter((g) => g.active && !g.bannedAt).length;
  const bannedServers = guilds.filter((g) => g.bannedAt).length;
  const maintOn = settings?.maintenanceOn ?? false;
  const maintForced = settings?.maintenanceForcedByEnv ?? false;
  const maintColor = maintOn ? "var(--gold)" : "var(--green)";

  // ── KPI tiles ─────────────────────────────────────────────────────────
  const tiles: Array<{ label: string; value: string; sub: string; color: string; icon: string }> = [
    { label: "NUTZER", value: String(users.length), sub: `${activeUsers} aktiv · ${users.length - activeUsers} inaktiv`, color: "var(--cyan)", icon: "users" },
    { label: "DISCORD-SERVER", value: String(guilds.length), sub: `${activeServers} aktiv · ${bannedServers} gebannt`, color: "var(--green)", icon: "server" },
    { label: "SCHIFFE", value: fmtNum(settings?.shipCatalog.count ?? 0), sub: `Sync ${fmtRel(settings?.shipCatalog.lastRun ?? null)}`, color: "var(--gold)", icon: "ship" },
    { label: "STANDORTE", value: fmtNum(settings?.locationCatalog.count ?? 0), sub: `Sync ${fmtRel(settings?.locationCatalog.lastRun ?? null)}`, color: "var(--purple)", icon: "pin" },
    { label: "OPERATIONEN", value: String(settings?.operations.total ?? settings?.operationCount ?? 0), sub: settings ? `${settings.operations.private} Privat · ${settings.operations.partners} Partner · ${settings.operations.public} Öffentl.` : "live", color: "var(--pink)", icon: "cal" },
    { label: "WARTUNG", value: maintOn ? "AN" : "AUS", sub: maintOn ? "Instanz gesperrt" : "Betrieb normal", color: maintColor, icon: "wrench" },
  ];
  const statCols = mobile ? "repeat(2,1fr)" : narrow ? "repeat(3,1fr)" : "repeat(6,1fr)";
  const ctrlCols = mobile ? "1fr" : narrow ? "repeat(2,1fr)" : "repeat(3,1fr)";
  const tablesGrid: React.CSSProperties = narrow
    ? { display: "flex", flexDirection: "column", gap: "1.1rem" }
    : { display: "grid", gridTemplateColumns: "minmax(0,2.3fr) minmax(0,1fr)", gap: "1.1rem", alignItems: "start" };

  const syncBtn = (busyState: boolean, color: string): React.CSSProperties => ({
    display: "inline-flex", alignItems: "center", gap: "6px", padding: "0.42rem 0.8rem", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.03em", borderRadius: "7px", cursor: busyState ? "default" : "pointer", whiteSpace: "nowrap", border: `1px solid ${color}66`, background: `${color}14`, color, opacity: busyState ? 0.7 : 1,
  });

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return u.username.toLowerCase().includes(q) || u.id.toLowerCase().includes(q) || (u.discordName ?? "").toLowerCase().includes(q);
  });

  const catalogCard = (
    kind: "ships" | "locations",
    title: string,
    icon: string,
    accent: string,
    state: AdminSettingsResponse["shipCatalog"],
    interval: number,
    setInterval: (n: number) => void,
  ) => {
    const running = state.running;
    return (
      <section style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)", padding: "1.05rem 1.15rem", display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem", paddingBottom: "0.7rem", borderBottom: "1px solid var(--border)" }}>
          <span style={{ width: 30, height: 30, borderRadius: 8, background: `${tint(accent, 12)}`, border: `1px solid ${tint(accent, 30)}`, color: accent, display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name={icon} size={16} sw={1.6} /></span>
          <div style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.06em", color: "var(--text-hi)" }}>{title}</div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.55rem 0.8rem", marginBottom: "0.85rem" }}>
          <div><div style={monoSub()}>GECACHED</div><div style={{ fontFamily: MONO, fontSize: "1.05rem", color: "var(--text-hi)", marginTop: 1 }}>{fmtNum(state.count)}</div></div>
          <div><div style={monoSub()}>AUTO-REFRESH</div><div style={{ fontSize: "0.86rem", color: "var(--text)", marginTop: 3 }}>alle {state.intervalDays} Tage</div></div>
          <div><div style={monoSub()}>LETZTER LAUF</div><div style={{ fontSize: "0.86rem", color: "var(--text)", marginTop: 3 }}>{fmtRel(state.lastRun)}</div></div>
          <div><div style={monoSub()}>STATUS</div><div style={{ fontFamily: MONO, fontSize: "0.78rem", color: running ? "var(--gold)" : "var(--green)", marginTop: 3 }}>{running ? "⟳ Läuft" : "Bereit"}</div></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginTop: "auto" }}>
          <button type="button" data-testid={`sync-${kind}`} disabled={busy || !csrf || running} onClick={() => run(() => syncCatalog(csrf!, kind), `${title} synchronisiert.`)} style={syncBtn(running, accent)}>
            <span style={running ? { animation: "fpw-spin 0.9s linear infinite", display: "inline-flex" } : { display: "inline-flex" }}><Ic name="refresh" size={14} sw={1.8} /></span>
            {running ? "Synchronisiert…" : "Sync jetzt"}
          </button>
          <label style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim2)" }}>
            Intervall
            <input
              type="number" min={1} max={90} value={interval} data-testid={`interval-${kind}`}
              onChange={(e) => setInterval(Number(e.target.value))}
              onBlur={() => { if (interval >= 1 && interval <= 90 && interval !== state.intervalDays) run(() => setCatalogConfig(csrf!, kind, interval), "Intervall gespeichert."); }}
              style={{ ...field, width: "3.4rem" }}
            />
          </label>
        </div>
      </section>
    );
  };

  return (
    <div data-testid="admin-page" style={{ width: "100%", color: "var(--text)" }}>
      <style>{`@keyframes fpw-spin{to{transform:rotate(360deg)}}`}</style>

      {/* PAGE HEADER */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem 1.4rem", marginBottom: "1.4rem", paddingBottom: "1.1rem", borderBottom: "1px solid var(--border)" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.35rem" }}><span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="shield" size={19} sw={1.7} /></span><span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>ADMIN // SYSTEMSTEUERUNG</span></div>
          <h1 style={{ fontWeight: 700, fontSize: "1.95rem", lineHeight: 1.05, color: "var(--text-hi)", margin: 0 }}>Admin-Konsole</h1>
          <div style={{ color: "var(--dim)", fontSize: "0.9rem", marginTop: "0.2rem" }}>RDOC Fleetplanner · Instanz <span style={{ fontFamily: MONO, color: "var(--dim2)" }}>raumdock.org</span></div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.7rem" }}>
          <button type="button" data-testid="maint-toggle" disabled={busy || !csrf || maintForced} title={maintForced ? "per ENV erzwungen" : undefined} onClick={() => run(() => setMaintenanceMode(csrf!, !maintOn), maintOn ? "Wartungsmodus deaktiviert." : "Wartungsmodus aktiviert.")} style={{ display: "inline-flex", alignItems: "center", gap: 8, padding: "0.5rem 0.85rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 9, cursor: maintForced ? "not-allowed" : "pointer", whiteSpace: "nowrap", border: `1px solid ${maintColor}66`, background: `${maintColor}12`, color: maintColor, opacity: maintForced ? 0.6 : 1 }}>
            <Ic name="wrench" size={15} sw={1.7} /> Wartungsmodus
            <span style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 4, background: `${maintColor}22`, color: maintColor }}>{maintOn ? "AN" : "AUS"}</span>
          </button>
        </div>
      </div>

      {/* KPI STATUS STRIP */}
      <div data-testid="admin-settings" style={{ display: "grid", gridTemplateColumns: statCols, gap: "0.8rem", marginBottom: "1.1rem" }}>
        {tiles.map((t) => (
          <div key={t.label} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${t.color}`, borderRadius: 12, background: "var(--bg2)", padding: "0.85rem 0.95rem", minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim2)" }}>{t.label}</span>
              <span style={{ color: t.color, display: "inline-flex" }}><Ic name={t.icon} size={15} sw={1.6} /></span>
            </div>
            <div style={{ fontFamily: MONO, fontSize: "1.5rem", lineHeight: 1, color: "var(--text-hi)" }}>{t.value}</div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", marginTop: "0.3rem" }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: t.color, flexShrink: 0 }} /><span style={{ fontSize: "0.72rem", color: "var(--dim)", lineHeight: 1.2 }}>{t.sub}</span></div>
          </div>
        ))}
      </div>

      {/* CONTROL GRID */}
      <div style={{ display: "grid", gridTemplateColumns: ctrlCols, gap: "0.9rem", marginBottom: "1.1rem" }}>
        {settings && catalogCard("ships", "SCHIFFSKATALOG", "ship", "var(--cyan)", settings.shipCatalog, shipInterval, setShipInterval)}
        {settings && catalogCard("locations", "STANDORTKATALOG", "pin", "var(--cyan)", settings.locationCatalog, locInterval, setLocInterval)}
        <section style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)", padding: "1.05rem 1.15rem", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem", paddingBottom: "0.7rem", borderBottom: "1px solid var(--border)" }}>
            <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--wash)", border: "1px solid var(--border-hi)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name="chat" size={16} sw={1.6} /></span>
            <div style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.06em", color: "var(--text-hi)" }}>FEEDBACK-KANAL</div>
          </div>
          <div style={monoSub({ marginBottom: "0.3rem" })}>DISCORD-KANAL-ID</div>
          <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.9rem" }}>
            <input type="text" inputMode="numeric" data-testid="feedback-channel" value={feedbackInput} placeholder="leer = aus" onChange={(e) => setFeedbackInput(e.target.value)} style={{ ...field, flex: 1, minWidth: 0 }} />
            <button type="button" data-testid="feedback-save" disabled={busy || !csrf} onClick={() => run(() => setFeedbackChannel(csrf!, feedbackInput.trim()), "Feedback-Kanal gespeichert.")} style={{ display: "inline-flex", alignItems: "center", gap: 5, flexShrink: 0, padding: "0 0.7rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--dim)", fontFamily: MONO, fontSize: "0.68rem", borderRadius: 6, cursor: "pointer" }}><Ic name="save" size={13} sw={1.7} /> Speichern</button>
          </div>
          <div style={{ marginTop: "auto", paddingTop: "0.8rem", borderTop: "1px solid var(--wash)", display: "flex", alignItems: "center", gap: "0.6rem" }}>
            <span style={{ color: "var(--dim3)", flexShrink: 0, display: "inline-flex" }}><Ic name="alert" size={15} sw={1.6} /></span>
            <span style={{ fontSize: "0.76rem", color: "var(--dim2)", lineHeight: 1.35 }}>Feedback aus dem Web wird an diesen Kanal gepostet. Leer lassen, um Weiterleitung zu deaktivieren.</span>
          </div>
        </section>
      </div>

      {/* DATA TABLES */}
      <div style={tablesGrid}>
        {/* USERS */}
        <section style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)", overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", padding: "0.9rem 1.15rem", borderBottom: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}><span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="users" size={16} sw={1.6} /></span><span style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.08em", color: "var(--text-hi)" }}>NUTZER</span><span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim3)" }}>{users.length} gesamt</span></div>
            <input type="search" data-testid="user-search" placeholder="Suchen…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...field, width: "9rem", fontSize: "0.74rem", padding: "0.32rem 0.55rem" }} />
          </div>

          {!mobile ? (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>{["NUTZER", "DISCORD", "SERVER / ROLLE", "INSTANZ-ROLLE", "STATUS", "ZULETZT"].map((h) => <th key={h} style={colHead}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {filtered.map((u) => {
                    const ac = avatarColor(u.role);
                    return (
                      <tr key={u.id} data-testid={`admin-user-${u.id}`}>
                        <td style={cell}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                            <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: ac, color: "var(--bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>{initialsOf(u.username)}</span>
                            <div style={{ minWidth: 0 }}><div style={{ fontSize: "0.88rem", color: "var(--text-hi)", lineHeight: 1.15 }}>{u.username}{u.id === me.id ? " (du)" : ""}</div><div style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim3)" }}>{u.id}</div></div>
                          </div>
                        </td>
                        <td style={cell}>
                          {u.discordId ? (
                            <><div style={{ fontFamily: MONO, fontSize: "0.74rem", color: "var(--text)" }}>{u.discordId}</div><div style={{ fontSize: "0.72rem", color: "var(--dim2)" }}>{u.discordName ? `@${u.discordName}` : ""}</div></>
                          ) : (
                            <span style={{ display: "inline-flex", alignItems: "center", padding: "2px 7px", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.05em", borderRadius: 4, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)" }}>NICHT VERKNÜPFT</span>
                          )}
                        </td>
                        <td style={cell}>
                          <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
                            {u.guilds.length === 0 ? <span style={{ fontSize: "0.76rem", color: "var(--dim3)" }}>—</span> : u.guilds.map((g, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.35rem", fontSize: "0.78rem", color: "var(--text)" }}><span>{g.name}</span><span style={miniRole(g.role)}>{ROLE_LABELS[g.role] ?? g.role}</span></div>
                            ))}
                          </div>
                        </td>
                        <td style={cell}>
                          <select data-testid={`admin-user-role-${u.id}`} value={u.role} disabled={busy || !csrf} onChange={(e) => run(() => setUserRole(u.id, csrf!, e.target.value), `Rolle von ${u.username} → ${ROLE_LABELS[e.target.value] ?? e.target.value}.`)} style={{ background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: MONO, fontSize: "0.72rem", padding: "0.28rem 0.4rem", borderRadius: 6, cursor: "pointer" }}>
                            {["superadmin", "fleetoperator", "crew"].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        </td>
                        <td style={cell}>
                          <button type="button" data-testid={`admin-user-active-${u.id}`} title="Status umschalten" disabled={busy || !csrf} onClick={() => run(() => toggleUserActive(u.id, csrf!))} style={statusChip(u.active)}>{u.active ? "AKTIV" : "DEAKTIVIERT"}</button>
                        </td>
                        <td style={{ ...cell, fontSize: "0.76rem", color: "var(--dim2)", whiteSpace: "nowrap" }}>{fmtRel(u.lastSeen)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", padding: "0.85rem" }}>
              {filtered.map((u) => {
                const ac = avatarColor(u.role);
                return (
                  <div key={u.id} data-testid={`admin-user-${u.id}`} style={{ border: "1px solid var(--border)", borderLeft: `3px solid ${ac}`, borderRadius: 10, background: "var(--row)", padding: "0.8rem 0.9rem" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.6rem" }}>
                      <span style={{ width: 28, height: 28, borderRadius: 7, flexShrink: 0, background: ac, color: "var(--bg)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>{initialsOf(u.username)}</span>
                      <div style={{ minWidth: 0, flex: 1 }}><div style={{ fontSize: "0.95rem", color: "var(--text-hi)" }}>{u.username}</div><div style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{u.id} · {fmtRel(u.lastSeen)}</div></div>
                      <button type="button" data-testid={`admin-user-active-${u.id}`} disabled={busy || !csrf} onClick={() => run(() => toggleUserActive(u.id, csrf!))} style={statusChip(u.active)}>{u.active ? "AKTIV" : "DEAKTIVIERT"}</button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem", marginBottom: "0.55rem" }}>
                      <select data-testid={`admin-user-role-${u.id}`} value={u.role} disabled={busy || !csrf} onChange={(e) => run(() => setUserRole(u.id, csrf!, e.target.value), `Rolle von ${u.username} → ${ROLE_LABELS[e.target.value] ?? e.target.value}.`)} style={{ ...roleChip(u.role), cursor: "pointer" }}>
                        {["superadmin", "fleetoperator", "crew"].map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                      {u.guilds.map((g, i) => <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: "0.3rem", fontSize: "0.74rem", color: "var(--dim)" }}>{g.name}<span style={miniRole(g.role)}>{ROLE_LABELS[g.role] ?? g.role}</span></span>)}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontFamily: MONO, fontSize: "0.68rem", color: "var(--dim2)" }}>
                      <Ic name="link" size={13} sw={1.6} />
                      {u.discordId ? <span>{u.discordName ? `@${u.discordName}` : u.discordId}</span> : <span style={{ color: "var(--red)" }}>nicht verknüpft</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* SERVERS */}
        <section style={{ border: "1px solid var(--border)", borderRadius: 13, background: "var(--bg2)", overflow: "hidden", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0.9rem 1.15rem", borderBottom: "1px solid var(--border)" }}><span style={{ color: "var(--green)", display: "inline-flex" }}><Ic name="server" size={16} sw={1.6} /></span><span style={{ fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.08em", color: "var(--text-hi)" }}>DISCORD-SERVER</span><span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim3)" }}>{guilds.length} gesamt</span></div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            {[...guilds].sort((a, b) => b.eventCount - a.eventCount || a.name.localeCompare(b.name)).map((s, gi) => {
              const banned = !!s.bannedAt;
              const c = banned ? "var(--red)" : s.active ? "var(--green)" : "var(--dim2)";
              const mostActive = gi === 0 && s.eventCount > 0;
              return (
                <div key={s.id} data-testid={`admin-guild-${s.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.6rem", rowGap: "0.5rem", flexWrap: mobile ? "wrap" : "nowrap", padding: "0.7rem 1.1rem", borderBottom: "1px solid var(--border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", minWidth: 0, flex: 1 }}>
                    <span style={{ width: 30, height: 30, borderRadius: 8, flexShrink: 0, background: `${c}18`, border: `1px solid ${c}55`, color: c, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.64rem", fontWeight: 700 }}>{initialsOf(s.name)}</span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
                        <span style={{ fontSize: "0.88rem", color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name}</span>
                        {mostActive && <span style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.52rem", letterSpacing: "0.06em", color: "var(--green)", border: "1px solid var(--edge-green)", background: "var(--tint-green)", borderRadius: 3, padding: "1px 5px", textTransform: "uppercase" }}>Aktivster</span>}
                      </div>
                      <div style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{fmtNum(s.memberCount)} Mitglieder · <span style={{ color: s.eventCount > 0 ? "var(--cyan)" : "var(--dim3)" }}>{fmtNum(s.eventCount)} Events</span></div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexShrink: 0 }}>
                    <span style={statusChip(!banned && s.active)}>{banned ? "GEBANNT" : s.active ? "AKTIV" : "INAKTIV"}</span>
                    {banned ? (
                      <button type="button" data-testid={`admin-unban-${s.id}`} disabled={busy || !csrf} onClick={() => run(() => unbanGuild(s.id, csrf!), `${s.name} entbannt.`)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.3rem 0.55rem", fontFamily: MONO, fontSize: "0.64rem", borderRadius: 6, cursor: "pointer", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)" }}><Ic name="check" size={12} sw={1.8} /> Entbannen</button>
                    ) : (
                      <button type="button" data-testid={`admin-ban-${s.id}`} disabled={busy || !csrf} onClick={() => run(() => banGuild(s.id, csrf!), `${s.name} gebannt.`)} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "0.3rem 0.55rem", fontFamily: MONO, fontSize: "0.64rem", borderRadius: 6, cursor: "pointer", border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)" }}><Ic name="ban" size={12} sw={1.8} /> Bannen</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* TOAST */}
      {toast && (
        <div data-testid="admin-notice" role="status" style={{ position: "fixed", left: "50%", bottom: "1.6rem", transform: "translateX(-50%)", zIndex: 9997, display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.65rem 1.1rem", background: "var(--row)", border: "1px solid var(--border-hi)", borderRadius: 10, color: "var(--cyan)", fontFamily: MONO, fontSize: "0.78rem", boxShadow: "0 12px 40px rgba(0,0,0,0.55)" }}>
          <Ic name="check" size={15} sw={1.8} /> {toast}
        </div>
      )}
    </div>
  );
}
