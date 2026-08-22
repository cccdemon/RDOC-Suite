import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  addStream,
  askQuestion,
  claimSeat,
  clearPrimaryUnit,
  cqbSignup,
  cqbWithdraw,
  getNeeds,
  getOperation,
  patchSeat,
  removeStream,
  setHangarShare,
  setPrimaryUnit,
  setSeatLateArrival,
  setUnitLateArrival,
  unclaimSeat,
  withdrawUnit,
} from "../api/client";
import { useT } from "../i18n";
import type { FleetUnit, OperationDetail, SessionResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { OfferShip } from "../components/OfferShip";
import { OperatorConsole } from "../components/OperatorConsole";
import { SquadLinkPanel } from "../components/SquadLinkPanel";
import { Ic } from "../components/Icons";
import { Avatar } from "../components/Avatar";
import { LateArrival } from "../components/LateArrival";
import { Markdown } from "../components/Markdown";
import { DocumentsPanel } from "../components/DocumentsPanel";
import { useSeo, metaText } from "../seo";
import { roleLabel } from "../shipRoles";
import { tint } from "../components/ui";
import { Breadcrumbs } from "../components/Breadcrumbs";

const MONO = "var(--mono)";

function fmtDate(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("de-DE", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(iso));
}
function fmtShort(iso: string, tz: string | null): string {
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(tz ? { timeZone: tz } : {}),
  }).format(new Date(iso));
}

const WEEKDAYS_MON0 = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

/**
 * "alle 2 Wochen — So 20:00 Uhr". Discord shows a recurring event with every
 * future date attached; the Fleetplanner only materialises an occurrence once
 * it is inside the spawn horizon, so the pattern has to be spelled out or the
 * series looks like a one-off.
 */
function seriesPattern(
  rec: NonNullable<import("../api/types").OperationDetail["recurrence"]>,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const freq = t(`series.freq.${rec.freq}`);
  const weekday = rec.byWeekday != null ? WEEKDAYS_MON0[rec.byWeekday] : "";
  return t("series.pattern", { freq, weekday, time: rec.timeOfDay }).replace("  ", " ");
}

// design: category lanes with accent color + rgb (for borders/washes)
const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", accent: "var(--cyan)" },
  { type: "fighter", label: "JÄGER", icon: "fighter", accent: "var(--cyan)" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "var(--cyan)" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "var(--cyan)" },
] as const;

// Fighter-class ships get their own lane (a fighter is its own class, not a ship).
function laneOf(u: FleetUnit): string {
  if (u.unitType === "ship") return u.shipClass === "Fighter" ? "fighter" : "ship";
  return u.unitType;
}

// design tagInfo()
const TAG_BASE: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "2px 7px",
  fontFamily: MONO,
  fontSize: "9.5px",
  letterSpacing: "0.07em",
  borderRadius: 3,
  borderWidth: 1,
  borderStyle: "solid",
  lineHeight: 1.5,
  whiteSpace: "nowrap",
  textTransform: "uppercase",
};
const TAGS = {
  fest: { text: "FEST", style: { ...TAG_BASE, color: "var(--dim)", borderColor: "var(--border-hi)", background: "var(--wash)" } },
  typ: { text: "TYP", style: { ...TAG_BASE, color: "var(--gold)", borderColor: "var(--edge-gold)", background: "var(--tint-gold)" } },
  rolle_offen: { text: "ROLLE OFFEN", style: { ...TAG_BASE, color: "var(--green)", borderColor: "var(--edge-green)", background: "var(--tint-green)" } },
  frei: { text: "FREI", style: { ...TAG_BASE, color: "var(--dim)", borderColor: "var(--border-hi)", borderStyle: "dashed", background: "transparent" } },
} as const;

const monoLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: MONO,
  fontSize: "0.72rem",
  letterSpacing: "0.14em",
  color: "var(--dim)",
  ...extra,
});

function seatIcon(u: FleetUnit, order: number): string {
  if (u.unitType === "squad") return "fps";
  return order === 0 ? "pilot" : "gunner";
}

export function OpDetailPage({ session }: { session: SessionResponse | null }) {
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const t = useT();
  const [qDraft, setQDraft] = useState("");
  const [op, setOp] = useState<OperationDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySeat, setBusySeat] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [logOpen, setLogOpen] = useState(false); // mission log, collapsed by default
  const [offerOpen, setOfferOpen] = useState(false);
  // FR-A5: operators preview the page as a guest / crew member / themselves. Pure
  // UI — changes no rights; just suppresses operator + me-based controls.
  const [viewAs, setViewAs] = useState<"self" | "crew" | "guest">("self");
  // What the mission needs (crew planning) — readable by any viewer with access.
  const [needs, setNeeds] = useState<import("../api/types").NeedsResponse | null>(null);
  const [lightbox, setLightbox] = useState(false); // hero cover full-size overlay
  const fleetRef = useRef<HTMLDivElement>(null);

  const load = useCallback(() => {
    if (!id) return;
    getOperation(id)
      .then(setOp)
      .catch((e) => setError(e instanceof ApiError ? e : new ApiError(0, null)));
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  // Live refresh: poll the op while the tab is visible so changes made elsewhere
  // (an operator on another screen, an admin edit) appear in the board/roster within
  // seconds — no full page reload. Paused when the tab is hidden to avoid idle load,
  // and re-synced immediately on re-focus.
  useEffect(() => {
    if (!id) return;
    const tick = () => { if (document.visibilityState === "visible") load(); };
    const timer = window.setInterval(tick, 20000);
    document.addEventListener("visibilitychange", tick);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", tick); };
  }, [id, load]);

  // Load the mission's needs once we have access (logged in). Best-effort: a 403
  // for a viewer without access just leaves the card hidden.
  useEffect(() => {
    if (!id || !session?.user) { setNeeds(null); return; }
    getNeeds(id).then(setNeeds).catch(() => setNeeds(null));
  }, [id, session?.user]);

  // Close the cover lightbox on Escape.
  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setLightbox(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);


  useSeo({
    title: op?.title ?? "Operation",
    description: op
      ? metaText(
          op.description?.trim()
            ? op.description
            : `Star-Citizen-Operation in ${op.meetingSystem} · Treffpunkt ${op.meetingLocation}. Crew anmelden im RDOC Fleetplanner.`,
        )
      : undefined,
  });

  const realUser = session?.user ?? null;
  // In "guest" preview the operator sees the page as a logged-out visitor → no
  // me-based controls (join/claim/withdraw/seat-edit). "crew" keeps the user but
  // hides the operator console (see below).
  const me = viewAs === "guest" ? null : realUser;
  const csrf = session?.csrfToken ?? null;

  async function onClaim(seatId: string) {
    if (!id || !csrf) return;
    setBusySeat(seatId);
    setNotice(null);
    try {
      await claimSeat(id, seatId, csrf);
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusySeat(null);
    }
  }
  async function onUnclaim(seatId: string) {
    if (!id || !csrf) return;
    setBusySeat(seatId);
    setNotice(null);
    try {
      await unclaimSeat(id, seatId, csrf);
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusySeat(null);
    }
  }
  async function run(action: () => Promise<unknown>) {
    if (!id || !csrf) return;
    setNotice(null);
    try {
      await action();
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }
  async function submitQuestion() {
    const text = qDraft.trim();
    if (!id || !csrf || !text) return;
    try {
      await askQuestion(id, csrf, text);
      setQDraft("");
      load();
    } catch (e) {
      setNotice(e instanceof ApiError ? e.message : "Aktion fehlgeschlagen.");
    }
  }

  if (error) {
    const code = error.status === 401 ? 401 : error.status === 403 ? 403 : error.status === 404 ? 404 : 503;
    const msg =
      code === 401
        ? "Diese Operation ist nicht öffentlich — bitte anmelden."
        : code === 404
          ? "Operation nicht gefunden."
          : "Operation konnte nicht geladen werden.";
    return <ErrorState code={code} message={msg} />;
  }
  if (!op)
    return (
      <div className="fpw-state">
        <span style={monoLabel()}>LADE OPERATION…</span>
      </div>
    );

  const accepted = op.units.filter((u) => u.status === "accepted");
  // The roster shows the OPTIMAL LINEUP: every fleet need appears as a slot — an
  // empty "unerfüllt" placeholder until a unit fills it, then the unit with its
  // claimable seats. Ship needs (one hull each) + the fighter need become slots;
  // CQB needs are the team cards in the CQB column. (Squads → CQB column.)
  const shipReqs = (needs?.requirements ?? []).filter((r) => r.needType === "ship");
  const shipReqUnfilled = shipReqs.filter((r) => !accepted.some((u) => u.requirementId === r.id));
  const fighterUnitsCount = accepted.filter((u) => laneOf(u) === "fighter").length;
  const fighterEmpty = Math.max(0, (needs?.fighterSquads ?? 0) - fighterUnitsCount);
  // Every category column is always shown (Schiffe / Jäger / CQB / Fahrzeuge);
  // an empty one (no units, no open needs) reads "Kein Bedarf".
  // Offered-but-not-yet-accepted units (status "pending"). They render in their
  // lane greyed out + a "wartet auf Bestätigung" tag so an offered ship no longer
  // seems to vanish until the operator accepts it. They never count toward
  // `accepted` (filled seats / need coverage) — only the visual list includes them.
  const pending = op.units.filter((u) => u.status === "pending");
  const lanes = LANES.filter((l) => l.type !== "squad").map((l) => {
    // Accepted first, then pending, so confirmed units stay on top.
    const units = [...accepted, ...pending].filter((u) => laneOf(u) === l.type);
    const placeholders: string[] =
      l.type === "ship" ? shipReqUnfilled.map((r) => r.label || r.category || "Schiff")
      : l.type === "fighter" ? Array.from({ length: fighterEmpty }, () => "Jäger")
      : [];
    return { ...l, units, placeholders };
  });
  const canManage = op.canManage;
  const filled = accepted.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const pct = op.minParticipants > 0 ? Math.min(100, Math.round((filled / op.minParticipants) * 100)) : 0;
  // Registration stays open while the op is live (started), not just "open".
  // Late joiners can still claim open seats / CQB squads mid-op. Only
  // locked/completed/cancelled close it.
  const canJoin =
    !!me && !!csrf && ["open", "draft", "starting", "in_progress"].includes(op.status);
  const heroImg = `${import.meta.env.BASE_URL}assets/operation-hero.png`;

  // design tab/link style for the operator action row
  const tabBase: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "0.5rem 0.95rem",
    fontFamily: MONO,
    fontSize: "0.78rem",
    letterSpacing: "0.03em",
    borderRadius: 6,
    border: "1px solid transparent",
    cursor: "pointer",
    background: "transparent",
    color: "var(--dim)",
    transition: "all .14s",
  };

  const infoRow = (icon: string, lab: string, val: string) => (
    <div key={lab} style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: "var(--bg3)",
          border: "1px solid var(--border)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "var(--dim)",
        }}
      >
        <Ic name={icon} size={15} sw={1.6} />
      </span>
      <span>
        <span style={{ display: "block", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim3)" }}>{lab}</span>
        <span style={{ color: "var(--text)", fontSize: "0.92rem" }}>{val}</span>
      </span>
    </div>
  );

  const seatRow = (u: FleetUnit, s: FleetUnit["seats"][number], lane: (typeof LANES)[number]) => {
    void lane;
    return (
      <div
        key={s.id}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.7rem",
          padding: "0.6rem 0.7rem",
          background: "var(--wash)",
          border: "1px solid var(--border)",
          borderRadius: 9,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: "var(--bg3)",
            border: "1px solid var(--wash)",
            color: "var(--dim)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Ic name={seatIcon(u, s.order)} size={16} sw={1.6} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.45rem", flexWrap: "wrap" }}>
            <strong style={{ fontWeight: 600, fontSize: "0.98rem", color: "var(--text)" }}>{s.label}</strong>
            <span style={TAGS.fest.style}>{TAGS.fest.text}</span>
          </div>
        </div>
        {s.claimedBy ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, minWidth: 0 }}>
            <Avatar name={s.claimedBy.username} />
            <span style={{ fontSize: "0.86rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "11rem" }}>
              {s.claimedBy.username}
            </span>
            <LateArrival eta={s.lateEta} canEdit={!!csrf && ((!!me && s.claimedBy.id === me.id) || canManage)} testid={`seat-late-${s.id}`} onSet={(eta) => run(() => setSeatLateArrival(id!, s.id, eta, csrf!))} />
            {me && s.claimedBy.id === me.id && (
              <button
                type="button"
                className="fpw-btn"
                style={{ padding: "0.3rem 0.6rem", fontSize: "0.68rem" }}
                disabled={busySeat === s.id}
                onClick={() => onUnclaim(s.id)}
                data-testid={`unclaim-${s.id}`}
              >
                Freigeben
              </button>
            )}
          </div>
        ) : canJoin ? (
          <button
            type="button"
            data-testid={`claim-${s.id}`}
            disabled={busySeat === s.id}
            onClick={() => onClaim(s.id)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              flexShrink: 0,
              padding: "0.4rem 0.7rem",
              border: "1px solid var(--border-hi)",
              background: "var(--wash)",
              color: "var(--cyan)",
              fontFamily: MONO,
              fontSize: "0.72rem",
              letterSpacing: "0.03em",
              borderRadius: 7,
              cursor: "pointer",
              whiteSpace: "nowrap",
            }}
          >
            Platz nehmen <Ic name="arrow" size={13} sw={1.8} />
          </button>
        ) : (
          <span style={TAGS.frei.style}>OFFEN</span>
        )}
      </div>
    );
  };

  // Captain view of a seat on their OWN offered ship: rename + activate/deactivate
  // (mirrors the operator's controls, but scoped to the unit's captain). Shows
  // inactive seats too so they can be re-activated. Claimed seats aren't toggled.
  const captainSeatRow = (u: FleetUnit, s: FleetUnit["seats"][number]) => (
    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.65rem", background: "var(--wash)", border: "1px solid var(--border)", borderRadius: 9, opacity: s.active ? 1 : 0.55 }}>
      <span style={{ width: 28, height: 28, borderRadius: 7, background: "var(--bg3)", border: "1px solid var(--wash)", color: "var(--dim)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Ic name={seatIcon(u, s.order)} size={15} sw={1.6} />
      </span>
      <input
        className="fpw-inline-edit"
        data-testid={`cap-seat-label-${s.id}`}
        key={`${s.id}:${s.label}`}
        defaultValue={s.label}
        title="Sitz umbenennen (Enter)"
        disabled={busySeat === s.id}
        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
        onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== s.label) run(() => patchSeat(id!, s.id, csrf!, { label: v })); }}
      />
      {s.claimedBy ? (
        <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexShrink: 0 }}>
          <Avatar name={s.claimedBy.username} />
          <span style={{ fontSize: "0.82rem", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "8rem" }}>{s.claimedBy.username}</span>
        </div>
      ) : (
        <button type="button" data-testid={`cap-seat-toggle-${s.id}`} title={s.active ? "Sitz/Turret deaktivieren — zählt dann nicht mehr zur Crew" : "Sitz/Turret aktivieren — zählt dann zur Crew"} disabled={busySeat === s.id} onClick={() => run(() => patchSeat(id!, s.id, csrf!, { active: !s.active }))} style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", padding: "0.18rem 0.5rem", borderRadius: 5, cursor: "pointer", whiteSpace: "nowrap", border: s.active ? "1px solid var(--wash)" : "1px solid var(--edge-green)", background: s.active ? "transparent" : "var(--tint-green)", color: s.active ? "var(--dim2)" : "var(--green)" }}>{s.active ? "Deaktivieren" : "Aktivieren"}</button>
      )}
    </div>
  );

  const entryCard = (
    color: string,
    icon: string,
    title: string,
    sub: string,
    cta: string,
    onClick: () => void,
    testid?: string,
  ) => (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      style={{
        flex: "1 1 240px",
        textAlign: "left",
        border: `1px solid ${tint(color, 20)}`,
        borderRadius: 11,
        background: `${tint(color, 4)}`,
        padding: "1.2rem 1.25rem",
        cursor: "pointer",
        color: "inherit",
        fontFamily: "inherit",
      }}
    >
      <span
        style={{
          width: 38,
          height: 38,
          borderRadius: 9,
          background: `${tint(color, 13)}`,
          border: `1px solid ${tint(color, 28)}`,
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "0.9rem",
        }}
      >
        <Ic name={icon} size={19} sw={1.6} />
      </span>
      <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "var(--text-hi)", marginBottom: "0.3rem" }}>{title}</div>
      <div style={{ color: "var(--dim)", fontSize: "0.88rem", marginBottom: "0.9rem", lineHeight: 1.5 }}>{sub}</div>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, color, fontFamily: MONO, fontSize: "0.74rem", letterSpacing: "0.04em" }}>
        {cta} <Ic name="arrow" size={14} sw={1.8} />
      </span>
    </button>
  );

  // Unit card (ship/fighter/vehicle/squad) — shared by the board lanes and the
  // CQB column (model A: an offered squad IS a CQB team).
  const unitCard = (u: FleetUnit, lane: (typeof LANES)[number]) => {
    const uFilled = u.seats.filter((s) => s.claimedBy).length;
    const expanded = !collapsed[u.id];
    const full = u.seats.length > 0 && uFilled === u.seats.length;
    const isPending = u.status === "pending";
    const isMine = !!me && u.captain?.id === me.id;
    return (
      <article
        key={u.id}
        data-testid="unit-card"
        data-pending={isPending ? "1" : undefined}
        style={{ width: "100%", minWidth: 0, border: `1px solid ${tint(lane.accent, 16)}`, borderTop: `2px solid ${tint(lane.accent, isPending ? 28 : 50)}`, borderRadius: 13, background: "var(--row)", padding: "1.15rem 1.2rem", opacity: isPending ? 0.72 : 1 }}
      >
        <div onClick={() => setCollapsed((c) => ({ ...c, [u.id]: !c[u.id] }))} style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem", cursor: "pointer" }}>
          <span style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: tint(lane.accent, 13), border: `1px solid ${tint(lane.accent, 28)}`, color: lane.accent }}>
            <Ic name={lane.icon} size={20} sw={1.6} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong style={{ fontWeight: 700, fontSize: "1.12rem", color: "var(--text-hi)", lineHeight: 1.2 }}>{u.name}</strong>
              {isPending && (
                <span style={{ ...TAG_BASE, fontSize: "9.5px", color: "var(--gold)", borderColor: "var(--edge-gold)", background: "var(--tint-gold)", gap: 4, padding: "2px 8px" }}>
                  <Ic name="bolt" size={12} sw={2} /> WARTET AUF BESTÄTIGUNG
                </span>
              )}
              {full && !isPending && (
                <span style={{ ...TAG_BASE, fontSize: "9.5px", color: "var(--green)", borderColor: "var(--edge-green)", background: "var(--tint-green)", gap: 4, padding: "2px 8px" }}>
                  <Ic name="check" size={12} sw={2} /> VOLL
                </span>
              )}
            </div>
            <div style={{ color: "var(--dim)", fontSize: "0.86rem", marginTop: "0.15rem", display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <span>{u.unitType}{u.captain ? ` · Captain: ${u.captain.username}` : ""}</span>
              {u.formationSlot === 0 && captainTag}
              {unitChips(u)}
              {csrf && (isMine || canManage) ? (
                <LateArrival eta={u.lateEta} canEdit testid={`unit-late-${u.id}`} onSet={(eta) => run(() => setUnitLateArrival(id!, u.id, eta, csrf!))} />
              ) : (
                <LateArrival eta={u.lateEta} canEdit={false} onSet={() => {}} />
              )}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: "1.05rem", color: "var(--text-hi)", lineHeight: 1 }}>{uFilled}<span style={{ color: "var(--dim3)" }}>/{u.seats.length}</span></div>
            <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "var(--dim3)", marginTop: "0.25rem" }}>BESETZT</div>
          </div>
          {me && csrf && u.captain?.id === me.id && (
            <button type="button" data-testid={`withdraw-unit-${u.id}`} title="Mein Schiff zurückziehen" onClick={(e) => { e.stopPropagation(); if (window.confirm("Dein Schiff aus dieser Operation zurückziehen?")) run(() => withdrawUnit(id!, u.id, csrf)); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.35rem 0.6rem", border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", fontFamily: MONO, fontSize: "0.66rem", borderRadius: 7, cursor: "pointer" }}>
              <Ic name="x" size={12} sw={2} /> Zurückziehen
            </button>
          )}
          <span style={{ display: "inline-flex", flexShrink: 0, transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", color: "var(--dim3)" }}>
            <Ic name="chevron" size={16} sw={2} />
          </span>
        </div>
        {expanded && (
          <div style={{ marginTop: "1rem" }}>
            {u.captainNote && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--dim)", fontSize: "0.86rem", marginBottom: "0.9rem" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex", flexShrink: 0 }}><Ic name="bolt" size={15} /></span>
                <span style={{ fontStyle: "italic" }}>{u.captainNote}</span>
              </div>
            )}
            {me && csrf && isMine ? (
              <>
                <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "var(--dim3)", marginBottom: "0.5rem" }}>DEINE SITZE · UMBENENNEN / AKTIVIEREN</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{u.seats.map((s) => captainSeatRow(u, s))}</div>
              </>
            ) : isPending ? (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--dim)", fontSize: "0.84rem", fontStyle: "italic" }}>
                <span style={{ color: "var(--gold)", display: "inline-flex", flexShrink: 0 }}><Ic name="bolt" size={14} /></span>
                Sitze buchbar, sobald der Operator dieses Schiff annimmt.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{u.seats.filter((s) => s.active).map((s) => seatRow(u, s, lane))}</div>
            )}
          </div>
        )}
      </article>
    );
  };

  // Empty need slot — a requested unit that nobody has provided yet (no seats).
  const emptyNeedCard = (label: string, lane: (typeof LANES)[number], key: string) => (
    <article key={key} data-testid="need-slot" style={{ width: "100%", minWidth: 0, border: `1px dashed ${tint(lane.accent, 40)}`, borderRadius: 13, background: "var(--wash)", padding: "1rem 1.15rem", opacity: 0.92 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
        <span style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: tint(lane.accent, 7), border: `1px dashed ${tint(lane.accent, 40)}`, color: lane.accent }}>
          <Ic name={lane.icon} size={19} sw={1.5} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 700, fontSize: "1rem", color: "var(--text)" }}>{label}</strong>
          <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.08em", color: lane.accent, marginTop: "0.2rem" }}>BEDARF · UNERFÜLLT</div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)", flexShrink: 0, whiteSpace: "nowrap" }}>noch kein Schiff</span>
      </div>
    </article>
  );

  const squadLane = LANES.find((l) => l.type === "squad")!;
  const squadUnits = accepted.filter((u) => u.unitType === "squad");
  // A player squad FULFILLS a CQB-team need. Show squads as teams, then only the
  // still-needed single-soldier teams (target − squads − already-staffed groups).
  // Staffed groups (members>0) always show; surplus EMPTY operator teams are
  // hidden. Over-fulfilment stays possible (operator raises the team count).
  const cqbNeedCount = needs?.cqbTeams.count ?? null;
  const cqbGroupsStaffed = op.cqbTeams.filter((t) => t.members.length > 0);
  const cqbGroupsEmpty = op.cqbTeams.filter((t) => t.members.length === 0);
  const cqbProvidedTeams = squadUnits.length + cqbGroupsStaffed.filter((t) => t.targetSize != null && t.members.length >= t.targetSize).length;
  const cqbRemainingEmpty = cqbNeedCount != null
    ? Math.max(0, cqbNeedCount - squadUnits.length - cqbGroupsStaffed.length)
    : cqbGroupsEmpty.length;
  const cqbGroupsShown = [...cqbGroupsStaffed, ...cqbGroupsEmpty.slice(0, cqbRemainingEmpty)];

  // ── Verband / Captain helpers ───────────────────────────────────────
  // Slot 0 of a group is always its Captain — the same rule the backend enforces,
  // so the roster can mark it without a separate leader field.
  const verbandName = (parentId: string | null | undefined) =>
    parentId ? (op.formations ?? []).find((f) => f.id === parentId)?.name ?? null : null;

  const captainTag = (
    <span style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.06em", color: "var(--gold)", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", borderRadius: 4, padding: "0.05rem 0.28rem", flexShrink: 0 }}>★ CAPTAIN</span>
  );

  // "Teil von <Verband>" chip, so a participant can see the higher formation
  // their Staffel/Trupp belongs to without opening the operator console.
  const verbandChip = (parentId: string | null | undefined) => {
    const n = verbandName(parentId);
    return n ? (
      <span data-testid="verband-chip" style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.06em", color: "var(--cyan)", border: "1px solid var(--border-hi)", background: "var(--wash)", borderRadius: 4, padding: "0.05rem 0.3rem", flexShrink: 0 }}>VERBAND: {n.toUpperCase()}</span>
    ) : null;
  };

  const chip = (label: string, color: string, testid?: string) => (
    <span data-testid={testid} style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.06em", color, border: `1px solid ${tint(color, 30)}`, background: `${tint(color, 7)}`, borderRadius: 4, padding: "0.05rem 0.3rem", flexShrink: 0 }}>{label}</span>
  );

  // Which group a unit sits in — a Staffel for a fighter, a Verband for a ship.
  // Returns the Verband above it too, so a fighter shows both levels.
  const groupOfUnit = (u: FleetUnit) => {
    if (!u.formationId) return null;
    const st = (op.fighterSquads ?? []).find((s) => s.id === u.formationId);
    if (st) return { name: st.name, kind: "STAFFEL", parentId: st.parentId };
    const f = (op.formations ?? []).find((x) => x.id === u.formationId);
    return f ? { name: f.name, kind: "VERBAND", parentId: null } : null;
  };

  const unitById = (unitId: string | null | undefined) =>
    unitId ? op.units.find((x) => x.id === unitId) ?? null : null;
  const unitLabel = (u: FleetUnit) => u.shipName ?? u.name;

  // Group + transport chips for a unit card. This is the whole point of the
  // transparency pass: a participant seated on a ship must see which Verband it
  // belongs to and what it carries, without opening the operator console.
  const unitChips = (u: FleetUnit) => {
    const g = groupOfUnit(u);
    const carrier = unitById(u.carrierUnitId);
    const carried = op.units.filter((x) => x.carrierUnitId === u.id && x.status !== "rejected");
    if (!g && !carrier && carried.length === 0 && !u.roleOverride) return null;
    return (
      <>
        {/* Only shown when the role was declared — otherwise it's just the catalog
            guess and would be noise on every single card. */}
        {u.roleOverride && chip(`ROLLE: ${roleLabel(u.roleOverride).toUpperCase()}`, "var(--cyan)", `unit-role-chip-${u.id}`)}
        {g && g.kind === "STAFFEL" && chip(`STAFFEL: ${g.name.toUpperCase()}`, "var(--dim)", `unit-squad-chip-${u.id}`)}
        {g && g.kind === "VERBAND" && chip(`VERBAND: ${g.name.toUpperCase()}`, "var(--cyan)", `unit-verband-chip-${u.id}`)}
        {g?.parentId && verbandChip(g.parentId)}
        {carrier && chip(`FÄHRT IN: ${unitLabel(carrier).toUpperCase()}`, "var(--dim)", `unit-carrier-chip-${u.id}`)}
        {carried.length > 0 && chip(`AN BORD: ${carried.map(unitLabel).join(", ").toUpperCase()}`, "var(--dim)", `unit-carried-chip-${u.id}`)}
      </>
    );
  };

  return (
    <article>
      <Breadcrumbs items={[{ label: "Operationen", to: "/operationen" }, { label: op.title }]} />
      {/* FR-A5: operator preview switcher — see the page as guest / crew / self. */}
      {op.canManage && (
        <div data-testid="viewas-bar" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem", padding: "0.55rem 0.75rem", border: "1px solid var(--border)", background: "var(--wash)", borderRadius: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "var(--dim)" }}>
            <Ic name="eye" size={14} /> ANSICHT ALS
          </span>
          {([["self", "Ich selbst"], ["crew", "Crew"], ["guest", "Gast"]] as const).map(([key, lab]) => {
            const on = viewAs === key;
            return (
              <button
                key={key}
                type="button"
                data-testid={`viewas-${key}`}
                onClick={() => setViewAs(key)}
                style={{ padding: "0.3rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? "1px solid var(--border-hi)" : "1px solid var(--wash)", background: on ? "var(--wash)" : "transparent", color: on ? "var(--cyan)" : "var(--dim)" }}
              >
                {lab}
              </button>
            );
          })}
          {viewAs !== "self" && (
            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.62rem", color: "var(--gold)" }}>VORSCHAU — keine Operator-Steuerung</span>
          )}
        </div>
      )}
      {/* HERO — two columns with the operation banner image */}
      <section
        style={{
          position: "relative",
          border: "1px solid var(--border-hi)",
          borderRadius: "var(--r-hero)",
          overflow: "hidden",
          background: "var(--hero-grad)",
          padding: "1.7rem 1.8rem",
          marginBottom: "1.1rem",
          display: "flex",
          flexWrap: "wrap",
          gap: "1.4rem",
          alignItems: "flex-start",
        }}
      >
        <div style={{ flex: "1.6 1 420px", minWidth: 0 }}>
          <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.5rem", marginBottom: "0.95rem" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "1px solid var(--edge-green)",
                color: "var(--green)",
                background: "var(--tint-green)",
                fontFamily: MONO,
                fontSize: "0.66rem",
                letterSpacing: "0.08em",
                padding: "0.2rem 0.55rem",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--green)" }} />
              {op.status}
            </span>
            <span
              style={{
                border: "1px solid var(--border-hi)",
                color: "var(--cyan)",
                background: "var(--wash)",
                fontFamily: MONO,
                fontSize: "0.66rem",
                letterSpacing: "0.08em",
                padding: "0.2rem 0.55rem",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              {op.visibility}
            </span>
            {op.recurrence && (
              <span
                data-testid="op-series-badge"
                title={seriesPattern(op.recurrence, t)}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: `1px solid ${tint("var(--cyan)", 45)}`,
                  color: "var(--cyan)",
                  background: tint("var(--cyan)", 10),
                  fontFamily: MONO,
                  fontSize: "0.66rem",
                  letterSpacing: "0.07em",
                  padding: "0.2rem 0.55rem",
                  borderRadius: 4,
                  textTransform: "uppercase",
                }}
              >
                <Ic name="swap" size={13} sw={1.7} /> {t("series.badge")}
              </span>
            )}
            {op.isStreamEvent && (
              <span
                data-testid="op-stream-badge"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  border: "1px solid rgba(145,70,255,0.45)",
                  color: "var(--purple)",
                  background: "rgba(145,70,255,0.1)",
                  fontFamily: MONO,
                  fontSize: "0.66rem",
                  letterSpacing: "0.08em",
                  padding: "0.2rem 0.55rem",
                  borderRadius: 4,
                  textTransform: "uppercase",
                }}
              >
                <Ic name="stream" size={13} sw={1.7} /> Stream
              </span>
            )}
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--dim)", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em", padding: "0.2rem" }}>
              <Ic name="clock" size={13} />
              {fmtDate(op.scheduledAt, op.guild.timezone).toUpperCase()}
            </span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "2.1rem", lineHeight: 1.12, color: "var(--text-hi)", margin: "0 0 0.7rem", letterSpacing: "0.01em" }} data-testid="op-title">
            {op.title}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 1.3rem", color: "var(--dim)", fontSize: "0.92rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="pin" size={15} sw={1.6} /></span>
              {op.meetingLocation}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="globe" size={15} sw={1.6} /></span>
              {op.meetingSystem}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="users" size={15} sw={1.6} /></span>
              {filled} angemeldet · min {op.minParticipants}
            </span>
          </div>

          {/* MISSION OBJECTIVE — part of the hero */}
          <div style={{ marginTop: "1.1rem", paddingTop: "1.1rem", borderTop: "1px solid var(--border)" }}>
            <div style={monoLabel({ marginBottom: "0.45rem" })}>MISSION OBJECTIVE</div>
            {op.description ? (
              <Markdown text={op.description} style={{ fontSize: "0.95rem" }} />
            ) : (
              <p style={{ margin: 0, color: "var(--dim2)" }}>Kein Missionsziel hinterlegt.</p>
            )}
            {op.resourceLinks.length > 0 && (
              <>
                <div style={monoLabel({ margin: "1rem 0 0.55rem", fontSize: "0.7rem" })}>BRIEFING / LINKS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {op.resourceLinks.map((l) => (
                    <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", color: "var(--cyan)", textDecoration: "none", fontSize: "0.92rem" }}>
                      {l.title} <span style={{ color: "var(--dim3)" }}>↗</span>
                    </a>
                  ))}
                </div>
              </>
            )}
            <StreamsSection op={op} csrf={csrf} meId={me?.id ?? null} canManage={op.canManage} onChanged={load} />
            <div style={{ marginTop: "1rem" }}>
              <DocumentsPanel opId={op.id} csrf={csrf} canManage={op.canManage} initialDocs={op.documents} onNotice={setNotice} />
            </div>
          </div>
        </div>

        {/* right column: ANMELDUNGEN box (left) + banner image (right), same height.
            The box drives the row height; the image scales into it with object-fit
            contain (whole image always visible, letterboxed). Wraps to stacked on narrow screens. */}
        <div style={{ flex: "1 1 420px", minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "1rem", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0, border: "1px solid var(--border)", borderRadius: 12, background: "rgba(18, 20, 22,0.55)", padding: "0.85rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={monoLabel()}>ANMELDUNGEN</span>
              <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: "var(--text-hi)" }}>
                <strong style={{ color: "var(--gold)" }}>{filled}</strong> <span style={{ color: "var(--dim3)" }}>/ {op.minParticipants}</span>
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 5, background: "var(--bg3)", overflow: "hidden", marginBottom: "0.4rem" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 5, background: "var(--gold)" }} />
            </div>
            <div style={{ color: "var(--dim)", fontSize: "0.8rem", marginBottom: "0.6rem" }}>
              {Math.max(0, op.minParticipants - filled) > 0 ? `Noch ${op.minParticipants - filled} bis zur Mindestzahl.` : "Mindestzahl erreicht."}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {infoRow("clock", "ZEIT", fmtShort(op.scheduledAt, op.guild.timezone))}
              {infoRow("pin", "TREFFPUNKT", op.meetingLocation)}
              {infoRow("globe", "SYSTEM", op.meetingSystem)}
            </div>
            {op.guild.discordInviteUrl && (
              <a
                href={op.guild.discordInviteUrl}
                target="_blank"
                rel="noopener noreferrer"
                data-testid="discord-join"
                style={{
                  marginTop: "0.7rem",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "0.5rem",
                  padding: "0.55rem 0.8rem",
                  borderRadius: 8,
                  border: "1px solid rgba(88,101,242,0.5)",
                  background: "rgba(88,101,242,0.14)",
                  color: "var(--purple)",
                  textDecoration: "none",
                  fontFamily: MONO,
                  fontSize: "0.72rem",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                }}
              >
                <Ic name="chat" size={15} sw={1.6} />
                Auf Discord beitreten
              </a>
            )}
          </div>
          <button type="button" data-testid="cover-open" title="Cover vergrößern" onClick={() => setLightbox(true)} style={{ flex: "2 1 320px", minWidth: 0, aspectRatio: "16 / 9", border: "1px solid var(--border)", borderRadius: 10, overflow: "hidden", background: "#0a1622", padding: 0, cursor: "zoom-in" }}>
            <img src={op.coverUrl ?? heroImg} alt={`Operation ${op.title}`} style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }} />
          </button>
        </div>
      </section>

      {/* What the mission needs — visible to crew for planning (read-only). */}
      {needs && (needs.shipNeeds.length > 0 || needs.fighterSquads > 0 || needs.cqbTeams.count > 0) && (
        <section data-testid="needs-overview" style={{ border: "1px solid var(--border)", borderRadius: 12, background: "rgba(18, 20, 22,0.55)", padding: "1rem 1.2rem", marginBottom: "1.4rem" }}>
          <div style={monoLabel({ marginBottom: "0.7rem" })}>GESUCHT — WAS DIE MISSION BRAUCHT</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {needs.shipNeeds.map((s) => {
              const bound = accepted.filter((u) => u.requirementId === s.id).length;
              return (
                <span key={s.id} data-testid={`need-chip-${s.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: `1px solid ${bound > 0 ? "var(--edge-green)" : "var(--border)"}`, background: bound > 0 ? "var(--tint-green)" : "var(--wash)", color: "var(--text)" }}>
                  <span style={{ color: bound > 0 ? "var(--green)" : "var(--cyan)", display: "inline-flex" }}><Ic name={bound > 0 ? "check" : "ship"} size={13} sw={1.8} /></span>
                  {s.label}
                </span>
              );
            })}
            {needs.fighterSquads > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--text)" }}>
                <span style={{ color: "var(--purple)", display: "inline-flex" }}><Ic name="fighter" size={13} sw={1.8} /></span>
                {needs.fighterSquads} Jäger-Staffel{needs.fighterSquads === 1 ? "" : "n"} · je {needs.fighterSquadSize} Piloten
              </span>
            )}
            {needs.cqbTeams.count > 0 && (() => {
              const covered = cqbProvidedTeams >= needs.cqbTeams.count;
              return (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: `1px solid ${covered ? "var(--edge-green)" : "var(--edge-gold)"}`, background: covered ? "var(--tint-green)" : "var(--tint-gold)", color: "var(--text)" }}>
                  <span style={{ color: covered ? "var(--green)" : "var(--gold)", display: "inline-flex" }}><Ic name={covered ? "check" : "fps"} size={13} sw={1.8} /></span>
                  {cqbProvidedTeams}/{needs.cqbTeams.count} CQB-Teams{cqbProvidedTeams > needs.cqbTeams.count ? " (über)" : ""} · je {needs.cqbTeams.size} Soldaten
                </span>
              );
            })()}
          </div>
        </section>
      )}

      {notice && (
        <p className="fpw-tag gold" role="alert" data-testid="op-notice" style={{ display: "inline-flex", marginTop: 0 }}>
          {notice}
        </p>
      )}


      {me && (() => {
        // FR: after signing up (esp. offering a ship) the player must SEE their status.
        // A pending ship-offer sets signupState="waitlist", which previously rendered
        // nothing — so the op looked like the user hadn't joined at all. Build a
        // "Dein Status" summary purely from data already in the payload.
        const myShips = op.units.filter((u) => u.captain?.id === me.id);
        const mySeats = op.units
          .filter((u) => u.captain?.id !== me.id) // seats on my OWN ship are covered by the ship row
          .flatMap((u) => u.seats.filter((s) => s.claimedBy?.id === me.id).map((s) => ({ seat: s, unit: u })));
        const shipTone = (status: string) => (status === "accepted" ? "var(--green)" : status === "rejected" ? "var(--red)" : "var(--gold)");
        const shipStatus = (status: string) => (status === "accepted" ? "bestätigt" : status === "rejected" ? "abgelehnt" : "noch nicht bestätigt");
        const items: { key: string; icon: string; tone: string; text: React.ReactNode }[] = [];
        // Where a unit sits in the hierarchy, as a readable suffix: the group it
        // belongs to, the Verband above it, and the ship carrying it. Without this
        // a participant has no way to learn they were put into a formation.
        const placement = (u: FleetUnit) => {
          const g = groupOfUnit(u);
          const carrier = unitById(u.carrierUnitId);
          const parts: string[] = [];
          if (g) parts.push(`${g.kind === "STAFFEL" ? "Staffel" : "Verband"} ${g.name}`);
          const vb = verbandName(g?.parentId);
          if (vb) parts.push(`Verband ${vb}`);
          if (carrier) parts.push(`an Bord der ${unitLabel(carrier)}`);
          return parts.length ? <> · {parts.join(" · ")}</> : null;
        };
        for (const u of myShips)
          items.push({ key: `ship-${u.id}`, icon: "ship", tone: shipTone(u.status), text: <>Schiff <strong>{u.shipName ?? u.name}</strong> — {shipStatus(u.status)}{placement(u)}{u.formationSlot === 0 ? <> · <strong>Captain</strong></> : null}</> });
        for (const { seat, unit } of mySeats)
          items.push({ key: `seat-${seat.id}`, icon: "pilot", tone: "var(--green)", text: <>Platz <strong>{seat.label}</strong> auf {unit.shipName ?? unit.name} — bestätigt{placement(unit)}</> });
        // Placement into a ground troop / squadron — the operator may have put the
        // player there without them ever offering a ship.
        for (const tm of op.cqbTeams) {
          const m = tm.members.find((x) => x.id === me.id);
          if (!m) continue;
          const vb = verbandName(tm.parentId);
          const carrier = unitById(tm.carrierUnitId);
          items.push({
            key: `cqb-${tm.id}`,
            icon: "fps",
            tone: "var(--green)",
            text: <>Bodentruppe <strong>{tm.name}</strong> — Platz {(m.slotIndex ?? 0) + 1}{m.slotIndex === 0 ? <> (<strong>Captain</strong>)</> : null}{vb ? ` · Verband ${vb}` : ""}{carrier ? ` · fährt in ${unitLabel(carrier)}` : ""}</>,
          });
        }
        for (const sq of op.fighterSquads ?? []) {
          const m = sq.members.find((x) => x.id === me.id);
          if (!m) continue;
          const vb = verbandName(sq.parentId);
          items.push({
            key: `sq-${sq.id}`,
            icon: "fighter",
            tone: "var(--green)",
            text: <>Staffel <strong>{sq.name}</strong> — Pilot{m.slotIndex === 0 ? <> (<strong>Staffel-Captain</strong>)</> : null}{vb ? ` · Verband ${vb}` : ""}</>,
          });
        }
        if (op.viewerCqbSignedUp && !items.some((i) => i.key.startsWith("cqb-") || i.key.startsWith("sq-")))
          items.push({ key: "cqb", icon: "swap", tone: "var(--gold)", text: <>Flexibel angemeldet — der Operator teilt dich passend ein</> });
        // Any other waitlist reason (e.g. a pending crew-assignment request) still gets ack'd.
        if (items.length === 0 && op.signupState)
          items.push({
            key: "generic",
            icon: "check",
            tone: op.signupState === "joined" ? "var(--green)" : "var(--gold)",
            text: op.signupState === "joined" ? <>Du bist Teilnehmer</> : <>Angemeldet — wird vom Operator bestätigt</>,
          });
        const signedUp = items.length > 0;
        // Someone can hold places in several accepted units (their own ship AND
        // a seat on someone else's, say). The roster needs to know which one
        // counts as theirs; without a choice the server picks a default, and
        // this control makes that choice explicit and changeable.
        const myUnits = op.units.filter(
          (u) =>
            u.status === "accepted" &&
            (u.captain?.id === me.id || u.seats.some((st) => st.claimedBy?.id === me.id)),
        );
        return (
          <div style={{ marginBottom: "1.8rem" }}>
            {signedUp && (
              <section data-testid="my-status" style={{ border: "1px solid var(--edge-green)", background: "var(--tint-green)", borderRadius: 12, padding: "0.9rem 1.1rem", marginBottom: "0.9rem" }}>
                <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.12em", color: "var(--dim2)", marginBottom: "0.6rem" }}>DEIN STATUS · BEREITS ANGEMELDET</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}>
                  {items.map((it) => (
                    <div key={it.key} style={{ display: "flex", alignItems: "center", gap: "0.55rem", fontSize: "0.9rem", color: "var(--text)" }}>
                      <span style={{ color: it.tone, display: "inline-flex", flexShrink: 0 }}><Ic name={it.icon} size={15} sw={1.7} /></span>
                      <span>{it.text}</span>
                    </div>
                  ))}
                </div>
                {myUnits.length > 1 && (
                  <div
                    data-testid="primary-unit"
                    style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap", marginTop: "0.8rem", paddingTop: "0.7rem", borderTop: "1px solid var(--wash)" }}
                  >
                    <label htmlFor="primary-unit-select" style={{ fontSize: "0.86rem", color: "var(--dim)" }}>
                      Deine Haupteinheit
                    </label>
                    <select
                      id="primary-unit-select"
                      data-testid="primary-unit-select"
                      value={op.viewerPrimaryUnitId ?? ""}
                      disabled={!csrf}
                      onChange={(e) => {
                        const v = e.target.value;
                        run(() => (v ? setPrimaryUnit(id!, csrf!, v) : clearPrimaryUnit(id!, csrf!)));
                      }}
                      style={{ background: "var(--bg3)", border: "1px solid var(--border-hi)", color: "var(--text)", fontSize: "0.84rem", padding: "0.3rem 0.5rem", borderRadius: 7, outline: "none" }}
                    >
                      <option value="">— automatisch —</option>
                      {myUnits.map((u) => (
                        <option key={u.id} value={u.id}>{u.shipName ?? u.name}</option>
                      ))}
                    </select>
                    <span style={{ fontSize: "0.78rem", color: "var(--dim2)" }}>
                      Zählt für Aufstellung und Ansprache, wenn du in mehreren Einheiten steckst.
                    </span>
                  </div>
                )}
              </section>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap" }}>
              {/* Calendar export (.ics) — backend route, proxied by nginx. */}
              <a
                href={`${import.meta.env.BASE_URL}ops/${id}/calendar.ics`}
                data-testid="calendar-export"
                style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "var(--cyan)", textDecoration: "none", fontFamily: MONO, fontSize: "0.74rem", border: "1px solid var(--border-hi)", borderRadius: 8, padding: "0.4rem 0.75rem" }}
              >
                <Ic name="cal" size={14} sw={1.7} /> Im Kalender speichern
              </a>
            </div>
          </div>
        );
      })()}

      {(
        <>
          {/* MITMACHEN — three entry cards */}
          {canJoin && (
            <section data-testid="join-card" style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.6rem 1.7rem", marginBottom: "1.6rem" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.7rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                <h2 style={{ fontWeight: 700, fontSize: "1.45rem", color: "var(--text-hi)", margin: 0 }}>Mitmachen</h2>
                <span style={{ color: "var(--dim)", fontSize: "0.95rem" }}>Wie willst du beitragen?</span>
              </div>
              <p style={{ margin: "0 0 1.3rem", color: "var(--dim)", fontSize: "0.95rem", maxWidth: "62ch" }}>
                Du kannst mehrere Wege kombinieren — ein Schiff bringen <em>und</em> einen Sitz an Bord nehmen schließen sich nicht aus. Jeder Platz zeigt mit einem Tag, wie festgelegt er ist.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem" }}>
                {entryCard("var(--cyan)", "ship", "Freien Platz nehmen", "Sieh die Flotte unten und klick auf einen offenen Sitz.", "Zur Flotte", () =>
                  fleetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                )}
                {entryCard("var(--green)", "fighter", "Eigenes Schiff einbringen", "Bring eines deiner Schiffe — die Crew besetzt die Sitze.", "Schiff wählen", () => setOfferOpen((v) => !v), "offer-ship-open")}
                {op.viewerCqbSignedUp
                  ? entryCard("var(--gold)", "check", "Du bist flexibel angemeldet", "Der Operator teilt dich passend ein. Klick zum Zurückziehen.", "Zurückziehen", () => run(() => cqbWithdraw(id!, csrf!)), "cqb-withdraw")
                  : entryCard("var(--gold)", "swap", "Teilt mich ein", "Keine Lust zu wählen? Der Operator gibt dir einen Platz.", "Flexibel anmelden", () => run(() => cqbSignup(id!, csrf!)), "cqb-signup")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.9rem", marginTop: "1.1rem" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={op.viewerHangarShared}
                    data-testid="hangar-toggle"
                    onChange={(e) => run(() => setHangarShare(id!, csrf!, e.target.checked))}
                    style={{ accentColor: "var(--cyan)", width: 18, height: 18 }}
                  />
                  <span style={{ color: "var(--dim)", fontSize: "0.9rem", display: "inline-flex", alignItems: "center", gap: 5 }}>
                    <Ic name="eye" size={14} /> Operator darf meinen Hangar sehen
                  </span>
                </label>
              </div>
              {offerOpen && (
                <OfferShip
                  opId={id!}
                  csrf={csrf!}
                  carrierOptions={accepted.filter((u) => u.unitType === "ship").map((u) => ({ id: u.id, name: u.name }))}
                  requirements={needs?.requirements ?? []}
                  onDone={() => {
                    setNotice(null);
                    setOfferOpen(false);
                    load();
                  }}
                  onCancel={() => setOfferOpen(false)}
                  onError={(m) => setNotice(m)}
                />
              )}
            </section>
          )}

          {/* TAG LEGEND */}
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              gap: "0.5rem 1.1rem",
              padding: "0.7rem 0.2rem",
              marginBottom: "1.2rem",
              borderTop: "1px solid var(--border)",
              borderBottom: "1px solid var(--border)",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "var(--dim3)" }}>WIE FEST IST EIN PLATZ?</span>
            {(
              [
                ["fest", "Genau dieser Platz"],
                ["typ", "Nur Schiffs-/Rollentyp festgelegt"],
                ["rolle_offen", "Generischer Platz in der Einheit"],
                ["frei", "Operator teilt dich ein"],
              ] as const
            ).map(([k, desc]) => (
              <span key={k} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <span style={TAGS[k].style}>{TAGS[k].text}</span>
                <span style={{ color: "var(--dim)", fontSize: "0.8rem" }}>{desc}</span>
              </span>
            ))}
          </div>

          {/* CATEGORY BOARD — Schiffe / Jäger / CQB / Fahrzeuge as columns */}
          {/* §12: a hard 500px column overflows a phone. min() lets the column shrink
              with the viewport and keeps the comfortable width everywhere else. */}
          <div ref={fleetRef} style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(min(100%, 500px), 1fr))", gap: "1.3rem", alignItems: "start" }}>
            {lanes.length === 0 && op.cqbTeams.length === 0 && <p style={{ color: "var(--dim2)" }}>Noch keine Einheiten.</p>}
            {lanes.map((lane) => {
              // Header count reflects CONFIRMED capacity only — pending units are
              // shown in the lane but must not inflate the "besetzt/total" tally.
              const confirmed = lane.units.filter((u) => u.status === "accepted");
              const laneFilled = confirmed.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
              const laneTotal = confirmed.reduce((a, u) => a + u.seats.length, 0);
              return (
                <section key={lane.type} style={{ flex: "1 1 290px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "1rem" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.78rem", letterSpacing: "0.12em", color: lane.accent, whiteSpace: "nowrap" }}>
                      <Ic name={lane.icon} size={16} />
                      {lane.label}
                    </span>
                    <span style={{ flex: 1, height: 1, background: "var(--border-hi)" }} />
                    <span style={{ fontFamily: MONO, fontSize: "0.78rem", color: "var(--dim)", whiteSpace: "nowrap" }}>
                      {laneFilled}/{laneTotal}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                    {lane.type === "fighter" ? (() => {
                      // Jäger-Staffeln (fighter squads) as CQB-style cards: fighters bind
                      // via formationId. Grouped fighters sit in their squad card, the
                      // rest under "Ohne Staffel". Slots show N/target, over-fill allowed.
                      // A Staffel is a fighter_squad group (its count IS the Bedarf).
                      // Ops also build Staffeln as Verbände, and both kinds coexist —
                      // picking one list over the other stranded every fighter bound
                      // to the other kind under "Ohne Staffel". So: all fighter_squad
                      // groups, plus the formations that actually hold fighters.
                      const fighterUnitGroupIds = new Set(
                        lane.units.map((u) => u.formationId).filter((x): x is string => !!x),
                      );
                      const squads = [
                        ...(op.fighterSquads ?? []),
                        ...(op.formations ?? []).filter(
                          (f) => fighterUnitGroupIds.has(f.id) || f.members.length > 0,
                        ),
                      ];
                      const squadIds = new Set(squads.map((s) => s.id));
                      const cap = needs?.fighterSquadSize ?? 2;
                      const ungrouped = lane.units.filter((u) => !u.formationId || !squadIds.has(u.formationId));
                      const nothing = lane.units.length === 0 && squads.length === 0;
                      return (
                        <>
                          {squads.map((sq) => {
                            const fs = lane.units.filter((u) => u.formationId === sq.id);
                            const mem = sq.members ?? [];
                            const filledF = fs.filter((u) => u.status === "accepted").length + mem.length;
                            const over = filledF > cap;
                            const met = filledF >= cap;
                            const empty = fs.length === 0 && mem.length === 0;
                            return (
                              <div key={sq.id} data-testid={`fighter-squad-${sq.id}`} style={{ border: "1px solid var(--border-hi)", borderTop: "2px solid var(--border-hi)", borderRadius: 13, background: "var(--wash)", padding: "0.8rem 0.85rem" }}>
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: empty ? 0 : "0.7rem" }}>
                                  <span style={{ color: "var(--purple)", display: "inline-flex", flexShrink: 0 }}><Ic name="fighter" size={15} sw={1.7} /></span>
                                  <strong style={{ fontSize: "0.95rem", color: "var(--text-hi)" }}>{sq.name}</strong>
                                  {/* Legacy fallback groups (formations) have no parent. */}
                                  {verbandChip((sq as { parentId?: string | null }).parentId ?? null)}
                                  <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.74rem", whiteSpace: "nowrap", color: met ? "var(--green)" : "var(--dim)" }}>{filledF}/{cap}{over ? " (über)" : ""}</span>
                                </div>
                                {empty ? (
                                  <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.06em", color: "var(--dim3)" }}>Noch kein Jäger zugewiesen.</div>
                                ) : (
                                  <div style={{ display: "flex", flexDirection: "column", gap: "0.7rem" }}>
                                    {fs.map((u) => unitCard(u, lane))}
                                    {mem.map((m) => (
                                      <div key={m.id} data-testid={`fighter-pilot-${m.id}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.86rem", color: "var(--text)", padding: "0.35rem 0.4rem", border: "1px solid var(--wash)", borderRadius: 8 }}>
                                        <Avatar name={m.username} /> <span style={{ flex: 1, minWidth: 0 }}>{m.username}{me && m.id === me.id ? <span style={{ color: "var(--green)", fontFamily: MONO, fontSize: "0.6rem" }}> · DU</span> : null} <span style={{ color: "var(--dim2)", fontFamily: MONO, fontSize: "0.58rem" }}>{m.slotIndex === 0 ? "Staffel-Captain" : "Pilot"}</span></span>
                                        {m.slotIndex === 0 && captainTag}
                                        <LateArrival eta={m.lateEta} canEdit={false} onSet={() => {}} />
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                          {ungrouped.length > 0 && (
                            <>
                              {squads.length > 0 && <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>OHNE STAFFEL</div>}
                              {ungrouped.map((u) => unitCard(u, lane))}
                            </>
                          )}
                          {nothing && (
                            <div data-testid="lane-empty-fighter" style={{ border: "1px dashed var(--wash)", borderRadius: 13, background: "var(--wash)", padding: "1.4rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>KEIN BEDARF</div>
                          )}
                        </>
                      );
                    })() : (
                      <>
                        {lane.units.map((u) => unitCard(u, lane))}
                        {lane.placeholders.map((label, i) => emptyNeedCard(label, lane, `ph-${lane.type}-${i}`))}
                        {lane.units.length === 0 && lane.placeholders.length === 0 && (
                          <div data-testid={`lane-empty-${lane.type}`} style={{ border: "1px dashed var(--wash)", borderRadius: 13, background: "var(--wash)", padding: "1.4rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>KEIN BEDARF</div>
                        )}
                      </>
                    )}
                  </div>
                </section>
              );
            })}

            {/* CQB column — squads (offered units) + soldier teams. A squad is a
                need, so it shows here as its own team, next to single-soldier teams. */}
            {(
              <section style={{ minWidth: 0 }} data-testid="cqb-squads">
                <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "1rem" }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.78rem", letterSpacing: "0.12em", color: "var(--gold)", whiteSpace: "nowrap" }}>
                    <Ic name="fps" size={16} /> BODENTRUPPEN / CQB
                  </span>
                  <span style={{ flex: 1, height: 1, background: "var(--border-hi)" }} />
                  {cqbNeedCount != null && (
                    <span style={{ fontFamily: MONO, fontSize: "0.74rem", whiteSpace: "nowrap", color: cqbProvidedTeams >= cqbNeedCount ? "var(--green)" : "var(--dim)" }}>
                      {cqbProvidedTeams}/{cqbNeedCount} Teams{cqbProvidedTeams > cqbNeedCount ? " (über)" : ""}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                  {/* Offered squads as their own CQB teams (members = seat holders). */}
                  {squadUnits.map((u) => unitCard(u, squadLane))}
                  {cqbGroupsShown.length > 0 && (
                    <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "var(--dim3)", marginTop: squadUnits.length ? "0.3rem" : 0 }}>EINZEL-SOLDATEN — FREIEN PLATZ NEHMEN</div>
                  )}
                  {cqbGroupsShown.map((tm) => {
                    const inTeam = !!me && tm.members.some((m) => m.id === me.id);
                    const full = tm.targetSize != null && tm.members.length >= tm.targetSize && !inTeam;
                    // Render the Trupp as N real slots — "2 Trupps à 4 Soldaten" must
                    // look like two tiles with four places, not a bare member list.
                    // Slot 0 is the Captain. Members without a slot (legacy rows) drop
                    // into the first free place so nobody disappears from the tile.
                    const slotted = new Map<number, (typeof tm.members)[number]>();
                    const loose: typeof tm.members = [];
                    for (const m of tm.members) {
                      if (m.slotIndex != null && !slotted.has(m.slotIndex)) slotted.set(m.slotIndex, m);
                      else loose.push(m);
                    }
                    const highest = slotted.size ? Math.max(...slotted.keys()) + 1 : 0;
                    const slotCount = Math.max(tm.targetSize ?? 0, highest, tm.members.length);
                    const slots: Array<(typeof tm.members)[number] | null> = [];
                    for (let i = 0; i < slotCount; i++) {
                      slots.push(slotted.get(i) ?? loose.shift() ?? null);
                    }
                    const carrier = tm.carrierUnitId ? op.units.find((u) => u.id === tm.carrierUnitId) : null;
                    return (
                      <article key={tm.id} data-testid={`cqb-squad-${tm.id}`} style={{ width: "100%", minWidth: 0, border: "1px solid var(--edge-gold)", borderTop: "2px solid var(--edge-gold)", borderRadius: 13, background: "var(--row)", padding: "1.1rem 1.2rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
                          <span style={{ width: 38, height: 38, borderRadius: 10, background: "var(--tint-gold)", border: "1px solid var(--edge-gold)", color: "var(--gold)", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name="fps" size={18} sw={1.6} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ fontSize: "1.02rem", color: "var(--text-hi)" }}>{tm.name}</strong>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.35rem", flexWrap: "wrap", marginTop: 2 }}>
                              <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim3)" }}>BODENTRUPPE</span>
                              {verbandChip(tm.parentId)}
                              {carrier && (
                                <span data-testid={`cqb-carrier-${tm.id}`} style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.06em", color: "var(--orange)", border: "1px solid var(--edge-gold)", background: "var(--tint-gold)", borderRadius: 4, padding: "0.05rem 0.3rem" }}>FÄHRT IN: {(carrier.shipName ?? carrier.name).toUpperCase()}</span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontFamily: MONO, fontSize: "1.05rem", color: "var(--text-hi)", flexShrink: 0 }}>{tm.members.length}<span style={{ color: "var(--dim3)" }}>/{tm.targetSize ?? "∞"}</span></span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: me && csrf ? "0.8rem" : 0 }}>
                          {slots.length === 0 && <div style={{ color: "var(--dim2)", fontSize: "0.82rem" }}>Noch keine Plätze definiert.</div>}
                          {slots.map((m, i) => (
                            <div key={m?.id ?? `free-${i}`} data-testid={`cqb-slot-${tm.id}-${i}`} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.86rem", color: m ? "var(--text)" : "var(--dim3)", padding: "0.3rem 0.4rem", borderRadius: 8, border: `1px ${m ? "solid" : "dashed"} rgba(217, 169, 78,${m ? 0.18 : 0.22})`, background: m ? "var(--tint-gold)" : "transparent" }}>
                              {/* Slot 1 is always the Captain — squad-link capable. */}
                              <span style={{ fontFamily: MONO, fontSize: "0.58rem", color: i === 0 ? "var(--gold)" : "var(--dim3)", width: 26, flexShrink: 0 }}>{i === 0 ? "CPT" : `#${i + 1}`}</span>
                              {m ? (
                                <>
                                  <Avatar name={m.username} />
                                  <span style={{ flex: 1, minWidth: 0 }}>{m.username}{me && m.id === me.id ? <span style={{ color: "var(--green)", fontFamily: MONO, fontSize: "0.6rem" }}> · DU</span> : null}</span>
                                  {i === 0 && captainTag}
                                  <LateArrival eta={m.lateEta} canEdit={false} onSet={() => {}} />
                                </>
                              ) : (
                                <span style={{ flex: 1, minWidth: 0, fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em" }}>{i === 0 ? "CAPTAIN — FREI" : "FREI"}</span>
                              )}
                            </div>
                          ))}
                        </div>
                        {me && csrf && (
                          inTeam ? (
                            <button type="button" data-testid={`cqb-leave-${tm.id}`} onClick={() => run(() => cqbWithdraw(id!, csrf!))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.8rem", border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}>Squad verlassen</button>
                          ) : canJoin ? (
                            <button type="button" data-testid={`cqb-join-${tm.id}`} disabled={full} onClick={() => run(() => cqbSignup(id!, csrf!, { groupId: tm.id }))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.9rem", border: `1px solid ${full ? "var(--wash)" : "var(--edge-gold)"}`, background: full ? "transparent" : "var(--tint-gold)", color: full ? "var(--dim3)" : "var(--gold)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: full ? "default" : "pointer" }}>{full ? "Voll" : <>Platz nehmen <Ic name="arrow" size={13} sw={1.8} /></>}</button>
                          ) : null
                        )}
                      </article>
                    );
                  })}
                  {squadUnits.length === 0 && cqbGroupsShown.length === 0 && (
                    <div data-testid="lane-empty-cqb" style={{ border: "1px dashed var(--wash)", borderRadius: 13, background: "var(--wash)", padding: "1.4rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.08em", color: "var(--dim3)" }}>KEIN BEDARF</div>
                  )}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {/* The series this op belongs to. Only the occurrences inside the spawn
          horizon exist as operations; the rest are computed by the backend and
          marked as such, so the page tells the same story as the Discord event. */}
      {op.recurrence && (
        <section data-testid="op-series" style={{ border: `1px solid ${tint("var(--cyan)", 30)}`, borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.3rem", marginTop: "1.6rem" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", flexWrap: "wrap", marginBottom: "0.7rem" }}>
            <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="swap" size={16} sw={1.7} /></span>
            <span style={{ ...monoLabel(), color: "var(--text-hi)" }}>{t("series.title").toUpperCase()}</span>
            <span style={{ color: "var(--cyan)", fontSize: "0.86rem" }}>{seriesPattern(op.recurrence, t)}</span>
            {!op.recurrence.active && (
              <span style={{ color: "var(--dim)", fontSize: "0.8rem" }}>{t("series.stopped")}</span>
            )}
          </div>

          {op.recurrence.upcoming.length > 0 && (
            <>
              <div style={{ ...monoLabel(), color: "var(--dim2)", marginBottom: "0.45rem" }}>{t("series.upcoming").toUpperCase()}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                {op.recurrence.upcoming.map((u) =>
                  u.opId ? (
                    <Link
                      key={u.at}
                      to={`/ops/${u.opId}`}
                      data-testid={`series-date-${u.at}`}
                      style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", fontSize: "0.86rem", color: "var(--text)", textDecoration: "none", borderBottom: "1px solid var(--wash)", paddingBottom: "0.28rem" }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: "0.78rem", color: "var(--text-hi)" }}>{fmtDate(u.at, op.guild.timezone)}</span>
                      <span style={{ color: "var(--cyan)", fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.07em" }}>OPEN →</span>
                    </Link>
                  ) : (
                    <div
                      key={u.at}
                      data-testid={`series-date-${u.at}`}
                      style={{ display: "flex", alignItems: "baseline", gap: "0.6rem", fontSize: "0.86rem", color: "var(--dim)", borderBottom: "1px solid var(--wash)", paddingBottom: "0.28rem" }}
                    >
                      <span style={{ fontFamily: MONO, fontSize: "0.78rem" }}>{fmtDate(u.at, op.guild.timezone)}</span>
                      <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.07em", color: "var(--dim3)" }}>{t("series.planned").toUpperCase()}</span>
                    </div>
                  ),
                )}
              </div>
            </>
          )}

          <div style={{ marginTop: "0.7rem", display: "flex", flexWrap: "wrap", gap: "0.3rem 1rem", color: "var(--dim2)", fontSize: "0.76rem" }}>
            <span>{t("series.leadHint", { days: Math.round(op.recurrence.leadTimeHours / 24) })}</span>
            {op.recurrence.seriesEnd && <span>{t("series.endsOn", { date: fmtShort(op.recurrence.seriesEnd, op.guild.timezone) })}</span>}
            {op.recurrence.seriesCount != null && (
              <span>{t("series.countLeft", { n: Math.max(0, op.recurrence.seriesCount - op.recurrence.spawnedCount), total: op.recurrence.seriesCount })}</span>
            )}
          </div>
        </section>
      )}

      {/* Mission log — deliberately NOT operator-gated. Every roster change is
          recorded, so a participant can check when they were put into a Verband,
          moved to another slot or had their ship accepted. Collapsed by default. */}
      {op.auditLogs.length > 0 && (
        <section data-testid="mission-log" style={{ border: "1px solid var(--wash)", borderRadius: 14, background: "var(--bg2)", padding: "1.1rem 1.3rem", marginTop: "1.6rem" }}>
          <button
            type="button"
            data-testid="mission-log-toggle"
            onClick={() => setLogOpen((v) => !v)}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", width: "100%", background: "transparent", border: "none", padding: 0, cursor: "pointer", color: "inherit", fontFamily: "inherit" }}
          >
            <span style={{ ...monoLabel(), color: "var(--dim2)" }}>MISSIONS-LOG</span>
            <span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--dim3)" }}>{op.auditLogs.length}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", transform: logOpen ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", color: "var(--dim3)" }}><Ic name="chevron" size={15} sw={2} /></span>
          </button>
          {logOpen && (
            <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem", marginTop: "0.8rem" }}>
              {op.auditLogs.map((a, i) => (
                <div key={`${a.createdAt}-${i}`} style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", fontSize: "0.8rem", color: "var(--dim)", borderBottom: "1px solid var(--wash)", paddingBottom: "0.25rem" }}>
                  <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)", flexShrink: 0 }}>{new Date(a.createdAt).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                  <span style={{ color: "var(--text)", flexShrink: 0 }}>{a.actor}</span>
                  <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--cyan)", flexShrink: 0 }}>{a.action}</span>
                  <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.detail}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* FR-B7: Q&A — any logged-in viewer asks; operators answer in the console */}
      {me && id && (
        <section data-testid="qa-section" style={{ border: "1px solid var(--border)", borderRadius: 14, background: "var(--bg2)", padding: "1.2rem 1.3rem", marginTop: "1.6rem" }}>
          <div style={monoLabel({ marginBottom: "0.8rem" })}>{t("qa.title").toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: csrf ? "0.9rem" : 0 }}>
            {op.questions.length === 0 && <div style={{ color: "var(--dim2)", fontSize: "0.85rem" }}>{t("qa.empty")}</div>}
            {op.questions.map((q) => (
              <div key={q.id} style={{ border: "1px solid var(--wash)", borderRadius: 9, padding: "0.6rem 0.7rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}><Avatar name={q.asker} /><strong style={{ fontSize: "0.82rem", color: "var(--text-hi)" }}>{q.asker}</strong></div>
                <div style={{ color: "var(--text)", fontSize: "0.88rem", lineHeight: 1.4, marginBottom: q.answer ? "0.45rem" : "0.3rem" }}>{q.body}</div>
                {q.answer ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", padding: "0.45rem 0.55rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", borderRadius: 8 }}>
                    <span style={{ color: "var(--green)", display: "inline-flex", flexShrink: 0, marginTop: 2 }}><Ic name="check" size={13} sw={2} /></span>
                    <div style={{ minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "var(--green)" }}>{t("qa.answeredBy", { who: q.answeredBy ?? "" })}</span><div style={{ color: "var(--text)", fontSize: "0.84rem", lineHeight: 1.4 }}>{q.answer}</div></div>
                  </div>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", color: "var(--dim2)" }}>{t("qa.unanswered")}</span>
                )}
              </div>
            ))}
          </div>
          {csrf && (
            <div style={{ display: "flex", gap: "0.4rem", alignItems: "flex-end" }}>
              <textarea
                data-testid="qa-input"
                value={qDraft}
                onChange={(e) => setQDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submitQuestion(); } }}
                placeholder={t("qa.placeholder")}
                style={{ flex: 1, minWidth: 0, minHeight: 38, background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.9rem", padding: "0.5rem 0.6rem", borderRadius: 8, outline: "none", resize: "vertical" }}
              />
              <button type="button" data-testid="qa-send" disabled={!qDraft.trim()} onClick={() => void submitQuestion()} style={{ flexShrink: 0, padding: "0.55rem 0.9rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 8, cursor: "pointer" }}>{t("qa.send")}</button>
            </div>
          )}
        </section>
      )}

      {/* SquadLink Lite voice deep-link for commanders (CommandNet). Visible to
          op managers once the op enables voice; the join link itself only
          materialises server-side after the op has started. */}
      {op.canManage && op.squadLinkVoiceEnabled && viewAs === "self" && id && (
        <SquadLinkPanel opId={id} />
      )}

      {/* IA merge D: adaptive operator console — only for leaders of this op,
          and hidden while previewing as guest/crew (FR-A5). */}
      {op.canManage && viewAs === "self" && id && (
        <OperatorConsole
          op={op}
          opId={id}
          csrf={csrf}
          reload={load}
          initialFlash={searchParams.get("flash")}
        />
      )}

      {/* Cover lightbox overlay — click anywhere / Esc to close. */}
      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          data-testid="cover-lightbox"
          onClick={() => setLightbox(false)}
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(18, 20, 22,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 3vw", cursor: "zoom-out" }}
        >
          <img
            src={op.coverUrl ?? heroImg}
            alt={`Operation ${op.title}`}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "94vh", objectFit: "contain", borderRadius: 10, border: "1px solid var(--border)", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}
          />
          <button
            type="button"
            data-testid="cover-lightbox-close"
            onClick={() => setLightbox(false)}
            style={{ position: "fixed", top: "2vh", right: "2vw", width: 36, height: 36, borderRadius: 9, border: "1px solid var(--border)", background: "rgba(18, 20, 22,0.8)", color: "var(--text-hi)", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <Ic name="x" size={18} sw={2} />
          </button>
        </div>
      )}
    </article>
  );
}

// FR-P3 Phase B: streamer links on an op (self-service). Any logged-in viewer
// adds their own stream; the owner or an operator can remove it.
const STREAM_META: Record<string, { icon: string; label: string; color: string }> = {
  twitch: { icon: "twitch", label: "Twitch", color: "var(--purple)" },
  youtube: { icon: "youtube", label: "YouTube", color: "var(--red)" },
  vdo_ninja: { icon: "stream", label: "VDO.Ninja", color: "var(--cyan)" },
  other: { icon: "stream", label: "Stream", color: "var(--dim)" },
};

function StreamsSection({
  op,
  csrf,
  meId,
  canManage,
  onChanged,
}: {
  op: OperationDetail;
  csrf: string | null;
  meId: string | null;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [platform, setPlatform] = useState<"twitch" | "youtube" | "vdo_ninja" | "other">("twitch");
  const [url, setUrl] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const streams = op.streams ?? [];
  // Show for stream-events or when streams already exist; the add form needs a login.
  if (!op.isStreamEvent && streams.length === 0 && !meId) return null;

  async function add() {
    if (!csrf || !url.trim() || busy) return;
    setBusy(true);
    setErr(null);
    try {
      await addStream(op.id, csrf, { platform, url: url.trim(), label: label.trim() || undefined });
      setUrl("");
      setLabel("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : "Hinzufügen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  async function del(id: string) {
    if (!csrf) return;
    try {
      await removeStream(op.id, id, csrf);
      onChanged();
    } catch {
      /* ignore */
    }
  }

  const inp: React.CSSProperties = { boxSizing: "border-box", background: "var(--bg3)", border: "1px solid var(--border)", color: "var(--text)", fontFamily: "var(--body)", fontSize: "0.88rem", padding: "0.45rem 0.6rem", borderRadius: 7, outline: "none" };

  return (
    <div data-testid="op-streams" style={{ marginTop: "1.1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", margin: "0 0 0.55rem" }}>
        <span style={monoLabel({ fontSize: "0.7rem" })}>STREAMS</span>
        <span style={{ color: "#9146ff", display: "inline-flex" }}><Ic name="stream" size={13} sw={1.7} /></span>
        {streams.length > 0 && <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "var(--dim3)" }}>{streams.length}</span>}
      </div>

      {streams.length === 0 ? (
        <p style={{ margin: "0 0 0.5rem", color: "var(--dim2)", fontSize: "0.86rem" }}>Noch keine Streams. Streamst du diese Operation?</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: "0.5rem" }}>
          {streams.map((s) => {
            const m = STREAM_META[s.platform] ?? STREAM_META.other;
            const canDelete = (s.userId !== null && s.userId === meId) || canManage;
            return (
              <div key={s.id} data-testid={`op-stream-${s.id}`} style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                <span style={{ color: m.color, display: "inline-flex", flexShrink: 0 }}><Ic name={m.icon} size={15} sw={1.7} /></span>
                <a href={s.url} target="_blank" rel="noopener noreferrer" style={{ flex: 1, minWidth: 0, color: "var(--text-hi)", textDecoration: "none", fontSize: "0.9rem", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {s.label || m.label}{s.username ? <span style={{ color: "var(--dim3)" }}> · {s.username}</span> : null} <span style={{ color: "var(--cyan)" }}>↗</span>
                </a>
                {canDelete && (
                  <button type="button" data-testid={`op-stream-del-${s.id}`} title="Entfernen" onClick={() => del(s.id)} style={{ flexShrink: 0, width: 22, height: 22, borderRadius: 6, border: "1px solid var(--edge-red)", background: "var(--tint-red)", color: "var(--red)", display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
                    <Ic name="x" size={12} sw={2} />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {meId && (open ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem", alignItems: "center" }}>
          <select data-testid="op-stream-platform" value={platform} onChange={(e) => setPlatform(e.target.value as typeof platform)} style={{ ...inp, flex: "0 0 auto" }}>
            <option value="twitch">Twitch</option>
            <option value="youtube">YouTube</option>
            <option value="vdo_ninja">VDO.Ninja</option>
            <option value="other">Andere</option>
          </select>
          <input data-testid="op-stream-url" type="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://twitch.tv/…" style={{ ...inp, flex: "1 1 200px" }} />
          <input data-testid="op-stream-label" type="text" maxLength={80} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (optional)" style={{ ...inp, flex: "1 1 130px" }} />
          <button type="button" data-testid="op-stream-add" disabled={busy || !url.trim()} onClick={add} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.45rem 0.8rem", border: "1px solid var(--edge-green)", background: "var(--tint-green)", color: "var(--green)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}>
            <Ic name="check" size={13} sw={1.8} /> Hinzufügen
          </button>
          <button type="button" onClick={() => { setOpen(false); setErr(null); }} style={{ flexShrink: 0, padding: "0.45rem 0.7rem", border: "1px solid var(--wash)", background: "transparent", color: "var(--dim)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}>Abbrechen</button>
          {err && <span style={{ flexBasis: "100%", color: "var(--red)", fontSize: "0.78rem" }}>{err}</span>}
        </div>
      ) : (
        <button type="button" data-testid="op-stream-open" onClick={() => setOpen(true)} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.45rem 0.8rem", border: "1px solid var(--border-hi)", background: "var(--wash)", color: "var(--cyan)", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 7, cursor: "pointer" }}>
          <Ic name="stream" size={13} sw={1.7} /> Ich streame das
        </button>
      ))}
    </div>
  );
}
