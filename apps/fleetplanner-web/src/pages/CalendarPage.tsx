import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ApiError, listOperations } from "../api/client";
import type { OperationSummary, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { ErrorState } from "../components/ErrorState";
import { useSeo } from "../seo";

const MONO = "var(--mono)";
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const DOW = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

// op type → design palette (defensive: match lowercased opType incl. de aliases)
const TYPES: Record<string, { label: string; color: string; rgb: string; icon: string }> = {
  combat: { label: "Kampf", color: "#ff4444", rgb: "255,68,68", icon: "fighter" },
  mining: { label: "Mining", color: "#f0a500", rgb: "240,165,0", icon: "bolt" },
  salvage: { label: "Bergung", color: "#ff7a45", rgb: "255,122,69", icon: "swap" },
  explore: { label: "Exploration", color: "#00d4ff", rgb: "0,212,255", icon: "globe" },
  transport: { label: "Transport", color: "#a064ff", rgb: "160,100,255", icon: "vehicle" },
  training: { label: "Training", color: "#00ff88", rgb: "0,255,136", icon: "lead" },
  social: { label: "Sozial", color: "#ff70c8", rgb: "255,112,200", icon: "users" },
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
};

const tagStyle = (color: string): React.CSSProperties => ({
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  fontFamily: MONO,
  fontSize: "9px",
  letterSpacing: "0.06em",
  borderRadius: 3,
  border: `1px solid ${color}55`,
  background: `${color}1a`,
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
  const viewParam = params.get("view");
  const view: "liste" | "monat" | "agenda" =
    viewParam === "kalender" || viewParam === "monat" ? "monat"
    : viewParam === "liste" ? "liste"
    : "agenda"; // default = agenda
  const setView = (v: "liste" | "monat" | "agenda") =>
    setParams(
      (p) => {
        const n = new URLSearchParams(p);
        n.set("view", v === "monat" ? "kalender" : v);
        return n;
      },
      { replace: true },
    );
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [filter, setFilter] = useState("alle");
  const [showPast, setShowPast] = useState(false);
  const [selDay, setSelDay] = useState(now.getDate());
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
      });
    }
    return out;
  }, [ops, year, month]);

  const visible = events.filter((e) => filter === "alle" || e.typeKey === filter);
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

  const statusOf = (e: Ev) => {
    // Explicit operation status wins over the time/capacity heuristic — a
    // cancelled/locked/completed op must never read as "OFFEN".
    if (e.status === "cancelled") return { key: "cancelled", label: "ABGESAGT", color: "#ff4444" };
    if (e.status === "completed") return { key: "done", label: "ABGESCHLOSSEN", color: "#5b6b7a" };
    if (e.status === "locked") return { key: "locked", label: "GESPERRT", color: "#f0a500" };
    if (e.ts < now.getTime()) return { key: "done", label: "ABGESCHLOSSEN", color: "#5b6b7a" };
    if (e.cap > 0 && e.signed >= e.cap) return { key: "voll", label: "VOLL", color: "#00d4ff" };
    if (e.cap > 0 && e.signed / e.cap >= 0.8) return { key: "fast", label: "FAST VOLL", color: "#f0a500" };
    return { key: "offen", label: "OFFEN", color: "#00ff88" };
  };

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
    if (k === "offen") statOffen++;
    else if (k === "fast") statFast++;
  });

  const legend = Object.keys(TYPES).map((k) => ({ ...TYPES[k] }));

  // ── filter chips ──────────────────────────────────────────────
  const chipBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.34rem 0.7rem", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.04em", borderRadius: 7, cursor: "pointer", whiteSpace: "nowrap" };
  const chips = [{ key: "alle", label: "Alle", color: "#9fb1c2" }].concat(
    Object.keys(TYPES).map((k) => ({ key: k, label: TYPES[k].label, color: TYPES[k].color })),
  );

  // ── op card (selected day + agenda) ───────────────────────────
  const opCard = (e: Ev, compact: boolean) => {
    const ty = typeOf(e.typeKey);
    const st = statusOf(e);
    const pct = e.cap > 0 ? Math.min(100, Math.round((e.signed / e.cap) * 100)) : 0;
    const dim = st.key === "done" || st.key === "cancelled";
    return (
      <Link key={e.id} to={`/ops/${e.id}`} data-testid={`cal-open-${e.id}`} style={{ display: "block", textDecoration: "none", border: `1px solid rgba(${ty.rgb},0.18)`, borderLeft: `3px solid ${ty.color}`, borderRadius: 10, background: "#0a1018", padding: "0.75rem 0.85rem", opacity: dim ? 0.6 : 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
          <span style={{ fontFamily: MONO, fontSize: compact ? "0.92rem" : "0.98rem", color: "#eaf4fb", flexShrink: 0 }}>{e.time}</span>
          <span style={{ width: 26, height: 26, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `rgba(${ty.rgb},0.12)`, border: `1px solid rgba(${ty.rgb},0.3)`, color: ty.color }}>
            <Ic name={ty.icon} size={15} sw={1.6} />
          </span>
          <span style={{ flex: 1 }} />
          <span style={tagStyle(st.color)}>{st.label}</span>
        </div>
        <strong style={{ display: "block", fontWeight: compact ? 700 : 600, fontSize: compact ? "1.1rem" : "1.08rem", color: "#eaf4fb", lineHeight: 1.2, margin: "0.5rem 0 0.2rem" }}>{e.title}</strong>
        <div style={{ display: "flex", alignItems: "center", gap: "0.8rem", flexWrap: "wrap", marginTop: "0.55rem" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 7px", fontFamily: MONO, fontSize: "9px", letterSpacing: "0.05em", borderRadius: 3, border: `1px solid rgba(${ty.rgb},0.4)`, background: `rgba(${ty.rgb},0.08)`, color: ty.color, textTransform: "uppercase" }}>{ty.label}</span>
          <span style={{ color: "#7e92a4", fontSize: "0.82rem" }}>{e.guild}</span>
          <div style={{ flex: 1, minWidth: 120, display: "flex", alignItems: "center", gap: "0.55rem" }}>
            <div style={{ flex: 1, height: 5, borderRadius: 4, background: "#0e1926", overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: ty.color, opacity: dim ? 0.5 : 1 }} />
            </div>
            <span style={{ fontFamily: MONO, fontSize: "0.74rem", color: "#9fb1c2", whiteSpace: "nowrap" }}>{e.signed}/{e.cap}</span>
          </div>
          <span style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.75rem", border: "1px solid rgba(0,212,255,0.4)", background: "rgba(0,212,255,0.08)", color: "#00d4ff", fontFamily: MONO, fontSize: "0.7rem", borderRadius: 7 }}>
            Öffnen <Ic name="arrow" size={13} sw={1.9} />
          </span>
        </div>
      </Link>
    );
  };

  const statsCard = (compact: boolean) => (
    <section style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 14, background: "#090f18", padding: "1.1rem 1.2rem" }}>
      <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#9fb1c2", marginBottom: "0.8rem" }}>DIESER MONAT</div>
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
        {[
          { v: statTotal, l: "OPS", c: "#eaf4fb", b: "rgba(0,212,255,0.14)", bg: "transparent" },
          { v: statOffen, l: "OFFEN", c: "#00ff88", b: "rgba(0,255,136,0.22)", bg: "rgba(0,255,136,0.04)" },
          { v: statFast, l: "FAST VOLL", c: "#f0a500", b: "rgba(240,165,0,0.24)", bg: "rgba(240,165,0,0.04)" },
        ].map((s) => (
          <div key={s.l} style={{ flex: "1 1 60px", border: `1px solid ${s.b}`, borderRadius: 9, padding: "0.6rem 0.5rem", textAlign: "center", background: s.bg }}>
            <div style={{ fontFamily: MONO, fontSize: compact ? "1.3rem" : "1.4rem", color: s.c, lineHeight: 1 }}>{s.v}</div>
            <div style={{ fontFamily: MONO, fontSize: "0.54rem", letterSpacing: "0.08em", color: "#5b6b7a", marginTop: "0.25rem" }}>{s.l}</div>
          </div>
        ))}
      </div>
      <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.1em", color: "#5b6b7a", marginBottom: "0.55rem", paddingTop: "0.2rem", borderTop: "1px solid rgba(255,255,255,0.05)" }}>OPERATIONSTYPEN</div>
      <div style={compact ? { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.45rem 0.8rem" } : { display: "flex", flexDirection: "column", gap: "0.4rem" }}>
        {legend.map((lg) => (
          <div key={lg.label} style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: 2, background: lg.color, flexShrink: 0 }} />
            <span style={{ color: lg.color, display: "inline-flex", flexShrink: 0 }}><Ic name={lg.icon} size={13} sw={1.6} /></span>
            <span style={{ fontSize: "0.83rem", color: "#c2d2de" }}>{lg.label}</span>
          </div>
        ))}
      </div>
    </section>
  );

  const tabBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.85rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 6, border: "1px solid transparent", background: "transparent", color: "#9fb1c2", cursor: "pointer" };
  const tabActive: React.CSSProperties = { ...tabBase, background: "rgba(0,212,255,0.12)", borderColor: "rgba(0,212,255,0.4)", color: "#00d4ff" };

  return (
    <div data-testid="calendar-page">
      {/* AKTUELL LAUFENDE OPERATIONEN — month-independent, top of page */}
      {runningOps.length > 0 && (
        <section
          data-testid="running-ops"
          style={{ border: "1px solid rgba(0,255,136,0.32)", borderRadius: 14, background: "linear-gradient(180deg,rgba(0,255,136,0.06),#090f18)", padding: "1rem 1.1rem", marginBottom: "1.5rem" }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.85rem" }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 0 0 rgba(0,255,136,0.6)", animation: "fpw-live-pulse 1.8s ease-out infinite", flexShrink: 0 }} />
            <span style={{ fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.14em", color: "#00ff88" }}>AKTUELL LAUFENDE OPERATIONEN</span>
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#5b6b7a" }}>{runningOps.length}</span>
            <style>{"@keyframes fpw-live-pulse{0%{box-shadow:0 0 0 0 rgba(0,255,136,0.55)}70%{box-shadow:0 0 0 7px rgba(0,255,136,0)}100%{box-shadow:0 0 0 0 rgba(0,255,136,0)}}"}</style>
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
                  style={{ display: "block", textDecoration: "none", border: `1px solid rgba(${ty.rgb},0.2)`, borderLeft: "3px solid #00ff88", borderRadius: 10, background: "#0a1018", padding: "0.7rem 0.8rem" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.4rem" }}>
                    <span style={{ width: 24, height: 24, borderRadius: 7, flexShrink: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", background: `rgba(${ty.rgb},0.12)`, border: `1px solid rgba(${ty.rgb},0.3)`, color: ty.color }}>
                      <Ic name={ty.icon} size={14} sw={1.6} />
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={tagStyle("#00ff88")}>{live ? "LÄUFT" : "STARTET"}</span>
                  </div>
                  <strong style={{ display: "block", fontWeight: 600, fontSize: "1.02rem", color: "#eaf4fb", lineHeight: 1.2 }}>{op.title}</strong>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", flexWrap: "wrap", marginTop: "0.5rem" }}>
                    <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "#9fb1c2" }}>{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(op.scheduledAt))}</span>
                    <span style={{ color: "#7e92a4", fontSize: "0.8rem" }}>{op.guild.name}</span>
                    <div style={{ flex: 1, minWidth: 90, display: "flex", alignItems: "center", gap: "0.5rem" }}>
                      <div style={{ flex: 1, height: 5, borderRadius: 4, background: "#0e1926", overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${pct}%`, borderRadius: 4, background: "#00ff88" }} />
                      </div>
                      <span style={{ fontFamily: MONO, fontSize: "0.72rem", color: "#9fb1c2", whiteSpace: "nowrap" }}>{op.filledSeats}/{cap}</span>
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
            <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="cal" size={20} /></span>
            <span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.14em", color: "#5b6b7a" }}>OPERATIONS-KALENDER</span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "2rem", lineHeight: 1.05, color: "#eaf4fb", margin: 0 }} data-testid="cal-month">{isListe ? "Operationen" : monthLabel}</h1>
          <div style={{ color: "#9fb1c2", fontSize: "0.92rem", marginTop: "0.2rem" }}>Star Citizen · RDOC Flottenoperationen</div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.6rem" }}>
          {!isListe && (
            <div style={{ display: "inline-flex", alignItems: "center", border: "1px solid rgba(0,212,255,0.16)", borderRadius: 9, background: "#090f18", overflow: "hidden" }}>
              <button type="button" data-testid="cal-prev" onClick={() => setMonth((m) => { if (m === 0) { setYear((y) => y - 1); return 11; } return m - 1; })} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 36, border: "none", background: "transparent", color: "#9fb1c2", cursor: "pointer" }}>
                <Ic name="back" size={16} sw={1.9} />
              </button>
              <button type="button" data-testid="cal-today" onClick={() => { setYear(T.y); setMonth(T.m); setSelDay(T.d); }} style={{ padding: "0 0.9rem", height: 36, border: "none", borderLeft: "1px solid rgba(0,212,255,0.12)", borderRight: "1px solid rgba(0,212,255,0.12)", background: "transparent", color: "#00d4ff", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.04em", cursor: "pointer", whiteSpace: "nowrap" }}>HEUTE</button>
              <button type="button" data-testid="cal-next" onClick={() => setMonth((m) => { if (m === 11) { setYear((y) => y + 1); return 0; } return m + 1; })} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 36, border: "none", background: "transparent", color: "#9fb1c2", cursor: "pointer" }}>
                <Ic name="arrow" size={16} sw={1.9} />
              </button>
            </div>
          )}
          <div style={{ display: "inline-flex", border: "1px solid rgba(0,212,255,0.16)", borderRadius: 9, padding: 3, background: "#090f18", gap: 3 }}>
            <button type="button" data-testid="op-view-liste" onClick={() => setView("liste")} style={view === "liste" ? tabActive : tabBase}><Ic name="board" size={14} /> Liste</button>
            {!mobile && <button type="button" data-testid="cal-view-monat" onClick={() => setView("monat")} style={view === "monat" ? tabActive : tabBase}><Ic name="cal" size={14} /> Kalender</button>}
            <button type="button" data-testid="cal-view-agenda" onClick={() => setView("agenda")} style={view === "agenda" ? tabActive : tabBase}><Ic name="chat" size={14} /> Agenda</button>
          </div>
          {draftCount > 0 && view !== "liste" && (
            <button type="button" data-testid="cal-drafts" onClick={() => setView("liste")} title="Entwürfe sind in der Listen-Ansicht sichtbar" style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.45rem 0.8rem", border: "1px solid rgba(240,165,0,0.45)", background: "rgba(240,165,0,0.1)", color: "#f0a500", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, cursor: "pointer" }}>
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
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#5b6b7a", marginRight: "0.3rem" }}>FILTER</span>
        {chips.map((c) => {
          const active = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              data-testid={`cal-filter-${c.key}`}
              onClick={() => setFilter(c.key)}
              style={active ? { ...chipBase, border: `1px solid ${c.color}`, background: `${c.color}1f`, color: c.key === "alle" ? "#eaf4fb" : c.color } : { ...chipBase, border: "1px solid rgba(255,255,255,0.1)", background: "transparent", color: "#9fb1c2" }}
            >
              {c.key !== "alle" && <span style={{ width: 7, height: 7, borderRadius: 2, background: c.color, flexShrink: 0 }} />}
              {c.label}
            </button>
          );
        })}
        {!isMonat && (
          <button
            type="button"
            data-testid="cal-toggle-past"
            onClick={() => setShowPast((v) => !v)}
            style={{
              ...chipBase,
              marginLeft: "auto",
              border: showPast ? "1px solid rgba(240,165,0,0.5)" : "1px solid rgba(0,212,255,0.28)",
              background: showPast ? "rgba(240,165,0,0.12)" : "rgba(0,212,255,0.05)",
              color: showPast ? "#f0a500" : "#9fb1c2",
            }}
          >
            <Ic name={showPast ? "eye" : "clock"} size={13} sw={1.7} />
            {showPast ? "Vergangene sichtbar" : "Nur anstehende"}
          </button>
        )}
      </div>

      {ops === null ? (
        <div className="fpw-state"><span style={{ fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.14em", color: "#9fb1c2" }}>LADE OPERATIONEN…</span></div>
      ) : isListe ? (
        (() => {
          const list = ops
            .filter((o) => filter === "alle" || typeOf(o.opType).key === filter)
            .filter((o) => showPast || new Date(o.scheduledAt).getTime() >= now.getTime())
            .slice()
            .sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime());
          return list.length === 0 ? (
            <p className="fpw-meta" style={{ color: "var(--dim)" }}>Keine Operationen.</p>
          ) : (
            <div className="fpw-grid" data-testid="op-grid">
              {list.map((op) => (
                <Link key={op.id} to={`/ops/${op.id}`} className="fpw-card fpw-cardlink" data-testid="op-card">
                  <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", marginBottom: "0.6rem" }}>
                    <span className="fpw-tag green"><span className="fpw-dot" />{op.status}</span>
                    <span className="fpw-tag cyan">{op.visibility}</span>
                    {op.signupState === "joined" && <span className="fpw-tag green">DABEI</span>}
                    {op.signupState === "waitlist" && <span className="fpw-tag gold">WARTELISTE</span>}
                  </div>
                  <div className="fpw-h2">{op.title}</div>
                  <div className="fpw-meta">
                    {new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(op.scheduledAt))} · {op.meetingSystem} · {op.guild.name}
                  </div>
                  <div className="fpw-mono-label" style={{ marginTop: "0.6rem", fontSize: "0.62rem" }}>
                    {op.acceptedUnitCount} EINHEITEN · {op.opType.toUpperCase()}
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
                        color: "#c7ccf8",
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
                </Link>
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
                <div key={w} style={{ textAlign: "center", fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.1em", color: "#7e92a4", padding: "0.35rem 0" }}>{w}</div>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7,1fr)", gap: 8 }}>
              {cells.map((cell, i) => {
                if (cell.blank) return <div key={i} style={{ minHeight: 158, border: "1px solid rgba(255,255,255,0.03)", borderRadius: 10, background: "rgba(255,255,255,0.008)" }} />;
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
                      border: selected ? "1px solid rgba(0,212,255,0.6)" : isToday ? "1px solid rgba(0,255,136,0.45)" : "1px solid rgba(0,212,255,0.1)",
                      background: selected ? "rgba(0,212,255,0.07)" : isToday ? "rgba(0,255,136,0.04)" : "#0a1018",
                      opacity: isPast ? 0.62 : 1,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                      <span style={{ fontFamily: MONO, fontSize: "1.05rem", fontWeight: 700, color: isToday ? "#00ff88" : selected ? "#00d4ff" : "#dbe7f0" }}>{d}</span>
                      {isToday ? (
                        <span style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.08em", color: "#00ff88", border: "1px solid rgba(0,255,136,0.4)", borderRadius: 3, padding: "0.1rem 0.3rem" }}>HEUTE</span>
                      ) : dayOps.length > 0 ? (
                        <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "#7e92a4" }}>{dayOps.length} OP</span>
                      ) : null}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {shown.map((e) => {
                        const ty = typeOf(e.typeKey);
                        const cancelled = e.status === "cancelled";
                        const dim = (isCurrentMonth && d < T.d) || monthBeforeToday || cancelled;
                        return (
                          <div key={e.id} style={{ display: "flex", flexDirection: "column", gap: 1, padding: "4px 7px", borderRadius: 6, background: `rgba(${ty.rgb},0.13)`, borderLeft: `3px solid ${cancelled ? "#ff4444" : ty.color}`, overflow: "hidden", opacity: dim ? 0.5 : 1 }}>
                            <span style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.02em", color: cancelled ? "#ff4444" : ty.color, flexShrink: 0 }}>{e.time}</span>
                            <span style={{ fontSize: "0.8rem", lineHeight: 1.16, color: "#dbe7f0", fontWeight: 500, textDecoration: cancelled ? "line-through" : "none", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{e.title}</span>
                          </div>
                        );
                      })}
                      {dayOps.length > 2 && <span style={{ fontFamily: MONO, fontSize: "0.64rem", color: "#7e92a4", paddingLeft: 2 }}>+{dayOps.length - 2} mehr</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* selected day + month stats */}
          <div style={mobile ? { display: "flex", flexDirection: "column", gap: "1.1rem" } : { display: "grid", gridTemplateColumns: "minmax(0,1fr) 320px", gap: "1.3rem", alignItems: "start" }}>
            <section style={{ border: "1px solid rgba(0,212,255,0.16)", borderRadius: 14, background: "#090f18", padding: "1.2rem 1.3rem" }}>
              <div style={{ marginBottom: "1rem" }}>
                <div style={{ fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.12em", color: "#00d4ff", whiteSpace: "nowrap", marginBottom: "0.25rem" }}>AUSGEWÄHLTER TAG</div>
                <div style={{ fontWeight: 700, fontSize: "1.3rem", color: "#eaf4fb", lineHeight: 1.1 }}>{selDateLabel}</div>
              </div>
              {selDayOps.length === 0 ? (
                <div style={{ padding: "1.6rem 0.5rem", textAlign: "center", color: "#5b6b7a", fontSize: "0.9rem", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 10 }}>
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
              <div style={{ padding: "3rem 1rem", textAlign: "center", color: "#5b6b7a", fontSize: "0.92rem", border: "1px dashed rgba(255,255,255,0.08)", borderRadius: 12 }}>
                {!showPast && hasPast ? (
                  <>
                    Keine anstehenden Operationen in diesem Monat.{" "}
                    <button type="button" data-testid="cal-show-past-inline" onClick={() => setShowPast(true)} style={{ background: "none", border: "none", color: "#00d4ff", cursor: "pointer", font: "inherit", textDecoration: "underline", padding: 0 }}>Vergangene anzeigen</button>.
                  </>
                ) : (
                  "Keine Operationen in diesem Monat — wähle einen anderen Monat oder lockere den Filter."
                )}
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "1.3rem" }}>
                {agenda.map((g) => (
                  <section key={g.day} style={{ display: "flex", gap: "1.1rem", alignItems: "flex-start" }}>
                    <div style={{ flex: "0 0 64px", textAlign: "center", paddingTop: "0.3rem" }}>
                      <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.08em", color: "#5b6b7a" }}>{g.dow}</div>
                      <div style={{ fontFamily: MONO, fontSize: "1.5rem", fontWeight: 700, lineHeight: 1, color: g.isToday ? "#00ff88" : "#eaf4fb" }}>{g.day}</div>
                      <div style={{ fontFamily: MONO, fontSize: "0.58rem", color: "#5b6b7a" }}>{g.mon}</div>
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
  );
}
