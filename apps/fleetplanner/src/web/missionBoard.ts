// Mission-board op-detail (player view) — faithful port of the claude.ai/design
// "Operationsdetail" mock. Data-driven from the real op; wired to the existing
// claim / units / cqb-join / crew-requests / hangar-share endpoints. Inline
// styles mirror the design 1:1.
import {
  html,
  safe,
  layout,
  escape,
  renderMarkdown,
  type SafeHtml,
  type LayoutOptions,
} from "./render.js";
import type { Ship } from "@prisma/client";
import { t } from "../i18n/index.js";
import { DEFAULT_TIMEZONE } from "../lib/timezone.js";
import { shipClass, matchesCategory } from "../services/composition.js";
import { shipTypeLabel, SHIP_TYPES } from "../services/needs.js";

type OpFull = Awaited<ReturnType<typeof import("../services/operations.js").getOperation>>;

// FR-P3 — icon for a resource-link kind (mirrors pages.ts resourceLinkEmoji).
function rlEmoji(kind: string): string {
  switch (kind) {
    case "youtube":
      return "▶";
    case "rsi_hub":
      return "📄";
    case "gdoc":
      return "📝";
    case "image":
      return "🖼";
    default:
      return "🔗";
  }
}

function flashFromQuery(msg: string | undefined): LayoutOptions["flash"] {
  if (!msg) return null;
  const [kind, ...rest] = msg.split(":");
  const text = rest.join(":") || msg;
  if (kind === "ok" || kind === "warn" || kind === "error") return { kind, text };
  return { kind: "ok", text: msg };
}

const MONO = "'Share Tech Mono',ui-monospace,monospace";

function ic(name: string, size = 16, stroke = "currentColor", sw = 1.7): SafeHtml {
  return safe(
    `<svg width="${size}" height="${size}" fill="none" stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"><use href="#i-${name}"></use></svg>`,
  );
}

type Kind = "fest" | "typ" | "rolle_offen" | "frei";
const TAGTEXT: Record<Kind, string> = { fest: "FEST", typ: "TYP", rolle_offen: "ROLLE OFFEN", frei: "FREI" };
function tagStyle(kind: Kind): string {
  const base =
    "display:inline-flex;align-items:center;padding:2px 7px;font-family:" +
    MONO +
    ";font-size:9.5px;letter-spacing:.07em;border-radius:3px;border:1px solid;line-height:1.5;white-space:nowrap;text-transform:uppercase;";
  const map: Record<Kind, string> = {
    fest: "color:#9fb6c9;border-color:rgba(159,182,201,.34);background:rgba(159,182,201,.07)",
    typ: "color:#f0a500;border-color:rgba(240,165,0,.44);background:rgba(240,165,0,.09)",
    rolle_offen: "color:#00ff88;border-color:rgba(0,255,136,.4);background:rgba(0,255,136,.08)",
    frei: "color:#9fb6c9;border-color:rgba(159,182,201,.34);border-style:dashed;background:transparent",
  };
  return base + map[kind];
}

const AV_COLORS = ["#00d4ff", "#a064ff", "#00ff88", "#f0a500", "#ff70c8"];
function avatarSpan(name: string): SafeHtml {
  const initials = (name.replace(/[^A-Za-z0-9]/g, "").slice(0, 2) || "??").toUpperCase();
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  const color = AV_COLORS[h % AV_COLORS.length];
  return html`<span
    style="width:22px;height:22px;border-radius:5px;display:inline-flex;align-items:center;justify-content:center;font-family:${safe(MONO)};font-size:9px;font-weight:700;color:#04060a;background:${color};flex-shrink:0"
    >${initials}</span
  >`;
}

interface Seat {
  icon: string;
  role: string;
  kind: Kind;
  hint?: string;
  hintIcon?: string;
  user?: string | null;
  take?: { action: string; fields: Record<string, string>; needShip: boolean; shipType?: string };
  /** Real SeatAssignment id — only present for ship/vehicle seats the operator can (un)assign. */
  id?: string;
  /** Seat order in its unit; 0 = captain seat (never freeable). */
  order?: number;
}
interface Unit {
  icon: string;
  name: string;
  sub: string;
  accentRgb: string;
  status?: { text: string; icon: string; kind: "voll" | "gesucht" };
  warn?: string;
  hint: string;
  filled: number;
  total: number;
  seats: Seat[];
  vehicle?: { name: string; tag: string; seats: Seat[] };
}

const SPRITE = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
<symbol id="i-ship" viewBox="0 0 24 24"><path d="M12 3c1.6 1.4 2.6 3.8 2.8 7.2l3.7 2.6-.2 2.2-3.8-1.3c-.3 2.4-1.2 4-2.5 4s-2.2-1.6-2.5-4l-3.8 1.3-.2-2.2 3.7-2.6C9.4 6.8 10.4 4.4 12 3z"/></symbol>
<symbol id="i-fighter" viewBox="0 0 24 24"><path d="M12 3l8 15-8-3.4L4 18z"/></symbol>
<symbol id="i-fps" viewBox="0 0 24 24"><circle cx="12" cy="7" r="2.6"/><path d="M5.5 20c0-3.6 2.9-5.8 6.5-5.8s6.5 2.2 6.5 5.8"/></symbol>
<symbol id="i-pilot" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1"/></symbol>
<symbol id="i-gunner" viewBox="0 0 24 24"><circle cx="12" cy="12" r="7"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/></symbol>
<symbol id="i-medic" viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8v8M8 12h8"/></symbol>
<symbol id="i-lead" viewBox="0 0 24 24"><path d="M6 13l6-5 6 5M6 18l6-5 6 5"/></symbol>
<symbol id="i-breacher" viewBox="0 0 24 24"><path d="M12 3l7 2.6v5.2c0 4.6-3 7.6-7 9.2-4-1.6-7-4.6-7-9.2V5.6z"/></symbol>
<symbol id="i-users" viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><path d="M3.5 19c0-3 2.4-4.8 5.5-4.8s5.5 1.8 5.5 4.8M16 5.2a3 3 0 0 1 0 5.6M21 19c0-2.4-1.6-4-3.8-4.6"/></symbol>
<symbol id="i-pin" viewBox="0 0 24 24"><path d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11z"/><circle cx="12" cy="10" r="2.4"/></symbol>
<symbol id="i-globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.5 2.5 14 0 17M12 3.5c-2.5 2.5-2.5 14 0 17"/></symbol>
<symbol id="i-clock" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/></symbol>
<symbol id="i-mic" viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3"/></symbol>
<symbol id="i-chat" viewBox="0 0 24 24"><path d="M4 5h16v11H9l-4 3v-3H4z"/></symbol>
<symbol id="i-bolt" viewBox="0 0 24 24"><path d="M13 3L5 13h5l-1 8 9-11h-6z"/></symbol>
<symbol id="i-check" viewBox="0 0 24 24"><path d="M5 12.5l4.2 4.2L19 7"/></symbol>
<symbol id="i-alert" viewBox="0 0 24 24"><path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17.4v.4"/></symbol>
<symbol id="i-arrow" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6"/></symbol>
<symbol id="i-x" viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></symbol>
<symbol id="i-swap" viewBox="0 0 24 24"><path d="M5 9h13l-3.5-3.5M19 15H6l3.5 3.5"/></symbol>
<symbol id="i-board" viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></symbol>
<symbol id="i-eye" viewBox="0 0 24 24"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.7"/></symbol>
<symbol id="i-chevron" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></symbol>
<symbol id="i-vehicle" viewBox="0 0 24 24"><path d="M4 13l2.3-4.5h8.4L18 13"/><path d="M3 13h18v3.4H3z"/><circle cx="7.5" cy="17.4" r="2.1"/><circle cx="16.5" cy="17.4" r="2.1"/></symbol>
</defs></svg>`;

export function opMissionBoardPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op: NonNullable<OpFull>;
  guildTimezone?: string;
  voiceChannelName?: string | null;
  ownedShips?: Ship[];
  canManage?: boolean;
  discordInvite?: string | null;
  /** board1 = stacked category sections; board2 = full-width 4-column board. */
  variant?: "board1" | "board2";
  /** "operator" → render the in-page operator console (only when canManage). */
  view?: string;
  /** operator console layout: "a" Befehlsstand (default) | "b" Triage. */
  lay?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const isBoard2 = (opts.variant ?? "board1") === "board2";
  const csrf = opts.csrfToken ?? "";
  const myId = opts.currentUser?.id;
  const tz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const isOpen = op.status === "open";
  const ownedShips = opts.ownedShips ?? [];
  const canManage = !!opts.canManage;
  const isOperatorView = canManage && opts.view === "operator";
  const layB = opts.lay === "b"; // operator console layout: a=Befehlsstand (default), b=Triage

  const acceptedUnits = op.units.filter((u) => u.status === "accepted");
  const cqbSignups = op.cqbSignups ?? [];
  const hasSeat = !!myId && acceptedUnits.some((u) => u.seats.some((s) => s.active && s.userId === myId));
  const hasReq = !!myId && op.crewRequests.some((r) => r.user.id === myId);
  const myCqb = !!myId && cqbSignups.some((s) => s.userId === myId);
  const signedUp = hasSeat || hasReq || myCqb;
  const myHangarShared =
    !!myId &&
    ((op as { hangarShares?: Array<{ userId: string }> }).hangarShares ?? []).some((h) => h.userId === myId);

  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("de-DE", { ...o, timeZone: tz }).format(d);
  const heroDate = `${fmt(op.scheduledAt, { weekday: "short", day: "numeric", month: "long" })} · ${fmt(op.scheduledAt, { hour: "2-digit", minute: "2-digit" })} ${tz}`;
  const anmeldungZeit = `${fmt(op.scheduledAt, { day: "2-digit", month: "2-digit", year: "numeric" })}, ${fmt(op.scheduledAt, { hour: "2-digit", minute: "2-digit" })}`;

  // ── seat row renderer ──
  const seatRow = (s: Seat, compact = false): SafeHtml => {
    const iconBox = compact ? 28 : 30;
    const occ = s.user
      ? html`<div style="display:flex;align-items:center;gap:.5rem;flex-shrink:0;min-width:0">
          ${avatarSpan(s.user)}<span style="font-size:.86rem;color:#ccdde8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:11rem">${s.user}</span>
        </div>`
      : s.take && isOpen && myId
        ? html`<button
            type="button"
            data-take
            data-action="${escape(s.take.action)}"
            data-role="${escape(s.role)}"
            data-kind="${s.kind}"
            data-needship="${s.take.needShip ? "1" : "0"}"
            data-shiptype="${escape(s.take.shipType ?? "")}"
            data-fields="${escape(JSON.stringify(s.take.fields))}"
            style="display:inline-flex;align-items:center;gap:5px;flex-shrink:0;padding:.4rem .7rem;border:1px solid rgba(0,212,255,.32);background:rgba(0,212,255,.05);color:#00d4ff;font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.03em;border-radius:7px;cursor:pointer"
          >${t("join.takeSlot")} ${ic("arrow", 13, "currentColor", 1.8)}</button>`
        : !myId && isOpen
          ? html`<a href="${bp}/login" style="flex-shrink:0;padding:.4rem .7rem;border:1px solid rgba(0,212,255,.32);background:rgba(0,212,255,.05);color:#00d4ff;font-family:${safe(MONO)};font-size:.72rem;border-radius:7px;text-decoration:none">${t("op.signIn")}</a>`
          : html`<span style="flex-shrink:0;color:#5b6b7a;font-family:${safe(MONO)};font-size:.7rem">—</span>`;
    return html`<div style="display:flex;align-items:center;gap:.7rem;padding:${compact ? ".55rem .65rem" : ".6rem .7rem"};background:rgba(255,255,255,.013);border:1px solid rgba(0,212,255,.08);border-radius:9px;min-width:0">
      <span style="width:${iconBox}px;height:${iconBox}px;border-radius:7px;background:#0e1926;border:1px solid rgba(255,255,255,.06);color:#9fb1c2;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic(s.icon, 16, "currentColor", 1.6)}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.45rem;flex-wrap:wrap">
          <strong style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:600;font-size:.98rem;color:#dce8f0">${s.role}</strong>
          <span style="${safe(tagStyle(s.kind))}">${TAGTEXT[s.kind]}</span>
        </div>
        ${s.hint
          ? html`<div style="display:flex;align-items:center;gap:5px;margin-top:3px;color:#7e92a4;font-size:.78rem">${s.hintIcon ? ic(s.hintIcon, 13, "currentColor", 1.6) : safe("")}<span>${s.hint}</span></div>`
          : safe("")}
      </div>
      ${occ}
    </div>`;
  };

  const unitCard = (u: Unit): SafeHtml => {
    const statusSpan = u.status
      ? html`<span style="display:inline-flex;align-items:center;gap:4px;font-family:${safe(MONO)};font-size:.6rem;letter-spacing:.06em;color:${u.status.kind === "voll" ? "#00ff88" : "#f0a500"};border:1px solid ${u.status.kind === "voll" ? "rgba(0,255,136,.4)" : "rgba(240,165,0,.42)"};background:${u.status.kind === "voll" ? "rgba(0,255,136,.08)" : "rgba(240,165,0,.09)"};padding:.12rem .4rem;border-radius:3px">${ic(u.status.icon, 12, "currentColor", 2)}${u.status.text}</span>`
      : safe("");
    return html`<details open style="flex:1 1 100%;border:1px solid rgba(${safe(u.accentRgb)},.16);border-radius:13px;background:#0b1019;padding:1.1rem 1.2rem">
      <summary style="display:flex;align-items:flex-start;gap:.8rem;cursor:pointer;list-style:none">
        <span style="width:42px;height:42px;border-radius:10px;background:rgba(${safe(u.accentRgb)},.1);border:1px solid rgba(${safe(u.accentRgb)},.26);color:rgb(${safe(u.accentRgb)});display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic(u.icon, 20, "currentColor", 1.6)}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <strong style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1.12rem;color:#eaf4fb;line-height:1.2">${u.name}</strong>${statusSpan}
          </div>
          <div style="color:#9fb1c2;font-size:.86rem;margin-top:.15rem">${u.sub}</div>
        </div>
        <div style="text-align:right;flex-shrink:0">
          <div style="font-family:${safe(MONO)};font-size:1.05rem;color:#eaf4fb;line-height:1">${u.filled}<span style="color:#5b6b7a">/${u.total}</span></div>
          <div style="font-family:${safe(MONO)};font-size:.56rem;letter-spacing:.1em;color:#5b6b7a;margin-top:.25rem">${t("mb.occupied")}</div>
        </div>
      </summary>
      <div style="margin-top:1rem">
        ${u.warn
          ? html`<div style="display:flex;align-items:flex-start;gap:.55rem;padding:.65rem .8rem;border:1px solid rgba(240,165,0,.3);background:rgba(240,165,0,.07);border-radius:9px;color:#f0c97a;font-size:.86rem;margin-bottom:.85rem">${ic("alert", 16, "#f0a500", 1.7)}${u.warn}</div>`
          : safe("")}
        <div style="display:flex;align-items:center;gap:.5rem;color:#9fb1c2;font-size:.86rem;margin-bottom:.9rem">${ic("bolt", 15, "#f0a500", 1.7)}<span style="font-style:italic">${u.hint}</span></div>
        <div style="display:flex;flex-direction:column;gap:.5rem">
          ${u.seats.map((s) => seatRow(s))}
          ${u.vehicle
            ? html`<div style="margin-top:.3rem;padding:.7rem .75rem .75rem;border:1px dashed rgba(160,100,255,.3);border-radius:9px;background:rgba(160,100,255,.04)">
                <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.6rem">${ic("ship", 15, "#a064ff", 1.6)}<strong style="font-family:${safe(MONO)};font-size:.78rem;color:#c6b0ff;letter-spacing:.04em">${u.vehicle.name}</strong><span style="font-family:${safe(MONO)};font-size:.6rem;letter-spacing:.07em;color:#a064ff;border:1px solid rgba(160,100,255,.4);background:rgba(160,100,255,.09);padding:.12rem .4rem;border-radius:3px">${u.vehicle.tag}</span></div>
                <div style="display:flex;flex-direction:column;gap:.5rem">${u.vehicle.seats.map((s) => seatRow(s, true))}</div>
              </div>`
            : safe("")}
        </div>
      </div>
    </details>`;
  };

  // ── build categories from real op data ──
  const shipUnits: Unit[] = [];
  for (const u of acceptedUnits.filter((x) => x.unitType === "ship" && !x.carrierUnitId)) {
    const seats = u.seats.filter((s) => s.active);
    const cls = u.ship ? shipClass(u.ship) : "";
    shipUnits.push({
      icon: "ship",
      name: u.ship?.name || u.squadName || t("op.unit"),
      sub: cls ? `${t("op.ship")} · ${cls}` : t("op.ship"),
      accentRgb: "0,212,255",
      status: seats.length > 0 && seats.every((s) => s.userId) ? { text: t("op.full").toUpperCase(), icon: "check", kind: "voll" } : undefined,
      hint: u.captainNote || t("mb.shipHint"),
      filled: seats.filter((s) => s.userId).length,
      total: seats.length,
      seats: seats.map((s, i): Seat => ({
        icon: i === 0 ? "pilot" : "gunner",
        role: s.label,
        kind: "fest",
        id: s.id,
        order: s.order,
        user: s.userId ? ((s as { user?: { username?: string } }).user?.username ?? null) : null,
        take: s.userId ? undefined : { action: `${bp}/api/seats/${s.id}/claim`, fields: {}, needShip: false },
      })),
    });
  }
  const allReqs = op.groups.flatMap((g) => g.requirements);
  for (const r of allReqs.filter((r) => ((r as { needType?: string | null }).needType ?? "ship") === "ship")) {
    const filledUnits = acceptedUnits.filter((u) => (u as { requirementId?: string | null }).requirementId === r.id).length;
    const open = Math.max(0, r.count - filledUnits);
    if (open <= 0) continue;
    const typeLabel = r.label || shipTypeLabel(r.shipType ?? "any");
    shipUnits.push({
      icon: "ship",
      name: typeLabel,
      sub: `${t("mb.typePrefix")}: ${shipTypeLabel(r.shipType ?? "any")} (${t("mb.shipWanted")})`,
      accentRgb: "0,212,255",
      status: { text: t("mb.shipWanted").toUpperCase(), icon: "alert", kind: "gesucht" },
      warn: t("mb.bringOwnShip"),
      hint: r.note || t("mb.shipReqHint"),
      filled: filledUnits,
      total: r.count,
      seats: [
        {
          icon: "pilot",
          role: t("join.pilot"),
          kind: "typ",
          hint: `${t("mb.ownShip")} · ${shipTypeLabel(r.shipType ?? "any")}`,
          hintIcon: "ship",
          take: { action: `${bp}/api/ops/${op.id}/units`, fields: { requirementId: r.id, unitType: "ship" }, needShip: true, shipType: r.shipType ?? "any" },
        },
      ],
    });
  }

  const squadCard = (g: (typeof op.groups)[number], accentRgb: string, iconName: string, kind: Kind, roleLabel: string, bringOwn: boolean): Unit => {
    const members = cqbSignups.filter((s) => s.assignedGroupId === g.id);
    const total = (g as { targetSize?: number | null }).targetSize ?? members.length;
    const seats: Seat[] = [];
    members.forEach((m, i) => seats.push({ icon: iconName, role: `${roleLabel} ${i + 1}`, kind, user: m.user.username }));
    for (let i = members.length; i < total; i++) {
      seats.push({
        icon: iconName,
        role: `${roleLabel} ${i + 1}`,
        kind,
        hint: bringOwn ? t("mb.ownFighter") : t("mb.seatOnBoard"),
        hintIcon: bringOwn ? "ship" : "users",
        take: isOpen ? { action: `${bp}/api/ops/${op.id}/cqb/squads/${g.id}/join`, fields: {}, needShip: false } : undefined,
      });
    }
    return {
      icon: iconName,
      name: g.name,
      sub: bringOwn ? t("mb.fighterSub") : t("mb.groundSub"),
      accentRgb,
      hint: bringOwn ? t("mb.fighterHint") : t("mb.groundHint"),
      filled: members.length,
      total,
      seats,
    };
  };
  const fighterUnits = op.groups.filter((g) => g.kind === "fighter_squad").map((g) => squadCard(g, "160,100,255", "fighter", "typ", t("join.slotPilot"), true));
  const groundUnits = op.groups.filter((g) => g.kind === "squad").map((g) => squadCard(g, "240,165,0", "fps", "fest", t("join.slotSoldier"), false));
  const vehicleUnits: Unit[] = acceptedUnits
    .filter((u) => u.unitType === "vehicle")
    .map((u) => {
      const seats = u.seats.filter((s) => s.active);
      return {
        icon: "vehicle",
        name: u.ship?.name || u.squadName || t("op.vehicle"),
        sub: t("op.vehicle"),
        accentRgb: "255,122,69",
        status: seats.length > 0 && seats.every((s) => s.userId) ? { text: t("op.full").toUpperCase(), icon: "check", kind: "voll" } : undefined,
        hint: u.captainNote || t("mb.groundHint"),
        filled: seats.filter((s) => s.userId).length,
        total: seats.length,
        seats: seats.map((s, i): Seat => ({
          icon: i === 0 ? "pilot" : "gunner",
          role: s.label,
          kind: "fest",
          id: s.id,
          order: s.order,
          user: s.userId ? ((s as { user?: { username?: string } }).user?.username ?? null) : null,
          take: s.userId ? undefined : { action: `${bp}/api/seats/${s.id}/claim`, fields: {}, needShip: false },
        })),
      };
    });

  const cats = [
    { label: t("cat.shipsAndCrew"), icon: "ship", accent: "#00d4ff", accentLine: "rgba(0,212,255,0.4)", units: shipUnits },
    { label: t("cat.fighterWing"), icon: "fighter", accent: "#a064ff", accentLine: "rgba(160,100,255,0.4)", units: fighterUnits },
    { label: t("cat.groundTroops"), icon: "fps", accent: "#f0a500", accentLine: "rgba(240,165,0,0.4)", units: groundUnits },
    { label: t("cat.vehicles"), icon: "vehicle", accent: "#ff7a45", accentLine: "rgba(255,122,69,0.4)", units: vehicleUnits },
  ].filter((c) => c.units.length > 0);
  const catCount = (units: Unit[]) => `${units.reduce((a, u) => a + u.filled, 0)}/${units.reduce((a, u) => a + u.total, 0)}`;

  const hangarRows = ownedShips.map((ship) => {
    const matchTypes = SHIP_TYPES.filter((st) => matchesCategory(st.slug, { unitType: "ship", ship })).map((st) => st.slug);
    const meta = [ship.role, ship.maxCrew ? `${ship.maxCrew} Crew` : "", ship.size].filter(Boolean).join(" · ");
    return { id: ship.id, name: ship.name, mfr: ship.manufacturer || "", meta, matchTypes };
  });

  const tabActive = "display:inline-flex;align-items:center;gap:7px;padding:.5rem .95rem;border:none;border-radius:7px;background:#00d4ff;color:#04060a;font-family:" + MONO + ";font-size:.78rem;letter-spacing:.04em;font-weight:700";
  const tabIdle = "display:inline-flex;align-items:center;gap:7px;padding:.5rem .95rem;border:none;border-radius:7px;background:transparent;color:#9fb1c2;font-family:" + MONO + ";font-size:.78rem;letter-spacing:.04em;text-decoration:none";
  // Inline Optik switcher (also on this player page, not only in Profile).
  const optSeg = "padding:.35rem .65rem;border:none;border-radius:6px;font-family:" + MONO + ";font-size:.68rem;letter-spacing:.03em;cursor:pointer;background:transparent;color:#9fb1c2";
  const optSegOn = "padding:.35rem .65rem;border:none;border-radius:6px;font-family:" + MONO + ";font-size:.68rem;letter-spacing:.03em;cursor:pointer;background:#00d4ff;color:#04060a;font-weight:700";
  const optikSwitch = html`<form method="post" action="${bp}/profile/opstyle" style="display:inline-flex;align-items:center;gap:.45rem;flex-wrap:wrap">
    <input type="hidden" name="_csrf" value="${csrf}" /><input type="hidden" name="returnOp" value="${op.id}" />
    <span style="font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.1em;color:#5b6b7a">${t("profile.opstyle.short")}</span>
    <div style="display:inline-flex;border:1px solid rgba(0,212,255,.16);border-radius:8px;padding:2px;background:#090f18;gap:2px">
      <button type="submit" name="opStyle" value="classic" style="${safe(optSeg)}">${t("mb.optClassic")}</button>
      <button type="submit" name="opStyle" value="board1" style="${safe(isBoard2 ? optSeg : optSegOn)}">${t("mb.optBoard1")}</button>
      <button type="submit" name="opStyle" value="board2" style="${safe(isBoard2 ? optSegOn : optSeg)}">${t("mb.optBoard2")}</button>
    </div>
  </form>`;
  const legendSpan = (kind: Kind, label: string) =>
    html`<span style="display:inline-flex;align-items:center;gap:6px"><span style="${safe(tagStyle(kind))}">${TAGTEXT[kind]}</span><span style="color:#9fb1c2;font-size:.8rem">${label}</span></span>`;

  const filledTotal = shipUnits.concat(fighterUnits, groundUnits).reduce((a, u) => a + u.filled, 0);
  const signedCount = filledTotal + op.crewRequests.length;
  const pct = op.minParticipants > 0 ? Math.min(100, Math.round((signedCount / op.minParticipants) * 100)) : 0;

  const metaRows = [
    { ic: "clock", lab: t("mb.time"), val: anmeldungZeit },
    { ic: "pin", lab: t("mb.meetpoint"), val: op.meetingLocation },
    { ic: "globe", lab: t("mb.system"), val: op.meetingSystem },
    { ic: "mic", lab: t("mb.voice"), val: opts.voiceChannelName || "—" },
  ];
  const mmCards = [
    { acc: "0,212,255", col: "#00d4ff", icon: "ship", ttl: t("join.mmSeat"), sub: t("join.mmSeatSub"), cta: t("mb.toFleet"), mm: "scroll" },
    { acc: "0,255,136", col: "#00ff88", icon: "fighter", ttl: t("join.mmShip"), sub: t("join.mmShipSub"), cta: t("mb.chooseShip"), mm: "scroll" },
    { acc: "240,165,0", col: "#f0a500", icon: "swap", ttl: t("join.mmFlex"), sub: t("join.mmFlexSub"), cta: t("mb.flexSignup"), mm: "flex" },
  ];

  const catHeader = (cat: { label: string; icon: string; accent: string; accentLine: string; units: Unit[] }) =>
    html`<div style="display:flex;align-items:center;gap:.7rem;margin-bottom:1rem">
      <span style="display:inline-flex;align-items:center;gap:.55rem;font-family:${safe(MONO)};font-size:.78rem;letter-spacing:.12em;color:${cat.accent};white-space:nowrap">${ic(cat.icon, 16, "currentColor", 1.7)}${cat.label}</span>
      <span style="flex:1;height:1px;background:linear-gradient(90deg,${safe(cat.accentLine)},transparent)"></span>
      <span style="font-family:${safe(MONO)};font-size:.78rem;color:#9fb1c2;white-space:nowrap">${catCount(cat.units)}</span>
    </div>`;
  const fleetBlock = isBoard2
    ? html`<div style="display:flex;flex-wrap:wrap;gap:1.3rem;align-items:flex-start">
        ${cats.map(
          (cat) => html`<section style="flex:1 1 290px;min-width:0">
            ${catHeader(cat)}
            <div style="display:flex;flex-direction:column;gap:1.1rem">${cat.units.map((u) => unitCard(u))}</div>
          </section>`,
        )}
      </div>`
    : html`${cats.map(
        (cat) => html`<section style="margin-bottom:2.2rem">
          ${catHeader(cat)}
          <div style="display:flex;flex-wrap:wrap;gap:1.1rem;align-items:flex-start">${cat.units.map((u) => unitCard(u))}</div>
        </section>`,
      )}`;

  // ══════════════════ OPERATOR BACKEND CONSOLE ══════════════════
  // In-page operator work surface (faithful port of Operationsdetail.dc.html chat2).
  // Two switchable layouts (Befehlsstand / Triage); clickable place-mode assignment,
  // inline seat-picker, drag & drop, Q&A answering, activity + hangar-freigaben.
  const opFilled = cats.reduce((a, c) => a + c.units.reduce((x, u) => x + u.filled, 0), 0);
  const opTotal = cats.reduce((a, c) => a + c.units.reduce((x, u) => x + u.total, 0), 0);
  const opOpen = Math.max(0, opTotal - opFilled);
  const fillPct = opTotal > 0 ? Math.round((opFilled / opTotal) * 100) : 0;
  const flexList = op.crewRequests;
  const flexWaiting = flexList.length;
  const questions = op.questions ?? [];
  const openQ = questions.filter((q) => !q.answer).length;
  const auditLogs = (op as { auditLogs?: Array<{ createdAt: Date; actor: string; action: string; detail: string }> }).auditLogs ?? [];
  const hangarShares = (op as { hangarShares?: Array<{ user?: { username?: string } | null; note?: string | null }> }).hangarShares ?? [];
  const leaders = op.leaders;
  const flexUrl = `${bp}/api/ops/${op.id}/crew-requests/remove`;

  const opBars = cats.map((c) => {
    const f = c.units.reduce((a, u) => a + u.filled, 0);
    const tt = c.units.reduce((a, u) => a + u.total, 0);
    return { label: c.label, accent: c.accent, text: `${f}/${tt}`, pct: tt > 0 ? Math.round((f / tt) * 100) : 0 };
  });
  const opNeeds: Array<{ unitName: string; catLabel: string; openCount: number; kind: Kind; accent: string }> = [];
  for (const c of cats)
    for (const u of c.units) {
      const open = u.total - u.filled;
      if (open <= 0) continue;
      const firstOpen = u.seats.find((s) => !s.user) ?? u.vehicle?.seats.find((s) => !s.user);
      opNeeds.push({ unitName: u.name, catLabel: c.label, openCount: open, kind: firstOpen?.kind ?? "frei", accent: c.accent });
    }

  // Shared flex-people picker rows (same for every open seat).
  const pickerPeople = (seatId: string): SafeHtml =>
    flexList.length
      ? html`${flexList.map(
          (p) => html`<button type="button" data-op-assign data-seatid="${seatId}" data-userid="${p.user.id}" style="display:flex;align-items:center;gap:.5rem;width:100%;text-align:left;padding:.4rem .5rem;border:1px solid rgba(240,165,0,.28);background:rgba(240,165,0,.05);border-radius:7px;cursor:pointer;color:inherit;font-family:inherit">
            ${avatarSpan(p.user.username)}<span style="flex:1;font-size:.84rem;color:#eaf4fb">${p.user.username}</span><span style="font-family:${safe(MONO)};font-size:.6rem;color:#f0a500">FLEX</span>
          </button>`,
        )}`
      : html`<div style="color:#5b6b7a;font-size:.78rem;padding:.2rem 0">${t("mb.opNoFlex")}</div>`;

  // Operator seat row — open real seats are clickable (place-mode target / picker);
  // claimed seats show a ✕ to free them (except the captain seat, order 0).
  const opSeatRow = (s: Seat): SafeHtml => {
    const claimed = !!s.user;
    const realOpen = !claimed && !!s.id;
    const canFree = claimed && !!s.id && s.order !== 0;
    const rowBase = "display:flex;align-items:center;gap:.7rem;padding:.55rem .65rem;border:1px solid rgba(0,212,255,.08);border-radius:9px;background:rgba(255,255,255,.013);min-width:0";
    const main = html`<div ${realOpen ? safe(`data-op-seat data-seatid="${escape(s.id ?? "")}" data-role="${escape(s.role)}"`) : safe("")} style="${safe(rowBase)};${realOpen ? "cursor:pointer" : ""}">
      <span style="width:28px;height:28px;border-radius:7px;background:#0e1926;border:1px solid rgba(255,255,255,.06);color:#9fb1c2;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic(s.icon, 15, "currentColor", 1.6)}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap"><strong style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:600;font-size:.9rem;color:#dce8f0">${s.role}</strong><span style="${safe(tagStyle(s.kind))}">${TAGTEXT[s.kind]}</span></div>
        ${s.hint ? html`<div style="color:#7e92a4;font-size:.72rem;margin-top:1px">${s.hint}</div>` : safe("")}
      </div>
      ${claimed
        ? html`<div style="display:flex;align-items:center;gap:.4rem;flex-shrink:0">${avatarSpan(s.user as string)}<span style="font-size:.8rem;color:#ccdde8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:6.5rem">${s.user}</span>${canFree ? html`<button type="button" data-op-unassign data-seatid="${s.id}" title="${t("mb.opFreeSeat")}" style="flex-shrink:0;width:21px;height:21px;border-radius:6px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#7e92a4;display:inline-flex;align-items:center;justify-content:center;cursor:pointer">${ic("x", 11, "currentColor", 2)}</button>` : safe("")}</div>`
        : realOpen
          ? html`<span class="op-open-hint" style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;color:#00d4ff;font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.03em">${ic("plus", 13, "currentColor", 1.9)}${t("mb.opAssign")}</span><span class="op-target-hint" hidden style="display:inline-flex;align-items:center;gap:4px;flex-shrink:0;color:#00ff88;font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.05em">${t("mb.opHere")}${ic("arrow", 13, "currentColor", 1.9)}</span>`
          : html`<span style="flex-shrink:0;color:#5b6b7a;font-family:${safe(MONO)};font-size:.7rem">${t("mb.opOpenLabel")}</span>`}
    </div>`;
    return html`<div class="op-seat-wrap" style="border:1px solid rgba(0,212,255,.06);border-radius:9px;overflow:hidden">
      ${main}
      ${realOpen
        ? html`<div class="op-picker" hidden style="border-top:1px solid rgba(0,212,255,.12);padding:.6rem;display:flex;flex-direction:column;gap:.35rem;background:#0a121c">
            <div style="font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.1em;color:#9fb1c2">${t("mb.opWhoHere")}</div>
            ${pickerPeople(s.id ?? "")}
            <div style="display:flex;gap:.4rem;margin-top:.15rem"><button type="button" data-op-closepicker style="flex:1;padding:.4rem;border:1px solid rgba(255,255,255,.12);background:transparent;color:#9fb1c2;font-family:${safe(MONO)};font-size:.64rem;border-radius:7px;cursor:pointer">${t("mb.opClose")}</button></div>
          </div>`
        : safe("")}
    </div>`;
  };

  const opUnitCard = (u: Unit): SafeHtml => {
    const statusSpan = u.status
      ? html`<span style="display:inline-flex;align-items:center;gap:4px;font-family:${safe(MONO)};font-size:.6rem;letter-spacing:.06em;color:${u.status.kind === "voll" ? "#00ff88" : "#f0a500"};border:1px solid ${u.status.kind === "voll" ? "rgba(0,255,136,.4)" : "rgba(240,165,0,.42)"};background:${u.status.kind === "voll" ? "rgba(0,255,136,.08)" : "rgba(240,165,0,.09)"};padding:.12rem .4rem;border-radius:3px;white-space:nowrap">${ic(u.status.icon, 11, "currentColor", 2)}${u.status.text}</span>`
      : safe("");
    const veh = u.vehicle;
    return html`<div style="border:1px solid rgba(${safe(u.accentRgb)},.16);border-radius:13px;background:#0b1019;padding:1rem 1.1rem">
      <div style="display:flex;align-items:center;gap:.6rem;margin-bottom:.7rem">
        <span style="width:36px;height:36px;border-radius:9px;background:rgba(${safe(u.accentRgb)},.1);border:1px solid rgba(${safe(u.accentRgb)},.26);color:rgb(${safe(u.accentRgb)});display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic(u.icon, 18, "currentColor", 1.6)}</span>
        <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap"><strong style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1.02rem;color:#eaf4fb;line-height:1.15">${u.name}</strong>${statusSpan}</div><div style="color:#7e92a4;font-size:.78rem;margin-top:1px">${u.sub}</div></div>
        <div style="text-align:right;flex-shrink:0"><span style="font-family:${safe(MONO)};font-size:.95rem;color:#eaf4fb">${u.filled}</span><span style="font-family:${safe(MONO)};font-size:.8rem;color:#5b6b7a">/${u.total}</span></div>
      </div>
      <div style="display:flex;flex-direction:column;gap:.4rem">
        ${u.seats.map((s) => opSeatRow(s))}
        ${veh
          ? html`<div style="margin-top:.2rem;padding:.6rem .65rem;border:1px dashed rgba(160,100,255,.3);border-radius:9px;background:rgba(160,100,255,.04)">
              <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.5rem;font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.08em;color:#a064ff">${ic("ship", 12, "currentColor", 1.6)}${veh.name} · ${t("mb.multiSeat")}</div>
              <div style="display:flex;flex-direction:column;gap:.4rem">${veh.seats.map((s) => opSeatRow(s))}</div>
            </div>`
          : safe("")}
      </div>
    </div>`;
  };

  const opBoard = html`<div style="font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.14em;color:#9fb1c2;margin-bottom:1rem">${t("mb.opFleetBoard")} <span style="color:#5b6b7a">· ${t("mb.opClickToFill")}</span></div>
    <div style="display:flex;flex-wrap:wrap;gap:1.3rem;align-items:flex-start">
      ${cats.map(
        (cat) => html`<div style="flex:1 1 290px;min-width:0">
          <div style="display:flex;align-items:center;gap:.45rem;margin-bottom:.8rem;padding-bottom:.5rem;border-bottom:1px solid ${cat.accentLine}"><span style="color:${cat.accent};display:inline-flex">${ic(cat.icon, 15, "currentColor", 1.7)}</span><span style="flex:1;min-width:0;font-family:${safe(MONO)};font-size:.68rem;letter-spacing:.06em;color:${cat.accent};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${cat.label}</span><span style="font-family:${safe(MONO)};font-size:.72rem;color:#9fb1c2;flex-shrink:0">${catCount(cat.units)}</span></div>
          <div style="display:flex;flex-direction:column;gap:.8rem">${cat.units.map((u) => opUnitCard(u))}</div>
        </div>`,
      )}
    </div>`;

  const railCardBorder = "border:1px solid rgba(0,212,255,.13);border-radius:14px;background:#090f18;padding:1.1rem 1.2rem";
  const labelMono = (txt: string, color = "#9fb1c2") => html`<div style="font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.12em;color:${color};margin-bottom:.7rem">${txt}</div>`;

  // Flexibel panel (people waiting to be assigned). Each row → place-mode.
  const flexPanel = html`<section style="${safe("border:1px solid rgba(240,165,0,.22);border-radius:14px;background:#090f18;padding:1.1rem 1.2rem")}">
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem">${ic("swap", 15, "#f0a500", 1.7)}<span style="font-family:${safe(MONO)};font-size:.7rem;letter-spacing:.1em;color:#f0a500">${t("mb.opFlex")}</span><span style="margin-left:auto;font-family:${safe(MONO)};font-size:.66rem;color:#5b6b7a">${t("mb.opWaiting", { n: flexWaiting })}</span></div>
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${flexList.length
        ? flexList.map(
            (p) => html`<div draggable="true" data-op-flex data-userid="${p.user.id}" data-name="${escape(p.user.username)}" style="display:flex;align-items:center;gap:.6rem;padding:.55rem .6rem;border:1px solid rgba(240,165,0,.18);border-radius:9px;background:rgba(240,165,0,.03);cursor:grab">
              ${avatarSpan(p.user.username)}
              <div style="flex:1;min-width:0"><div style="display:flex;align-items:center;gap:.4rem"><strong style="font-size:.9rem;color:#eaf4fb">${p.user.username}</strong></div>${p.note ? html`<div style="color:#7e92a4;font-size:.76rem;margin-top:1px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${p.note}</div>` : safe("")}</div>
              <button type="button" data-op-place data-userid="${p.user.id}" data-name="${escape(p.user.username)}" style="flex-shrink:0;padding:.4rem .65rem;border:1px solid rgba(0,212,255,.32);background:rgba(0,212,255,.05);color:#00d4ff;font-family:${safe(MONO)};font-size:.66rem;border-radius:7px;cursor:pointer">${t("mb.opPlace")}</button>
            </div>`,
          )
        : html`<div style="padding:.7rem;text-align:center;color:#5b6b7a;font-size:.8rem;font-family:${safe(MONO)}">${t("mb.opAllPlaced")}</div>`}
    </div>
  </section>`;

  const needsPanel = html`<section style="${safe(railCardBorder)}">
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem">${ic("alert", 15, "#00d4ff", 1.7)}<span style="font-family:${safe(MONO)};font-size:.7rem;letter-spacing:.1em;color:#9fb1c2">${t("mb.opNeeds")}</span><span style="margin-left:auto;font-family:${safe(MONO)};font-size:.66rem;color:#5b6b7a">${opOpen}</span></div>
    <div style="display:flex;flex-direction:column;gap:.42rem">
      ${opNeeds.length
        ? opNeeds.map(
            (n) => html`<div style="display:flex;align-items:center;gap:.55rem;padding:.45rem .55rem;border:1px solid rgba(255,255,255,.05);border-radius:8px">
              <span style="width:8px;height:8px;border-radius:2px;background:${n.accent};flex-shrink:0"></span>
              <div style="flex:1;min-width:0"><div style="font-size:.85rem;color:#dce8f0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.unitName}</div><div style="font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.04em;color:#5b6b7a;margin-top:1px">${n.catLabel}</div></div>
              <div style="display:flex;align-items:center;gap:.3rem;flex-shrink:0"><span style="${safe(tagStyle(n.kind))}">${TAGTEXT[n.kind]}</span><span style="font-family:${safe(MONO)};font-size:.9rem;color:#f0a500;margin-left:.15rem">${n.openCount}</span></div>
            </div>`,
          )
        : html`<div style="padding:.5rem;color:#5b6b7a;font-size:.8rem;font-family:${safe(MONO)}">${t("mb.opNoNeeds")}</div>`}
    </div>
  </section>`;

  const qaPanel = html`<section style="${safe(railCardBorder)}">
    <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.8rem">${ic("chat", 15, "#00d4ff", 1.7)}<span style="font-family:${safe(MONO)};font-size:.7rem;letter-spacing:.1em;color:#9fb1c2">${t("mb.opQuestions")}</span>${openQ > 0 ? html`<span style="margin-left:auto;font-family:${safe(MONO)};font-size:.58rem;color:#f0a500;border:1px solid rgba(240,165,0,.4);background:rgba(240,165,0,.08);padding:.08rem .4rem;border-radius:10px">${t("mb.opOpenCount", { n: openQ })}</span>` : safe("")}</div>
    <div style="display:flex;flex-direction:column;gap:.6rem">
      ${questions.length
        ? questions.map(
            (q) => html`<div style="border:1px solid rgba(255,255,255,.06);border-radius:9px;padding:.6rem .65rem">
              <div style="display:flex;align-items:center;gap:.4rem;margin-bottom:.4rem">${avatarSpan(q.asker)}<strong style="font-size:.82rem;color:#eaf4fb">${q.asker}</strong></div>
              <div style="color:#c2d2de;font-size:.84rem;line-height:1.42;margin-bottom:.5rem">${q.body}</div>
              ${q.answer
                ? html`<div style="display:flex;align-items:flex-start;gap:.45rem;padding:.45rem .55rem;border:1px solid rgba(0,255,136,.28);background:rgba(0,255,136,.05);border-radius:8px">${ic("check", 13, "#00ff88", 2)}<div style="min-width:0"><span style="font-family:${safe(MONO)};font-size:.6rem;color:#00ff88">${q.answeredBy ?? ""}</span><div style="color:#c2d2de;font-size:.82rem;line-height:1.4">${q.answer}</div></div></div>`
                : html`<form method="post" action="${bp}/ops/${op.id}/questions/${q.id}/answer" style="display:flex;gap:.4rem;align-items:flex-end">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <textarea name="answer" required placeholder="${t("mb.opAnswerPh")}" style="flex:1;min-width:0;min-height:36px;background:#0e1926;border:1px solid rgba(0,212,255,.14);color:#ccdde8;font-family:'Rajdhani',system-ui,sans-serif;font-size:.84rem;padding:.42rem .55rem;border-radius:8px;outline:none;resize:vertical"></textarea>
                    <button type="submit" style="flex-shrink:0;padding:.5rem .65rem;border:1px solid rgba(0,255,136,.45);background:rgba(0,255,136,.12);color:#00ff88;font-family:${safe(MONO)};font-size:.68rem;border-radius:8px;cursor:pointer">${t("mb.opSend")}</button>
                  </form>`}
            </div>`,
          )
        : html`<div style="padding:.5rem;color:#5b6b7a;font-size:.8rem;font-family:${safe(MONO)}">${t("mb.opNoQuestions")}</div>`}
    </div>
  </section>`;

  const opActionsPanel = html`<section style="${safe(railCardBorder)}">
    ${labelMono(t("mb.opActions"))}
    <div style="display:flex;flex-direction:column;gap:.4rem">
      <a href="${bp}/ops/${op.id}/manage?tab=fleet" style="display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .7rem;border:1px solid rgba(0,212,255,.22);background:rgba(0,212,255,.03);color:#9fb1c2;font-family:${safe(MONO)};font-size:.72rem;border-radius:8px;text-decoration:none">${ic("board", 14, "currentColor", 1.7)}${t("mb.opManageFleet")}</a>
      <a href="${bp}/ops/${op.id}/manage?tab=needs" style="display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .7rem;border:1px solid rgba(0,212,255,.22);background:rgba(0,212,255,.03);color:#9fb1c2;font-family:${safe(MONO)};font-size:.72rem;border-radius:8px;text-decoration:none">${ic("alert", 14, "currentColor", 1.7)}${t("mb.opManageNeeds")}</a>
      <a href="${bp}/ops/${op.id}/manage?tab=admin" style="display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .7rem;border:1px solid rgba(0,212,255,.22);background:rgba(0,212,255,.03);color:#9fb1c2;font-family:${safe(MONO)};font-size:.72rem;border-radius:8px;text-decoration:none">${ic("bolt", 14, "currentColor", 1.7)}${t("mb.opAdmin")}</a>
    </div>
  </section>`;

  const leadersPanel = html`<section style="${safe(railCardBorder)}">
    ${labelMono(t("mb.opLeadership"))}
    <div style="display:flex;flex-direction:column;gap:.5rem">
      ${leaders.length
        ? leaders.map(
            (l) => html`<div style="display:flex;align-items:center;gap:.5rem">${avatarSpan(l.user.username)}<div style="flex:1;min-width:0"><div style="font-size:.85rem;color:#eaf4fb">${l.user.username}</div><div style="font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.04em;color:#5b6b7a">${t("mb.opLeadRole")}</div></div></div>`,
          )
        : html`<div style="color:#5b6b7a;font-size:.8rem">—</div>`}
    </div>
  </section>`;

  const fillRing = html`<div style="position:relative;width:62px;height:62px;border-radius:50%;background:conic-gradient(#00ff88 ${fillPct * 3.6}deg,#0e1926 0);flex-shrink:0"><div style="position:absolute;inset:7px;border-radius:50%;background:#090f18;display:flex;flex-direction:column;align-items:center;justify-content:center"><span style="font-family:${safe(MONO)};font-size:1.1rem;color:#eaf4fb;line-height:1">${fillPct}%</span><span style="font-family:${safe(MONO)};font-size:.48rem;letter-spacing:.1em;color:#5b6b7a">${t("mb.opFull")}</span></div></div>`;

  const barsBlock = html`<div style="display:flex;flex-direction:column;gap:.6rem">
    ${opBars.map(
      (b) => html`<div><div style="display:flex;justify-content:space-between;margin-bottom:.28rem"><span style="display:inline-flex;align-items:center;gap:.4rem;font-size:.78rem;color:#c2d2de"><span style="width:8px;height:8px;border-radius:2px;background:${b.accent}"></span>${b.label}</span><span style="font-family:${safe(MONO)};font-size:.74rem;color:#9fb1c2">${b.text}</span></div><div style="height:5px;border-radius:4px;background:#0e1926;overflow:hidden"><div style="height:100%;width:${b.pct}%;background:${b.accent};border-radius:4px"></div></div></div>`,
    )}
  </div>`;

  const kpi = (val: number | string, label: string, color: string, bdr: string) =>
    html`<div style="display:inline-flex;align-items:center;gap:.5rem;padding:.42rem .7rem;border:1px solid ${bdr};background:rgba(255,255,255,.01);border-radius:8px"><span style="font-family:${safe(MONO)};font-size:1.02rem;color:${color};line-height:1">${val}</span><span style="font-family:${safe(MONO)};font-size:.56rem;letter-spacing:.08em;color:#5b6b7a">${label}</span></div>`;

  const opSegA = layB ? optSeg : optSegOn;
  const opSegB = layB ? optSegOn : optSeg;
  const kpiStrip = html`<div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.9rem 1.4rem;margin-bottom:1.4rem">
    <div style="display:flex;align-items:center;gap:.8rem;flex-wrap:wrap">
      <span style="font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.14em;color:#5b6b7a">${t("mb.opLayout")}</span>
      <div style="display:inline-flex;border:1px solid rgba(0,212,255,.16);border-radius:9px;padding:3px;background:#090f18;gap:3px">
        <a href="${bp}/ops/${op.id}?view=operator" style="${safe(opSegA)};display:inline-flex;align-items:center;gap:5px;text-decoration:none">${ic("board", 14, "currentColor", 1.7)}${t("mb.opLayoutA")}</a>
        <a href="${bp}/ops/${op.id}?view=operator&lay=b" style="${safe(opSegB)};display:inline-flex;align-items:center;gap:5px;text-decoration:none">${ic("bolt", 14, "currentColor", 1.7)}${t("mb.opLayoutB")}</a>
      </div>
    </div>
    <div style="display:flex;gap:.5rem;flex-wrap:wrap">
      ${kpi(opFilled, t("mb.opKpiFilled"), "#00ff88", "rgba(0,255,136,.25)")}
      ${kpi(opOpen, t("mb.opKpiOpen"), "#f0a500", "rgba(240,165,0,.28)")}
      ${kpi(flexWaiting, t("mb.opKpiFlex"), "#f0a500", "rgba(240,165,0,.28)")}
      ${kpi(openQ, t("mb.opKpiQ"), "#00d4ff", "rgba(0,212,255,.2)")}
    </div>
  </div>`;

  const toolsBlock = html`<details style="margin-top:.4rem">
    <summary style="display:inline-flex;align-items:center;gap:.5rem;padding:.5rem .85rem;border:1px solid rgba(0,212,255,.16);background:rgba(0,212,255,.03);color:#9fb1c2;font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.03em;border-radius:8px;cursor:pointer;list-style:none;width:fit-content">${ic("chevron", 14, "currentColor", 1.7)}${t("mb.opTools")}</summary>
    <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-top:.9rem">
      <section style="flex:1 1 300px;min-width:0;${safe(railCardBorder)}">
        ${labelMono(t("mb.opActivity"))}
        <div style="display:flex;flex-direction:column">
          ${auditLogs.length
            ? auditLogs.slice(0, 12).map(
                (a) => html`<div style="display:flex;gap:.6rem;padding:.32rem 0;border-bottom:1px solid rgba(255,255,255,.05);font-size:.82rem"><span style="font-family:${safe(MONO)};font-size:.7rem;color:#5b6b7a;flex-shrink:0">${fmt(new Date(a.createdAt), { hour: "2-digit", minute: "2-digit" })}</span><span style="color:#c2d2de"><strong style="color:#eaf4fb">${a.actor}</strong> ${a.action}${a.detail ? html`<span style="color:#7e92a4"> · ${a.detail}</span>` : safe("")}</span></div>`,
              )
            : html`<div style="color:#5b6b7a;font-size:.8rem">—</div>`}
        </div>
      </section>
      <section style="flex:1 1 300px;min-width:0;${safe(railCardBorder)}">
        <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.4rem">${ic("eye", 15, "#00d4ff", 1.7)}<span style="font-family:${safe(MONO)};font-size:.7rem;letter-spacing:.12em;color:#9fb1c2">${t("mb.opHangarShares")}</span></div>
        <p style="margin:0 0 .9rem;color:#7e92a4;font-size:.78rem">${t("mb.opHangarSharesSub")}</p>
        <div style="display:flex;flex-direction:column;gap:.7rem">
          ${hangarShares.length
            ? hangarShares.map(
                (sh) => html`<div style="border:1px solid rgba(0,212,255,.1);border-radius:10px;padding:.7rem .8rem"><div style="display:flex;align-items:center;gap:.55rem">${avatarSpan(sh.user?.username ?? "?")}<strong style="font-size:.9rem;color:#eaf4fb">${sh.user?.username ?? "?"}</strong></div>${sh.note ? html`<div style="color:#7e92a4;font-size:.78rem;margin-top:.4rem">${sh.note}</div>` : safe("")}</div>`,
              )
            : html`<div style="color:#5b6b7a;font-size:.8rem">${t("mb.opNoShares")}</div>`}
        </div>
      </section>
    </div>
  </details>`;

  const layoutA = html`<div style="display:flex;flex-wrap:wrap;gap:1.4rem;align-items:flex-start">
    <aside style="flex:1 1 320px;max-width:380px;min-width:0;display:flex;flex-direction:column;gap:1rem">
      <section style="${safe(railCardBorder)}">
        <div style="display:flex;align-items:center;gap:.9rem;margin-bottom:1rem">${fillRing}<div style="flex:1;min-width:0"><div style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1rem;color:#eaf4fb;line-height:1.1">${t("mb.opSlotsOf", { f: opFilled, t: opTotal })}</div><div style="color:#7e92a4;font-size:.76rem;margin-top:1px">${t("mb.opOpenFlex", { open: opOpen, flex: flexWaiting })}</div></div></div>
        ${barsBlock}
      </section>
      ${opActionsPanel}
      ${leadersPanel}
    </aside>
    <div style="flex:3 1 560px;min-width:0">
      <div style="display:flex;flex-wrap:wrap;gap:1rem;margin-bottom:1.6rem">
        <div style="flex:1 1 270px;min-width:0">${flexPanel}</div>
        <div style="flex:1 1 270px;min-width:0">${needsPanel}</div>
        <div style="flex:1 1 270px;min-width:0">${qaPanel}</div>
      </div>
      ${opBoard}
      ${toolsBlock}
    </div>
  </div>`;

  const layoutBView = html`<div style="display:flex;flex-wrap:wrap;gap:1.4rem;align-items:flex-start">
    <div style="flex:3 1 560px;min-width:0">
      <section style="border:1px solid rgba(0,212,255,.13);border-radius:14px;background:#090f18;padding:1rem 1.2rem;margin-bottom:1.3rem">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.7rem 1.4rem">
          <div style="display:flex;align-items:center;gap:.5rem"><span style="font-family:${safe(MONO)};font-size:1.5rem;color:#eaf4fb;line-height:1">${fillPct}%</span><span style="font-family:${safe(MONO)};font-size:.56rem;letter-spacing:.1em;color:#5b6b7a">${t("mb.opKpiFilled")}</span></div>
          <div style="flex:1;min-width:200px">${barsBlock}</div>
        </div>
      </section>
      ${opBoard}
      ${toolsBlock}
    </div>
    <aside style="flex:1 1 320px;max-width:380px;min-width:0;display:flex;flex-direction:column;gap:1rem">
      ${flexPanel}
      ${needsPanel}
      ${qaPanel}
      ${opActionsPanel}
    </aside>
  </div>`;

  const operatorConsole = html`<div id="op-console">
    ${kpiStrip}
    ${layB ? layoutBView : layoutA}
    <form id="op-assign-form" method="post" style="display:none"><input type="hidden" name="_csrf" value="${csrf}" /><input type="hidden" name="ui" value="operator" /><input type="hidden" name="view" value="operator" />${layB ? html`<input type="hidden" name="lay" value="b" />` : safe("")}<input type="hidden" name="userId" id="op-assign-user" /></form>
    <form id="op-unassign-form" method="post" style="display:none"><input type="hidden" name="_csrf" value="${csrf}" /><input type="hidden" name="ui" value="operator" /><input type="hidden" name="view" value="operator" />${layB ? html`<input type="hidden" name="lay" value="b" />` : safe("")}</form>
  </div>`;

  const body = html`${safe(SPRITE)}
    <main style="max-width:${isBoard2 ? "1700px" : "1340px"};margin:0 auto;padding:1.4rem 1.2rem 5rem;font-family:'Rajdhani','Inter',system-ui,sans-serif;color:#ccdde8">
      <section style="position:relative;border:1px solid rgba(0,212,255,.18);border-radius:14px;overflow:hidden;background:linear-gradient(135deg,rgba(0,212,255,.06),transparent 46%),#0a121c;padding:1.7rem 1.8rem;margin-bottom:1.1rem">
        <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem;margin-bottom:.95rem">
          <span style="display:inline-flex;align-items:center;gap:6px;border:1px solid rgba(0,255,136,.4);color:#00ff88;background:rgba(0,255,136,.08);font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.08em;padding:.2rem .55rem;border-radius:4px"><span style="width:7px;height:7px;border-radius:50%;background:#00ff88;box-shadow:0 0 8px #00ff88"></span>${safe(t(`status.${op.status}`).toUpperCase())}</span>
          <span style="border:1px solid rgba(0,212,255,.38);color:#00d4ff;background:rgba(0,212,255,.08);font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.08em;padding:.2rem .55rem;border-radius:4px">${safe(t(`vis.${op.visibility}`).toUpperCase())}</span>
          <span style="display:inline-flex;align-items:center;gap:6px;color:#9fb1c2;font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.06em;padding:.2rem .2rem">${ic("clock", 13, "currentColor", 1.7)}${safe(heroDate.toUpperCase())}</span>
        </div>
        <h1 style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:2.1rem;line-height:1.12;color:#eaf4fb;margin:0 0 .7rem;letter-spacing:.01em">${op.title}</h1>
        <div style="display:flex;flex-wrap:wrap;gap:.35rem 1.3rem;color:#9fb1c2;font-size:.92rem">
          <span style="display:inline-flex;align-items:center;gap:6px">${ic("pin", 15, "#00d4ff", 1.6)}${op.meetingLocation}</span>
          <span style="display:inline-flex;align-items:center;gap:6px">${ic("globe", 15, "#00d4ff", 1.6)}${op.meetingSystem}</span>
          <span style="display:inline-flex;align-items:center;gap:6px">${ic("users", 15, "#00d4ff", 1.6)}${t("mb.signedMin", { n: signedCount, min: op.minParticipants })}</span>
        </div>
      </section>

      <div style="display:flex;flex-wrap:wrap;gap:1.1rem;margin-bottom:1.6rem">
        <section style="flex:1.7 1 380px;min-width:0;border:1px solid rgba(0,212,255,.13);border-radius:14px;background:#090f18;padding:1.5rem 1.6rem">
          <div style="font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.14em;color:#9fb1c2;margin-bottom:.85rem">${t("mb.missionObjective")}</div>
          <div class="mb-md" style="color:#c2d2de;font-size:1.02rem;line-height:1.62">${op.description ? renderMarkdown(op.description) : html`<p style="margin:0">${t("mb.noObjective")}</p>`}</div>
          ${op.resourceLinks && op.resourceLinks.length
            ? html`<div style="margin-top:1.2rem;border-top:1px solid rgba(0,212,255,.1);padding-top:1rem">
                <div style="font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.14em;color:#9fb1c2;margin-bottom:.7rem">${t("op.resourceLinksTitle")}</div>
                <div style="display:flex;flex-direction:column;gap:.5rem">
                  ${op.resourceLinks.map(
                    (l) => html`<a href="${l.url}" target="_blank" rel="noopener noreferrer" style="display:inline-flex;align-items:center;gap:.55rem;color:#00d4ff;text-decoration:none;font-size:.92rem">${rlEmoji(l.kind)} <span>${l.title}</span> <span style="color:#5b6b7a">↗</span></a>`,
                  )}
                </div>
              </div>`
            : safe("")}
        </section>
        <section style="flex:1 1 290px;min-width:0;border:1px solid rgba(0,212,255,.13);border-radius:14px;background:#090f18;padding:1.5rem 1.6rem">
          <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:.85rem">
            <span style="font-family:${safe(MONO)};font-size:.72rem;letter-spacing:.14em;color:#9fb1c2">${t("mb.signups")}</span>
            <span style="font-family:${safe(MONO)};font-size:1.15rem;color:#eaf4fb"><strong style="color:#f0a500">${signedCount}</strong> <span style="color:#5b6b7a">/ ${op.minParticipants}</span></span>
          </div>
          <div style="height:7px;border-radius:5px;background:#0e1926;overflow:hidden;margin-bottom:.5rem"><div style="height:100%;width:${pct}%;border-radius:5px;background:linear-gradient(90deg,#f0a500,#f5c451)"></div></div>
          <div style="color:#9fb1c2;font-size:.82rem;margin-bottom:1.15rem">${t("mb.remainingToMin", { n: Math.max(0, op.minParticipants - signedCount) })}</div>
          <div style="display:flex;flex-direction:column;gap:.85rem;margin-bottom:1.15rem">
            ${metaRows.map((row) => html`<div style="display:flex;align-items:center;gap:.7rem"><span style="width:30px;height:30px;border-radius:7px;background:#0e1926;border:1px solid rgba(0,212,255,.12);display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic(row.ic, 15, "#9fb1c2", 1.6)}</span><span><span style="display:block;font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.1em;color:#5b6b7a">${row.lab}</span><span style="color:#ccdde8;font-size:.92rem">${row.val}</span></span></div>`)}
          </div>
          ${opts.discordInvite
            ? html`<a href="${opts.discordInvite}" target="_blank" rel="noopener" style="width:100%;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.7rem;border:1px solid rgba(0,212,255,.45);background:rgba(0,212,255,.12);color:#00d4ff;font-family:${safe(MONO)};font-size:.78rem;letter-spacing:.06em;border-radius:8px;text-decoration:none;box-sizing:border-box">${ic("chat", 16, "currentColor", 1.7)}${t("op.joinEventDiscord")}</a>`
            : safe("")}
        </section>
      </div>

      <div style="display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:.8rem;margin-bottom:1.8rem">
        <div style="display:inline-flex;border:1px solid rgba(0,212,255,.16);border-radius:9px;padding:3px;background:#090f18;gap:3px">
          <a href="${bp}/ops/${op.id}" style="${safe(isOperatorView ? tabIdle : tabActive)}">${ic("fps", 15, "currentColor", 1.7)}${t("join.playerView")}</a>
          ${canManage ? html`<a href="${bp}/ops/${op.id}?view=operator" style="${safe(isOperatorView ? tabActive : tabIdle)}">${ic("board", 15, "currentColor", 1.7)}${t("join.operatorView")}</a>` : safe("")}
        </div>
        <div style="display:flex;align-items:center;gap:1.1rem;flex-wrap:wrap">
          ${optikSwitch}
          ${signedUp ? html`<span style="display:inline-flex;align-items:center;gap:.45rem;color:#00ff88;font-size:.88rem">${ic("check", 15, "currentColor", 1.7)}${t("mb.youAreParticipant")}</span>` : safe("")}
        </div>
      </div>

      ${isOperatorView
        ? operatorConsole
        : html`${myId && isOpen
            ? html`<section style="border:1px solid rgba(0,212,255,.13);border-radius:14px;background:#090f18;padding:1.6rem 1.7rem;margin-bottom:1.6rem">
                <div style="display:flex;align-items:baseline;gap:.7rem;flex-wrap:wrap;margin-bottom:.4rem"><h2 style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1.45rem;color:#eaf4fb;margin:0">${t("join.contribute")}</h2><span style="color:#9fb1c2;font-size:.95rem">${t("mb.howContribute")}</span></div>
                <p style="margin:0 0 1.3rem;color:#9fb1c2;font-size:.95rem;max-width:62ch">${safe(t("mb.contributeBody"))}</p>
                <div style="display:flex;flex-wrap:wrap;gap:.9rem">
                  ${mmCards.map((c) => html`<button type="button" data-mm="${c.mm}" style="flex:1 1 240px;text-align:left;border:1px solid rgba(${safe(c.acc)},.22);border-radius:11px;background:rgba(${safe(c.acc)},.04);padding:1.2rem 1.25rem;cursor:pointer;color:inherit;font-family:inherit"><span style="width:38px;height:38px;border-radius:9px;background:rgba(${safe(c.acc)},.13);border:1px solid rgba(${safe(c.acc)},.28);color:${c.col};display:inline-flex;align-items:center;justify-content:center;margin-bottom:.9rem">${ic(c.icon, 19, "currentColor", 1.6)}</span><div style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1.1rem;color:#eaf4fb;margin-bottom:.3rem">${c.ttl}</div><div style="color:#9fb1c2;font-size:.88rem;margin-bottom:.9rem;line-height:1.5">${c.sub}</div><span style="display:inline-flex;align-items:center;gap:5px;color:${c.col};font-family:${safe(MONO)};font-size:.74rem;letter-spacing:.04em">${c.cta} ${ic("arrow", 14, "currentColor", 1.8)}</span></button>`)}
                </div>
              </section>`
            : safe("")}

          <div style="display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1.1rem;padding:.7rem .2rem;margin-bottom:1.2rem;border-top:1px solid rgba(0,212,255,.1);border-bottom:1px solid rgba(0,212,255,.1)">
            <span style="font-family:${safe(MONO)};font-size:.62rem;letter-spacing:.1em;color:#5b6b7a">${t("mb.howFixed")}</span>
            ${legendSpan("fest", t("mb.legendFest"))}${legendSpan("typ", t("mb.legendTyp"))}${legendSpan("rolle_offen", t("mb.legendRolle"))}${legendSpan("frei", t("mb.legendFrei"))}
          </div>

          <div id="mb-fleet">
            ${fleetBlock}
            ${cats.length === 0 ? html`<p style="color:#7e92a4">${t("op.noFleetNeeds")}</p>` : safe("")}
          </div>

          <form id="mb-flex-form" method="post" action="${bp}/api/ops/${op.id}/crew-requests" style="display:none">
            <input type="hidden" name="_csrf" value="${csrf}" /><input type="hidden" name="ui" value="player" /><input type="hidden" name="tab" value="crew" />
          </form>`}
    </main>

    ${isOperatorView ? opScript(bp, op.id) : mbModal({ bp, opId: op.id, csrf, hangarRows, myHangarShared })}
    ${isOperatorView ? safe("") : mbScript(bp, op.id)}`;

  return layout({ title: op.title, basePath: bp, currentUser: opts.currentUser, csrfToken: opts.csrfToken, flash: flashFromQuery(opts.flash), body });
}

function mbModal(o: {
  bp: string;
  opId: string;
  csrf: string;
  hangarRows: Array<{ id: string; name: string; mfr: string; meta: string; matchTypes: string[] }>;
  myHangarShared: boolean;
}): SafeHtml {
  return html`<div id="mb-modal" hidden style="position:fixed;inset:0;z-index:1000;background:rgba(2,4,8,.74);backdrop-filter:blur(4px);display:flex;align-items:flex-start;justify-content:center;padding:3vh 1rem;overflow-y:auto">
    <form id="mb-modal-form" method="post" action="" style="width:100%;max-width:480px;background:#0a121c;border:1px solid rgba(0,212,255,.3);border-radius:14px;margin:auto">
      <input type="hidden" name="_csrf" value="${o.csrf}" /><input type="hidden" name="ui" value="player" /><input type="hidden" name="tab" value="fleet" />
      <span id="mb-extra-fields"></span>
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;padding:1.3rem 1.5rem 1.1rem;border-bottom:1px solid rgba(0,212,255,.12)">
        <div>
          <div style="display:flex;align-items:center;gap:.5rem;margin-bottom:.3rem"><span style="font-family:${safe(MONO)};font-size:.6rem;letter-spacing:.1em;color:#00d4ff;border:1px solid rgba(0,212,255,.3);padding:.12rem .4rem;border-radius:3px">${t("mb.takeTitle")}</span></div>
          <h3 id="mb-modal-role" style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:700;font-size:1.35rem;color:#eaf4fb;margin:.2rem 0 .15rem"></h3>
          <div id="mb-modal-unit" style="color:#9fb1c2;font-size:.86rem"></div>
        </div>
        <button type="button" data-mb-close style="flex-shrink:0;width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.1);background:transparent;color:#9fb1c2;display:inline-flex;align-items:center;justify-content:center;cursor:pointer">${ic("x", 17, "currentColor", 1.8)}</button>
      </div>
      <div style="padding:1.3rem 1.5rem">
        <div id="mb-modal-banner" style="display:flex;align-items:flex-start;gap:.55rem;padding:.7rem .85rem;border-radius:9px;font-size:.86rem"></div>
        <div id="mb-hangar" hidden style="margin-top:1.2rem">
          <div style="font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.12em;color:#9fb1c2;margin-bottom:.6rem">${t("mb.fromHangar")}</div>
          <div id="mb-hangar-list" style="display:flex;flex-direction:column;gap:.5rem">
            ${o.hangarRows.length
              ? o.hangarRows.map((s) => html`<label class="mb-hangar-row" data-match='${safe(JSON.stringify(s.matchTypes))}' style="display:flex;align-items:center;gap:.7rem;padding:.6rem .7rem;border:1px solid rgba(0,212,255,.12);border-radius:9px;background:#0e1926;cursor:pointer"><input type="radio" name="ownedShipId" value="${s.id}" style="accent-color:#00d4ff" /><span style="font-family:${safe(MONO)};font-size:.62rem;color:#9fb1c2;border:1px solid rgba(255,255,255,.1);padding:.1rem .35rem;border-radius:3px;flex-shrink:0">${s.mfr || "—"}</span><div style="flex:1;min-width:0;text-align:left"><div style="display:flex;align-items:center;gap:.4rem;flex-wrap:wrap"><strong style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:600;font-size:.95rem;color:#eaf4fb">${s.name}</strong><span class="mb-passend" hidden style="font-family:${safe(MONO)};font-size:.58rem;letter-spacing:.06em;color:#00ff88;border:1px solid rgba(0,255,136,.38);background:rgba(0,255,136,.08);padding:.1rem .35rem;border-radius:3px">${t("mb.fits")}</span></div><div style="font-family:${safe(MONO)};font-size:.72rem;color:#7e92a4;margin-top:2px">${s.meta}</div></div></label>`)
              : html`<div style="color:#7e92a4;font-size:.84rem">${t("mb.hangarEmptyHint")}</div>`}
          </div>
        </div>
        <div style="margin-top:1.2rem">
          <div style="font-family:${safe(MONO)};font-size:.66rem;letter-spacing:.12em;color:#9fb1c2;margin-bottom:.5rem">${t("mb.noteToOperator")} <span style="color:#5b6b7a">· optional</span></div>
          <textarea name="captainNote" maxlength="240" placeholder="${t("op.captainNotePlaceholder")}" style="width:100%;min-height:76px;background:#0e1926;border:1px solid rgba(0,212,255,.14);color:#ccdde8;font-family:'Rajdhani',system-ui,sans-serif;font-size:.9rem;padding:.6rem .85rem;border-radius:8px;outline:none;resize:vertical;box-sizing:border-box"></textarea>
        </div>
        <div style="display:flex;align-items:center;gap:.8rem;margin-top:1.1rem;padding:.85rem .95rem;border:1px solid rgba(0,212,255,.14);border-radius:10px;background:#0e1926">
          <span style="width:32px;height:32px;border-radius:8px;background:rgba(0,212,255,.1);color:#00d4ff;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">${ic("eye", 17, "currentColor", 1.6)}</span>
          <div style="flex:1;min-width:0"><div style="font-family:'Rajdhani',system-ui,sans-serif;font-weight:600;font-size:.95rem;color:#eaf4fb">${t("mb.hangarToggleTitle")}</div><div style="color:#7e92a4;font-size:.8rem;line-height:1.45">${t("mb.hangarToggleSub")}</div></div>
          <input type="checkbox" id="mb-hangar-share" ${o.myHangarShared ? safe("checked") : safe("")} style="width:42px;height:24px;accent-color:#00d4ff;cursor:pointer" />
        </div>
        <div style="display:flex;gap:.7rem;margin-top:1.4rem">
          <button type="button" data-mb-close style="flex:1;padding:.75rem;border:1px solid rgba(255,255,255,.12);background:transparent;color:#9fb1c2;font-family:${safe(MONO)};font-size:.78rem;letter-spacing:.04em;border-radius:9px;cursor:pointer">${t("common.cancel")}</button>
          <button type="submit" style="flex:1.5;display:inline-flex;align-items:center;justify-content:center;gap:.5rem;padding:.75rem;border:1px solid rgba(0,255,136,.5);background:rgba(0,255,136,.16);color:#00ff88;font-family:${safe(MONO)};font-size:.78rem;letter-spacing:.04em;border-radius:9px;cursor:pointer">${ic("check", 15, "currentColor", 2)}${t("mb.takeTitle")}</button>
        </div>
      </div>
    </form>
  </div>`;
}

function mbScript(bp: string, opId: string): SafeHtml {
  const banners: Record<Kind, { text: string; style: string }> = {
    fest: { text: t("slot.festHelp"), style: "border:1px solid rgba(159,182,201,.3);background:rgba(159,182,201,.06);color:#bcd0e0" },
    typ: { text: t("slot.typHelp"), style: "border:1px solid rgba(240,165,0,.3);background:rgba(240,165,0,.07);color:#f0c97a" },
    rolle_offen: { text: t("slot.rolleOffenHelp"), style: "border:1px solid rgba(0,255,136,.3);background:rgba(0,255,136,.06);color:#9ff0c4" },
    frei: { text: t("slot.freiHelp"), style: "border:1px solid rgba(159,182,201,.3);background:rgba(159,182,201,.06);color:#bcd0e0" },
  };
  const hangarUrl = `${bp}/api/ops/${opId}/hangar-share`;
  const js = `(function(){
  var modal=document.getElementById("mb-modal"); if(!modal) return;
  var form=document.getElementById("mb-modal-form"), extra=document.getElementById("mb-extra-fields"),
      hangar=document.getElementById("mb-hangar"), roleEl=document.getElementById("mb-modal-role"),
      unitEl=document.getElementById("mb-modal-unit"), bannerEl=document.getElementById("mb-modal-banner"),
      shareCb=document.getElementById("mb-hangar-share");
  var BANNERS=${JSON.stringify(banners)};
  function close(){ modal.hidden=true; document.body.style.overflow=""; }
  document.querySelectorAll("[data-mb-close]").forEach(function(b){b.addEventListener("click",close);});
  modal.addEventListener("click",function(e){ if(e.target===modal) close(); });
  document.querySelectorAll("[data-take]").forEach(function(btn){
    btn.addEventListener("click",function(){
      var kind=btn.getAttribute("data-kind")||"fest", needShip=btn.getAttribute("data-needship")==="1",
          shipType=btn.getAttribute("data-shiptype")||"", fields={};
      try{fields=JSON.parse(btn.getAttribute("data-fields")||"{}");}catch(e){}
      var card=btn.closest("details"), unitName=""; if(card){var st=card.querySelector("summary strong"); if(st) unitName=st.textContent;}
      roleEl.textContent=btn.getAttribute("data-role")||""; unitEl.textContent=unitName;
      form.setAttribute("action",btn.getAttribute("data-action")||"");
      var b=BANNERS[kind]||BANNERS.fest;
      bannerEl.setAttribute("style",b.style+";display:flex;align-items:flex-start;gap:.55rem;padding:.7rem .85rem;border-radius:9px;font-size:.86rem");
      bannerEl.textContent=b.text;
      extra.innerHTML="";
      Object.keys(fields).forEach(function(k){var i=document.createElement("input");i.type="hidden";i.name=k;i.value=fields[k];extra.appendChild(i);});
      hangar.hidden=!needShip;
      if(needShip){
        var rows=modal.querySelectorAll(".mb-hangar-row"), firstMatch=null;
        rows.forEach(function(r){
          var m=[]; try{m=JSON.parse(r.getAttribute("data-match")||"[]");}catch(e){}
          var fits=!!shipType&&(m.indexOf(shipType)>=0||m.indexOf("any")>=0);
          var p=r.querySelector(".mb-passend"); if(p)p.hidden=!fits;
          r.style.order=fits?"0":"1"; if(fits&&!firstMatch)firstMatch=r;
        });
        var rd=firstMatch||rows[0]; if(rd){var inp=rd.querySelector("input[type=radio]"); if(inp)inp.checked=true;}
      }
      modal.hidden=false; document.body.style.overflow="hidden";
    });
  });
  form.addEventListener("submit",function(e){
    if(shareCb&&shareCb.checked&&!form.__shared){
      e.preventDefault(); form.__shared=true;
      var csrf=(form.querySelector("input[name=_csrf]")||{}).value||"";
      var body="_csrf="+encodeURIComponent(csrf)+"&allow=1&ui=player&tab=crew";
      fetch(${JSON.stringify(hangarUrl)},{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:body,credentials:"same-origin"})
        .then(function(){form.submit();},function(){form.submit();});
    }
  });
  document.querySelectorAll("[data-mm]").forEach(function(c){
    c.addEventListener("click",function(){
      if(c.getAttribute("data-mm")==="flex"){var f=document.getElementById("mb-flex-form"); if(f)f.submit(); return;}
      var fl=document.getElementById("mb-fleet"); if(fl)fl.scrollIntoView({behavior:"smooth",block:"start"});
    });
  });
})();`;
  return html`<script>
    ${safe(js)}
  </script>`;
}

// Operator-console client JS: place-mode assign, inline seat-picker, drag & drop,
// and seat unassign. Commits go through hidden forms (server redirect + re-render),
// matching the rest of the app — no JSON endpoints needed.
function opScript(bp: string, opId: string): SafeHtml {
  const assignBase = `${bp}/api/seats/`;
  const js = `(function(){
  var root=document.getElementById("op-console"); if(!root) return;
  var assignForm=document.getElementById("op-assign-form"),
      unassignForm=document.getElementById("op-unassign-form"),
      userInput=document.getElementById("op-assign-user");
  var placing=null;
  var ASSIGN=${JSON.stringify(assignBase)};
  function doAssign(seatId,userId){ if(!seatId||!userId)return; assignForm.setAttribute("action",ASSIGN+encodeURIComponent(seatId)+"/assign"); userInput.value=userId; assignForm.submit(); }
  function doUnassign(seatId){ if(!seatId)return; unassignForm.setAttribute("action",ASSIGN+encodeURIComponent(seatId)+"/unassign"); unassignForm.submit(); }
  function setTargets(on){ root.querySelectorAll("[data-op-seat]").forEach(function(s){ s.style.boxShadow=on?"0 0 0 1px rgba(0,255,136,.5)":""; var oh=s.querySelector(".op-open-hint"),th=s.querySelector(".op-target-hint"); if(oh)oh.hidden=!!on; if(th)th.hidden=!on; }); }
  function clearPlace(){ placing=null; var b=document.getElementById("op-place-banner"); if(b)b.remove(); setTargets(false); }
  function startPlace(userId,name){ placing={userId:userId,name:name};
    var old=document.getElementById("op-place-banner"); if(old)old.remove();
    var banner=document.createElement("div"); banner.id="op-place-banner";
    banner.setAttribute("style","position:sticky;top:8px;z-index:60;display:flex;align-items:center;gap:.7rem;padding:.7rem 1rem;margin-bottom:1.1rem;border:1px solid rgba(240,165,0,.55);background:linear-gradient(90deg,rgba(240,165,0,.16),rgba(240,165,0,.04));border-radius:10px");
    var info=document.createElement("div"); info.setAttribute("style","flex:1;min-width:0;color:#eaf4fb;font-size:.92rem");
    info.innerHTML='<span style="font-family:\\'Share Tech Mono\\',monospace;font-size:.62rem;letter-spacing:.12em;color:#f0a500">EINTEILEN-MODUS</span><div style="margin-top:1px"><strong></strong> — wähle unten einen offenen Platz <span style="color:#f0c97a">(grün)</span></div>';
    info.querySelector("strong").textContent=name; banner.appendChild(info);
    var cancel=document.createElement("button"); cancel.type="button"; cancel.textContent="Abbrechen";
    cancel.setAttribute("style","flex-shrink:0;padding:.42rem .8rem;border:1px solid rgba(255,255,255,.18);background:transparent;color:#9fb1c2;font-family:\\'Share Tech Mono\\',monospace;font-size:.72rem;border-radius:7px;cursor:pointer");
    cancel.addEventListener("click",clearPlace); banner.appendChild(cancel);
    root.insertBefore(banner,root.firstChild); setTargets(true);
  }
  root.querySelectorAll("[data-op-place]").forEach(function(b){ b.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation();
    var u=b.getAttribute("data-userid"),n=b.getAttribute("data-name")||""; if(placing&&placing.userId===u){clearPlace();return;} startPlace(u,n); }); });
  root.querySelectorAll("[data-op-seat]").forEach(function(seat){ seat.addEventListener("click",function(){
    var seatId=seat.getAttribute("data-seatid");
    if(placing){ doAssign(seatId,placing.userId); return; }
    var wrap=seat.closest(".op-seat-wrap"); if(!wrap)return; var pk=wrap.querySelector(".op-picker"); if(pk)pk.hidden=!pk.hidden;
  }); });
  root.querySelectorAll("[data-op-assign]").forEach(function(b){ b.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation();
    doAssign(b.getAttribute("data-seatid"),b.getAttribute("data-userid")); }); });
  root.querySelectorAll("[data-op-closepicker]").forEach(function(b){ b.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation();
    var wrap=b.closest(".op-seat-wrap"); if(!wrap)return; var pk=wrap.querySelector(".op-picker"); if(pk)pk.hidden=true; }); });
  root.querySelectorAll("[data-op-unassign]").forEach(function(b){ b.addEventListener("click",function(e){ e.preventDefault(); e.stopPropagation();
    doUnassign(b.getAttribute("data-seatid")); }); });
  root.querySelectorAll("[data-op-flex]").forEach(function(f){ f.addEventListener("dragstart",function(e){ e.dataTransfer.setData("text/plain",f.getAttribute("data-userid")||""); e.dataTransfer.effectAllowed="move"; }); });
  root.querySelectorAll("[data-op-seat]").forEach(function(seat){
    seat.addEventListener("dragover",function(e){ e.preventDefault(); e.dataTransfer.dropEffect="move"; seat.style.boxShadow="0 0 0 2px rgba(0,255,136,.7)"; });
    seat.addEventListener("dragleave",function(){ seat.style.boxShadow=placing?"0 0 0 1px rgba(0,255,136,.5)":""; });
    seat.addEventListener("drop",function(e){ e.preventDefault(); var u=e.dataTransfer.getData("text/plain"); if(u)doAssign(seat.getAttribute("data-seatid"),u); });
  });
})();`;
  void opId;
  return html`<script>
    ${safe(js)}
  </script>`;
}
