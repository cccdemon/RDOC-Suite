import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, getGuildSettings, setMemberRole, updateGuildSettings } from "../api/client";
import type { GuildSettings, GuildSettingsMember, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
const label: React.CSSProperties = { fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.7rem" };
const field: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", background: "var(--bg3)",
  border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)",
  fontSize: "0.95rem", padding: "0.55rem 0.7rem", borderRadius: 8, outline: "none",
};

// Same curated IANA list the SSR settings page offers (lib/timezone.ts).
const TIMEZONES: Array<[string, string]> = [
  ["Europe/Berlin", "Berlin (CET/CEST)"], ["Europe/London", "London (GMT/BST)"],
  ["Europe/Paris", "Paris (CET/CEST)"], ["Europe/Amsterdam", "Amsterdam (CET/CEST)"],
  ["Europe/Stockholm", "Stockholm (CET/CEST)"], ["Europe/Warsaw", "Warsaw (CET/CEST)"],
  ["Europe/Moscow", "Moscow (MSK)"], ["America/New_York", "New York (EST/EDT)"],
  ["America/Chicago", "Chicago (CST/CDT)"], ["America/Denver", "Denver (MST/MDT)"],
  ["America/Los_Angeles", "Los Angeles (PST/PDT)"], ["America/Sao_Paulo", "São Paulo (BRT)"],
  ["Asia/Tokyo", "Tokyo (JST)"], ["Asia/Shanghai", "Shanghai (CST)"],
  ["Asia/Seoul", "Seoul (KST)"], ["Asia/Singapore", "Singapore (SGT)"],
  ["Australia/Sydney", "Sydney (AEST/AEDT)"], ["UTC", "UTC"],
];

export function GuildSettingsPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const csrf = session?.csrfToken ?? null;
  const [searchParams] = useSearchParams();
  // Only a guild's OWN fleet operators manage its settings here — being a partner
  // (or instance superadmin) must not expose another guild's config. (Superadmins
  // use the Admin console for instance-wide actions.)
  const manageable = (session?.memberships ?? []).filter((m) => m.role === "fleetoperator");

  const [guildId, setGuildId] = useState<string | null>(null);
  const [guild, setGuild] = useState<GuildSettings | null>(null);
  const [members, setMembers] = useState<GuildSettingsMember[]>([]);
  const [form, setForm] = useState({ orgName: "", timezone: "Europe/Berlin", discordInviteUrl: "", admiralRoleId: "" });
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Respect the guild picked on the server list (?guild=…) if it's actually
  // manageable; otherwise fall back to the first manageable guild.
  useEffect(() => {
    if (guildId !== null || manageable.length === 0) return;
    const wanted = searchParams.get("guild");
    const pick = manageable.find((m) => m.guildId === wanted)?.guildId ?? manageable[0].guildId;
    setGuildId(pick);
  }, [manageable, guildId, searchParams]);

  function reload(id: string) {
    getGuildSettings(id)
      .then((r) => {
        setGuild(r.guild);
        setMembers(r.members);
        setForm({
          orgName: r.guild.orgName ?? "",
          timezone: r.guild.timezone || "Europe/Berlin",
          discordInviteUrl: r.guild.discordInviteUrl ?? "",
          admiralRoleId: r.guild.admiralRoleId ?? "",
        });
      })
      .catch((e) => setNotice(e instanceof ApiError ? e.message : "Server nicht ladbar."));
  }
  useEffect(() => {
    if (guildId) reload(guildId);
  }, [guildId]);

  async function save() {
    if (!csrf || !guildId) return;
    setBusy(true);
    setNotice(null);
    try {
      await updateGuildSettings(guildId, csrf, {
        orgName: form.orgName.trim() || null,
        timezone: form.timezone,
        discordInviteUrl: form.discordInviteUrl.trim() || null,
        admiralRoleId: form.admiralRoleId.trim() || null,
      });
      setNotice("Gespeichert.");
      reload(guildId);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleRole(m: GuildSettingsMember) {
    if (!csrf || !guildId) return;
    const next = m.role === "fleetoperator" ? "crew" : "fleetoperator";
    setBusy(true);
    setNotice(null);
    try {
      await setMemberRole(guildId, m.userId, next, csrf);
      reload(guildId);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Rolle nicht änderbar.");
    } finally {
      setBusy(false);
    }
  }

  if (session === null) return <div className="fpw-state"><span style={label}>LADE…</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="guild-anon">
        <span style={label}>ANMELDUNG ERFORDERLICH</span>
        <Link className="fpw-btn" to="/login">Anmelden</Link>
      </div>
    );
  if (manageable.length === 0)
    return (
      <div className="fpw-state" data-testid="guild-none">
        <span style={label}>KEINE SERVER-RECHTE</span>
        <p className="fpw-meta">Du bist auf keinem Server Flottenoperator. Server-Einstellungen sind Admiralen vorbehalten.</p>
      </div>
    );

  return (
    <div data-testid="guild-settings-page" style={{ width: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.2rem" }}>
        <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="users" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "var(--text-hi)", margin: 0 }}>Server-Einstellungen</h1>
      </div>
      <p className="fpw-meta" style={{ marginBottom: "1.2rem", display: "flex", gap: "1.2rem", flexWrap: "wrap" }}>
        <Link to="/guilds/partnerships" data-testid="partnerships-link">Partnerschaften verwalten →</Link>
        <Link to="/guilds/diagnostics" data-testid="diagnostics-link">Discord-Diagnose →</Link>
      </p>

      {manageable.length > 1 && (
        <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
          <div style={label}>SERVER</div>
          <select
            data-testid="guild-select"
            value={guildId ?? ""}
            onChange={(e) => setGuildId(e.target.value)}
            style={field}
          >
            {manageable.map((m) => (
              <option key={m.guildId} value={m.guildId}>{m.guildName}</option>
            ))}
          </select>
        </section>
      )}

      {notice && <p className="fpw-tag gold" role="alert" data-testid="guild-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      {guild === null ? (
        <p className="fpw-meta">Lade Server…</p>
      ) : (
        <>
          <section className="fpw-card" style={{ marginBottom: "1.2rem" }}>
            <div style={label}>{guild.name.toUpperCase()}</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.9rem" }}>
              <label style={{ display: "block" }}>
                <span style={label}>ORG-NAME (ANZEIGENAME)</span>
                <input data-testid="guild-orgname" type="text" maxLength={80} value={form.orgName} placeholder={guild.name} onChange={(e) => setForm((f) => ({ ...f, orgName: e.target.value }))} style={field} />
              </label>
              <label style={{ display: "block" }}>
                <span style={label}>ZEITZONE</span>
                <select data-testid="guild-timezone" value={form.timezone} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))} style={field}>
                  {TIMEZONES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label style={{ display: "block" }}>
                <span style={label}>DISCORD-EINLADUNGSLINK</span>
                <input data-testid="guild-invite" type="url" value={form.discordInviteUrl} placeholder="https://discord.gg/…" onChange={(e) => setForm((f) => ({ ...f, discordInviteUrl: e.target.value }))} style={field} />
                <p className="fpw-meta" style={{ marginTop: "0.35rem", fontSize: "0.8rem" }}>Nur echte discord.gg / discord.com/invite Links — ungültige Eingaben werden verworfen.</p>
              </label>
              <label style={{ display: "block" }}>
                <span style={label}>ORGAMEMBER-ROLLE (DISCORD-ROLLEN-ID)</span>
                <input data-testid="guild-admiralrole" type="text" inputMode="numeric" value={form.admiralRoleId} placeholder="z. B. 123456789012345678" onChange={(e) => setForm((f) => ({ ...f, admiralRoleId: e.target.value }))} style={field} />
                <p className="fpw-meta" style={{ marginTop: "0.35rem", fontSize: "0.8rem" }}>Mitglieder mit dieser Discord-Rolle sind Orgamember: berechtigt zum Anlegen von Events etc. und Teil der Org-Flotte.</p>
              </label>
              <div>
                <button type="button" data-testid="guild-save" className="fpw-btn" disabled={busy || !csrf} onClick={save}>
                  <Ic name="check" size={13} sw={2} /> Speichern
                </button>
              </div>
            </div>
          </section>

          <section className="fpw-card">
            <div style={label}>MITGLIEDER ({members.length})</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              {members.map((m) => (
                <div key={m.userId} className="fpw-seat" data-testid={`member-row-${m.userId}`}>
                  <span style={{ flex: 1, color: "var(--text-hi)" }}>{m.username}</span>
                  {m.isOwner ? (
                    <span className="fpw-tag gold" style={{ display: "inline-flex" }}>OWNER · ADMIRAL</span>
                  ) : (
                    <>
                      <span className={`fpw-tag ${m.role === "fleetoperator" ? "cyan" : "dim"}`} style={{ display: "inline-flex" }}>
                        {m.role === "fleetoperator" ? "FLOTTENOPERATOR" : "CREW"}
                      </span>
                      <button type="button" data-testid={`member-toggle-${m.userId}`} className="fpw-btn" disabled={busy || !csrf} onClick={() => toggleRole(m)} style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}>
                        {m.role === "fleetoperator" ? "→ Crew" : "→ Operator"}
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
