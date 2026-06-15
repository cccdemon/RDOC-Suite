import { useState } from "react";
import { ApiError, createRecurrence, publishTemplate, setOperationStatus, stopRecurrence } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { NeedsEditor } from "./NeedsEditor";
import { OperatorPanel } from "./OperatorPanel";
import { CoverPanel } from "./CoverPanel";
import { CommandersPanel } from "./CommandersPanel";
import { EckdatenForm } from "./EckdatenForm";
import { ResourceLinksPanel } from "./ResourceLinksPanel";
import { CardHead, MONO, btnGhost, btnPrimary, card, inp, lbl } from "./ui";

// IA merge D: the operator console (previously the standalone /ops/:id/manage page)
// is now an adaptive section of the op-detail screen — rendered only when the viewer
// is a leader of THIS op (op.canManage from the role-aware payload). One screen,
// no separate manage URL or layout toggle.
const STATUSES: Array<[string, string]> = [
  ["draft", "Entwurf"], ["open", "Offen"], ["locked", "Gesperrt"], ["starting", "Startet"],
  ["in_progress", "Läuft"], ["completed", "Abgeschlossen"], ["cancelled", "Abgesagt"],
];

const TABS = [
  { key: "eckdaten", label: "Eckdaten", icon: "edit" },
  { key: "fleet", label: "Flotte & Warteliste", icon: "ship" },
  { key: "cover", label: "Mission Cover", icon: "image" },
  { key: "commanders", label: "Commanders", icon: "lead" },
  { key: "admin", label: "Admin", icon: "shield" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

function resolveTab(raw: string | null): TabKey {
  if (TABS.some((t) => t.key === raw)) return raw as TabKey;
  if (raw === "overview") return "eckdaten";
  if (raw === "needs") return "fleet";
  return "eckdaten";
}

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

export function OperatorConsole({
  op,
  opId,
  csrf,
  reload,
  initialTab,
  initialFlash,
}: {
  op: OperationDetail;
  opId: string;
  csrf: string | null;
  reload: () => void;
  initialTab: string | null;
  initialFlash: string | null;
}) {
  const [tab, setTab] = useState<TabKey>(resolveTab(initialTab));
  const [status, setStatusValue] = useState(op.status);
  const [notice, setNotice] = useState<string | null>(() => decodeFlash(initialFlash));
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState({ name: "", summary: "", visibility: "guild" });
  const [recur, setRecur] = useState({ freq: "weekly", seriesCount: "", seriesEnd: "" });

  async function run(action: () => Promise<unknown>, msg: string) {
    if (!csrf) return;
    setBusy(true); setNotice(null);
    try { await action(); setNotice(msg); reload(); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  const changeStatus = (next: string) => run(() => setOperationStatus(opId, csrf!, next), `Status: ${next}.`);
  const publish = () => run(() => publishTemplate(opId, csrf!, { name: tpl.name.trim() || undefined, summary: tpl.summary.trim() || undefined, visibility: tpl.visibility }), "Als Vorlage veröffentlicht.");
  const makeSeries = () => run(() => createRecurrence(opId, csrf!, { freq: recur.freq, seriesCount: recur.seriesCount ? Number(recur.seriesCount) : undefined, seriesEnd: recur.seriesEnd ? new Date(recur.seriesEnd).toISOString() : undefined }), "Serie erstellt.");
  async function stopSeries() {
    if (!csrf) return;
    setBusy(true); setNotice(null);
    try { const r = await stopRecurrence(opId, csrf); setNotice(r.stopped ? "Serie gestoppt." : "Diese Operation ist keine Serie."); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Stoppen fehlgeschlagen."); } finally { setBusy(false); }
  }

  const accepted = op.units.filter((u) => u.status === "accepted");
  const ships = accepted.filter((u) => u.unitType === "ship").length;
  const tiles = {
    flotte: accepted.length, ships, fighters: accepted.length - ships,
    crew: op.filledSeats, free: Math.max(0, op.totalSeats - op.filledSeats),
    total: op.totalSeats, pending: op.units.filter((u) => u.status !== "accepted").length,
  };

  const tabBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 7, padding: "0.6rem 1.1rem", fontFamily: MONO, fontSize: "0.76rem", letterSpacing: "0.04em", borderRadius: 9, cursor: "pointer", whiteSpace: "nowrap", border: "1px solid rgba(255,255,255,0.12)", background: "rgba(255,255,255,0.02)", color: "#9fb1c2" };
  const tabActive: React.CSSProperties = { ...tabBase, color: "#04060a", fontWeight: 700, border: "1px solid var(--cyan)", background: "var(--cyan)", boxShadow: "0 0 14px rgba(0,212,255,0.4)" };

  return (
    <section
      data-testid="operator-console"
      style={{
        width: "100%",
        marginTop: "2.5rem",
        border: "1px solid rgba(0,212,255,0.4)",
        borderRadius: 16,
        background: "rgba(0,212,255,0.04)",
        boxShadow: "0 0 0 1px rgba(0,212,255,0.06), 0 18px 50px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      {/* Header bar — clearly marks the operator-only zone. */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.9rem 1.3rem", background: "linear-gradient(90deg, rgba(0,212,255,0.16), rgba(0,212,255,0.03))", borderBottom: "1px solid rgba(0,212,255,0.3)" }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "rgba(0,212,255,0.16)", border: "1px solid rgba(0,212,255,0.4)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name="board" size={17} sw={1.8} /></span>
        <span style={{ fontFamily: MONO, fontSize: "0.82rem", letterSpacing: "0.16em", color: "#eaf4fb", fontWeight: 700 }}>OPERATOR-KONSOLE</span>
        <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.1em", color: "var(--cyan)", border: "1px solid rgba(0,212,255,0.35)", borderRadius: 5, padding: "0.18rem 0.5rem" }}>NUR EINSATZLEITUNG</span>
      </div>
      <div style={{ padding: "1.3rem 1.3rem 1.5rem" }}>

      {/* KPI strip — always visible above the tabs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: "0.8rem", marginBottom: "1.1rem" }}>
        <StatTile label="FLOTTENSTÄRKE" value={tiles.flotte} sub={`${tiles.ships} Schiffe · ${tiles.fighters} Jäger`} color="var(--cyan)" icon="ship" />
        <StatTile label="CREW" value={tiles.crew} sub="angemeldet" color="var(--green)" icon="users" />
        <StatTile label="SITZE FREI" value={tiles.free} sub={`von ${tiles.total}`} color="var(--gold)" icon="lead" />
        <StatTile label="WARTELISTE" value={tiles.pending} sub="offene Anfragen" color="var(--purple)" icon="clock" />
      </div>

      {/* STATUS — always visible on the event main page (not buried in a tab) */}
      <section style={{ ...card, marginBottom: "1.1rem" }}>
        <CardHead icon="bolt" label={`STATUS · AKTUELL ${op.status.toUpperCase()}`} tone="green" />
        <div style={{ display: "flex", gap: "0.6rem", flexWrap: "wrap", alignItems: "center" }}>
          <select data-testid="manage-status" value={status} onChange={(e) => setStatusValue(e.target.value)} style={{ ...inp, width: "auto", minWidth: 180 }}>
            {STATUSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
          <button type="button" data-testid="manage-status-apply" style={btnPrimary} disabled={busy || !csrf || status === op.status} onClick={() => changeStatus(status)}>Status setzen</button>
        </div>
      </section>

      {/* tabs — pill segmented control in its own bar */}
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", padding: "0.7rem 0.8rem", marginBottom: "1.2rem", borderRadius: 11, background: "rgba(0,0,0,0.25)", border: "1px solid rgba(0,212,255,0.16)" }}>
        {TABS.map((t) => (
          <button key={t.key} type="button" data-testid={`manage-tab-${t.key}`} onClick={() => setTab(t.key)} style={tab === t.key ? tabActive : tabBase}>
            <Ic name={t.icon} size={15} sw={1.8} />{t.label}
          </button>
        ))}
      </div>

      {notice && <p className="tag tag-gold" role="alert" data-testid="manage-notice" style={{ marginBottom: "1rem" }}>{notice}</p>}

      {tab === "eckdaten" && (
        <>
          <EckdatenForm op={op} csrf={csrf} onSaved={reload} onNotice={setNotice} />
          <ResourceLinksPanel op={op} opId={opId} csrf={csrf} onChanged={reload} onNotice={setNotice} />
        </>
      )}

      {tab === "fleet" && (
        <>
          {csrf ? <OperatorPanel op={op} csrf={csrf} embedded onChanged={reload} onError={(m) => setNotice(m)} /> : <p style={lbl}>ANMELDUNG ERFORDERLICH</p>}
          <div style={{ marginTop: "1.6rem" }}>
            <NeedsEditor opId={opId} csrf={csrf} />
          </div>
        </>
      )}

      {tab === "cover" && <CoverPanel opId={opId} csrf={csrf} onNotice={setNotice} />}

      {tab === "commanders" && <CommandersPanel op={op} csrf={csrf} onChanged={reload} onNotice={setNotice} />}

      {tab === "admin" && (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
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
        </div>
      )}
      </div>
    </section>
  );
}
