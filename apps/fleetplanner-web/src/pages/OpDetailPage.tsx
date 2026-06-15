import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import {
  ApiError,
  askQuestion,
  claimSeat,
  cqbSignup,
  cqbWithdraw,
  getNeeds,
  getOperation,
  patchSeat,
  setHangarShare,
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
import { Markdown } from "../components/Markdown";

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

// design: category lanes with accent color + rgb (for borders/washes)
const LANES = [
  { type: "ship", label: "SCHIFFE & CREW", icon: "ship", accent: "#00d4ff", rgb: "0,212,255" },
  { type: "fighter", label: "JÄGER", icon: "fighter", accent: "#a78bfa", rgb: "167,139,250" },
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "#f0a500", rgb: "240,165,0" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "#ff7a45", rgb: "255,122,69" },
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
  fest: { text: "FEST", style: { ...TAG_BASE, color: "#9fb6c9", borderColor: "rgba(159,182,201,0.34)", background: "rgba(159,182,201,0.07)" } },
  typ: { text: "TYP", style: { ...TAG_BASE, color: "#f0a500", borderColor: "rgba(240,165,0,0.44)", background: "rgba(240,165,0,0.09)" } },
  rolle_offen: { text: "ROLLE OFFEN", style: { ...TAG_BASE, color: "#00ff88", borderColor: "rgba(0,255,136,0.4)", background: "rgba(0,255,136,0.08)" } },
  frei: { text: "FREI", style: { ...TAG_BASE, color: "#9fb6c9", borderColor: "rgba(159,182,201,0.34)", borderStyle: "dashed", background: "transparent" } },
} as const;

const monoLabel = (extra?: React.CSSProperties): React.CSSProperties => ({
  fontFamily: MONO,
  fontSize: "0.72rem",
  letterSpacing: "0.14em",
  color: "#9fb1c2",
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
  const lanes = LANES.filter((l) => l.type !== "squad").map((l) => {
    const units = accepted.filter((u) => laneOf(u) === l.type);
    const placeholders: string[] =
      l.type === "ship" ? shipReqUnfilled.map((r) => r.label || r.category || "Schiff")
      : l.type === "fighter" ? Array.from({ length: fighterEmpty }, () => "Jäger")
      : [];
    return { ...l, units, placeholders };
  });
  const filled = accepted.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
  const pct = op.minParticipants > 0 ? Math.min(100, Math.round((filled / op.minParticipants) * 100)) : 0;
  const canJoin = !!me && !!csrf && op.status === "open";
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
    color: "#9fb1c2",
    transition: "all .14s",
  };

  const infoRow = (icon: string, lab: string, val: string) => (
    <div key={lab} style={{ display: "flex", alignItems: "center", gap: "0.7rem" }}>
      <span
        style={{
          width: 30,
          height: 30,
          borderRadius: 7,
          background: "#0e1926",
          border: "1px solid rgba(0,212,255,0.12)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          color: "#9fb1c2",
        }}
      >
        <Ic name={icon} size={15} sw={1.6} />
      </span>
      <span>
        <span style={{ display: "block", fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#5b6b7a" }}>{lab}</span>
        <span style={{ color: "#ccdde8", fontSize: "0.92rem" }}>{val}</span>
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
          background: "rgba(255,255,255,0.013)",
          border: "1px solid rgba(0,212,255,0.08)",
          borderRadius: 9,
          minWidth: 0,
        }}
      >
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 7,
            background: "#0e1926",
            border: "1px solid rgba(255,255,255,0.06)",
            color: "#9fb1c2",
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
            <strong style={{ fontWeight: 600, fontSize: "0.98rem", color: "#dce8f0" }}>{s.label}</strong>
            <span style={TAGS.fest.style}>{TAGS.fest.text}</span>
          </div>
        </div>
        {s.claimedBy ? (
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0, minWidth: 0 }}>
            <Avatar name={s.claimedBy.username} />
            <span style={{ fontSize: "0.86rem", color: "#ccdde8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "11rem" }}>
              {s.claimedBy.username}
            </span>
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
              border: "1px solid rgba(0,212,255,0.32)",
              background: "rgba(0,212,255,0.05)",
              color: "#00d4ff",
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
    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: "0.6rem", padding: "0.5rem 0.65rem", background: "rgba(255,255,255,0.013)", border: "1px solid rgba(0,212,255,0.08)", borderRadius: 9, opacity: s.active ? 1 : 0.55 }}>
      <span style={{ width: 28, height: 28, borderRadius: 7, background: "#0e1926", border: "1px solid rgba(255,255,255,0.06)", color: "#9fb1c2", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
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
          <span style={{ fontSize: "0.82rem", color: "#ccdde8", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "8rem" }}>{s.claimedBy.username}</span>
        </div>
      ) : (
        <button type="button" data-testid={`cap-seat-toggle-${s.id}`} title={s.active ? "Sitz deaktivieren" : "Sitz aktivieren"} disabled={busySeat === s.id} onClick={() => run(() => patchSeat(id!, s.id, csrf!, { active: !s.active }))} style={{ flexShrink: 0, fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.05em", padding: "0.18rem 0.42rem", borderRadius: 5, cursor: "pointer", border: s.active ? "1px solid rgba(255,255,255,0.12)" : "1px solid rgba(0,255,136,0.4)", background: s.active ? "transparent" : "rgba(0,255,136,0.08)", color: s.active ? "#7e92a4" : "#00ff88" }}>{s.active ? "AUS" : "AN"}</button>
      )}
    </div>
  );

  const entryCard = (
    rgb: string,
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
        border: `1px solid rgba(${rgb},0.2)`,
        borderRadius: 11,
        background: `rgba(${rgb},0.04)`,
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
          background: `rgba(${rgb},0.13)`,
          border: `1px solid rgba(${rgb},0.28)`,
          color,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          marginBottom: "0.9rem",
        }}
      >
        <Ic name={icon} size={19} sw={1.6} />
      </span>
      <div style={{ fontWeight: 700, fontSize: "1.1rem", color: "#eaf4fb", marginBottom: "0.3rem" }}>{title}</div>
      <div style={{ color: "#9fb1c2", fontSize: "0.88rem", marginBottom: "0.9rem", lineHeight: 1.5 }}>{sub}</div>
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
    return (
      <article
        key={u.id}
        data-testid="unit-card"
        style={{ width: "100%", minWidth: 0, border: `1px solid rgba(${lane.rgb},0.16)`, borderTop: `2px solid rgba(${lane.rgb},0.5)`, borderRadius: 13, background: "#0a1018", padding: "1.15rem 1.2rem" }}
      >
        <div onClick={() => setCollapsed((c) => ({ ...c, [u.id]: !c[u.id] }))} style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem", cursor: "pointer" }}>
          <span style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: `rgba(${lane.rgb},0.13)`, border: `1px solid rgba(${lane.rgb},0.28)`, color: lane.accent }}>
            <Ic name={lane.icon} size={20} sw={1.6} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
              <strong style={{ fontWeight: 700, fontSize: "1.12rem", color: "#eaf4fb", lineHeight: 1.2 }}>{u.name}</strong>
              {full && (
                <span style={{ ...TAG_BASE, fontSize: "9.5px", color: "#00ff88", borderColor: "rgba(0,255,136,0.4)", background: "rgba(0,255,136,0.08)", gap: 4, padding: "2px 8px" }}>
                  <Ic name="check" size={12} sw={2} /> VOLL
                </span>
              )}
            </div>
            <div style={{ color: "#9fb1c2", fontSize: "0.86rem", marginTop: "0.15rem" }}>
              {u.unitType}{u.captain ? ` · Captain: ${u.captain.username}` : ""}
            </div>
          </div>
          <div style={{ textAlign: "right", flexShrink: 0 }}>
            <div style={{ fontFamily: MONO, fontSize: "1.05rem", color: "#eaf4fb", lineHeight: 1 }}>{uFilled}<span style={{ color: "#5b6b7a" }}>/{u.seats.length}</span></div>
            <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "#5b6b7a", marginTop: "0.25rem" }}>BESETZT</div>
          </div>
          {me && csrf && u.captain?.id === me.id && (
            <button type="button" data-testid={`withdraw-unit-${u.id}`} title="Mein Schiff zurückziehen" onClick={(e) => { e.stopPropagation(); if (window.confirm("Dein Schiff aus dieser Operation zurückziehen?")) run(() => withdrawUnit(id!, u.id, csrf)); }} style={{ flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5, padding: "0.35rem 0.6rem", border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", fontFamily: MONO, fontSize: "0.66rem", borderRadius: 7, cursor: "pointer" }}>
              <Ic name="x" size={12} sw={2} /> Zurückziehen
            </button>
          )}
          <span style={{ display: "inline-flex", flexShrink: 0, transform: expanded ? "rotate(90deg)" : "rotate(0deg)", transition: "transform .15s", color: "#5b6b7a" }}>
            <Ic name="chevron" size={16} sw={2} />
          </span>
        </div>
        {expanded && (
          <div style={{ marginTop: "1rem" }}>
            {u.captainNote && (
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#9fb1c2", fontSize: "0.86rem", marginBottom: "0.9rem" }}>
                <span style={{ color: "#f0a500", display: "inline-flex", flexShrink: 0 }}><Ic name="bolt" size={15} /></span>
                <span style={{ fontStyle: "italic" }}>{u.captainNote}</span>
              </div>
            )}
            {me && csrf && u.captain?.id === me.id ? (
              <>
                <div style={{ fontFamily: MONO, fontSize: "0.58rem", letterSpacing: "0.1em", color: "#5b6b7a", marginBottom: "0.5rem" }}>DEINE SITZE · UMBENENNEN / AKTIVIEREN</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{u.seats.map((s) => captainSeatRow(u, s))}</div>
              </>
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
    <article key={key} data-testid="need-slot" style={{ width: "100%", minWidth: 0, border: `1px dashed rgba(${lane.rgb},0.4)`, borderRadius: 13, background: "rgba(255,255,255,0.012)", padding: "1rem 1.15rem", opacity: 0.92 }}>
      <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
        <span style={{ width: 42, height: 42, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, background: `rgba(${lane.rgb},0.07)`, border: `1px dashed rgba(${lane.rgb},0.4)`, color: lane.accent }}>
          <Ic name={lane.icon} size={19} sw={1.5} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong style={{ fontWeight: 700, fontSize: "1rem", color: "#c2d2de" }}>{label}</strong>
          <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.08em", color: lane.accent, marginTop: "0.2rem" }}>BEDARF · UNERFÜLLT</div>
        </div>
        <span style={{ fontFamily: MONO, fontSize: "0.62rem", color: "#5b6b7a", flexShrink: 0, whiteSpace: "nowrap" }}>noch kein Schiff</span>
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

  return (
    <article>
      {/* FR-A5: operator preview switcher — see the page as guest / crew / self. */}
      {op.canManage && (
        <div data-testid="viewas-bar" style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap", marginBottom: "1rem", padding: "0.55rem 0.75rem", border: "1px solid rgba(0,212,255,0.18)", background: "rgba(0,212,255,0.04)", borderRadius: 10 }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontFamily: MONO, fontSize: "0.64rem", letterSpacing: "0.1em", color: "#9fb1c2" }}>
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
                style={{ padding: "0.3rem 0.7rem", borderRadius: 7, cursor: "pointer", fontFamily: MONO, fontSize: "0.7rem", border: on ? "1px solid rgba(0,212,255,0.5)" : "1px solid rgba(255,255,255,0.12)", background: on ? "rgba(0,212,255,0.14)" : "transparent", color: on ? "#00d4ff" : "#9fb1c2" }}
              >
                {lab}
              </button>
            );
          })}
          {viewAs !== "self" && (
            <span style={{ marginLeft: "auto", fontFamily: MONO, fontSize: "0.62rem", color: "#f0a500" }}>VORSCHAU — keine Operator-Steuerung</span>
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
                border: "1px solid rgba(0,255,136,0.4)",
                color: "#00ff88",
                background: "rgba(0,255,136,0.08)",
                fontFamily: MONO,
                fontSize: "0.66rem",
                letterSpacing: "0.08em",
                padding: "0.2rem 0.55rem",
                borderRadius: 4,
                textTransform: "uppercase",
              }}
            >
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#00ff88", boxShadow: "0 0 8px #00ff88" }} />
              {op.status}
            </span>
            <span
              style={{
                border: "1px solid rgba(0,212,255,0.38)",
                color: "#00d4ff",
                background: "rgba(0,212,255,0.08)",
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
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "#9fb1c2", fontFamily: MONO, fontSize: "0.66rem", letterSpacing: "0.06em", padding: "0.2rem" }}>
              <Ic name="clock" size={13} />
              {fmtDate(op.scheduledAt, op.guild.timezone).toUpperCase()}
            </span>
          </div>
          <h1 style={{ fontWeight: 700, fontSize: "2.1rem", lineHeight: 1.12, color: "#eaf4fb", margin: "0 0 0.7rem", letterSpacing: "0.01em" }} data-testid="op-title">
            {op.title}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem 1.3rem", color: "#9fb1c2", fontSize: "0.92rem" }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="pin" size={15} sw={1.6} /></span>
              {op.meetingLocation}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="globe" size={15} sw={1.6} /></span>
              {op.meetingSystem}
            </span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#00d4ff", display: "inline-flex" }}><Ic name="users" size={15} sw={1.6} /></span>
              {filled} angemeldet · min {op.minParticipants}
            </span>
          </div>

          {/* MISSION OBJECTIVE — part of the hero */}
          <div style={{ marginTop: "1.1rem", paddingTop: "1.1rem", borderTop: "1px solid rgba(0,212,255,0.1)" }}>
            <div style={monoLabel({ marginBottom: "0.45rem" })}>MISSION OBJECTIVE</div>
            {op.description ? (
              <Markdown text={op.description} style={{ fontSize: "0.95rem" }} />
            ) : (
              <p style={{ margin: 0, color: "#7e92a4" }}>Kein Missionsziel hinterlegt.</p>
            )}
            {op.resourceLinks.length > 0 && (
              <>
                <div style={monoLabel({ margin: "1rem 0 0.55rem", fontSize: "0.7rem" })}>BRIEFING / LINKS</div>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                  {op.resourceLinks.map((l) => (
                    <a key={l.id} href={l.url} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", color: "#00d4ff", textDecoration: "none", fontSize: "0.92rem" }}>
                      {l.title} <span style={{ color: "#5b6b7a" }}>↗</span>
                    </a>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* right column: ANMELDUNGEN box (left) + banner image (right), same height.
            The box drives the row height; the image fills it with object-fit cover
            (cropped, never squished). Wraps to stacked on narrow screens. */}
        <div style={{ flex: "1 1 420px", minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "row", flexWrap: "wrap", gap: "1rem", alignItems: "stretch" }}>
          <div style={{ flex: "1 1 220px", minWidth: 0, border: "1px solid rgba(0,212,255,0.13)", borderRadius: 12, background: "rgba(9,15,24,0.55)", padding: "0.85rem 1rem" }}>
            <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: "0.5rem" }}>
              <span style={monoLabel()}>ANMELDUNGEN</span>
              <span style={{ fontFamily: MONO, fontSize: "1.1rem", color: "#eaf4fb" }}>
                <strong style={{ color: "#f0a500" }}>{filled}</strong> <span style={{ color: "#5b6b7a" }}>/ {op.minParticipants}</span>
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 5, background: "#0e1926", overflow: "hidden", marginBottom: "0.4rem" }}>
              <div style={{ height: "100%", width: `${pct}%`, borderRadius: 5, background: "linear-gradient(90deg,#f0a500,#f5c451)" }} />
            </div>
            <div style={{ color: "#9fb1c2", fontSize: "0.8rem", marginBottom: "0.6rem" }}>
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
                  color: "#c7ccf8",
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
          <button type="button" data-testid="cover-open" title="Cover vergrößern" onClick={() => setLightbox(true)} style={{ flex: "2 1 320px", minWidth: 0, aspectRatio: "16 / 9", border: "1px solid rgba(0,212,255,0.18)", borderRadius: 10, overflow: "hidden", background: "#0a1622", padding: 0, cursor: "zoom-in" }}>
            <img src={op.coverUrl ?? heroImg} alt={`Operation ${op.title}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </button>
        </div>
      </section>

      {/* What the mission needs — visible to crew for planning (read-only). */}
      {needs && (needs.shipNeeds.length > 0 || needs.fighterSquads > 0 || needs.cqbTeams.count > 0) && (
        <section data-testid="needs-overview" style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 12, background: "rgba(9,15,24,0.55)", padding: "1rem 1.2rem", marginBottom: "1.4rem" }}>
          <div style={monoLabel({ marginBottom: "0.7rem" })}>GESUCHT — WAS DIE MISSION BRAUCHT</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.5rem" }}>
            {needs.shipNeeds.map((s) => {
              const bound = accepted.filter((u) => u.requirementId === s.id).length;
              return (
                <span key={s.id} data-testid={`need-chip-${s.id}`} style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: `1px solid ${bound > 0 ? "rgba(0,255,136,0.35)" : "rgba(0,212,255,0.25)"}`, background: bound > 0 ? "rgba(0,255,136,0.06)" : "rgba(0,212,255,0.05)", color: "#dce8f0" }}>
                  <span style={{ color: bound > 0 ? "#00ff88" : "#00d4ff", display: "inline-flex" }}><Ic name={bound > 0 ? "check" : "ship"} size={13} sw={1.8} /></span>
                  {s.label}
                </span>
              );
            })}
            {needs.fighterSquads > 0 && (
              <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: "1px solid rgba(167,139,250,0.3)", background: "rgba(167,139,250,0.06)", color: "#dce8f0" }}>
                <span style={{ color: "#a78bfa", display: "inline-flex" }}><Ic name="fighter" size={13} sw={1.8} /></span>
                {needs.fighterSquads} Jäger-Staffel{needs.fighterSquads === 1 ? "" : "n"} · je {needs.fighterSquadSize} Piloten
              </span>
            )}
            {needs.cqbTeams.count > 0 && (() => {
              const covered = cqbProvidedTeams >= needs.cqbTeams.count;
              return (
                <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "0.3rem 0.6rem", borderRadius: 7, fontSize: "0.8rem", border: `1px solid ${covered ? "rgba(0,255,136,0.35)" : "rgba(240,165,0,0.3)"}`, background: covered ? "rgba(0,255,136,0.06)" : "rgba(240,165,0,0.06)", color: "#dce8f0" }}>
                  <span style={{ color: covered ? "#00ff88" : "#f0a500", display: "inline-flex" }}><Ic name={covered ? "check" : "fps"} size={13} sw={1.8} /></span>
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


      {me && (
        <div style={{ marginBottom: "1.8rem", display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap" }}>
          {op.signupState === "joined" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", color: "#00ff88", fontSize: "0.88rem" }}>
              <Ic name="check" size={15} /> Du bist Teilnehmer.
            </span>
          )}
          {/* Calendar export (.ics) — backend route, proxied by nginx. */}
          <a
            href={`${import.meta.env.BASE_URL}ops/${id}/calendar.ics`}
            data-testid="calendar-export"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", color: "#00d4ff", textDecoration: "none", fontFamily: MONO, fontSize: "0.74rem", border: "1px solid rgba(0,212,255,0.3)", borderRadius: 8, padding: "0.4rem 0.75rem" }}
          >
            <Ic name="cal" size={14} sw={1.7} /> Im Kalender speichern
          </a>
        </div>
      )}

      {(
        <>
          {/* MITMACHEN — three entry cards */}
          {canJoin && (
            <section data-testid="join-card" style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 14, background: "#090f18", padding: "1.6rem 1.7rem", marginBottom: "1.6rem" }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: "0.7rem", flexWrap: "wrap", marginBottom: "0.4rem" }}>
                <h2 style={{ fontWeight: 700, fontSize: "1.45rem", color: "#eaf4fb", margin: 0 }}>Mitmachen</h2>
                <span style={{ color: "#9fb1c2", fontSize: "0.95rem" }}>Wie willst du beitragen?</span>
              </div>
              <p style={{ margin: "0 0 1.3rem", color: "#9fb1c2", fontSize: "0.95rem", maxWidth: "62ch" }}>
                Du kannst mehrere Wege kombinieren — ein Schiff bringen <em>und</em> einen Sitz an Bord nehmen schließen sich nicht aus. Jeder Platz zeigt mit einem Tag, wie festgelegt er ist.
              </p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.9rem" }}>
                {entryCard("0,212,255", "#00d4ff", "ship", "Freien Platz nehmen", "Sieh die Flotte unten und klick auf einen offenen Sitz.", "Zur Flotte", () =>
                  fleetRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }),
                )}
                {entryCard("0,255,136", "#00ff88", "fighter", "Eigenes Schiff einbringen", "Bring eines deiner Schiffe — die Crew besetzt die Sitze.", "Schiff wählen", () => setOfferOpen((v) => !v), "offer-ship-open")}
                {op.viewerCqbSignedUp
                  ? entryCard("240,165,0", "#f0a500", "check", "Du bist flexibel angemeldet", "Der Operator teilt dich passend ein. Klick zum Zurückziehen.", "Zurückziehen", () => run(() => cqbWithdraw(id!, csrf!)), "cqb-withdraw")
                  : entryCard("240,165,0", "#f0a500", "swap", "Teilt mich ein", "Keine Lust zu wählen? Der Operator gibt dir einen Platz.", "Flexibel anmelden", () => run(() => cqbSignup(id!, csrf!)), "cqb-signup")}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.9rem", marginTop: "1.1rem" }}>
                <label style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", cursor: "pointer" }}>
                  <input
                    type="checkbox"
                    checked={op.viewerHangarShared}
                    data-testid="hangar-toggle"
                    onChange={(e) => run(() => setHangarShare(id!, csrf!, e.target.checked))}
                    style={{ accentColor: "#00d4ff", width: 18, height: 18 }}
                  />
                  <span style={{ color: "#9fb1c2", fontSize: "0.9rem", display: "inline-flex", alignItems: "center", gap: 5 }}>
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
              borderTop: "1px solid rgba(0,212,255,0.1)",
              borderBottom: "1px solid rgba(0,212,255,0.1)",
            }}
          >
            <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.1em", color: "#5b6b7a" }}>WIE FEST IST EIN PLATZ?</span>
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
                <span style={{ color: "#9fb1c2", fontSize: "0.8rem" }}>{desc}</span>
              </span>
            ))}
          </div>

          {/* CATEGORY BOARD — Schiffe / Jäger / CQB / Fahrzeuge as columns */}
          <div ref={fleetRef} style={{ width: "100%", display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(500px, 1fr))", gap: "1.3rem", alignItems: "start" }}>
            {lanes.length === 0 && op.cqbTeams.length === 0 && <p style={{ color: "#7e92a4" }}>Noch keine Einheiten.</p>}
            {lanes.map((lane) => {
              const laneFilled = lane.units.reduce((a, u) => a + u.seats.filter((s) => s.claimedBy).length, 0);
              const laneTotal = lane.units.reduce((a, u) => a + u.seats.length, 0);
              return (
                <section key={lane.type} style={{ flex: "1 1 290px", minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.7rem", marginBottom: "1rem" }}>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.78rem", letterSpacing: "0.12em", color: lane.accent, whiteSpace: "nowrap" }}>
                      <Ic name={lane.icon} size={16} />
                      {lane.label}
                    </span>
                    <span style={{ flex: 1, height: 1, background: `linear-gradient(90deg,rgba(${lane.rgb},0.4),transparent)` }} />
                    <span style={{ fontFamily: MONO, fontSize: "0.78rem", color: "#9fb1c2", whiteSpace: "nowrap" }}>
                      {laneFilled}/{laneTotal}
                    </span>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                    {lane.units.map((u) => unitCard(u, lane))}
                    {lane.placeholders.map((label, i) => emptyNeedCard(label, lane, `ph-${lane.type}-${i}`))}
                    {lane.units.length === 0 && lane.placeholders.length === 0 && (
                      <div data-testid={`lane-empty-${lane.type}`} style={{ border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 13, background: "rgba(255,255,255,0.012)", padding: "1.4rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.08em", color: "#5b6b7a" }}>KEIN BEDARF</div>
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
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", fontFamily: MONO, fontSize: "0.78rem", letterSpacing: "0.12em", color: "#f0a500", whiteSpace: "nowrap" }}>
                    <Ic name="fps" size={16} /> BODENTRUPPEN / CQB
                  </span>
                  <span style={{ flex: 1, height: 1, background: "linear-gradient(90deg,rgba(240,165,0,0.4),transparent)" }} />
                  {cqbNeedCount != null && (
                    <span style={{ fontFamily: MONO, fontSize: "0.74rem", whiteSpace: "nowrap", color: cqbProvidedTeams >= cqbNeedCount ? "#00ff88" : "#9fb1c2" }}>
                      {cqbProvidedTeams}/{cqbNeedCount} Teams{cqbProvidedTeams > cqbNeedCount ? " (über)" : ""}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
                  {/* Offered squads as their own CQB teams (members = seat holders). */}
                  {squadUnits.map((u) => unitCard(u, squadLane))}
                  {cqbGroupsShown.length > 0 && (
                    <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.08em", color: "#5b6b7a", marginTop: squadUnits.length ? "0.3rem" : 0 }}>EINZEL-SOLDATEN — FREIEN PLATZ NEHMEN</div>
                  )}
                  {cqbGroupsShown.map((tm) => {
                    const inTeam = !!me && tm.members.some((m) => m.id === me.id);
                    const full = tm.targetSize != null && tm.members.length >= tm.targetSize && !inTeam;
                    return (
                      <article key={tm.id} data-testid={`cqb-squad-${tm.id}`} style={{ width: "100%", minWidth: 0, border: "1px solid rgba(240,165,0,0.2)", borderTop: "2px solid rgba(240,165,0,0.5)", borderRadius: 13, background: "#0a1018", padding: "1.1rem 1.2rem" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.7rem" }}>
                          <span style={{ width: 38, height: 38, borderRadius: 10, background: "rgba(240,165,0,0.12)", border: "1px solid rgba(240,165,0,0.3)", color: "#f0a500", display: "inline-flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic name="fps" size={18} sw={1.6} /></span>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <strong style={{ fontSize: "1.02rem", color: "#eaf4fb" }}>{tm.name}</strong>
                            <div style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.06em", color: "#5b6b7a", marginTop: 1 }}>BODENTRUPPE</div>
                          </div>
                          <span style={{ fontFamily: MONO, fontSize: "1.05rem", color: "#eaf4fb", flexShrink: 0 }}>{tm.members.length}<span style={{ color: "#5b6b7a" }}>/{tm.targetSize ?? "∞"}</span></span>
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem", marginBottom: me && csrf ? "0.8rem" : 0 }}>
                          {tm.members.length === 0 && <div style={{ color: "#7e92a4", fontSize: "0.82rem" }}>Noch keine Soldaten.</div>}
                          {tm.members.map((m) => (
                            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.86rem", color: "#ccdde8" }}>
                              <Avatar name={m.username} /> {m.username}{me && m.id === me.id ? <span style={{ color: "#00ff88", fontFamily: MONO, fontSize: "0.6rem" }}> · DU</span> : null}
                            </div>
                          ))}
                        </div>
                        {me && csrf && (
                          inTeam ? (
                            <button type="button" data-testid={`cqb-leave-${tm.id}`} onClick={() => run(() => cqbWithdraw(id!, csrf!))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.8rem", border: "1px solid rgba(255,68,68,0.4)", background: "rgba(255,68,68,0.07)", color: "#ff6b6b", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: "pointer" }}>Squad verlassen</button>
                          ) : canJoin ? (
                            <button type="button" data-testid={`cqb-join-${tm.id}`} disabled={full} onClick={() => run(() => cqbSignup(id!, csrf!, { groupId: tm.id }))} style={{ display: "inline-flex", alignItems: "center", gap: 5, padding: "0.4rem 0.9rem", border: `1px solid ${full ? "rgba(255,255,255,0.12)" : "rgba(240,165,0,0.45)"}`, background: full ? "transparent" : "rgba(240,165,0,0.12)", color: full ? "#5b6b7a" : "#f0a500", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 8, cursor: full ? "default" : "pointer" }}>{full ? "Voll" : <>Platz nehmen <Ic name="arrow" size={13} sw={1.8} /></>}</button>
                          ) : null
                        )}
                      </article>
                    );
                  })}
                  {squadUnits.length === 0 && cqbGroupsShown.length === 0 && (
                    <div data-testid="lane-empty-cqb" style={{ border: "1px dashed rgba(255,255,255,0.1)", borderRadius: 13, background: "rgba(255,255,255,0.012)", padding: "1.4rem 1rem", textAlign: "center", fontFamily: MONO, fontSize: "0.68rem", letterSpacing: "0.08em", color: "#5b6b7a" }}>KEIN BEDARF</div>
                  )}
                </div>
              </section>
            )}
          </div>
        </>
      )}

      {/* FR-B7: Q&A — any logged-in viewer asks; operators answer in the console */}
      {me && id && (
        <section data-testid="qa-section" style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 14, background: "#090f18", padding: "1.2rem 1.3rem", marginTop: "1.6rem" }}>
          <div style={monoLabel({ marginBottom: "0.8rem" })}>{t("qa.title").toUpperCase()}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: csrf ? "0.9rem" : 0 }}>
            {op.questions.length === 0 && <div style={{ color: "#7e92a4", fontSize: "0.85rem" }}>{t("qa.empty")}</div>}
            {op.questions.map((q) => (
              <div key={q.id} style={{ border: "1px solid rgba(255,255,255,0.06)", borderRadius: 9, padding: "0.6rem 0.7rem" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.3rem" }}><Avatar name={q.asker} /><strong style={{ fontSize: "0.82rem", color: "#eaf4fb" }}>{q.asker}</strong></div>
                <div style={{ color: "#c2d2de", fontSize: "0.88rem", lineHeight: 1.4, marginBottom: q.answer ? "0.45rem" : "0.3rem" }}>{q.body}</div>
                {q.answer ? (
                  <div style={{ display: "flex", alignItems: "flex-start", gap: "0.45rem", padding: "0.45rem 0.55rem", border: "1px solid rgba(0,255,136,0.28)", background: "rgba(0,255,136,0.05)", borderRadius: 8 }}>
                    <span style={{ color: "#00ff88", display: "inline-flex", flexShrink: 0, marginTop: 2 }}><Ic name="check" size={13} sw={2} /></span>
                    <div style={{ minWidth: 0 }}><span style={{ fontFamily: MONO, fontSize: "0.6rem", color: "#00ff88" }}>{t("qa.answeredBy", { who: q.answeredBy ?? "" })}</span><div style={{ color: "#c2d2de", fontSize: "0.84rem", lineHeight: 1.4 }}>{q.answer}</div></div>
                  </div>
                ) : (
                  <span style={{ fontFamily: MONO, fontSize: "0.6rem", letterSpacing: "0.05em", color: "#7e92a4" }}>{t("qa.unanswered")}</span>
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
                style={{ flex: 1, minWidth: 0, minHeight: 38, background: "#0e1926", border: "1px solid rgba(0,212,255,0.14)", color: "#ccdde8", fontFamily: "var(--body)", fontSize: "0.9rem", padding: "0.5rem 0.6rem", borderRadius: 8, outline: "none", resize: "vertical" }}
              />
              <button type="button" data-testid="qa-send" disabled={!qDraft.trim()} onClick={() => void submitQuestion()} style={{ flexShrink: 0, padding: "0.55rem 0.9rem", border: "1px solid rgba(0,212,255,0.45)", background: "rgba(0,212,255,0.12)", color: "#00d4ff", fontFamily: MONO, fontSize: "0.74rem", borderRadius: 8, cursor: "pointer" }}>{t("qa.send")}</button>
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
          initialTab={searchParams.get("op")}
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
          style={{ position: "fixed", inset: 0, zIndex: 10000, background: "rgba(2,5,10,0.88)", display: "flex", alignItems: "center", justifyContent: "center", padding: "3vh 3vw", cursor: "zoom-out" }}
        >
          <img
            src={op.coverUrl ?? heroImg}
            alt={`Operation ${op.title}`}
            onClick={(e) => e.stopPropagation()}
            style={{ maxWidth: "100%", maxHeight: "94vh", objectFit: "contain", borderRadius: 10, border: "1px solid rgba(0,212,255,0.25)", boxShadow: "0 24px 80px rgba(0,0,0,0.7)" }}
          />
          <button
            type="button"
            data-testid="cover-lightbox-close"
            onClick={() => setLightbox(false)}
            style={{ position: "fixed", top: "2vh", right: "2vw", width: 36, height: 36, borderRadius: 9, border: "1px solid rgba(255,255,255,0.2)", background: "rgba(9,15,24,0.8)", color: "#eaf4fb", cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center" }}
          >
            <Ic name="x" size={18} sw={2} />
          </button>
        </div>
      )}
    </article>
  );
}
