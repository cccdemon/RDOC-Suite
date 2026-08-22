import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ApiError, createRecurrence, editOperation, getOperatorView, publishTemplate, setOperationStatus, stopRecurrence } from "../api/client";
import type { OperationDetail } from "../api/types";
import { Ic } from "./Icons";
import { NeedsEditor } from "./NeedsEditor";
import { OperatorPanel } from "./OperatorPanel";
import { CoverPanel } from "./CoverPanel";
import { CommandersPanel } from "./CommandersPanel";
import { EckdatenForm } from "./EckdatenForm";
import { VoicePanel } from "./VoicePanel";
import { ResourceLinksPanel } from "./ResourceLinksPanel";
import { CardHead, MONO, btnGhost, btnPrimary, card, inp, lbl } from "./ui";
import { FieldSaveProvider, GlobalSaveBadge, SaveDot, useFieldSave } from "./fieldSave";

// IA merge D + Operator-Console redesign (Variante A "Tabs + Live"): one screen,
// adaptive section of the op-detail page (op.canManage). Persistent status header
// over the tabs; everything autosaves with per-field status; no full reload on
// each action.
const STATUSES: Array<[string, string, string]> = [
  ["draft", "Entwurf", "var(--dim2)"], ["open", "Offen", "var(--green)"], ["locked", "Gesperrt", "var(--gold)"],
  ["starting", "Startet", "var(--cyan)"], ["in_progress", "Läuft", "var(--cyan)"],
  ["completed", "Abgeschlossen", "var(--dim)"], ["cancelled", "Abgesagt", "var(--red2)"],
];

// Wording (UI audit §9): inside the "Flotte" area a tab called "Flotte & Board"
// next to "Verbände" reads as if the two were different tasks — it is just the
// board. "Commanders" and "Admin" were the only English words in a German menu
// with a plain German equivalent. "Voice" stays: that is what the feature is
// called in the product (Subraum) and in Discord.
const TABS = [
  { key: "fleet", label: "Board", icon: "ship" },
  { key: "formations", label: "Verbände", icon: "board" },
  { key: "cqb", label: "CQB", icon: "fps" },
  { key: "eckdaten", label: "Eckdaten", icon: "edit" },
  { key: "cover", label: "Cover", icon: "image" },
  { key: "commanders", label: "Kommandanten", icon: "lead" },
  { key: "voice", label: "Voice", icon: "mic" },
  { key: "qa", label: "Fragen", icon: "chat" },
  { key: "admin", label: "Status, Vorlage & Serie", icon: "shield" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// IA 2026-08-21: nine equal tabs were a wall. They are now four work areas, each
// holding the tabs that belong together. The leaf tab still IS the URL (`?op=`),
// so every existing deep link keeps working and the group follows from the leaf.
const TAB_GROUPS = [
  { key: "flotte", label: "Flotte", icon: "ship", tabs: ["fleet", "formations", "cqb"] },
  { key: "planung", label: "Planung", icon: "edit", tabs: ["eckdaten", "cover", "commanders"] },
  { key: "kommunikation", label: "Kommunikation", icon: "chat", tabs: ["voice", "qa"] },
  { key: "verwaltung", label: "Verwaltung", icon: "shield", tabs: ["admin"] },
] as const;
type GroupKey = (typeof TAB_GROUPS)[number]["key"];

function groupOf(tab: TabKey): GroupKey {
  return (TAB_GROUPS.find((g) => (g.tabs as readonly string[]).includes(tab)) ?? TAB_GROUPS[0]).key;
}
function tabsOf(group: GroupKey): TabKey[] {
  return [...(TAB_GROUPS.find((g) => g.key === group) ?? TAB_GROUPS[0]).tabs] as TabKey[];
}
function tabMeta(tab: TabKey) {
  return TABS.find((t) => t.key === tab)!;
}

// §6 recommends `?mode=manage&section=…&sub=…`. The canonical form here stays
// `?op=<leaf>` (shorter, and every existing deep link already uses it), but the
// recommended form resolves to the same tab so those links work too.
function tabFromParams(sp: URLSearchParams): string | null {
  return sp.get("op") ?? sp.get("sub") ?? sp.get("section") ?? null;
}

function resolveTab(raw: string | null): TabKey {
  if (TABS.some((t) => t.key === raw)) return raw as TabKey;
  if (raw === "overview") return "eckdaten";
  if (raw === "needs") return "fleet";
  // A group name in `?op=` is legitimate too — it opens that area's first tab.
  const grp = TAB_GROUPS.find((g) => g.key === raw);
  if (grp) return grp.tabs[0] as TabKey;
  return "fleet";
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

export function OperatorConsole(props: {
  op: OperationDetail;
  opId: string;
  csrf: string | null;
  reload: () => void;
  initialFlash: string | null;
}) {
  return (
    <FieldSaveProvider>
      <OperatorConsoleInner {...props} />
    </FieldSaveProvider>
  );
}

function OperatorConsoleInner({
  op,
  opId,
  csrf,
  reload,
  initialFlash,
}: {
  op: OperationDetail;
  opId: string;
  csrf: string | null;
  reload: () => void;
  initialFlash: string | null;
}) {
  const { touch, fail } = useFieldSave();
  // The active work area lives in the URL, not in component state: reload,
  // deep link and browser-back all have to land on the same tab (IA goal 8).
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = resolveTab(tabFromParams(searchParams));
  const group = groupOf(tab);
  function setTab(next: TabKey) {
    if (next === tab) return;
    const sp = new URLSearchParams(searchParams);
    sp.set("op", next);
    // ?op is the canonical form; drop the accepted aliases so the URL cannot
    // end up carrying two different tabs at once.
    sp.delete("sub"); sp.delete("section"); sp.delete("mode");
    sp.delete("flash"); // a one-shot notice must not survive a tab switch
    setSearchParams(sp); // push — so browser-back returns to the previous tab
  }
  const [status, setStatusValue] = useState(op.status);
  const [voiceEnabled, setVoiceEnabled] = useState(op.squadLinkVoiceEnabled);
  const [notice, setNotice] = useState<string | null>(() => decodeFlash(initialFlash));
  // §9: both tab levels get a roving tabindex and arrow-key movement, and both
  // point at the single panel they control.
  const groupRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const arrowIndex = (key: string, i: number, len: number): number =>
    key === "ArrowRight" || key === "ArrowDown" ? (i + 1) % len
    : key === "ArrowLeft" || key === "ArrowUp" ? (i - 1 + len) % len
    : key === "Home" ? 0
    : key === "End" ? len - 1
    : -1;
  const [busy, setBusy] = useState(false);
  const [tpl, setTpl] = useState({ name: "", summary: "", visibility: "guild" });
  const [recur, setRecur] = useState({ freq: "weekly", seriesCount: "", seriesEnd: "" });
  const [flex, setFlex] = useState<number | null>(null);

  // Re-seed status/voice when navigating to another op.
  useEffect(() => { setStatusValue(op.status); setVoiceEnabled(op.squadLinkVoiceEnabled); }, [op.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Header KPI: flexible-waitlist count lives in the operator view only.
  useEffect(() => { getOperatorView(opId).then((v) => setFlex(v.crewRequests.length)).catch(() => setFlex(null)); }, [opId]);

  // Deliberate create/destroy actions keep an explicit button + reload (not autosave):
  // publishing a template / creating a series each materialize new objects.
  async function run(action: () => Promise<unknown>, msg: string) {
    if (!csrf) return;
    setBusy(true); setNotice(null);
    try { await action(); setNotice(msg); reload(); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }
  const publish = () => run(() => publishTemplate(opId, csrf!, { name: tpl.name.trim() || undefined, summary: tpl.summary.trim() || undefined, visibility: tpl.visibility }), "Als Vorlage veröffentlicht.");
  const makeSeries = () => run(() => createRecurrence(opId, csrf!, { freq: recur.freq, seriesCount: recur.seriesCount ? Number(recur.seriesCount) : undefined, seriesEnd: recur.seriesEnd ? new Date(recur.seriesEnd).toISOString() : undefined }), "Serie erstellt.");
  async function stopSeries() {
    if (!csrf) return;
    if (!window.confirm("Wiederkehrende Serie wirklich stoppen?")) return;
    setBusy(true); setNotice(null);
    try { const r = await stopRecurrence(opId, csrf); setNotice(r.stopped ? "Serie gestoppt." : "Diese Operation ist keine Serie."); }
    catch (e) { setNotice(e instanceof ApiError ? e.message : "Stoppen fehlgeschlagen."); } finally { setBusy(false); }
  }

  // Inline status: optimistic + immediate save; confirm only for the destructive cancel.
  async function changeStatus(next: string) {
    if (!csrf || next === status) return;
    if (next === "cancelled" && !window.confirm("Operation auf „Abgesagt“ setzen?")) return;
    const prev = status;
    setStatusValue(next); setNotice(null);
    try { await setOperationStatus(opId, csrf, next); touch("op-status"); }
    catch (e) { setStatusValue(prev); fail("op-status"); setNotice(e instanceof ApiError ? e.message : "Status fehlgeschlagen."); }
  }
  // Voice quick-switch — shared field with Eckdaten + the Voice tab.
  async function toggleVoice() {
    if (!csrf) return;
    const next = !voiceEnabled;
    setVoiceEnabled(next); setNotice(null);
    try { await editOperation(opId, csrf, { squadLinkVoiceEnabled: next }); touch("op-voice"); }
    catch (e) { setVoiceEnabled(!next); fail("op-voice"); setNotice(e instanceof ApiError ? e.message : "Speichern fehlgeschlagen."); }
  }

  // ── derived header metrics (from op; flex from the view) ──
  const filled = op.filledSeats;
  const total = op.totalSeats;
  const free = Math.max(0, total - filled);
  const pct = total ? Math.round((filled / total) * 100) : 0;
  const openQ = op.questions.filter((q) => !q.answer).length;
  const recipientCount = useMemo(() => {
    const s = new Set(op.leaders.map((l) => l.id));
    op.units.forEach((u) => { if (u.status === "accepted") u.seats.forEach((se) => { if (se.claimedBy) s.add(se.claimedBy.id); }); });
    return s.size;
  }, [op]);

  // ── status header (always above the tabs) ──
  const kpiTile = (label: string, value: number | string, color: string) => (
    <div key={label} style={{ flex: "1 1 110px", border: `1px solid ${color === "var(--cyan)" ? "var(--border)" : "var(--wash)"}`, borderLeft: `2px solid ${color}`, borderRadius: 9, background: "var(--wash)", padding: "0.55rem 0.75rem" }}>
      <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.08em", color: "var(--dim2)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontFamily: MONO, fontSize: "1.2rem", color, lineHeight: 1 }}>{value}</div>
    </div>
  );

  const statusHeader = (
    <div style={{ border: "1px solid var(--border-hi)", borderRadius: 14, background: "var(--bg2)", padding: "0.9rem 1rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "0.8rem" }}>
        <span style={{ width: 30, height: 30, borderRadius: 8, background: "var(--wash)", border: "1px solid var(--border-hi)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name="board" size={17} /></span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>OPERATOR-KONSOLE · NUR EINSATZLEITUNG</div>
          <div style={{ fontSize: "1.05rem", fontWeight: 700, color: "var(--text-hi)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{op.title}</div>
        </div>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
          <button type="button" data-testid="voice-quickswitch" title="Subraum Voice" onClick={toggleVoice} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.36rem 0.65rem", borderRadius: 8, cursor: "pointer", border: voiceEnabled ? "1px solid var(--border-hi)" : "1px solid var(--wash)", background: voiceEnabled ? "var(--wash)" : "transparent", color: voiceEnabled ? "var(--purple)" : "var(--dim2)", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.04em" }}>
            <Ic name="mic" size={13} /> {voiceEnabled ? "VOICE AN" : "VOICE AUS"}
          </button>
          <SaveDot id="op-voice" />
        </div>
        <GlobalSaveBadge />
      </div>
      <div style={{ display: "flex", gap: "0.9rem", flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.1em", color: "var(--dim2)" }}>STATUS</span>
          <div data-testid="manage-status" style={{ display: "inline-flex", gap: 4, padding: 4, borderRadius: 10, background: "rgba(0,0,0,0.3)", border: "1px solid var(--border)", flexWrap: "wrap" }}>
            {STATUSES.map(([v, l, col]) => {
              const on = status === v;
              return (
                <button key={v} type="button" data-testid={`status-seg-${v}`} onClick={() => changeStatus(v)} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.32rem 0.7rem", borderRadius: 7, cursor: "pointer", border: on ? `1px solid ${col}` : "1px solid transparent", background: on ? "var(--wash)" : "transparent", color: on ? col : "var(--dim2)", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.04em" }}>
                  {on && <span style={{ width: 6, height: 6, borderRadius: "50%", background: col }} />}{l}
                </button>
              );
            })}
          </div>
          <SaveDot id="op-status" />
        </div>
        <div style={{ flex: 1, minWidth: 220, display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          {kpiTile("FÜLLGRAD", `${pct}%`, "var(--green)")}
          {kpiTile("SITZE FREI", free, "var(--gold)")}
          {kpiTile("FLEXIBEL", flex ?? "–", "var(--cyan)")}
          {kpiTile("OFFENE FRAGEN", openQ, "var(--purple)")}
        </div>
      </div>
    </div>
  );

  // §9: a badge counts open work, and it says so — a bare number next to a tab
  // is unreadable for anyone who cannot see which tab it sits on.
  const tabBadge = (k: TabKey): { n: number; color: string; what: string } | null => {
    if (k === "fleet" && free > 0) return { n: free, color: "var(--cyan)", what: free === 1 ? "freier Platz" : "freie Plätze" };
    if (k === "voice" && voiceEnabled && recipientCount > 0) return { n: recipientCount, color: "var(--purple)", what: recipientCount === 1 ? "Voice-Teilnehmer" : "Voice-Teilnehmer" };
    if (k === "qa" && openQ > 0) return { n: openQ, color: "var(--gold)", what: openQ === 1 ? "offene Frage" : "offene Fragen" };
    return null;
  };
  const accentOf = (k: TabKey) => (k === "voice" ? "var(--purple)" : k === "qa" ? "var(--gold)" : "var(--cyan)");
  const firstTabOf = (g: GroupKey) => tabsOf(g)[0];
  // A collapsed area still has to show that something inside it needs attention.
  const groupBadge = (g: GroupKey): { n: number; color: string; what: string } | null => {
    const parts = tabsOf(g).map(tabBadge).filter((b): b is { n: number; color: string; what: string } => b !== null);
    if (parts.length === 0) return null;
    return {
      n: parts.reduce((sum, b) => sum + b.n, 0),
      color: parts[0].color,
      what: parts.map((b) => `${b.n} ${b.what}`).join(", "),
    };
  };

  return (
    <section
      data-testid="operator-console"
      style={{
        width: "100%",
        marginTop: "2.5rem",
        border: "1px solid var(--border-hi)",
        borderRadius: 16,
        background: "var(--wash)",
        boxShadow: "0 0 0 1px var(--wash), 0 18px 50px rgba(0,0,0,0.35)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "1.2rem 1.3rem 1.5rem" }}>
        {statusHeader}

        {/* Two-level work-area navigation: four areas, then that area's tabs.
            Both levels write the leaf tab into the URL. */}
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.5rem" }}>
          <span style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--cyan)" }} />
          <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>ARBEITSBEREICH</span>
        </div>
        <div role="tablist" aria-label="Arbeitsbereich" style={{ display: "flex", gap: "0.45rem", flexWrap: "wrap", padding: "0.55rem 0.6rem", marginBottom: "0.6rem", borderRadius: 13, background: "rgba(0,0,0,0.28)", border: "1px solid var(--border)" }}>
          {TAB_GROUPS.map((g, gi) => {
            const on = g.key === group;
            const badge = groupBadge(g.key);
            return (
              <button
                key={g.key}
                type="button"
                role="tab"
                id={`manage-group-tab-${g.key}`}
                aria-selected={on}
                aria-controls="manage-panel"
                tabIndex={on ? 0 : -1}
                ref={(el) => { groupRefs.current[g.key] = el; }}
                data-testid={`manage-group-${g.key}`}
                onKeyDown={(e) => {
                  const j = arrowIndex(e.key, gi, TAB_GROUPS.length);
                  if (j < 0) return;
                  e.preventDefault();
                  const next = TAB_GROUPS[j];
                  setTab(firstTabOf(next.key));
                  groupRefs.current[next.key]?.focus();
                }}
                onClick={() => setTab(firstTabOf(g.key))} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 9, padding: "0.6rem 1rem", borderRadius: 10, cursor: "pointer", fontFamily: MONO, fontSize: "0.76rem", letterSpacing: "0.03em", whiteSpace: "nowrap", fontWeight: on ? 700 : 500, border: on ? "1px solid var(--cyan)" : "1px solid var(--wash)", background: on ? "var(--cyan)" : "var(--wash)", color: on ? "var(--bg)" : "var(--dim)", transition: "all .12s" }}>
                <span style={{ display: "inline-flex", color: on ? "var(--bg)" : "var(--cyan)" }}><Ic name={g.icon} size={16} /></span>{g.label}
                {badge && <span role="status" aria-label={badge.what} title={badge.what} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 19, height: 19, padding: "0 5px", borderRadius: 10, fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700, background: on ? "rgba(18, 20, 22,0.22)" : badge.color, color: "var(--bg)" }}>{badge.n}</span>}
              </button>
            );
          })}
        </div>
        <div role="tablist" aria-label="Bereich" data-testid="manage-subtabs" style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "1.2rem", paddingLeft: "0.15rem" }}>
          {tabsOf(group).map((k, ti) => {
            const meta = tabMeta(k);
            const on = tab === k;
            const badge = tabBadge(k);
            const acc = accentOf(k);
            const siblings = tabsOf(group);
            return (
              <button
                key={k}
                type="button"
                role="tab"
                id={`manage-tab-id-${k}`}
                aria-selected={on}
                aria-controls="manage-panel"
                tabIndex={on ? 0 : -1}
                ref={(el) => { tabRefs.current[k] = el; }}
                data-testid={`manage-tab-${k}`}
                onKeyDown={(e) => {
                  const j = arrowIndex(e.key, ti, siblings.length);
                  if (j < 0) return;
                  e.preventDefault();
                  setTab(siblings[j]);
                  tabRefs.current[siblings[j]]?.focus();
                }}
                onClick={() => setTab(k)} style={{ display: "inline-flex", alignItems: "center", gap: 7, padding: "0.42rem 0.8rem", borderRadius: 8, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", letterSpacing: "0.03em", whiteSpace: "nowrap", fontWeight: on ? 700 : 500, border: on ? "1px solid var(--cyan)" : "1px solid var(--border)", background: on ? "var(--wash)" : "transparent", color: on ? "var(--cyan)" : "var(--dim)", transition: "all .12s" }}>
                <span style={{ display: "inline-flex", color: on ? "var(--cyan)" : acc }}><Ic name={meta.icon} size={14} /></span>{meta.label}
                {badge && <span role="status" aria-label={`${badge.n} ${badge.what}`} title={`${badge.n} ${badge.what}`} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", minWidth: 18, height: 18, padding: "0 5px", borderRadius: 9, fontFamily: MONO, fontSize: "0.6rem", fontWeight: 700, background: badge.color, color: "var(--bg)" }}>{badge.n}</span>}
              </button>
            );
          })}
        </div>

        {notice && <p className="tag tag-gold" role="alert" data-testid="manage-notice" style={{ marginBottom: "1rem" }}>{notice}</p>}

        <div className="fpw-popin" role="tabpanel" id="manage-panel" aria-labelledby={`manage-tab-id-${tab}`} tabIndex={-1}>
          {tab === "eckdaten" && (
            <>
              <EckdatenForm op={op} csrf={csrf} onNotice={setNotice} voiceEnabled={voiceEnabled} onToggleVoice={toggleVoice} />
              <ResourceLinksPanel op={op} opId={opId} csrf={csrf} onChanged={reload} onNotice={setNotice} />
            </>
          )}

          {(tab === "fleet" || tab === "cqb" || tab === "formations" || tab === "qa") && (
            csrf
              ? <OperatorPanel op={op} csrf={csrf} embedded section={tab} onChanged={reload} onError={(m) => setNotice(m)} />
              : <p style={lbl}>ANMELDUNG ERFORDERLICH</p>
          )}
          {/* Also on the CQB tab: that is where CQB teams are managed, and without
              the editor there is no way to REQUEST any — the count control lived
              on the fleet tab only, so "I asked for 2 teams" never reached the server. */}
          {(tab === "fleet" || tab === "cqb") && (
            <div style={{ marginTop: "1.6rem" }}>
              <NeedsEditor opId={opId} csrf={csrf} />
            </div>
          )}

          {tab === "voice" && <VoicePanel op={op} csrf={csrf} voiceEnabled={voiceEnabled} onToggleVoice={toggleVoice} onNotice={setNotice} />}

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
      </div>
    </section>
  );
}
