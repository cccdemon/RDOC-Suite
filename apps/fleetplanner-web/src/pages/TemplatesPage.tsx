import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { applyTemplate, ApiError, listTemplates } from "../api/client";
import type { SessionResponse, TemplateSummary } from "../api/types";
import { Ic } from "../components/Icons";

const MONO = "var(--mono)";
const TYPE_LABEL: Record<string, string> = {
  combat: "Kampf", mining: "Mining", salvage: "Bergung", explore: "Exploration",
  transport: "Transport", training: "Training", social: "Sozial",
};

export function TemplatesPage({ session }: { session: SessionResponse | null }) {
  const nav = useNavigate();
  const operatorGuilds = (session?.memberships ?? []).filter(
    (m) => m.role === "fleetoperator" || session?.user?.role === "superadmin",
  );
  const [guildId, setGuildId] = useState("");
  const [query, setQuery] = useState("");
  const [templates, setTemplates] = useState<TemplateSummary[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [applyId, setApplyId] = useState<string | null>(null);
  const [when, setWhen] = useState("");
  const [busy, setBusy] = useState(false);
  const csrf = session?.csrfToken ?? null;

  useEffect(() => {
    if (!guildId && operatorGuilds[0]) setGuildId(operatorGuilds[0].guildId);
  }, [guildId, operatorGuilds]);

  useEffect(() => {
    if (!guildId) return;
    setTemplates(null);
    const t = setTimeout(() => {
      listTemplates(guildId, query.trim() || undefined)
        .then((r) => setTemplates(r.templates))
        .catch((e) => { setTemplates([]); setNotice(e instanceof ApiError ? e.message : "Vorlagen nicht ladbar."); });
    }, 250);
    return () => clearTimeout(t);
  }, [guildId, query]);

  if (session === null) return <div className="fpw-state"><span className="fpw-mono-label">LADE…</span></div>;
  if (operatorGuilds.length === 0)
    return (
      <div className="fpw-state" data-testid="templates-denied">
        <span className="fpw-mono-label">KEINE BERECHTIGUNG</span>
        <p className="fpw-meta">Vorlagen anwenden können nur Fleet-Operatoren.</p>
        <Link className="fpw-btn" to="/">Zur Übersicht</Link>
      </div>
    );

  async function doApply(id: string) {
    if (!csrf || !when) {
      setNotice("Bitte Datum & Zeit wählen.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const r = await applyTemplate(id, csrf, { guildId, scheduledAt: new Date(when).toISOString() });
      nav(`/ops/${r.id}`);
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Anwenden fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div data-testid="templates-page" style={{ maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1rem" }}>
        <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="board" size={20} /></span>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", color: "#eaf4fb", margin: 0 }}>Vorlagen-Marktplatz</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="templates-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.8rem", marginBottom: "1.2rem", alignItems: "center" }}>
        <select data-testid="templates-guild" value={guildId} onChange={(e) => setGuildId(e.target.value)} style={{ background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", padding: "0.5rem", borderRadius: 8 }}>
          {operatorGuilds.map((g) => <option key={g.guildId} value={g.guildId}>{g.guildName}</option>)}
        </select>
        <input type="search" data-testid="templates-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Vorlage suchen…" style={{ flex: "1 1 240px", background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", fontFamily: "var(--body)", padding: "0.5rem 0.7rem", borderRadius: 8, outline: "none" }} />
      </div>

      {templates === null ? (
        <p className="fpw-meta">Lade Vorlagen…</p>
      ) : templates.length === 0 ? (
        <p className="fpw-meta">Keine Vorlagen in dieser Guild-Sicht.</p>
      ) : (
        <div className="fpw-grid">
          {templates.map((t) => (
            <div key={t.id} className="fpw-card" data-testid={`template-${t.id}`}>
              <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.5rem" }}>
                <span className="fpw-tag cyan">{TYPE_LABEL[t.opType] ?? t.opType}</span>
                <span className="fpw-tag dim">{t.visibility}</span>
              </div>
              <div className="fpw-h2" style={{ marginBottom: "0.3rem" }}>{t.name}</div>
              {t.summary && <div className="fpw-meta" style={{ marginBottom: "0.6rem" }}>{t.summary}</div>}
              <div className="fpw-mono-label" style={{ fontSize: "0.6rem", marginBottom: "0.7rem" }}>{t.ownerGuildName} · {t.usageCount}× genutzt</div>
              {applyId === t.id ? (
                <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
                  <input type="datetime-local" data-testid={`template-when-${t.id}`} value={when} onChange={(e) => setWhen(e.target.value)} style={{ background: "var(--bg3)", border: "1px solid rgba(0,212,255,0.14)", color: "var(--text)", padding: "0.4rem", borderRadius: 8 }} />
                  <button type="button" data-testid={`template-confirm-${t.id}`} className="fpw-btn" disabled={busy} style={{ padding: "0.4rem 0.7rem", fontSize: "0.7rem" }} onClick={() => doApply(t.id)}>Erstellen</button>
                  <button type="button" className="fpw-btn" style={{ padding: "0.4rem 0.7rem", fontSize: "0.7rem", borderColor: "rgba(255,255,255,0.18)", background: "transparent", color: "var(--dim)" }} onClick={() => setApplyId(null)}>Abbrechen</button>
                </div>
              ) : (
                <button type="button" data-testid={`template-apply-${t.id}`} className="fpw-btn" style={{ padding: "0.4rem 0.8rem", fontSize: "0.72rem" }} onClick={() => { setApplyId(t.id); setWhen(""); }}>
                  <Ic name="plus" size={13} sw={2} /> Anwenden
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
