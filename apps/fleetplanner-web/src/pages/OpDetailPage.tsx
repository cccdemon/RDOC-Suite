import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ApiError,
  claimSeat,
  cqbSignup,
  cqbWithdraw,
  getOperation,
  setHangarShare,
  unclaimSeat,
} from "../api/client";
import type { FleetUnit, OperationDetail, SessionResponse } from "../api/types";
import { ErrorState } from "../components/ErrorState";
import { OfferShip } from "../components/OfferShip";
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
  { type: "squad", label: "BODENTRUPPEN", icon: "fps", accent: "#f0a500", rgb: "240,165,0" },
  { type: "vehicle", label: "FAHRZEUGE", icon: "vehicle", accent: "#ff7a45", rgb: "255,122,69" },
] as const;

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
  const [op, setOp] = useState<OperationDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busySeat, setBusySeat] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [offerOpen, setOfferOpen] = useState(false);
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

  const me = session?.user ?? null;
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
  const lanes = LANES.map((l) => ({ ...l, units: accepted.filter((u) => u.unitType === l.type) })).filter(
    (l) => l.units.length > 0,
  );
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

  return (
    <article>
      {/* HERO — two columns with the operation banner image */}
      <section
        style={{
          position: "relative",
          border: "1px solid rgba(0,212,255,0.18)",
          borderRadius: 14,
          overflow: "hidden",
          background: "linear-gradient(135deg,rgba(0,212,255,0.06),transparent 46%),#0a121c",
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

        {/* right column: banner image + ANMELDUNGEN — part of the hero */}
        <div style={{ flex: "1 1 260px", minWidth: 0, alignSelf: "stretch", display: "flex", flexDirection: "column", gap: "1rem" }}>
          <div style={{ minHeight: 130, flex: "0 0 auto", height: 150, border: "1px solid rgba(0,212,255,0.18)", borderRadius: 10, overflow: "hidden", background: "#0a1622" }}>
            <img src={heroImg} alt={`Operation ${op.title}`} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }} />
          </div>
          <div style={{ border: "1px solid rgba(0,212,255,0.13)", borderRadius: 12, background: "rgba(9,15,24,0.55)", padding: "0.85rem 1rem" }}>
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
          </div>
        </div>
      </section>

      {notice && (
        <p className="fpw-tag gold" role="alert" data-testid="op-notice" style={{ display: "inline-flex", marginTop: 0 }}>
          {notice}
        </p>
      )}


      {/* OPERATOR ACTIONS — Spieler sehen das Board direkt; Operatoren steuern über Management/Bearbeiten */}
      {(op.canManage || op.signupState === "joined") && (
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "0.8rem", marginBottom: "1.8rem" }}>
          {op.canManage ? (
            <div style={{ display: "inline-flex", border: "1px solid rgba(0,212,255,0.16)", borderRadius: 9, padding: 3, background: "#090f18", gap: 3 }}>
              <Link to={`/ops/${id}/manage`} data-testid="manage-op-link" style={{ ...tabBase, textDecoration: "none" }}>
                <Ic name="board" size={15} /> Management
              </Link>
              <Link to={`/ops/${id}/edit`} data-testid="edit-op-link" style={{ ...tabBase, textDecoration: "none" }}>
                <Ic name="bolt" size={15} /> Bearbeiten
              </Link>
            </div>
          ) : (
            <span />
          )}
          {op.signupState === "joined" && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "0.45rem", color: "#00ff88", fontSize: "0.88rem" }}>
              <Ic name="check" size={15} /> Du bist Teilnehmer.
            </span>
          )}
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

          {/* CATEGORY BOARD */}
          <div ref={fleetRef} style={{ display: "flex", flexWrap: "wrap", gap: "1.3rem", alignItems: "flex-start" }}>
            {lanes.length === 0 && <p style={{ color: "#7e92a4" }}>Noch keine Einheiten.</p>}
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
                    {lane.units.map((u) => {
                      const uFilled = u.seats.filter((s) => s.claimedBy).length;
                      const expanded = !collapsed[u.id];
                      const full = u.seats.length > 0 && uFilled === u.seats.length;
                      return (
                        <article
                          key={u.id}
                          data-testid="unit-card"
                          style={{
                            width: "100%",
                            minWidth: 0,
                            border: `1px solid rgba(${lane.rgb},0.16)`,
                            borderTop: `2px solid rgba(${lane.rgb},0.5)`,
                            borderRadius: 13,
                            background: "#0a1018",
                            padding: "1.15rem 1.2rem",
                          }}
                        >
                          <div
                            onClick={() => setCollapsed((c) => ({ ...c, [u.id]: !c[u.id] }))}
                            style={{ display: "flex", alignItems: "flex-start", gap: "0.8rem", cursor: "pointer" }}
                          >
                            <span
                              style={{
                                width: 42,
                                height: 42,
                                borderRadius: 11,
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                flexShrink: 0,
                                background: `rgba(${lane.rgb},0.13)`,
                                border: `1px solid rgba(${lane.rgb},0.28)`,
                                color: lane.accent,
                              }}
                            >
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
                                {u.unitType}
                                {u.captain ? ` · Captain: ${u.captain.username}` : ""}
                              </div>
                            </div>
                            <div style={{ textAlign: "right", flexShrink: 0 }}>
                              <div style={{ fontFamily: MONO, fontSize: "1.05rem", color: "#eaf4fb", lineHeight: 1 }}>
                                {uFilled}
                                <span style={{ color: "#5b6b7a" }}>/{u.seats.length}</span>
                              </div>
                              <div style={{ fontFamily: MONO, fontSize: "0.56rem", letterSpacing: "0.1em", color: "#5b6b7a", marginTop: "0.25rem" }}>BESETZT</div>
                            </div>
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
                              <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>{u.seats.map((s) => seatRow(u, s, lane))}</div>
                            </div>
                          )}
                        </article>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </>
      )}
    </article>
  );
}
