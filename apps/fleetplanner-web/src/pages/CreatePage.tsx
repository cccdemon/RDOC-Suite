import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, createOperation } from "../api/client";
import type { SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";

const OP_TYPES = [
  { key: "combat", label: "Kampf" },
  { key: "mining", label: "Mining" },
  { key: "salvage", label: "Bergung" },
  { key: "explore", label: "Exploration" },
  { key: "transport", label: "Transport" },
  { key: "training", label: "Training" },
  { key: "social", label: "Sozial" },
];
const VIS = [
  { key: "guild", label: "Guild" },
  { key: "partners", label: "Partner" },
  { key: "public", label: "Öffentlich" },
  { key: "private", label: "Privat" },
];

const fieldStyle: React.CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  background: "var(--bg3)",
  border: "1px solid rgba(0,212,255,0.14)",
  color: "var(--text)",
  fontFamily: "var(--body)",
  fontSize: "0.95rem",
  padding: "0.55rem 0.7rem",
  borderRadius: 8,
  outline: "none",
};
const labelStyle: React.CSSProperties = { fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#9fb1c2", marginBottom: "0.4rem", display: "block" };

export function CreatePage({ session }: { session: SessionResponse | null }) {
  const nav = useNavigate();
  const operatorGuilds = (session?.memberships ?? []).filter(
    (m) => m.role === "fleetoperator" || session?.user?.role === "superadmin",
  );

  const [guildId, setGuildId] = useState(operatorGuilds[0]?.guildId ?? "");
  const [title, setTitle] = useState("");
  const [opType, setOpType] = useState("combat");
  const [description, setDescription] = useState("");
  const [meetingSystem, setMeetingSystem] = useState("Stanton");
  const [meetingLocation, setMeetingLocation] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [minParticipants, setMinParticipants] = useState(0);
  const [visibility, setVisibility] = useState("guild");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const csrf = session?.csrfToken ?? null;

  // session arrives async; default the guild once memberships are known
  useEffect(() => {
    if (!guildId && operatorGuilds[0]) setGuildId(operatorGuilds[0].guildId);
  }, [guildId, operatorGuilds]);

  if (session === null)
    return <div className="fpw-state"><span style={labelStyle}>LADE…</span></div>;

  if (operatorGuilds.length === 0)
    return (
      <div className="fpw-state" data-testid="create-denied">
        <span style={labelStyle}>KEINE BERECHTIGUNG</span>
        <p className="fpw-meta">Operationen erstellen können nur Fleet-Operatoren. Du bist in keiner Guild Operator.</p>
        <Link className="fpw-btn" to="/">Zur Übersicht</Link>
      </div>
    );

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!csrf) return;
    if (!title.trim() || !scheduledAt) {
      setNotice("Titel und Datum sind erforderlich.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // datetime-local has no timezone → interpret as local, send ISO/UTC.
      const iso = new Date(scheduledAt).toISOString();
      const r = await createOperation(csrf, {
        guildId,
        title: title.trim(),
        opType,
        description: description.trim() || undefined,
        meetingSystem: meetingSystem.trim() || undefined,
        meetingLocation: meetingLocation.trim() || undefined,
        scheduledAt: iso,
        minParticipants,
        visibility,
      });
      nav(`/ops/${r.id}`);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : "Erstellen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="create-page" style={{ maxWidth: 720, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="plus" size={20} sw={2} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Neue Operation</h1>
        <Link to="/templates" className="fpw-mono-label" style={{ marginLeft: "auto", color: "var(--cyan)" }} data-testid="templates-link">VORLAGEN →</Link>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="create-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <form onSubmit={submit} className="fpw-card" style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
        <div>
          <label style={labelStyle}>GUILD</label>
          <select data-testid="create-guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} style={fieldStyle}>
            {operatorGuilds.map((g) => (
              <option key={g.guildId} value={g.guildId}>{g.guildName}</option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>TITEL</label>
          <input data-testid="create-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={160} placeholder="Operationsname…" style={fieldStyle} />
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>TYP</label>
            <select data-testid="create-type" value={opType} onChange={(e) => setOpType(e.target.value)} style={fieldStyle}>
              {OP_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>SICHTBARKEIT</label>
            <select data-testid="create-vis" value={visibility} onChange={(e) => setVisibility(e.target.value)} style={fieldStyle}>
              {VIS.map((v) => <option key={v.key} value={v.key}>{v.label}</option>)}
            </select>
          </div>
        </div>
        <div>
          <label style={labelStyle}>BESCHREIBUNG · MISSIONSZIEL</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} placeholder="Was ist die Mission?" style={{ ...fieldStyle, minHeight: 90, resize: "vertical" }} />
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>SYSTEM</label>
            <input value={meetingSystem} onChange={(e) => setMeetingSystem(e.target.value)} maxLength={80} style={fieldStyle} />
          </div>
          <div style={{ flex: "1 1 200px" }}>
            <label style={labelStyle}>TREFFPUNKT</label>
            <input value={meetingLocation} onChange={(e) => setMeetingLocation(e.target.value)} maxLength={160} placeholder="z. B. HUR-L1" style={fieldStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 240px" }}>
            <label style={labelStyle}>DATUM &amp; ZEIT</label>
            <input data-testid="create-when" type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} style={fieldStyle} />
          </div>
          <div style={{ flex: "0 1 160px" }}>
            <label style={labelStyle}>MIND. TEILNEHMER</label>
            <input type="number" min={0} max={1000} value={minParticipants} onChange={(e) => setMinParticipants(Number(e.target.value))} style={fieldStyle} />
          </div>
        </div>
        <div style={{ display: "flex", gap: "0.7rem", marginTop: "0.4rem" }}>
          <button type="submit" data-testid="create-submit" className="fpw-btn" disabled={busy}>
            <Ic name="check" size={15} sw={2} /> Operation erstellen
          </button>
          <Link to="/" className="fpw-btn" style={{ borderColor: "rgba(255,255,255,0.18)", background: "transparent", color: "var(--dim)" }}>Abbrechen</Link>
        </div>
      </form>
      <p className="fpw-meta" style={{ marginTop: "1rem" }}>
        Die Operation wird als Entwurf angelegt — Flotte, Bedarfe und Veröffentlichung danach in der Op-Detailseite.
      </p>
    </div>
  );
}
