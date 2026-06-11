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
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const isBoard2 = (opts.variant ?? "board1") === "board2";
  const csrf = opts.csrfToken ?? "";
  const myId = opts.currentUser?.id;
  const tz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const isOpen = op.status === "open";
  const ownedShips = opts.ownedShips ?? [];

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
          <span style="${safe(tabActive)}">${ic("fps", 15, "currentColor", 1.7)}${t("join.playerView")}</span>
          ${opts.canManage ? html`<a href="${bp}/ops/${op.id}/manage" style="${safe(tabIdle)}">${ic("board", 15, "currentColor", 1.7)}${t("join.operatorView")}</a>` : safe("")}
        </div>
        ${signedUp ? html`<span style="display:inline-flex;align-items:center;gap:.45rem;color:#00ff88;font-size:.88rem">${ic("check", 15, "currentColor", 1.7)}${t("mb.youAreParticipant")}</span>` : safe("")}
      </div>

      ${myId && isOpen
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
      </form>
    </main>

    ${mbModal({ bp, opId: op.id, csrf, hangarRows, myHangarShared })}
    ${mbScript(bp, op.id)}`;

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
