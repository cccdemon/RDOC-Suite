import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { ApiError, createRecurrence, getOperation, publishTemplate, setOperationStatus, stopRecurrence } from "../api/client";
import type { OperationDetail, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { NeedsEditor } from "../components/NeedsEditor";
import { OperatorPanel } from "../components/OperatorPanel";
import { CoverPanel } from "../components/CoverPanel";
import { CommandersPanel } from "../components/CommandersPanel";
import { EckdatenForm } from "../components/EckdatenForm";
import { CardHead, MONO, btnGhost, btnPrimary, card, inp, lbl } from "../components/ui";

const STATUSES: Array<[string, string]> = [
  ["draft", "Entwurf"], ["open", "Offen"], ["locked", "Gesperrt"], ["starting", "Startet"],
  ["in_progress", "Läuft"], ["completed", "Abgeschlossen"], ["cancelled", "Abgesagt"],
];

const TABS = [
  { key: "eckdaten", label: "Eckdaten", icon: "edit" },
  { key: "fleet", label: "Flotte & Warteliste", icon: "ship" },
  { key: "commanders", label: "Commanders", icon: "lead" },
  { key: "admin", label: "Admin", icon: "shield" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// Legacy / cover-save redirects use older tab names — map them onto the 4 tabs.
function resolveTab(raw: string | null): TabKey {
  if (TABS.some((t) => t.key === raw)) return raw as TabKey;
  if (raw === "overview") return "eckdaten";
  if (raw === "needs") return "fleet";
  if (raw === "cover") return "admin";
  return "eckdaten";
}

// Decode a "kind:text" flash param (+ for spaces) from the cover save redirect.
function decodeFlash(raw: string | null): string | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const text = i >= 0 ? raw.slice(i + 1) : raw;
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function fmtWhen(iso: string, tz: string | null): string {
  try {
    return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", timeZone: tz || undefined, timeZoneName: "short" }).format(new Date(iso));
  } catch {
    return new Date(iso).toLocaleString("de-DE");
  }
}

function StatTile({ label, value, sub, color, icon }: { label: string; value: number | string; sub: string; color: string; icon: string }) {
  return (
    <div className="kpi" style={{ borderLeftColor: color }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.4rem" }}>
        <span className="kpi-label">{label}</span>
        <span style={{ color, display: "inline-flex" }}><Ic name={icon} size={14} sw={1.6} /></span>
      </div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  );
}

export function OpManagePage({ session }: { session: SessionResponse | null }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const csrf = session?.csrfToken ?? null;

  const [op, setOp] = useState<OperationDetail | null>(null);
  const [loadError, setLoadError] = useState<ApiError | null>(null);
  const [tab, setTab] = useState<TabKey>(resolveTab(searchParams.get("tab")));
  const [status, setStatusValue] = useState("draft");
  const [notice, setNotice] = useState<string | null>(() => decodeFlash(searchParams.get("flash")));
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState({ name: "", summary: "", visibility: "guild" });
  const [recur, setRecur] = useState({ freq: "weekly", seriesCount: "", seriesEnd: "" });

  function reload() {
    if (!id) return;
    getOperation(id)
      .then((o) => { setOp(o); setStatusValue(o.status); })
      .catch((e) => setLoadError(e instanceof ApiError ? e : new ApiError(0, null)));
  }
  useEffect(reload, [id]);

  async function run(action: () => Promise<unknown>, msg: string) {
    if (!csrf || !id) return;
    setBusy(true); setNotice(null);
    try { await action(); setNotice(msg); reload(); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  const changeStatus = (next: string) => run(() => setOperationStatus(id!, csrf!, next), `Status: ${next}.`);
  const publish = () => run(() => publishTemplate(id!, csrf!, { name: tpl.name.trim() || undefined, summary: tpl.summary.trim() || undefined, visibility: tpl.visibility }), "Als Vorlage veröffentlicht.");
  const makeSeries = () => run(() => createRecurrence(id!, csrf!, { freq: recur.freq, seriesCount: recur.seriesCount ? Number(recur.seriesCount) : undefined, seriesEnd: recur.seriesEnd ? new Date(recur.seriesEnd).toISOString() : undefined }), "Serie erstellt.");
  async function stopSeries() {
    if (!csrf || !id) return;
    setBusy(true); setNotice(null);
    try { const r = await stopRecurrence(id, csrf); setNotice(r.stopped ? "Serie gestoppt." : "Diese Operation ist keine Serie."); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Stoppen fehlgeschlagen."); } finally { setBusy(false); }
  }

  const tiles = useMemo(() => {
    if (!op) return null;
    const accepted = op.units.filter((u) => u.status === "accepted");
    const ships = accepted.filter((u) => u.unitType === "ship").length;
    const fighters = accepted.length - ships;
    const pending = op.units.filter((u) => u.status !== "accepted").length;
    const free = Math.max(0, op.totalSeats - op.filledSeats);
    return { flotte: accepted.length, ships, fighters, crew: op.filledSeats, free, total: op.totalSeats, pending };
  }, [op]);

  if (loadError)
    return <div className="fpw-state" data-testid="manage-error"><span style={lbl}>OPERATION {loadError.status === 404 ? "NICHT GEFUNDEN" : "NICHT LADBAR"}</span><Link className="fpw-btn" to="/">Zurück</Link></div>;
  if (session === null || !op || !tiles) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;
  if (!op.canManage)
    return <div className="fpw-state" data-testid="manage-forbidden"><span style={lbl}>KEINE OPERATOR-RECHTE</span><Link className="fpw-btn" to={`/ops/${id}`}>Zur Operation</Link></div>;

  const tabBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.9rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 0, cursor: "pointer", whiteSpace: "nowrap", border: "none", borderBottom: "2px solid transparent", background: "transparent", color: "#9fb1c2" };
  const tabActive: React.CSSProperties = { ...tabBase, color: "var(--cyan)", borderBottom: "2px solid var(--cyan)", background: "rgba(0,212,255,0.08)" };

  return (
    <div data-testid="manage-page" style={{ width: "100%" }}>
      {/* header */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "0.8rem", marginBottom: "1.1rem" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="board" size={17} sw={1.7} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>OPERATION // MANAGEMENT</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: "0 0 0.35rem" }}>{op.title}</h1>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", fontFamily: MONO, fontSize: "0.74rem", color: "#9fb1c2" }}>
            <span style={{ color: "var(--gold)", display: "inline-flex" }}><Ic name="clock" size={13} sw={1.6} /></span>
            {fmtWhen(op.scheduledAt, op.guild.timezone)}
            {op.meetingLocation && <><span style={{ color: "var(--dim2)" }}>·</span>{op.meetingLocation}</>}
          </div>
        </div>
        <Link to={`/ops/${id}`} data-testid="manage-view" className="btn btn-ghost">
          <Ic name="eye" size={13} sw={1.7} /> Spieler-Ansicht
        </Link>
      </div>

      {/* KPI strip — always visible above the tabs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "0.8rem", marginBottom: "1.1rem" }}>
        <StatTile label="FLOTTENSTÄRKE" value={tiles.flotte} sub={`${tiles.ships} Schiffe · ${tiles.fighters} Jäger`} color="var(--cyan)" icon="ship" />
        <StatTile label="CREW" value={tiles.crew} sub="angemeldet" color="var(--green)" icon="users" />
        <StatTile label="SITZE FREI" value={tiles.free} sub={`von ${tiles.total}`} color="var(--gold)" icon="lead" />
        <StatTile label="WARTELISTE" value={tiles.pending} sub="offene Anfragen" color="var(--purple)" icon="clock" />
      </div>

      {/* tabs */}
      <div style={{ display: "flex", gap: "0.3rem", overflowX: "auto", borderBottom: "1px solid rgba(0,212,255,0.14)", marginBottom: "1.2rem" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" data-testid={`manage-tab-${t.key}`} onClick={() => setTab(t.key)} style={tab === t.key ? tabActive : tabBase}>
            <Ic name={t.icon} size={14} sw={1.7} />{t.label}
          </button>
        ))}
      </div>

      {notice && <p className="tag tag-gold" role="alert" data-testid="manage-notice" style={{ marginBottom: "1rem" }}>{notice}</p>}

      {/* TAB: Eckdaten (fused edit form) */}
      {tab === "eckdaten" && <EckdatenForm op={op} csrf={csrf} onSaved={reload} onNotice={setNotice} />}

      {/* TAB: Flotte & Warteliste (board + waitlist D&D + needs) */}
      {tab === "fleet" && id && (
        <>
          {csrf ? <OperatorPanel op={op} csrf={csrf} embedded onChanged={reload} onError={(m) => setNotice(m)} /> : <p style={lbl}>ANMELDUNG ERFORDERLICH</p>}
          <div style={{ marginTop: "1.6rem" }}>
            <NeedsEditor opId={id} csrf={csrf} />
          </div>
        </>
      )}

      {/* TAB: Commanders */}
      {tab === "commanders" && <CommandersPanel op={op} csrf={csrf} onChanged={reload} onNotice={setNotice} />}

      {/* TAB: Admin (status + template + recurrence + cover) */}
      {tab === "admin" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
          <section style={card}>
            <CardHead icon="bolt" label={`STATUS · AKTUELL ${op.status.toUpperCase()}`} tone="green" />
            <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
              <select data-testid="manage-status" value={status} onChange={(e) => setStatusValue(e.target.value)} style={{ ...inp, width: "auto", minWidth: 180 }}>
                {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <button type="button" data-testid="manage-status-apply" style={btnPrimary} disabled={busy || !csrf || status === op.status} onClick={() => changeStatus(status)}>Status setzen</button>
            </div>
          </section>

          <section style={card}>
            <CardHead icon="shield" label="VORLAGE & SERIE" tone="gold" />
            <div style={{ ...lbl, fontSize: "0.6rem", marginBottom: "0.5rem" }}>ALS VORLAGE VERÖFFENTLICHEN</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.2rem" }}>
              <input data-testid="tpl-name" type="text" maxLength={120} value={tpl.name} placeholder={`Name (Standard: ${op.title})`} onChange={(e) => setTpl((t) => ({ ...t, name: e.target.value }))} style={inp} />
              <input data-testid="tpl-summary" type="text" maxLength={500} value={tpl.summary} placeholder="Kurzbeschreibung" onChange={(e) => setTpl((t) => ({ ...t, summary: e.target.value }))} style={inp} />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
                <select data-testid="tpl-visibility" value={tpl.visibility} onChange={(e) => setTpl((t) => ({ ...t, visibility: e.target.value }))} style={{ ...inp, width: "auto", minWidth: 160 }}>
                  <option value="guild">Guild</option><option value="partners">Partner-Guilds</option><option value="public">Öffentlich</option>
                </select>
                <button type="button" data-testid="tpl-publish" style={btnPrimary} disabled={busy || !csrf} onClick={publish}><Ic name="board" size={13} sw={2} /> Veröffentlichen</button>
              </div>
            </div>
            <div style={{ ...lbl, fontSize: "0.6rem", marginBottom: "0.5rem" }}>WIEDERKEHRENDE SERIE</div>
            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center", marginBottom: "0.6rem" }}>
              <select data-testid="recur-freq" value={recur.freq} onChange={(e) => setRecur((r) => ({ ...r, freq: e.target.value }))} style={{ ...inp, width: "auto", minWidth: 150 }}>
                <option value="weekly">Wöchentlich</option><option value="biweekly">Zweiwöchentlich</option><option value="monthly_nth">Monatlich</option><option value="yearly">Jährlich</option>
              </select>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>Anzahl<input data-testid="recur-count" type="number" min={1} max={365} value={recur.seriesCount} placeholder="∞" onChange={(e) => setRecur((r) => ({ ...r, seriesCount: e.target.value }))} style={{ ...inp, width: 80 }} /></label>
              <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--dim)", fontSize: "0.82rem" }}>bis<input data-testid="recur-until" type="date" value={recur.seriesEnd} onChange={(e) => setRecur((r) => ({ ...r, seriesEnd: e.target.value }))} style={{ ...inp, width: 160 }} /></label>
              <button type="button" data-testid="recur-create" style={btnPrimary} disabled={busy || !csrf} onClick={makeSeries}>Serie erstellen</button>
            </div>
            <button type="button" data-testid="recurrence-stop" style={btnGhost} disabled={busy || !csrf} onClick={stopSeries}>Serie stoppen</button>
          </section>

          {id && <CoverPanel opId={id} csrf={csrf} onNotice={setNotice} />}
        </div>
      )}
    </div>
  );
}
