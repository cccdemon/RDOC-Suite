import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, listOperations } from "../api/client";
import type { OperationSummary, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { ErrorState } from "../components/ErrorState";
import { useSeo } from "../seo";
import { ObjectTile, tint } from "../components/ui";
import { SIGNUP_LABEL, opStatusBadge, visibilityLabel } from "../opStatus";

const MONO = "var(--mono)";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DOW = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// op type → design palette (defensive: match lowercased opType incl. de aliases)
// Same closed palette as OP_TYPES in opForm.ts: icon and label separate the
// types, not a hue per type.
const TYPES: Record<string, { label: string; color: string; icon: string }> = {
  combat: { label: "Kampf", color: "var(--cyan)", icon: "fighter" },
  mining: { label: "Mining", color: "var(--cyan)", icon: "bolt" },
  salvage: { label: "Bergung", color: "var(--cyan)", icon: "swap" },
  explore: { label: "Exploration", color: "var(--cyan)", icon: "globe" },
  transport: { label: "Transport", color: "var(--cyan)", icon: "vehicle" },
  training: { label: "Training", color: "var(--cyan)", icon: "lead" },
  social: { label: "Sozial", color: "var(--cyan)", icon: "users" },
};
const TYPE_ALIASES: Record<string, string> = {
  kampf: "combat", fight: "combat", pvp: "combat", defense: "combat",
  bergung: "salvage", exploration: "explore", erkundung: "explore",
  logistik: "transport", fracht: "transport", sozial: "social", community: "social",
};
function typeOf(opType: string) {
  const k = opType.toLowerCase();
  const key = TYPES[k] ? k : TYPE_ALIASES[k] ?? "combat";
  return { key, ...TYPES[key] };
}

type Ev = {
  id: string;
  day: number;
  time: string;
  title: string;
  typeKey: string;
  guild: string;
  signed: number;
  cap: number;
  ts: number;
  status: string;
  stream: boolean;
  recurring: boolean;
};

// The three views of one dataset. Same order on every screen size; the month
// view is disabled (not removed) where it does not fit.
const VIEW_TABS = [
  { v: "liste", testid: "op-view-liste", label: "Liste", icon: "board" },
  { v: "monat", testid: "cal-view-monat", label: "Kalender", icon: "cal" },
  { v: "agenda", testid: "cal-view-agenda", label: "Agenda", icon: "chat" },
] as const;

const tagStyle = (color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  fontFamily: MONO,
  fontSize: "9px",
  letterSpacing: "0.06em",
  borderRadius: 3,
  // tint() rather than `${color}55`: half the callers pass a token, and
  // "var(--green)55" is not a colour — border and background were silently
  // dropping there.
  border: `1px solid ${tint(color, 33)}`,
  background: tint(color, 10),
  color,
  whiteSpace: "nowrap",
});

// IA merge A: Operationen-Übersicht + Kalender are one screen with a Liste /
// Kalender / Agenda view switch over a single GET /api/v1/operations dataset.
// The view persists in the URL (?view=). The list view is session-aware
// (signup badges, create/login CTAs); kalender/agenda are month-scoped.
export function OperationenPage({ session }: { session: SessionResponse | null }) {
  useSeo({
    title: "Operationsplanung für Star-Citizen-Flotten",
    description:
      "RDOC Fleetplanner: Events anlegen, Flotten-Slots vergeben, Crew anmelden und Voice koordinieren — die Operationsplanung für Star-Citizen-Organisationen.",
  });
  const now = new Date();
  const [params, setParams] = useSearchParams();

  // UI audit §5: everything that makes this screen look the way it looks lives in
  // the URL — view, type filter, stream filter, past toggle, visible month and the
  // selected day. Reload, deep link and Back therefore reproduce the same page.
  const patchParams = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        for (const [k, v] of Object.entries(patch)) {
          if (v === null) n.delete(k);
          else n.set(k, v);
        }
        return n;
      },
      { replace },
    );

  const viewParam = params.get("view");
  const view: "liste" | "monat" | "agenda" =
    viewParam === "kalender" || viewParam === "monat" ? "monat"
    : viewParam === "liste" ? "liste"
    : "agenda"; // default = agenda
  // Push, not replace: switching the view is navigation, and Back must undo it.
  const setView = (v: "liste" | "monat" | "agenda") => patchParams({ view: v === "monat" ? "kalender" : v });

  const filter = params.get("typ") ?? "alle";
  const setFilter = (k: string) => patchParams({ typ: k === "alle" ? null : k });

  // FR-P3 stream filter: all → show everything, only → stream events, off → hide stream events.
  const streamParam = params.get("stream");
  const streamFilter: "all" | "only" | "off" = streamParam === "only" || streamParam === "off" ? streamParam : "all";
  const setStreamFilter = (v: "all" | "only" | "off") => patchParams({ stream: v === "all" ? null : v });

  const showPast = params.get("past") === "1";
  const setShowPast = (v: boolean) => patchParams({ past: v ? "1" : null });

  // §5: drafts are a saved view, not a button that teleports somewhere. They only
  // exist in the list (the calendar and the agenda never show unpublished ops), so
  // turning the filter on switches to the list as part of the same state change.
  const draftsOnly = params.get("status") === "draft";
  const setDraftsOnly = (v: boolean) => patchParams({ status: v ? "draft" : null, view: v ? "liste" : null });

  // ?m=YYYY-MM carries the visible month; anything unparseable falls back to now.
  const mMatch = /^(\d{4})-(\d{2})$/.exec(params.get("m") ?? "");
  const monthRaw = mMatch ? Number(mMatch[2]) - 1 : now.getMonth();
  const year = mMatch ? Number(mMatch[1]) : now.getFullYear();
  const month = monthRaw >= 0 && monthRaw <= 11 ? monthRaw : now.getMonth();
  const gotoMonth = (y: number, m: number, day?: number) =>
    patchParams({ m: `${y}-${String(m + 1).padStart(2, "0")}`, d: day === undefined ? null : String(day) });

  const dParam = Number(params.get("d"));
  const monthIsNow = year === now.getFullYear() && month === now.getMonth();
  const selDay = dParam >= 1 && dParam <= 31 ? dParam : monthIsNow ? now.getDate() : 1;
  // Picking a day refines the current view rather than navigating away from it.
  const setSelDay = (d: number) => patchParams({ d: String(d) }, true);

  // Roving focus for the view tablist.
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const [vw, setVw] = useState(typeof window !== "undefined" ? window.innerWidth : 1280);
  const [ops, setOps] = useState<OperationSummary[] | null>(null);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    listOperations(true)
      .then((r) => setOps(r.operations))
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, null)));
  }, []);

  useEffect(() => {
    const onResize = () => {
      const w = window.innerWidth;
      setVw((p) => (Math.abs(w - p) > 16 ? w : p));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const T = { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
  const isCurrentMonth = year === T.y && month === T.m;
  const monthBeforeToday = year < T.y || (year === T.y && month < T.m);
  const monthLabel = `${MONTHS[month]} ${year}`;
  const mobile = vw < 760;
  // month grid is desktop-only; on mobile it falls back to agenda. Liste stays.
  const effectiveView = mobile && view === "monat" ? "agenda" : view;
  const isListe = effectiveView === "liste";
  const isMonat = effectiveView === "monat";

  // ── map operations of the visible month to events ─────────────
  const events = useMemo<Ev[]>(() => {
    if (!ops) return [];
    const out: Ev[] = [];
    for (const op of ops) {
      // Drafts (unpublished) never appear in the calendar grid / agenda.
      if (op.status === "draft") continue;
      const d = new Date(op.scheduledAt);
      if (d.getFullYear() !== year || d.getMonth() !== month) continue;
      out.push({
        id: op.id,
        day: d.getDate(),
        time: new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit" }).format(d),
        title: op.title,
        typeKey: typeOf(op.opType).key,
        guild: op.guild.name,
        signed: op.filledSeats,
        cap: op.totalSeats || op.minParticipants || 0,
        ts: d.getTime(),
        status: op.status,
        stream: op.isStreamEvent ?? false,
        recurring: op.isRecurring ?? false,
      });
    }
    return out;
  }, [ops, year, month]);

  const passStream = (isStream: boolean) =>
    streamFilter === "all" || (streamFilter === "only" ? isStream : !isStream);
  const visible = events.filter((e) => (filter === "alle" || e.typeKey === filter) && passStream(e.stream));
  // Drafts are hidden from the calendar grid/agenda, but the operator must still
  // reach them — surfaced via a quick-access pill into the (draft-aware) list view.
  const draftCount = (ops ?? []).filter((o) => o.status === "draft").length;

  // Currently-running ops (status starting | in_progress) are surfaced at the
  // very top, month-independent — they happen "now", regardless of the visible
  // month. Sorted by start time.
  const runningOps = (ops ?? [])
    .filter((o) => o.status === "starting" || o.status === "in_progress")
    .slice()
    .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());

  // Shared vocabulary (opStatus.ts) — the calendar, the agenda, the list and the
  // detail page must not each invent their own word for the same state.
  const statusOf = (e: Ev) =>
    opStatusBadge({ status: e.status, scheduledAt: e.ts, filledSeats: e.signed, totalSeats: e.cap }, now.getTime());

  if (error) {
    const code = error.status === 401 ? 401 : 503;
    return <ErrorState code={code} message="Kalender konnte nicht geladen werden." />;
  }

  // ── month grid ────────────────────────────────────────────────
  const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const cells: Array<{ blank: boolean; day?: number }> = [];
  for (let i = 0; i < firstDow; i++) cells.push({ blank: true });
  for (let d = 1; d <= daysInMonth; d++) cells.push({ blank: false, day: d });
  while (cells.length % 7 !== 0) cells.push({ blank: true });

  const selDayOps = visible.filter((e) => e.day === selDay).sort((a, b) => a.time.localeCompare(b.time));
  const selDateLabel = selDay ? `${DOW[new Date(Date.UTC(year, month, selDay)).getUTCDay()]} · ${selDay}. ${MONTHS[month]}` : "—";

  // ── agenda groups ─────────────────────────────────────────────
  // Agenda defaults to upcoming-only; the toggle reveals past events too.
  const agendaSource = visible.filter((e) => showPast || e.ts >= now.getTime());
  const hasPast = visible.some((e) => e.ts < now.getTime());
  const agenda: Array<{ day: number; dow: string; mon: string; isToday: boolean; ops: Ev[] }> = [];
  agendaSource
    .slice()
    .sort((a, b) => a.day - b.day || a.time.localeCompare(b.time))
    .forEach((e) => {
      let g = agenda.find((x) => x.day === e.day);
      if (!g) {
        const dd = new Date(Date.UTC(year, month, e.day));
        g = { day: e.day, dow: DOW[dd.getUTCDay()], mon: MONTHS[month].slice(0, 3), isToday: isCurrentMonth && e.day === T.d, ops: [] };
        agenda.push(g);
      }
      g.ops.push(e);
    });

  // ── stats ─────────────────────────────────────────────────────
  const statTotal = visible.length;
  let statOffen = 0, statFast = 0;
  visible.forEach((e) => {
    const k = statusOf(e).key;
    if (k === "open") statOffen++;
    else if (k === "fast") statFast++;
  });

  const legend = Object.keys(TYPES).map((k) => ({ ...TYPES[k] }));

  // ── filter chips ──────────────────────────────────────────────
  const chipBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.34rem 0.7rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.04em", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" };
  const chips = [{ key: "alle", label: "Alle", color: "var(--dim)" }].concat(
    Object.keys(TYPES).map((k) => ({ key: k, label: TYPES[k].label, color: TYPES[k].color })),
  );

  // ── empty state (§5: name the filters, offer the way out) ─────
  const activeFilters = [
    draftsOnly ? "nur Entwürfe" : null,
    filter !== "alle" ? `Typ: ${TYPES[filter]?.label ?? filter}` : null,
    streamFilter === "only" ? "nur Stream-Events" : streamFilter === "off" ? "ohne Stream-Events" : null,
    !showPast ? "nur anstehende" : null,
  ].filter((x): x is string => !!x);
  const filtersNarrowed = filter !== "alle" || streamFilter !== "all" || draftsOnly;
  const emptyState = (headline: string, offerPast: boolean) => (
    <div data-testid="cal-empty" style={{ padding: "2.4rem 1rem", textAlign: "center", border: "1px dashed var(--wash)", borderRadius: 12 }}>
      <div style={{ color: "var(--dim)", fontSize: "0.95rem" }}>{headline}</div>
      {activeFilters.length > 0 && (
        <div data-testid="cal-empty-filters" style={{ marginTop: "0.5rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.04em", color: "var(--dim3)" }}>
          AKTIVE FILTER: {activeFilters.join(" · ")}
        </div>
      )}
      <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center", flexWrap: "wrap", marginTop: "0.9rem" }}>
        {filtersNarrowed && (
          <button type="button" data-testid="cal-filter-reset" onClick={() => patchParams({ typ: null, stream: null, status: null })} style={{ ...chipBase, border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)" }}>
            <Ic name="refresh" size={13} sw={1.7} /> Filter zurücksetzen
          </button>
        )}
        {offerPast && !showPast && (
          <button type="button" data-testid="cal-show-past-inline" onClick={() => setShowPast(true)} style={{ ...chipBase, border: "1px solid var(--border)", background: "transparent", color: "var(--dim)" }}>
            <Ic name="eye" size={13} sw={1.7} /> Vergangene anzeigen
          </button>
        )}
      </div>
    </div>
  );

  // ── op card (selected day + agenda) ───────────────────────────
  const opCard = (e: Ev, compact: boolean) => {
    const ty = typeOf(e.typeKey);
    const st = statusOf(e);
    const pct = e.cap > 0 ? Math.min(100, Math.round((e.signed / e.cap) * 100)) : 0;
    const dim = st.key === "done" || st.key === "cancelled";
    return (
      <Link key={e.id} to={`/ops/${e.id}`} data-testid={`cal-open-${e.id}`} style={{ display: "block", textDecoration: "none", border: `1px solid ${tint(ty.color, 18)}`, borderLeft: `3px solid ${ty.color}`, borderRadius: 10, background: "var(--row)", padding: "0.75rem 0.85rem", opacity: dim ? 0.6 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontFamily: MONO, fontSize: compact ? "0.92rem" : "0.98rem", color: "var(--text-hi)", flexShrink: 0 }}>{e.time}</span>
          <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${tint(ty.color, 12)}`, border: `1px solid ${tint(ty.color, 30)}`, color: ty.color }}>
            <Ic name={ty.icon} size={15} sw={1.6} />
          </span>
          <span style={{ flex: 1 }} />
          {e.recurring && (
            <span data-testid={`cal-series-${e.id}`} title="Teil einer wiederkehrenden Serie" style={{ ...tagStyle("var(--cyan)"), gap: 4 }}>
              <Ic name="swap" size={11} sw={1.7} /> SERIE
            </span>
          )}
          {e.stream && (
            <span data-testid={`cal-stream-${e.id}`} style={{ ...tagStyle("#9146ff"), gap: 4 }}>
              <Ic name="stream" size={11} sw={1.7} /> STREAM
            </span>
          )}
          <span style={tagStyle(st.color)}>{st.label}</span>
        </div>
        <strong style={{ display: "block", fontWeight: compact ? 700 : 600, fontSize: compact ? "1.1rem" : "1.08rem", color: "var(--text-hi)", lineHeight: 1.2, margin: "0.5rem 0 0.2rem" }}>{e.title}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.55rem" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", fontFamily: MONO, fontSize: "9px", letterSpacing: "0.05em", borderRadius: 3, border: `1px solid ${tint(ty.color, 40)}`, background: `${tint(ty.color, 8)}`, color: ty.color, textTransform: "uppercase" }}>{ty.label}</span>
          <span style={{ color: "var(--dim2)", fontSize: "0.82rem" }}>{e.guild}</span>
          <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <div style={{ flex: 1, height: 5, borderRadius: 4, background: "var(--bg3)", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: ty.color, opacity: dim ? 0.5 : 1 }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: "0.74rem", color: "var(--dim)", whiteSpace: "nowrap" }}>{e.signed}/{e.cap}</span>
          </div>
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.75rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 7 }}>
            Öffnen <Ic name="arrow" size={13} sw={1.9} />
          </span>
        </div>
      </Link>
    );
  };

  const statsCard = (compact: boolean) => (
    <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.2rem" }}>
      <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--dim)", marginBottom: "0.8rem" }}>DIESER MONAT</div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {[
          { v: statTotal, l: "OPS", c: "var(--text-hi)", b: "var(--wash)", bg: "transparent" },
          { v: statOffen, l: "OFFEN", c: "var(--green)", b: "var(--edge-green)", bg: "var(--tint-green)" },
          { v: statFast, l: "FAST VOLL", c: "var(--gold)", b: "var(--edge-gold)", bg: "var(--tint-gold)" },
        ].map((s) => (
          <div key={s.l} style={{ flex: "1 1 60px", border: `1px solid ${s.b}`, borderRadius: 9, padding: "0.6rem 0.5rem", textAlign: "center", background: s.bg }}>
            <div style={{ fontFamily: MONO, fontSize: compact ? "1.3rem" : "1.4rem", color: s.c, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontFamily: MONO, fontSize: "0.54rem", letterSpacing: "0.08em", color: "var(--dim3)", marginTop: "0.25rem" }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.1em", color: "var(--dim3)", marginBottom: "0.55rem", paddingTop: "0.2rem", borderTop: "1px solid var(--wash)" }}>OPERATIONSTYPEN</div>
      <div style={compact ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem 0.8rem" } : { display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {legend.map((lg) => (
          <div key={lg.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: lg.color, flexShrink: 0 }} />
            <span style={{ color: lg.color, display: "inline-flex", flexShrink: 0 }}><Ic name={lg.icon} size={13} sw={1.6} /></span>
            <span style={{ fontSize: "0.83rem", color: "var(--text)" }}>{lg.label}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const tabBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.85rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "var(--dim)", cursor: "pointer" };
  const tabActive: React.CSSProperties = { ...tabBase, background: "var(--wash)", borderColor: "var(--border-hi)", color: "var(--cyan)" };

  return (
    <div data-testid="calendar-page">
      {/* AKTUELL LAUFENDE OPERATIONEN — month-independent, top of page */}
      {runningOps.length > 0 && (
        <section
          data-testid="running-ops"
          style={{ border: "1px solid var(--edge-green)", borderRadius: 14, background: "var(--bg2)", padding: "1rem 1.1rem", marginBottom: "1.5rem" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 0 0 var(--edge-green)", animation: "fpw-live-pulse 1.8s ease-out infinite", flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.14em", color: "var(--green)" }}>AKTUELL LAUFENDE OPERATIONEN</span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{runningOps.length}</span>
            <style>{"@keyframes fpw-live-pulse{0%,100%{opacity:1}50%{opacity:0.45}}"}</style>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: mobile ? "1fr" : "repeat(auto-fill,minmax(280px,1fr))", gap: "0.7rem" }}>
            {runningOps.map((op) => {
              const ty = typeOf(op.opType);
              const cap = op.totalSeats || op.minParticipants || 0;
              const pct = cap > 0 ? Math.min(100, Math.round((op.filledSeats / cap) * 100)) : 0;
              const live = op.status === "in_progress";
              return (
                <Link
                  key={op.id}
                  to={`/ops/${op.id}`}
                  data-testid={`running-open-${op.id}`}
                  style={{ display: "block", textDecoration: "none", border: `1px solid ${tint(ty.color, 20)}`, borderLeft: "3px solid var(--green)", borderRadius: 10, background: "var(--row)", padding: "0.7rem 0.8rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `${tint(ty.color, 12)}`, border: `1px solid ${tint(ty.color, 30)}`, color: ty.color }}>
                      <Ic name={ty.icon} size={14} sw={1.6} />
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={tagStyle("var(--green)")}>{live ? "LÄUFT" : "STARTET"}</span>
                  </div>
                  <strong style={{ display: "block", fontWeight: 600, fontSize: "1.02rem", color: "var(--text-hi)", lineHeight: 1.2 }}>{op.title}</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                    <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "var(--dim)" }}>{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(op.scheduledAt))}</span>
                    <span style={{ color: "var(--dim2)", fontSize: "0.8rem" }}>{op.guild.name}</span>
                    <div style={{ flex: 1, minWidth: 90, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 4, background: "var(--bg3)", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: "var(--green)" }} />
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "var(--dim)", whiteSpace: "nowrap" }}>{op.filledSeats}/{cap}</span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {/* PAGE HEADER */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-end", justifyContent: "space-between", gap: "1rem 1.4rem", marginBottom: "1.5rem" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.4rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="cal" size={20} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "var(--dim3)" }}>OPERATIONS-KALENDER</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.05, color: "var(--text-hi)", margin: 0 }} data-testid="cal-month">{isListe ? "Operationen" : monthLabel}</h1>
          <div style={{ color: "var(--dim)", fontSize: "0.92rem", marginTop: "0.2rem" }}>Star Citizen · RDOC Flottenoperationen</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
          {!isListe && (
            <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid var(--border)", borderRadius: 9, background: "var(--bg2)", overflow: "hidden" }}>
              <button type="button" data-testid="cal-prev" aria-label="Vorheriger Monat" onClick={() => gotoMonth(month === 0 ? year - 1 : year, month === 0 ? 11 : month - 1)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 36, border: "none", background: "transparent", color: "var(--dim)", cursor: "pointer" }}>
                <Ic name="back" size={16} sw={1.9} />
              </button>
              <button type="button" data-testid="cal-today" onClick={() => gotoMonth(T.y, T.m, T.d)} style={{ padding: "0 0.9rem", height: 36, border: "none", borderLeft: "1px solid var(--border)", borderRight: "1px solid var(--border)", background: "transparent", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap" }}>HEUTE</button>
              <button type="button" data-testid="cal-next" aria-label="Nächster Monat" onClick={() => gotoMonth(month === 11 ? year + 1 : year, month === 11 ? 0 : month + 1)} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 36, border: "none", background: "transparent", color: "var(--dim)", cursor: "pointer" }}>
                <Ic name="arrow" size={16} sw={1.9} />
              </button>
            </div>
          )}
          {/* §9: a real tablist — arrow keys, Home/End, roving tabindex, aria-selected,
              and one panel it controls. The month view is not silently swapped on a
              narrow screen; it is offered as disabled with the reason. */}
          <div role="tablist" aria-label="Ansicht" data-testid="op-view-tabs" style={{ display: "inline-flex", border: "1px solid var(--border)", borderRadius: 9, padding: 3, background: "var(--bg2)", gap: 3 }}>
            {VIEW_TABS.map((tb) => {
              const on = view === tb.v;
              const off = tb.v === "monat" && mobile;
              return (
                <button
                  key={tb.v}
                  type="button"
                  role="tab"
                  id={`op-view-tab-${tb.v}`}
                  aria-selected={on}
                  aria-controls="op-view-panel"
                  aria-disabled={off || undefined}
                  tabIndex={on ? 0 : -1}
                  ref={(el) => { tabRefs.current[tb.v] = el; }}
                  data-testid={tb.testid}
                  title={off ? "Der Monatskalender braucht mehr Breite als dieser Bildschirm hat." : undefined}
                  onClick={() => { if (!off) setView(tb.v); }}
                  onKeyDown={(e) => {
                    const open = VIEW_TABS.filter((x) => !(x.v === "monat" && mobile));
                    const i = open.findIndex((x) => x.v === tb.v);
                    if (i < 0) return;
                    const j = e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % open.length
                      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + open.length) % open.length
                      : e.key === "Home" ? 0
                      : e.key === "End" ? open.length - 1
                      : -1;
                    if (j < 0) return;
                    e.preventDefault();
                    setView(open[j].v);
                    tabRefs.current[open[j].v]?.focus();
                  }}
                  style={{ ...(on ? tabActive : tabBase), opacity: off ? 0.45 : 1, cursor: off ? "not-allowed" : "pointer" }}
                >
                  <Ic name={tb.icon} size={14} /> {tb.label}
                </button>
              );
            })}
          </div>
          {draftCount > 0 && (
            <button
              type="button"
              data-testid="cal-drafts"
              aria-pressed={draftsOnly}
              onClick={() => setDraftsOnly(!draftsOnly)}
              title={draftsOnly ? "Filter aufheben — wieder alle Operationen zeigen" : "Nur Entwürfe zeigen (Listen-Ansicht)"}
              style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.45rem 0.8rem", border: draftsOnly ? "1px solid var(--gold)" : "1px solid var(--edge-gold)", background: draftsOnly ? "var(--gold)" : "var(--tint-gold)", color: draftsOnly ? "var(--bg)" : "var(--gold)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, cursor: "pointer" }}
            >
              <Ic name="edit" size={13} sw={1.7} /> {draftCount} {draftCount === 1 ? "Entwurf" : "Entwürfe"}
            </button>
          )}
          {(session?.memberships ?? []).some((m) => m.role === "fleetoperator") && (
            <Link to="/ops/new" data-testid="create-link" className="btn btn-green" style={{ textDecoration: "none" }}><Ic name="plus" size={14} sw={1.9} /> Neue Op</Link>
          )}
          {!session?.user && (
            <Link to="/login" data-testid="login-cta" className="btn btn-ghost" style={{ textDecoration: "none" }}>Anmelden →</Link>
          )}
        </div>
      </div>

      {/* FILTER CHIPS */}
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.4rem", marginBottom: "1.4rem" }}>
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--dim3)", marginRight: "0.3rem" }}>FILTER</span>
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`cal-filter-${c.key}`}
              onClick={() => setFilter(c.key)}
              style={active ? { ...chipBase, border: `1px solid ${c.color}`, background: `${c.color}1f`, color: c.key === "alle" ? "var(--text-hi)" : c.color } : { ...chipBase, border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)" }}
            >
              {c.key !== "alle" && <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color, flexShrink: 0 }} />}
              {c.label}
            </button>
          );
        })}
        {/* §5: a three-state button whose label keeps changing hides its own state.
            The same three states as a named choice. */}
        <span style={streamFilter === "all"
          ? { ...chipBase, cursor: "default", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)" }
          : { ...chipBase, cursor: "default", border: "1px solid #9146ff", background: "rgba(145,70,255,0.15)", color: "var(--purple)" }}
        >
          <Ic name="stream" size={13} sw={1.7} />
          <select
            data-testid="cal-filter-stream"
            aria-label="Stream-Events"
            value={streamFilter}
            onChange={(e) => setStreamFilter(e.target.value as "all" | "only" | "off")}
            style={{ border: "none", background: "transparent", color: "inherit", font: "inherit", cursor: "pointer", outline: "none" }}
          >
            <option value="all">Alle</option>
            <option value="only">Nur Streams</option>
            <option value="off">Ohne Streams</option>
          </select>
        </span>
        {!isMonat && (
          <button
            type="button"
            data-testid="cal-toggle-past"
            aria-pressed={showPast}
            onClick={() => setShowPast(!showPast)}
            style={{
              ...chipBase,
              marginLeft: "auto",
              border: showPast ? "1px solid var(--edge-gold)" : "1px solid var(--border)",
              background: showPast ? "var(--tint-gold)" : "var(--wash)",
              color: showPast ? "var(--gold)" : "var(--dim)",
            }}
          >
            <Ic name={showPast ? "eye" : "clock"} size={13} sw={1.7} />
            {showPast ? "Vergangene sichtbar" : "Nur anstehende"}
          </button>
        )}
      </div>

      <div role="tabpanel" id="op-view-panel" aria-labelledby={`op-view-tab-${view}`} tabIndex={-1}>
      {mobile && view === "monat" && (
        <p data-testid="cal-mobile-note" style={{ margin: "0 0 1rem", padding: "0.6rem 0.8rem", border: "1px solid var(--border)", borderRadius: 9, background: "var(--wash)", color: "var(--dim)", fontSize: "0.82rem", lineHeight: 1.45 }}>
          Der Monatskalender braucht mehr Breite als dieser Bildschirm hat — unten steht die Agenda desselben Monats.
        </p>
      )}
      {ops === null ? (
        <div className="fpw-state"><span style={{ fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.14em", color: "var(--dim)" }}>LADE OPERATIONEN…</span></div>
      ) : isListe ? (
        (() => {
          const list = ops
            .filter((o) => (draftsOnly ? o.status === "draft" : true))
            .filter((o) => filter === "alle" || typeOf(o.opType).key === filter)
            .filter((o) => passStream(o.isStreamEvent ?? false))
            .filter((o) => showPast || new Date(o.scheduledAt).getTime() >= now.getTime())
            .slice()
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
          const anyPast = ops.some((o) => o.status !== "draft" && new Date(o.scheduledAt).getTime() < now.getTime());
          return list.length === 0 ? (
            emptyState("Keine Operationen in dieser Auswahl.", anyPast)
          ) : (
            <div className="fpw-grid" data-testid="op-grid">
              {list.map((op) => (
                <ObjectTile key={op.id} to={`/ops/${op.id}`} testid="op-card" ariaLabel={op.title}>
                  {/* §5 information order: status and participation, title, date,
                      server, place, capacity, then the secondary action. */}
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                    {(() => {
                      const st = opStatusBadge(op);
                      return <span className="fpw-tag" data-testid="op-card-status" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: st.color, borderColor: tint(st.color, 40), background: tint(st.color, 12) }}><span className="fpw-dot" style={{ background: st.color }} />{st.label}</span>;
                    })()}
                    {op.signupState && SIGNUP_LABEL[op.signupState] && (
                      <span className={`fpw-tag ${op.signupState === "joined" ? "green" : "gold"}`} data-testid="op-card-signup">{SIGNUP_LABEL[op.signupState]}</span>
                    )}
                    <span className="fpw-tag cyan">{visibilityLabel(op.visibility)}</span>
                    {op.isStreamEvent && (
                      <span className="fpw-tag" data-testid="op-card-stream" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--purple)", borderColor: "rgba(145,70,255,0.4)", background: "rgba(145,70,255,0.1)" }}>
                        <Ic name="stream" size={11} sw={1.7} /> STREAM
                      </span>
                    )}
                  </div>
                  <div className="fpw-h2">{op.title}</div>
                  <div className="fpw-meta">
                    {new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(op.scheduledAt))} · {op.guild.name}
                    {op.meetingSystem ? ` · ${op.meetingSystem}` : ""}{op.meetingLocation ? ` · ${op.meetingLocation}` : ""}
                  </div>
                  <div className="fpw-mono-label" style={{ marginTop: "0.6rem", fontSize: "0.62rem" }}>
                    {op.totalSeats > 0 ? `${op.filledSeats}/${op.totalSeats} PLÄTZE` : `${op.acceptedUnitCount} EINHEITEN`} · {op.opType.toUpperCase()}
                  </div>
                  {op.guild.discordInviteUrl && (
                    // Card itself is a <Link> (anchor); render the invite as a button
                    // and stop propagation so it doesn't trigger op navigation, and
                    // never nests an <a> inside an <a>.
                    <button
                      type="button"
                      data-testid="discord-join"
                      title="Auf Discord beitreten"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        window.open(op.guild.discordInviteUrl!, "_blank", "noopener,noreferrer");
                      }}
                      style={{
                        marginTop: "0.6rem",
                        display: "inline-flex",
                        alignItems: "center",
                        gap: "0.4rem",
                        padding: "0.3rem 0.6rem",
                        borderRadius: 6,
                        border: "1px solid rgba(88,101,242,0.5)",
                        background: "rgba(88,101,242,0.14)",
                        color: "var(--purple)",
                        cursor: "pointer",
                        fontFamily: MONO,
                        fontSize: "0.6rem",
                        letterSpacing: "0.08em",
                        textTransform: "uppercase",
                      }}
                    >
                      <Ic name="chat" size={12} sw={1.6} />
                      Discord
                    </button>
                  )}
                </ObjectTile>
              ))}
            </div>
          );
        })()
      ) : isMonat ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "1.6rem" }}>
          {/* weekday header + cells */}
          <div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8, marginBottom: 8 }}>
              {WEEKDAYS.map((w) => (
                <div key={w} style={{ textAlign: "center", fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.1em", color: "var(--dim2)", padding: "0.35rem 0" }}>{w}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
              {cells.map((cell, i) => {
                if (cell.blank) return <div key={i} style={{ minHeight: 158, border: "1px solid var(--wash)", borderRadius: 10, background: "var(--wash)" }} />;
                const d = cell.day!;
                const dayOps = visible.filter((e) => e.day === d).sort((a, b) => a.time.localeCompare(b.time));
                const isToday = isCurrentMonth && d === T.d;
                const isPast = (isCurrentMonth && d < T.d) || monthBeforeToday;
                const selected = d === selDay;
                const shown = dayOps.slice(0, 2);
                return (
                  <div
                    key={i}
                    data-testid={`cal-day-${d}`}
                    onClick={() => setSelDay(d)}
                    style={{
                      minHeight: 158,
                      display: "flex",
                      flexDirection: "column",
                      gap: 4,
                      padding: "8px 9px",
                      borderRadius: 10,
                      cursor: "pointer",
                      overflow: "hidden",
                      border: selected ? "1px solid var(--border-hi)" : isToday ? "1px solid var(--edge-green)" : "1px solid var(--wash)",
                      background: selected ? "var(--wash)" : isToday ? "var(--tint-green)" : "var(--row)",
                      opacity: isPast ? 0.62 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: MONO, fontSize: "1.05rem", fontWeight: 700, color: isToday ? "var(--green)" : selected ? "var(--cyan)" : "var(--text)" }}>{d}</span>
                      {isToday ? (
                        <span style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.08em", color: "var(--green)", border: "1px solid var(--edge-green)", borderRadius: 3, padding: "0.1rem 0.3rem" }}>HEUTE</span>
                      ) : dayOps.length > 0 ? (
                        <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim2)" }}>{dayOps.length} OP</span>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {shown.map((e) => {
                        const ty = typeOf(e.typeKey);
                        const cancelled = e.status === "cancelled";
                        const dim = (isCurrentMonth && d < T.d) || monthBeforeToday || cancelled;
                        return (
                          <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "4px 7px", borderRadius: 6, background: `${tint(ty.color, 13)}`, borderLeft: `3px solid ${cancelled ? "var(--red)" : ty.color}`, overflow: "hidden", opacity: dim ? 0.5 : 1 }}>
                            <span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.02em", color: cancelled ? "var(--red)" : ty.color, flexShrink: 0 }}>{e.time}</span>
                            <span style={{ fontSize: "0.8rem", lineHeight: 1.16, color: "var(--text)", fontWeight: 500, textDecoration: cancelled ? "line-through" : "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{e.title}</span>
                          </div>
                        );
                      })}
                      {dayOps.length > 2 && <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "var(--dim2)", paddingLeft: 2 }}>+{dayOps.length - 2} mehr</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* selected day + month stats */}
          <div style={mobile ? { display: "flex", flexDirection: "column", gap: "1.1rem" } : { display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: "1.3rem", alignItems: "start" }}>
            <section style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.2rem 1.3rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "var(--cyan)", whiteSpace: "nowrap", marginBottom: "0.25rem" }}>AUSGEWÄHLTER TAG</div>
                <div style={{ fontWeight: 700, fontSize: "1.3rem", color: "var(--text-hi)", lineHeight: 1.1 }}>{selDateLabel}</div>
              </div>
              {selDayOps.length === 0 ? (
                <div style={{ padding: "1.6rem 0.5rem", textAlign: "center", color: "var(--dim3)", fontSize: "0.9rem", border: "1px dashed var(--wash)", borderRadius: 10 }}>
                  Keine Operationen an diesem Tag — wähle einen Tag mit Markierung.
                </div>
              ) : (
                <div style={mobile ? { display: "flex", flexDirection: "column", gap: "0.7rem" } : { display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(248px,1fr))", gap: "0.7rem" }}>
                  {selDayOps.map((e) => opCard(e, false))}
                </div>
              )}
            </section>
            {statsCard(true)}
          </div>
        </div>
      ) : (
        <div style={mobile ? { display: "flex", flexDirection: "column", gap: "1.1rem" } : { display: "flex", gap: "1.3rem", alignItems: "flex-start" }}>
          <div style={mobile ? { width: "100%", minWidth: 0 } : { flex: "1 1 0", minWidth: 0 }}>
            {agenda.length === 0 ? (
              emptyState(
                !showPast && hasPast
                  ? "Keine anstehenden Operationen in diesem Monat."
                  : "Keine Operationen in diesem Monat — wähle einen anderen Monat oder lockere den Filter.",
                hasPast,
              )
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.3rem" }}>
                {agenda.map((g) => (
                  <section key={g.day} style={{ display: "flex", gap: "1.1rem", alignItems: "flex-start" }}>
                    <div style={{ flex: "0 0 64px", textAlign: "center", paddingTop: "0.3rem" }}>
                      <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>{g.dow}</div>
                      <div style={{ fontFamily: MONO, fontSize: "1.5rem", fontWeight: 700, lineHeight: 1, color: g.isToday ? "var(--green)" : "var(--text-hi)" }}>{g.day}</div>
                      <div style={{ fontFamily: MONO, fontSize: "0.58rem", color: "var(--dim3)" }}>{g.mon}</div>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: "0.7rem" }}>{g.ops.map((e) => opCard(e, true))}</div>
                  </section>
                ))}
              </div>
            )}
          </div>
          <aside style={mobile ? { width: "100%" } : { flex: "0 0 326px", maxWidth: "100%", position: "sticky", top: 84, alignSelf: "flex-start" }}>{statsCard(false)}</aside>
        </div>
      )}
      </div>
    </div>
  );
}
