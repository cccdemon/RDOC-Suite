import { html, safe, rawHtml, layout, type SafeHtml, type LayoutOptions } from "./render.js";
import type { User, Operation, Ship, Location } from "@prisma/client";
import type { DiscordInstallDiagnostics, BotDiagnostic } from "../services/discordDiagnostics.js";
import {
  fmtDateTz,
  fmtDateLocalTz,
  isValidTimezone,
  TIMEZONE_OPTIONS,
  DEFAULT_TIMEZONE,
} from "../lib/timezone.js";
import { getEnv } from "../config/env.js";
import { CHANGELOG } from "../lib/changelog.js";
import { matchesCategory } from "../services/composition.js";
import type { MissionParticipant } from "../services/participants.js";
import type { MultiPositionAssignment } from "../services/primaryUnits.js";

// ── Re-export layout for routes ─────────────────────────────────────
export { layout, rawHtml } from "./render.js";

// ── Types returned by getOperation() includes ───────────────────────
type OpFull = Awaited<ReturnType<typeof import("../services/operations.js").getOperation>>;
type UnitFull = NonNullable<OpFull>["units"][number];

// ── Shared helpers ───────────────────────────────────────────────────

const REQUIREMENT_CATEGORIES = [
  "fps",
  "capital",
  "subcapital",
  "fighter",
  "support",
  "ground",
  "transport",
  "mining",
  "salvage",
  "exploration",
  "any",
] as const;

// Fleet Requirements starter templates for the creation wizard (FR-P1 Phase 3). Hosts
// load one and then tweak rows; nothing is locked. Categories must be valid
// REQUIREMENT_CATEGORIES.
const COMPOSITION_TEMPLATES = [
  {
    name: "Tactical Strike Groups",
    requirements: [
      { category: "fps", label: "Fireteam Alpha", count: 1 },
      { category: "fps", label: "Fireteam Bravo", count: 1 },
      { category: "fighter", label: "Jäger", count: 6 },
      { category: "support", label: "Support", count: 1 },
    ],
  },
  {
    name: "Hator",
    requirements: [
      { category: "capital", label: "Großkampfschiff", count: 1 },
      { category: "subcapital", label: "Subcapital", count: 2 },
      { category: "fighter", label: "Jäger-Eskorte", count: 4 },
    ],
  },
  {
    name: "Rockbreaker",
    requirements: [
      { category: "mining", label: "Mining-Schiff", count: 3 },
      { category: "transport", label: "Transport", count: 1 },
      { category: "fighter", label: "Eskorte", count: 2 },
    ],
  },
  {
    name: "Stormbreaker",
    requirements: [
      { category: "subcapital", label: "Großkampfschiff", count: 2 },
      { category: "fighter", label: "Jäger", count: 6 },
      { category: "fps", label: "Boarding-Team", count: 2 },
    ],
  },
] as const;

function categoryLabel(category: string): string {
  return (
    {
      fps: "FPS Squad",
      capital: "Capital Ship",
      subcapital: "Large / Subcapital Ship",
      fighter: "Fighter",
      support: "Support Ship",
      ground: "Ground / Vehicle",
      transport: "Transport Ship",
      mining: "Mining Ship",
      salvage: "Salvage Ship",
      exploration: "Exploration Ship",
      any: "Any Unit",
    }[category] ?? category
  );
}

function fmtDate(d: Date, tz = DEFAULT_TIMEZONE): string {
  return fmtDateTz(d, tz);
}

function fmtDateLocal(d: Date, tz = DEFAULT_TIMEZONE): string {
  return fmtDateLocalTz(d, tz);
}

function statusTag(status: string): SafeHtml {
  const map: Record<string, string> = {
    draft: "tag-dim",
    open: "tag-cyan",
    locked: "tag-gold",
    in_progress: "tag-green",
    completed: "tag",
    cancelled: "tag-red",
    pending: "tag-gold",
    accepted: "tag-green",
    rejected: "tag-red",
  };
  const cls = map[status] ?? "tag";
  return html`<span class="tag ${cls}">${status.replace("_", " ").toUpperCase()}</span>`;
}

function opTypeTag(opType: string): SafeHtml {
  return html`<span class="tag">${opType.toUpperCase()}</span>`;
}

const VISIBILITY_META: Record<string, { cls: string; icon: string; label: string }> = {
  private: { cls: "tag-dim", icon: "🔒", label: "PRIVATE" },
  partners: { cls: "tag-gold", icon: "🤝", label: "PARTNERS" },
  public: { cls: "tag-green", icon: "🌐", label: "PUBLIC" },
};

function visibilityTag(visibility: string): SafeHtml {
  const m = VISIBILITY_META[visibility] ?? VISIBILITY_META.private;
  return html`<span class="tag ${m.cls}">${m.icon} ${m.label}</span>`;
}

/**
 * Visibility control: a select + save button for op leaders, or a plain
 * badge for everyone else. `action` is the POST target.
 */
function visibilityControl(opts: {
  visibility: string;
  canEdit: boolean;
  action: string;
  csrfToken?: string;
}): SafeHtml {
  if (!opts.canEdit) return visibilityTag(opts.visibility);
  const option = (value: string, label: string): SafeHtml =>
    html`<option value="${value}" ${opts.visibility === value ? safe("selected") : ""}>
      ${label}
    </option>`;
  return html`<form method="post" action="${opts.action}" class="opv2-inline-form">
    <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
    <select name="visibility" aria-label="Visibility">
      ${option("private", "🔒 Private (this Discord only)")}
      ${option("partners", "🤝 Partners (this Discord + linked ones)")}
      ${option("public", "🌐 Public (any logged-in user)")}
    </select>
    <button type="submit" class="btn btn-sm">Set visibility</button>
  </form>`;
}

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function discordBotInviteUrl(clientId: string, permissions: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    scope: "bot applications.commands",
    permissions,
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

const SYSTEMS = ["stanton", "nyx", "pyro"] as const;
const OP_TYPES = [
  "combat",
  "pve",
  "mining",
  "salvage",
  "training",
  "mixed",
  "exploration",
  "transport",
  "social",
] as const;
const MISSION_IMAGE_TYPES = new Set<string>(OP_TYPES);

function systemLabel(system: string): string {
  return system ? system[0].toUpperCase() + system.slice(1) : "Stanton";
}

function flashFromQuery(msg: string | undefined): LayoutOptions["flash"] {
  if (!msg) return null;
  const [kind, ...rest] = msg.split(":");
  const text = rest.join(":") || msg;
  if (kind === "ok" || kind === "warn" || kind === "error") return { kind, text };
  return { kind: "ok", text: msg };
}

function missionImageType(opType: string): string {
  const normalized = opType.toLowerCase();
  return MISSION_IMAGE_TYPES.has(normalized) ? normalized : "combat";
}

function missionImageUrl(bp: string, opType: string): string {
  return `${bp}/assets/mission-images/${missionImageType(opType)}.png`;
}

export function opPublicPreviewPage(opts: {
  basePath: string;
  op: { id: string; title: string; description: string; opType: string; scheduledAt: Date };
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const { WEB_PUBLIC_URL } = getEnv();
  const body = html` <div style="max-width:42rem;margin:4rem auto;text-align:center">
    <div
      class="mission-banner"
      style="background-image:linear-gradient(90deg,rgba(5,8,16,.92),rgba(5,8,16,.55),rgba(5,8,16,.18)),url('${missionImageUrl(
        bp,
        op.opType,
      )}');margin-bottom:2rem"
    ></div>
    <h1
      style="font-family:var(--font-mono);color:var(--cyan);font-size:1.5rem;letter-spacing:.08em;margin-bottom:.75rem"
    >
      ${op.title}
    </h1>
    ${op.description
      ? html`<p style="color:var(--dim);margin-bottom:1.5rem;font-size:.92rem;line-height:1.7">
          ${op.description.slice(0, 300)}
        </p>`
      : ""}
    <p style="color:var(--dim);font-size:.82rem;margin-bottom:2rem">
      Login um diese Operation zu sehen.
    </p>
    <a href="${bp}/login" class="btn">Login</a>
  </div>`;
  return layout({
    title: op.title,
    basePath: bp,
    currentUser: null,
    ogMeta: {
      title: op.title,
      description: op.description ? op.description.slice(0, 200) : undefined,
      imageUrl: `${WEB_PUBLIC_URL}${missionImageUrl(bp, op.opType)}`,
      pageUrl: `${WEB_PUBLIC_URL}${bp}/ops/${op.id}`,
    },
    body,
  });
}

function opTypeClass(opType: string): string {
  return `op-type-${opType.toLowerCase().replace(/[^a-z0-9-]/g, "-")}`;
}

// ── Home / Calendar ──────────────────────────────────────────────────

function shipSizeLabel(ship: Pick<Ship, "size" | "rawJson">): string {
  if (ship.size && ship.size !== "[object Object]") return ship.size;
  try {
    const raw = JSON.parse(ship.rawJson) as { size?: unknown };
    if (typeof raw.size === "string" || typeof raw.size === "number") return String(raw.size);
    if (raw.size && typeof raw.size === "object") {
      const size = raw.size as Record<string, unknown>;
      return String(size.en_EN ?? size.name ?? size.label ?? size.type ?? "");
    }
  } catch {
    // Ignore invalid legacy cache rows.
  }
  return "";
}

/** Title for a unit's lead. Only Capital ships (Idris etc.) carry a true
 *  "Captain"; smaller hulls are flown by a "Pilot" (user feedback). Falls back
 *  to "Captain" when there is no ship (e.g. FPS/ground units). */
function unitLeadTitle(ship?: Pick<Ship, "size" | "rawJson"> | null): string {
  if (!ship) return "Captain";
  return shipSizeLabel(ship).trim().toLowerCase() === "capital" ? "Captain" : "Pilot";
}

type OpListItem = {
  id: string;
  title: string;
  opType: string;
  scheduledAt: Date;
  status: string;
  guild: { id: string; name: string; iconHash: string | null; timezone?: string | null };
  createdBy: User;
  leaders: { user: User }[];
  units: { id: string; status: string }[];
};

export function homePage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  ops: OpListItem[];
  includePast: boolean;
  /** Guilds the user can create ops for — shown in the quick guild picker. */
  operatorGuilds?: Array<{ id: string; name: string }>;
}): SafeHtml {
  const bp = opts.basePath;
  const canCreate = (opts.operatorGuilds?.length ?? 0) > 0;
  // The calendar mixes ops from several guilds, each with its own timezone.
  // Render each op's day-grouping AND time in ITS guild's timezone (matching
  // the op-detail page) instead of the server's system zone (UTC). Cache one
  // set of Intl formatters per timezone.
  const fmtCache = new Map<
    string,
    { day: Intl.DateTimeFormat; key: Intl.DateTimeFormat; time: Intl.DateTimeFormat }
  >();
  function fmtsFor(tz: string | null | undefined) {
    const safe = tz && isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
    let f = fmtCache.get(safe);
    if (!f) {
      f = {
        day: new Intl.DateTimeFormat("en-GB", {
          timeZone: safe,
          weekday: "short",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }),
        key: new Intl.DateTimeFormat("en-CA", {
          timeZone: safe,
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        }),
        time: new Intl.DateTimeFormat("en-GB", {
          timeZone: safe,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZoneName: "short",
        }),
      };
      fmtCache.set(safe, f);
    }
    return f;
  }
  // "20:00 CEST" from the time formatter parts.
  function fmtTime(op: OpListItem): string {
    const parts = fmtsFor(op.guild.timezone).time.formatToParts(op.scheduledAt);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const tzName = get("timeZoneName");
    return `${get("hour")}:${get("minute")}${tzName ? " " + tzName : ""}`;
  }

  // Assign a consistent CSS class per guild for the colored badge
  const guildIndex = new Map<string, number>();
  let guildCounter = 0;
  const GUILD_COLORS = ["guild-a", "guild-b", "guild-c", "guild-d", "guild-e"];
  function guildClass(guildId: string): string {
    if (!guildIndex.has(guildId)) guildIndex.set(guildId, guildCounter++ % GUILD_COLORS.length);
    return GUILD_COLORS[guildIndex.get(guildId)!];
  }

  const groupedOps = opts.ops.reduce<Array<{ key: string; label: string; ops: OpListItem[] }>>(
    (groups, op) => {
      const f = fmtsFor(op.guild.timezone);
      const key = f.key.format(op.scheduledAt);
      let group = groups.find((item) => item.key === key);
      if (!group) {
        group = { key, label: f.day.format(op.scheduledAt), ops: [] };
        groups.push(group);
      }
      group.ops.push(op);
      return groups;
    },
    [],
  );

  const rows = groupedOps.length
    ? html` <div class="op-date-board">
        ${groupedOps.map((group) => {
          const [weekday, day, month, year] = group.label.replace(",", "").split(" ");
          return html`<section class="op-day-group">
            <div class="op-day-label">
              <span>${weekday}</span>
              <strong>${day}</strong>
              <span>${month} ${year}</span>
            </div>
            <div class="op-card-grid">
              ${group.ops.map((op) => {
                const accepted = op.units.filter((u) => u.status === "accepted").length;
                const total = op.units.length;
                const leaders = op.leaders.map((leader) => leader.user.username).join(", ");
                return html` <a
                  href="${bp}/ops/${op.id}"
                  class="op-card ${opTypeClass(op.opType)}"
                  style="color:inherit;text-decoration:none;"
                >
                  <div class="op-card-top">
                    <span class="op-card-time">${fmtTime(op)}</span>
                    <span class="op-type-pill">${op.opType.toUpperCase()}</span>
                  </div>
                  <div class="op-card-title">${op.title}</div>
                  <div class="op-card-meta">
                    <span class="op-guild-badge ${guildClass(op.guild.id)}">${op.guild.name}</span>
                    ${statusTag(op.status)}
                  </div>
                  <div class="op-card-footer">
                    <span>${accepted}/${total} units</span>
                    <span>${leaders || op.createdBy.username}</span>
                  </div>
                </a>`;
              })}
            </div>
          </section>`;
        })}
      </div>`
    : html`<p class="text-dim text-sm">
        No operations scheduled. ${canCreate ? html`<a href="${bp}/ops/new">Create one?</a>` : ""}
      </p>`;

  // Quick new-op picker: inline guild selector when user has multiple servers
  const newOpControl = canCreate
    ? (() => {
        const guilds = opts.operatorGuilds!;
        if (guilds.length === 1) {
          return html`<a href="${bp}/ops/new" class="btn btn-sm">+ New Operation</a>`;
        }
        return html` <form method="get" action="${bp}/ops/new" class="inline new-op-picker">
          <select
            name="_guild"
            class="guild-picker-select"
            onchange="this.form.submit()"
            title="Select server for new operation"
          >
            <option value="">+ New Operation on…</option>
            ${guilds.map((g) => html`<option value="${g.id}">${g.name}</option>`)}
          </select>
        </form>`;
      })()
    : safe("");

  const body = html` <div class="page-header">
      <h1 class="page-title">FLEET OPERATIONS</h1>
      <p class="page-subtitle">Star Citizen – RDOC operation calendar</p>
    </div>
    <div class="flex gap-2 mb-1">
      ${newOpControl}
      ${opts.includePast
        ? html`<a href="${bp}/" class="btn btn-sm btn-ghost">Hide Past</a>`
        : html`<a href="${bp}/?past=1" class="btn btn-sm btn-ghost">Show Past</a>`}
    </div>
    <div class="mt-2">${rows}</div>`;

  return layout({
    title: "Operations",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Operation detail ─────────────────────────────────────────────────

type OpDetailPageOptions = {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op: NonNullable<OpFull>;
  ownedShips: Ship[];
  assignableUsers: Pick<User, "id" | "username" | "role">[];
  guildVoiceChannels?: Array<{ id: string; name: string }>;
  availableVoiceBotCount: number;
  voiceEnabled: boolean;
  missionVoice?: { globalVoiceRoom: string | null; commanderVoiceRoom: string | null } | null;
  /** IANA timezone of the guild — used to display/parse scheduledAt. */
  guildTimezone?: string;
  /** Fleet voice links per eligible user — only passed for fleetoperator+ views */
  fleetVoiceLinks?: Array<{ userId: string; username: string; link: string }> | null;
  /** Commander roster for the Commanders tab: accepted captains, voice-bearing
   *  leaders, and manually-added participants. Links are present only when a
   *  voice session is live. */
  commanderRoster?: {
    entries: Array<{
      userId: string;
      username: string;
      kind: "squadleader" | "leader" | "participant";
      globalVoice: boolean;
      link: string | null;
    }>;
    voiceActive: boolean;
  } | null;
  /** Per-unit live Discord voice control (Option B). Only passed when the
   *  bridge is configured, voice is enabled, the op is open/in_progress, the
   *  viewer is fleetoperator+, and units have Discord voice channels. */
  voiceControl?: Array<{
    unitId: string;
    channelId: string;
    channelName: string;
    crew: Array<{
      userId: string;
      username: string;
      discordId: string | null;
      location: "here" | "elsewhere" | "offline";
    }>;
  }> | null;
  /** Op visibility: private | partners | public. */
  visibility?: string;
  /** Whether the current viewer may change the op's visibility. */
  canEditVisibility?: boolean;
  /** Permanent Discord invite link, set only when the viewer is NOT a member of
   *  the op's host guild — so guests get a "join the event Discord" banner. */
  joinInviteUrl?: string | null;
  /** The host guild's permanent Discord invite link, shown in Action Details. */
  guildDiscordInviteUrl?: string | null;
  /** Host guild's Discord server name — used in the share embed (og). */
  guildName?: string;
  /** Host guild's SC org name — preferred over guildName in the share embed. */
  orgName?: string | null;
  /** Assigned-roster participants — passed only when the op is completed, so the
   *  overview shows "who took part" plus a CSV export link. */
  participants?: MissionParticipant[] | null;
  /** Multi-position users (2+ units) and their primary-channel choice. */
  primaryAssignments?: MultiPositionAssignment[];
  /** Whether the viewer may set the primary channel for ANY user (leaders).
   *  Non-leaders may still set their own. */
  canManagePrimary?: boolean;
  /** Guest view of a public op (not logged in): redact member usernames. */
  redactNames?: boolean;
};

/** Banner shown to viewers who are NOT members of the op's host Discord, so
 *  guests from partner orgs can join the event Discord (required for voice). */
function joinInviteBanner(url: string | null | undefined): SafeHtml | string {
  if (!url) return "";
  return html`<div
    class="flash flash-warn"
    style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap"
  >
    <span>You're not in this operation's Discord server — join it to take part in the voice channels:</span>
    <a class="btn btn-sm btn-gold" href="${url}" target="_blank" rel="noopener noreferrer"
      >Join Event Discord</a
    >
  </div>`;
}

/** User ids that appear in MORE THAN ONE accepted unit (captain or active seat).
 *  Discord allows only one voice channel per person, so these users get exactly
 *  one channel (their primary/first unit) — flagged in the UI so leaders see it. */
function multiPositionUserIds(op: NonNullable<OpFull>): Set<string> {
  const count = new Map<string, number>();
  for (const unit of op.units) {
    if (unit.status !== "accepted") continue;
    const ids = new Set<string>([unit.captainId]);
    for (const s of unit.seats) if (s.active && s.userId) ids.add(s.userId);
    for (const id of ids) count.set(id, (count.get(id) ?? 0) + 1);
  }
  return new Set([...count.entries()].filter(([, n]) => n > 1).map(([id]) => id));
}

/** Gold flag shown next to a user who holds positions in multiple units. */
function multiPosTag(userId: string | null | undefined, multiPos: Set<string>): SafeHtml | string {
  if (!userId || !multiPos.has(userId)) return "";
  return html`<span
    class="tag tag-gold"
    title="In mehreren Units — bekommt nur EINEN Voice-Channel (primäre/erste Unit). Kann sich im Discord frei zwischen seinen Missionskanälen bewegen."
    style="margin-left:.35rem;font-size:.6rem"
    >⚑ mehrfach</span
  >`;
}

export function opDetailPageV2(opts: OpDetailPageOptions & { tab?: string }): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const csrf = opts.csrfToken ?? "";
  const realUser = opts.currentUser;
  const multiPos = multiPositionUserIds(op);
  const canRealManage =
    !!realUser && (realUser.role === "superadmin" || realUser.role === "fleetoperator");
  // Player preview is a dedicated route (/ops/:id) now — no in-shell role
  // simulation. The shell always renders for the real user.
  const user = realUser;
  const canManage = !!user && (user.role === "superadmin" || user.role === "fleetoperator");
  const isLeader = !!user && (canManage || op.leaders.some((leader) => leader.user.id === user.id));
  // Guest view of a public op (not logged in): hide member usernames for privacy.
  // Manage/claim controls are already gated on `user` (null here), so they vanish.
  const redactNames = opts.redactNames === true;
  const nm = (name?: string | null) => (redactNames ? "Mitglied" : (name ?? "?"));
  const activeUnits = op.units.filter((unit) => unit.status !== "rejected");
  const pendingUnits = op.units.filter((unit) => unit.status === "pending");
  const acceptedUnits = op.units.filter((unit) => unit.status === "accepted");
  const activeSeats = activeUnits.flatMap((unit) => unit.seats.filter((seat) => seat.active));
  const assignedSeats = activeSeats.filter((seat) => seat.userId);
  // Fleet strength split: ships vs FPS squads (accepted units only), with
  // filled / total active seats per category for the mission overview.
  const seatStats = (units: typeof acceptedUnits) => {
    const seats = units.flatMap((u) => u.seats.filter((s) => s.active));
    const filled = seats.filter((s) => s.userId).length;
    return { total: seats.length, filled, open: seats.length - filled };
  };
  const shipUnits = acceptedUnits.filter((u) => u.unitType === "ship");
  const fpsUnits = acceptedUnits.filter((u) => u.unitType !== "ship");
  const shipSeatStats = seatStats(shipUnits);
  const fpsSeatStats = seatStats(fpsUnits);
  const crewWaiting = op.crewRequests.length;
  const compositionTotal = op.groups.reduce(
    (sum, group) =>
      sum + group.requirements.reduce((groupSum, requirement) => groupSum + requirement.count, 0),
    0,
  );
  const compositionFilled = op.groups.reduce(
    (sum, group) =>
      sum +
      group.requirements.reduce(
        (groupSum, requirement) =>
          groupSum +
          Math.min(
            requirement.count,
            requirement.fleetUnits.filter((unit) => unit.status === "accepted").length,
          ),
        0,
      ),
    0,
  );
  // Tabs the current viewer may see. Commanders is operator-only; Admin needs a
  // logged-in user (hidden for public-op guests). Clamp the active tab to this
  // set so a ?tab=admin URL from a guest doesn't land on a blank panel.
  const tabNames = [
    "overview",
    "fleet",
    "crew",
    "voice",
    ...(canManage ? ["commanders"] : []),
    ...(user ? ["admin"] : []),
  ];
  const activeTab = tabNames.includes(opts.tab ?? "") ? opts.tab! : "overview";
  const tabUrl = (tab: string) => `${bp}/ops/${op.id}/manage?tab=${tab}`;
  const returnFields = (tab: string) => html`
    <input type="hidden" name="ui" value="new" />
    <input type="hidden" name="tab" value="${tab}" />
  `;

  const shellLink = (tab: string, label: string) =>
    html`<a
      class="opv2-tab ${activeTab === tab ? "active" : ""}"
      href="${tabUrl(tab)}"
      data-tab="${tab}"
      >${label}</a
    >`;

  const metric = (label: string, value: string | number, tone = "") =>
    html`<div class="opv2-metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>`;

  const unitName = (unit: UnitFull) =>
    unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");

  const unitTypeLabel = (unit: UnitFull) => (unit.unitType === "ship" ? "SHIP" : "FPS");

  const unitTypeDetail = (unit: UnitFull) =>
    unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");

  const seatRow = (unit: UnitFull, seat: UnitFull["seats"][number]) => {
    const claimed = !!seat.userId;
    const isMe = realUser && seat.userId === realUser.id;
    const canClaim =
      user &&
      seat.active &&
      !claimed &&
      unit.status === "accepted" &&
      (seat.order !== 0 || unit.captainId === user.id);
    const canAssign = isLeader && seat.active && !claimed && unit.status === "accepted";
    const canUnclaim = claimed && (isMe || isLeader) && !(seat.order === 0 && !canManage);

    const dropAttrs =
      canAssign && op.crewRequests.length
        ? safe(` data-seat-id="${seat.id}" data-drop-seat="1"`)
        : safe("");

    return html`<div class="opv2-seat-row ${seat.active ? "" : "disabled"}" ${dropAttrs}>
      <div>
        <strong>${seat.label}</strong>
        <span>${seat.seatType}</span>
      </div>
      <div class="opv2-seat-user ${claimed ? "" : "empty"}">
        ${claimed ? nm(seat.user?.username) : "open"}${claimed && !redactNames ? multiPosTag(seat.userId, multiPos) : ""}
      </div>
      <div class="opv2-seat-actions">
        ${!seat.active ? html`<span class="tag tag-dim">disabled</span>` : safe("")}
        ${canClaim
          ? html`<form method="post" action="${bp}/api/seats/${seat.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <button type="submit" class="btn btn-sm btn-green">Claim</button>
            </form>`
          : safe("")}
        ${canAssign
          ? html`<details class="opv2-seat-assign">
              <summary class="btn btn-sm btn-ghost">Assign</summary>
              <form method="post" action="${bp}/api/seats/${seat.id}/assign">
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <select name="userId" required>
                  <option value="">Select user...</option>
                  ${opts.assignableUsers.map(
                    (assignableUser) =>
                      html`<option value="${assignableUser.id}">
                        ${assignableUser.username} (${assignableUser.role})
                      </option>`,
                  )}
                </select>
                <button type="submit" class="btn btn-sm">Add</button>
              </form>
            </details>`
          : safe("")}
        ${canUnclaim
          ? html`<form method="post" action="${bp}/api/seats/${seat.id}/unclaim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <button type="submit" class="btn btn-sm btn-ghost">Release</button>
            </form>`
          : safe("")}
      </div>
    </div>`;
  };

  const seatSetup = (unit: UnitFull) => {
    const canConfigureSeats = !!(user && unit.captainId === user.id) || canManage;
    if (!canConfigureSeats) return safe("");

    return html`<details class="opv2-edit-block mt-1">
      <summary class="btn btn-sm btn-ghost">Seat Setup</summary>
      <form
        method="post"
        action="${bp}/api/ops/${op.id}/units/${unit.id}/seats"
        class="opv2-form mt-1"
      >
        <input type="hidden" name="_csrf" value="${csrf}" />
        ${returnFields("fleet")}
        ${unit.seats.map((seat) => {
          const placeholder =
            seat.seatType === "fps"
              ? "Boomtuber, Railgunner, Medic, Soldier, Sniper"
              : "Turret top, Turret bottom, Engineer, Scanner";
          return html`<div class="opv2-seat-setup-row">
            <input
              type="text"
              name="label_${seat.id}"
              value="${seat.label}"
              maxlength="40"
              placeholder="${placeholder}"
            />
            <span class="tag tag-dim">${seat.seatType}</span>
            <label class="seat-toggle">
              <input
                type="checkbox"
                name="active_${seat.id}"
                value="1"
                ${seat.active ? safe("checked") : ""}
                ${seat.order === 0 ? safe("checked disabled") : ""}
              />
              Active
            </label>
          </div>`;
        })}
        <button type="submit" class="btn btn-sm">Save Seats</button>
      </form>
    </details>`;
  };

  const availableSlotsForUnit = (currentUnitId?: string) =>
    op.groups.flatMap((group) =>
      group.requirements
        .filter((requirement) => {
          const filled = requirement.fleetUnits.filter(
            (fleetUnit) => fleetUnit.id !== currentUnitId && fleetUnit.status !== "rejected",
          ).length;
          const current = requirement.fleetUnits.some(
            (fleetUnit) => fleetUnit.id === currentUnitId,
          );
          return current || filled < requirement.count;
        })
        .map((requirement) => {
          const filled = requirement.fleetUnits.filter(
            (fleetUnit) => fleetUnit.id !== currentUnitId && fleetUnit.status !== "rejected",
          ).length;
          return {
            id: requirement.id,
            label: `${group.name}: ${requirement.label} (${filled}/${requirement.count})`,
          };
        }),
    );

  const availableSlots = availableSlotsForUnit();

  const unitRows = activeUnits.length
    ? activeUnits.map((unit) => {
        const seats = unit.seats.filter((seat) => seat.active);
        const assigned = seats.filter((seat) => seat.userId).length;
        const free = Math.max(seats.length - assigned, 0);
        const canEditUnit = !!user && (unit.captainId === user.id || isLeader);
        const unitSlots = availableSlotsForUnit(unit.id);
        const unitActions = html`
          ${isLeader && unit.status === "pending"
            ? html`<div class="opv2-actions">
                <form
                  method="post"
                  action="${bp}/api/ops/${op.id}/units/${unit.id}/accept"
                  class="inline"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <button type="submit" class="btn btn-sm btn-green">Accept</button>
                </form>
                <form
                  method="post"
                  action="${bp}/api/ops/${op.id}/units/${unit.id}/reject"
                  class="inline"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <button type="submit" class="btn btn-sm btn-danger">Reject</button>
                </form>
              </div>`
            : safe("")}
          ${(user && unit.captainId === user.id) || canManage
            ? html`<form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/delete"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <button
                  type="submit"
                  class="btn btn-sm btn-ghost"
                  onclick="return confirm('Delete this unit?')"
                >
                  Delete
                </button>
              </form>`
            : safe("")}
        `;
        const editUnit = canEditUnit
          ? html`<details class="opv2-edit-block mt-1">
              <summary class="btn btn-sm btn-ghost">Edit Unit</summary>
              <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/edit"
                class="opv2-form mt-1"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <label>Fleet need</label>
                <select name="requirementId">
                  <option value="">Unslotted</option>
                  ${unitSlots.map(
                    (slot) =>
                      html`<option
                        value="${slot.id}"
                        ${unit.requirementId === slot.id ? safe("selected") : ""}
                      >
                        ${slot.label}
                      </option>`,
                  )}
                </select>
                <label>Unit type</label>
                <select name="unitType">
                  <option value="ship" ${unit.unitType === "ship" ? safe("selected") : ""}>
                    Ship
                  </option>
                  <option value="squad" ${unit.unitType === "squad" ? safe("selected") : ""}>
                    FPS Squad
                  </option>
                </select>
                <label>Owned ship</label>
                <select name="ownedShipId" class="opv2-owned-ship-select mandatory">
                  <option value="">Keep current ship</option>
                  ${opts.ownedShips.map(
                    (ship) =>
                      html`<option
                        value="${ship.id}"
                        ${unit.shipId === ship.id ? safe("selected") : ""}
                      >
                        ${ship.name}
                      </option>`,
                  )}
                </select>
                <input
                  type="hidden"
                  name="shipId"
                  class="opv2-ship-id-field"
                  value="${unit.shipId ?? ""}"
                />
                <label>Ship search</label>
                <input
                  type="search"
                  class="opv2-ship-search mandatory"
                  placeholder="Search ship catalog..."
                  autocomplete="off"
                />
                <div class="ship-results opv2-ship-results"></div>
                <div class="opv2-form-grid">
                  <div>
                    <label>Squad name</label>
                    <input
                      type="text"
                      name="squadName"
                      maxlength="80"
                      value="${unit.squadName ?? ""}"
                      placeholder="FPS Team"
                    />
                  </div>
                  <div>
                    <label>Squad size</label>
                    <input
                      type="number"
                      name="squadSize"
                      min="2"
                      max="8"
                      value="${unit.squadSize ?? 4}"
                    />
                  </div>
                </div>
                <label>Captain note</label>
                <input
                  type="text"
                  name="captainNote"
                  maxlength="240"
                  value="${unit.captainNote ?? ""}"
                  placeholder="Role, loadout, crew preference..."
                />
                ${unit.status === "accepted"
                  ? html`<p class="text-dim text-sm">
                      Saving changes moves this accepted unit back to pending review.
                    </p>`
                  : safe("")}
                <button type="submit" class="btn btn-sm">Save Unit</button>
              </form>
            </details>`
          : safe("");

        return html`<details class="opv2-unit-card">
          <summary class="opv2-unit-summary">
            <div class="opv2-unit-main">
              <strong>${unitName(unit)}</strong>
              <span>${unitLeadTitle(unit.ship)}: ${nm(unit.captain.username)}${redactNames ? "" : multiPosTag(unit.captainId, multiPos)}</span>
            </div>
            <div class="opv2-unit-facts">
              <span class="tag ${unit.unitType === "ship" ? "tag-cyan" : "tag-gold"}"
                >${unitTypeLabel(unit)}</span
              >
              <span class="opv2-unit-detail">${unitTypeDetail(unit)}</span>
              <span class="tag ${free > 0 ? "tag-green" : "tag-dim"}">${free} free</span>
              <span class="text-mono">${assigned}/${seats.length} seats</span>
              ${statusTag(unit.status)}
            </div>
          </summary>
          <div class="opv2-unit-body">
            ${unitActions}
            <div class="opv2-seat-list">${unit.seats.map((seat) => seatRow(unit, seat))}</div>
            ${editUnit} ${seatSetup(unit)}
          </div>
        </details>`;
      })
    : [html`<p class="text-dim text-sm">No registered units yet.</p>`];

  const compositionRows = op.groups.length
    ? op.groups.map(
        (group) =>
          html`<div class="opv2-composition-group">
            <div class="opv2-panel-title">${group.name}</div>
            ${group.requirements.length
              ? group.requirements.map((requirement) => {
                  const filled = requirement.fleetUnits.filter(
                    (unit) => unit.status !== "rejected",
                  ).length;
                  return html`<div class="opv2-requirement">
                    <div>
                      <span>${requirement.label}</span>
                      ${requirement.note
                        ? html`<span class="text-dim text-sm">${requirement.note}</span>`
                        : safe("")}
                    </div>
                    <span class="tag tag-dim">${categoryLabel(requirement.category)}</span>
                    <strong>${filled}/${requirement.count}</strong>
                    ${canManage
                      ? html`<details class="opv2-edit-block">
                          <summary class="btn btn-sm btn-ghost">Edit</summary>
                          <form
                            method="post"
                            action="${bp}/api/ops/${op.id}/requirements/${requirement.id}/edit"
                            class="opv2-form mt-1"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            ${returnFields("fleet")}
                            <div class="opv2-form-grid">
                              <div>
                                <label>What do you need?</label>
                                <input
                                  type="text"
                                  name="label"
                                  maxlength="80"
                                  value="${requirement.label}"
                                  required
                                />
                              </div>
                              <div>
                                <label>Type</label>
                                <select name="category">
                                  ${REQUIREMENT_CATEGORIES.map(
                                    (category) =>
                                      html`<option
                                        value="${category}"
                                        ${requirement.category === category ? safe("selected") : ""}
                                      >
                                        ${categoryLabel(category)}
                                      </option>`,
                                  )}
                                </select>
                              </div>
                            </div>
                            <div class="opv2-form-grid">
                              <div>
                                <label>How many?</label>
                                <input
                                  type="number"
                                  name="count"
                                  value="${requirement.count}"
                                  min="${Math.max(1, filled)}"
                                  max="20"
                                />
                              </div>
                              <div>
                                <label>Details</label>
                                <input
                                  type="text"
                                  name="note"
                                  maxlength="160"
                                  value="${requirement.note ?? ""}"
                                  placeholder="e.g. 4 people each, medical, cargo"
                                />
                              </div>
                            </div>
                            <button type="submit" class="btn btn-sm mt-1">Save Need</button>
                          </form>
                          <form
                            method="post"
                            action="${bp}/api/ops/${op.id}/requirements/${requirement.id}/delete"
                            class="inline mt-1"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            ${returnFields("fleet")}
                            <button
                              type="submit"
                              class="btn btn-sm btn-danger"
                              onclick="return confirm('Delete this need?')"
                            >
                              Delete Need
                            </button>
                          </form>
                        </details>`
                      : safe("")}
                  </div>`;
                })
              : html`<p class="text-dim text-sm">No requirements.</p>`}
          </div>`,
      )
    : [html`<p class="text-dim text-sm">No fleet needs have been defined yet.</p>`];
  const statusControls = canManage
    ? html`<div class="opv2-actions">
        ${["draft", "open", "locked", "starting", "in_progress", "completed", "cancelled"].map((status) =>
          status !== op.status
            ? html`<form method="post" action="${bp}/api/ops/${op.id}/status" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="status" value="${status}" />
                ${returnFields(activeTab)}
                <button type="submit" class="btn btn-sm btn-ghost">
                  ${status.replace("_", " ")}
                </button>
              </form>`
            : safe(""),
        )}
      </div>`
    : safe("");

  const crewPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Need Assignment</div>
      ${op.crewRequests.length
        ? op.crewRequests.map(
            (request) =>
              html`<div class="opv2-row">
                <div>
                  <strong>${nm(request.user.username)}</strong>
                  <span>${request.note || "No note"}</span>
                </div>
                ${isLeader
                  ? html`<form
                      method="post"
                      action="${bp}/api/ops/${op.id}/crew-requests/remove"
                      class="inline"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="userId" value="${request.user.id}" />
                      ${returnFields("crew")}
                      <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
                    </form>`
                  : safe("")}
              </div>`,
          )
        : html`<p class="text-dim text-sm">No unassigned crewmembers.</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Crew Action</div>
      ${user && (op.status === "open" || op.status === "draft")
        ? html`<form method="post" action="${bp}/api/ops/${op.id}/crew-requests">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("crew")}
            <label>Assignment note</label>
            <input
              type="text"
              name="note"
              maxlength="240"
              placeholder="Any seat, prefer medic, gunner, FPS..."
            />
            <button type="submit" class="btn btn-sm mt-1">Request Assignment</button>
          </form>`
        : html`<p class="text-dim text-sm">
            Crew requests are available while the op is draft or open.
          </p>`}
    </section>
  </div>`;

  // Multi-position users pick (or leaders assign) which of their 2+ units is
  // their primary Discord voice channel. Default prefers an FPS squad.
  const currentUserId = opts.currentUser?.id ?? null;
  const primaryAssignments = opts.primaryAssignments ?? [];
  const visiblePrimary = opts.canManagePrimary
    ? primaryAssignments
    : primaryAssignments.filter((a) => a.userId === currentUserId);
  const primaryPanel =
    visiblePrimary.length > 0
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title">Primary Voice Channel</div>
          <p class="text-dim text-sm">
            Members in two or more units get only one Discord voice channel. Pick the main one
            (default: the FPS squad).
          </p>
          <div class="opv2-stack">
            ${visiblePrimary.map((a) => {
              const editable = opts.canManagePrimary || a.userId === currentUserId;
              const effectiveName =
                a.units.find((u) => u.unitId === a.effectiveUnitId)?.name ?? "—";
              if (!editable) {
                return html`<div class="opv2-row">
                  <div>
                    <strong>${a.username}</strong>
                    <span>${effectiveName}${a.chosenUnitId ? "" : " (auto)"}</span>
                  </div>
                </div>`;
              }
              return html`<form
                method="post"
                action="${bp}/api/ops/${op.id}/primary-unit"
                class="opv2-row"
                style="align-items:flex-end;gap:.5rem"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("voice")}
                <input type="hidden" name="userId" value="${a.userId}" />
                <div style="flex:1">
                  <label>${a.username}</label>
                  <select name="unitId">
                    <option value="" ${a.chosenUnitId ? "" : safe("selected")}>
                      Auto (FPS squad / first unit)
                    </option>
                    ${a.units.map(
                      (u) =>
                        html`<option
                          value="${u.unitId}"
                          ${a.chosenUnitId === u.unitId ? safe("selected") : ""}
                        >
                          ${u.name} (${u.unitType === "ship" ? "Ship" : "FPS"})${u.hasChannel
                            ? ""
                            : " — no channel"}
                        </option>`,
                    )}
                  </select>
                </div>
                <button type="submit" class="btn btn-sm">Save</button>
              </form>`;
            })}
          </div>
        </section>`
      : safe("");

  const voicePanel = html`<div class="opv2-grid">
    ${primaryPanel}
    <section class="opv2-panel">
      <div class="opv2-panel-title">Mission Voice</div>
      ${opts.voiceEnabled
        ? opts.missionVoice?.globalVoiceRoom
          ? html`<div class="opv2-stack">
              <div class="detail-row">
                <span>Global Radio Net</span>
                <strong>${opts.missionVoice.globalVoiceRoom}</strong>
              </div>
              <div class="detail-row">
                <span>Command Net</span>
                <strong>${opts.missionVoice.commanderVoiceRoom ?? "None"}</strong>
              </div>
            </div>`
          : html`<p class="text-dim text-sm">
              No active mission voice room. It starts when the operation is opened.
            </p>`
        : html`<p class="text-dim text-sm">Voice integration is not enabled for this server.</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Unit Channels</div>
      ${op.voiceChannels.length
        ? op.voiceChannels.map((channel) => {
            const name =
              channel.channelName ||
              (channel.unit.unitType === "ship"
                ? (channel.unit.ship?.name ?? "Unknown Ship")
                : (channel.unit.squadName ?? "Squad"));
            return html`<div class="opv2-row">
              <div>
                <strong>${name}</strong>
                <span>${unitLeadTitle(channel.unit.ship)}: ${channel.unit.captain.username}</span>
              </div>
              <div class="opv2-row-meta">
                <span class="tag tag-cyan">${channel.voiceBot?.label ?? "Discord"}</span>
                ${canManage
                  ? html`<form
                        method="post"
                        action="${bp}/api/ops/${op.id}/voice-channels/${channel.id}/rename"
                        class="opv2-inline-form"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("voice")}
                        <input type="text" name="name" value="${name}" maxlength="100" required />
                        <button type="submit" class="btn btn-sm btn-ghost">Rename</button>
                      </form>
                      <form
                        method="post"
                        action="${bp}/api/ops/${op.id}/voice-channels/${channel.id}/delete"
                        class="inline"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("voice")}
                        <button
                          type="submit"
                          class="btn btn-sm btn-danger"
                          onclick="return confirm('Delete this Discord voice channel?')"
                        >
                          Delete
                        </button>
                      </form>`
                  : safe("")}
              </div>
            </div>`;
          })
        : html`<p class="text-dim text-sm">No generated unit voice channels.</p>`}
      ${canManage && opts.availableVoiceBotCount > 0
        ? html`<form
            method="post"
            action="${bp}/api/ops/${op.id}/voice-channels/launch"
            class="mt-1"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("voice")}
            <button type="submit" class="btn btn-sm btn-cyan">Launch Voice Channels</button>
          </form>`
        : safe("")}
    </section>
    ${canManage && opts.voiceEnabled && opts.voiceControl && opts.voiceControl.length
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title">Voice Control</div>
          <p class="text-dim text-sm" style="margin-bottom:.75rem">
            Pull assigned crew into their unit's Discord voice channel. Members must already be in
            a Discord voice channel.
          </p>
          <div class="opv2-stack">
            ${opts.voiceControl.map(
              (unit) => html`<div class="opv2-row" style="flex-wrap:wrap;gap:.5rem">
                <div>
                  <strong>${unit.channelName}</strong>
                  <span>${unit.crew.length} crew</span>
                </div>
                <div class="opv2-row-meta" style="gap:.4rem;flex-wrap:wrap">
                  <form
                    method="post"
                    action="${bp}/ops/${op.id}/voice/move-unit/${unit.unitId}"
                    class="inline"
                  >
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <button type="submit" class="btn btn-sm btn-cyan">Pull all crew here</button>
                  </form>
                  ${unit.crew.map(
                    (member) =>
                      member.discordId && member.location === "elsewhere"
                        ? html`<form
                            method="post"
                            action="${bp}/ops/${op.id}/voice/move-member/${unit.unitId}/${member.userId}"
                            class="inline"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <button type="submit" class="btn btn-sm btn-ghost">
                              Move ${member.username}
                            </button>
                          </form>`
                        : safe(""),
                  )}
                </div>
              </div>`,
            )}
          </div>
        </section>`
      : safe("")}
  </div>`;

  const commanderKindLabel = (k: "squadleader" | "leader" | "participant") =>
    k === "squadleader" ? "Squadleader" : k === "leader" ? "Leader" : "Added";
  const commanderKindTone = (k: "squadleader" | "leader" | "participant") =>
    k === "participant" ? "tag-gold" : k === "leader" ? "tag-green" : "tag-cyan";
  const rosterIds = new Set((opts.commanderRoster?.entries ?? []).map((e) => e.userId));
  const addableUsers = opts.assignableUsers.filter((u) => !rosterIds.has(u.id));

  const commandersPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Commanders</div>
      ${!opts.voiceEnabled
        ? html`<p class="text-dim text-sm">Voice integration is not enabled for this server.</p>`
        : html`
            <p class="text-dim text-sm" style="margin-bottom:.75rem">
              Squadleaders of accepted FPS squads are commanders automatically. Add anyone else
              who should be on the Command Net, and grant Global Radio Net only where needed.
            </p>
            ${opts.commanderRoster && !opts.commanderRoster.voiceActive
              ? html`<div class="banner banner-dim text-sm" style="margin-bottom:.75rem">
                  No active voice session — links appear once the operation is set to
                  <strong>open</strong> or <strong>in progress</strong>.
                </div>`
              : safe("")}
            <div class="opv2-stack">
              ${(opts.commanderRoster?.entries ?? []).length
                ? opts.commanderRoster!.entries.map(
                    (e) => html`<div class="opv2-row" style="flex-wrap:wrap;gap:.5rem">
                      <div>
                        <strong>${e.username}</strong>
                        <span class="tag ${commanderKindTone(e.kind)}"
                          >${commanderKindLabel(e.kind)}</span
                        >
                      </div>
                      <div
                        class="opv2-row-meta"
                        style="flex:1;justify-content:flex-end;gap:.4rem;min-width:16rem"
                      >
                        ${e.link
                          ? html`<input
                                type="text"
                                readonly
                                value="${e.link}"
                                class="text-mono text-sm"
                                style="flex:1;min-width:8rem;padding:.2rem .4rem;font-size:.7rem"
                                onclick="this.select()"
                              />
                              <button
                                type="button"
                                class="btn btn-sm btn-cyan"
                                onclick="const i=this.previousElementSibling;i.select();navigator.clipboard.writeText(i.value).then(()=>{const b=this,t=b.textContent;b.textContent='Kopiert';b.disabled=true;setTimeout(()=>{b.textContent=t;b.disabled=false;},1200);}).catch(()=>{document.execCommand('copy');});"
                              >
                                Kopieren
                              </button>`
                          : safe("")}
                        <form
                          method="post"
                          action="${bp}/api/ops/${op.id}/voice-participants/${e.userId}/global-voice"
                          class="inline"
                        >
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          ${returnFields("commanders")}
                          <input type="hidden" name="globalVoice" value="${e.globalVoice ? "0" : "1"}" />
                          <button
                            type="submit"
                            class="btn btn-sm ${e.globalVoice ? "btn-gold" : "btn-ghost"}"
                            title="Global Radio Net via relay bots"
                          >
                            Global Radio ${e.globalVoice ? "On" : "Off"}
                          </button>
                        </form>
                        ${e.kind === "participant"
                          ? html`<form
                              method="post"
                              action="${bp}/api/ops/${op.id}/voice-participants/${e.userId}/remove"
                              class="inline"
                            >
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              ${returnFields("commanders")}
                              <button type="submit" class="btn btn-sm btn-danger">Remove</button>
                            </form>`
                          : safe("")}
                      </div>
                    </div>`,
                  )
                : html`<p class="text-dim text-sm">No commanders yet.</p>`}
            </div>
            ${addableUsers.length
              ? html`<form
                  method="post"
                  action="${bp}/api/ops/${op.id}/voice-participants/add"
                  class="mt-1 flex gap-1"
                  style="align-items:center"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("commanders")}
                  <select name="userId" required style="flex:1">
                    <option value="">Add commander…</option>
                    ${addableUsers.map(
                      (u) => html`<option value="${u.id}">${u.username} (${u.role})</option>`,
                    )}
                  </select>
                  <label class="seat-toggle text-sm">
                    <input type="checkbox" name="globalVoice" value="1" />
                    Global Radio Net
                  </label>
                  <button type="submit" class="btn btn-sm btn-green">Add</button>
                </form>`
              : safe("")}
          `}
    </section>
  </div>`;

  // ── Fleet Requirements Board (read-only requested/fulfilled/open overview) ──
  type CompRow = {
    group: string;
    label: string;
    category: string;
    count: number;
    fulfilled: number;
    pending: number;
    open: number;
    extra: number;
    mismatches: number;
  };
  const compRows: CompRow[] = op.groups.flatMap((g) =>
    g.requirements.map((r) => {
      const accepted = r.fleetUnits.filter((u) => u.status === "accepted");
      const pending = r.fleetUnits.filter((u) => u.status === "pending").length;
      const fulfilled = accepted.length;
      const mismatches = accepted.filter(
        (u) => !matchesCategory(r.category, { unitType: u.unitType, ship: u.ship }),
      ).length;
      return {
        group: g.name,
        label: r.label,
        category: r.category,
        count: r.count,
        fulfilled,
        pending,
        open: Math.max(0, r.count - fulfilled),
        extra: Math.max(0, fulfilled - r.count),
        mismatches,
      };
    }),
  );
  const compRequested = compRows.reduce((a, r) => a + r.count, 0);
  const compFulfilled = compRows.reduce((a, r) => a + r.fulfilled, 0);
  const compOpen = compRows.reduce((a, r) => a + r.open, 0);
  const compChips = (r: CompRow) => {
    const filledOk = Math.max(0, r.fulfilled - r.mismatches);
    const chips: SafeHtml[] = [];
    for (let i = 0; i < filledOk; i++) chips.push(html`<span class="comp-chip filled"></span>`);
    for (let i = 0; i < r.mismatches; i++)
      chips.push(html`<span class="comp-chip mismatch" title="Unit does not match category"></span>`);
    for (let i = 0; i < r.open; i++) chips.push(html`<span class="comp-chip open"></span>`);
    return chips;
  };
  const compTone = (r: CompRow) =>
    r.open === 0 ? "tag-green" : r.fulfilled === 0 ? "tag-dim" : "tag-gold";
  const compositionBoard = html`<section class="opv2-panel">
    <div class="opv2-panel-title">Fleet Requirements</div>
    ${compRows.length
      ? html`<div class="fleet-req-board">
            <div class="fleet-req-row fleet-req-head">
              <span>Fleet Requirement</span>
              <span>Requested</span>
              <span>Fulfilled</span>
              <span>Open Slots</span>
            </div>
            ${compRows.map(
              (r) => html`<div class="comp-row">
                <div class="comp-row-head">
                  <div class="fleet-req-name">
                    <strong>${r.label}</strong>
                    <span class="tag tag-dim">${categoryLabel(r.category)}</span>
                    ${r.group ? html`<span class="text-dim text-sm">${r.group}</span>` : safe("")}
                  </div>
                  <strong class="fleet-req-num">${r.count}</strong>
                  <span class="fleet-req-num">
                    <span class="tag ${compTone(r)}">${r.fulfilled}</span>
                    ${r.pending ? html`<span class="tag tag-gold">${r.pending} pending</span>` : safe("")}
                    ${r.mismatches
                      ? html`<span class="tag tag-gold" title="Accepted units not matching the category"
                          >${r.mismatches} mismatch</span
                        >`
                      : safe("")}
                  </span>
                  <span class="fleet-req-num">
                    <span class="tag ${r.open ? "tag-red" : "tag-green"}">${r.open}</span>
                    ${r.extra ? html`<span class="tag tag-cyan">+${r.extra} extra</span>` : safe("")}
                  </span>
                </div>
                <div class="comp-chips">${compChips(r)}</div>
              </div>`,
            )}
            <div class="fleet-req-row fleet-req-total">
              <span>Total</span>
              <strong>${compRequested}</strong>
              <strong>${compFulfilled}</strong>
              <strong>${compOpen}</strong>
            </div>
            <p class="text-dim text-sm" style="margin:.6rem 0 0">
              Fulfilled = accepted ships or teams. Open Slots = still needed mission requirements.
            </p>
          </div>`
      : html`<p class="text-dim text-sm">
          No Fleet Requirements defined.${canManage ? " Add the ships and squads you need in the Fleet tab." : ""}
        </p>`}
  </section>`;

  const participantsPanel =
    op.status === "completed" && opts.participants
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
            <span>Participants (${opts.participants.length})</span>
            <a class="btn btn-sm btn-ghost" href="${bp}/ops/${op.id}/participants.csv">Download CSV</a>
          </div>
          ${opts.participants.length
            ? opts.participants.map(
                (p) =>
                  html`<div class="opv2-row">
                    <div>
                      <strong>${p.username}</strong>
                      <span>${p.roles.join(", ") || "—"}</span>
                    </div>
                    <span class="text-dim text-sm">${p.units.join(", ")}</span>
                  </div>`,
              )
            : html`<p class="text-dim text-sm">No participants were assigned to this operation.</p>`}
        </section>`
      : safe("");

  const overviewPanel = html`<div class="opv2-grid">
    ${participantsPanel} ${compositionBoard}
    <section class="opv2-panel">
      <div class="opv2-panel-title">${canManage ? "Edit Briefing" : "Briefing"}</div>
      ${canManage
        ? html`<form method="post" action="${bp}/ops/${op.id}/edit" class="opv2-form">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("overview")}
            <label>Title</label>
            <input type="text" name="title" value="${op.title}" maxlength="120" required />
            <div class="opv2-form-grid">
              <div>
                <label>Type</label>
                <select name="opType">
                  ${OP_TYPES.map(
                    (type) =>
                      html`<option value="${type}" ${op.opType === type ? safe("selected") : ""}>
                        ${type}
                      </option>`,
                  )}
                </select>
              </div>
              <div>
                <label>When</label>
                <input
                  type="datetime-local"
                  name="scheduledAt"
                  value="${fmtDateLocal(op.scheduledAt, gtz)}"
                  required
                />
              </div>
            </div>
            <div class="opv2-form-grid">
              <div>
                <label>System</label>
                <select name="meetingSystem">
                  ${SYSTEMS.map(
                    (system) =>
                      html`<option
                        value="${system}"
                        ${(op.meetingSystem ?? "stanton") === system ? safe("selected") : ""}
                      >
                        ${systemLabel(system)}
                      </option>`,
                  )}
                </select>
              </div>
              <div>
                <label>Rendezvous</label>
                <input
                  type="text"
                  name="meetingLocation"
                  value="${op.meetingLocation ?? ""}"
                  maxlength="120"
                />
              </div>
            </div>
            <label>Description</label>
            <textarea name="description" rows="5">${op.description ?? ""}</textarea>
            ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
              ? html`<label
                    >Discord Event Voice Channel
                    <span style="font-weight:normal;opacity:.65">
                      (optional - Discord scheduled event location)
                    </span></label
                  >
                  <select name="eventVoiceChannelId">
                    <option value="">No voice channel</option>
                    ${opts.guildVoiceChannels.map(
                      (channel) =>
                        html`<option
                          value="${channel.id}"
                          ${op.eventVoiceChannelId === channel.id ? safe("selected") : ""}
                        >
                          ${channel.name}
                        </option>`,
                    )}
                  </select>`
              : safe("")}
            <button type="submit" class="btn btn-sm mt-1">Save Overview</button>
          </form>`
        : op.description
          ? html`<p>${op.description}</p>`
          : html`<p class="text-dim text-sm">No briefing text has been added.</p>`}
    </section>
  </div>`;

  // Action Details — rendered persistently in the shell (above the tab nav) so
  // mission time/location/Discord + status controls stay visible on every tab.
  // Styled as metric cards (label over value) to match the metrics row above.
  const eventVoiceName =
    opts.guildVoiceChannels?.find((channel) => channel.id === op.eventVoiceChannelId)?.name ??
    "Not set";
  const actionDetailsPanel = html`<div class="opv2-action-details">
    <div class="opv2-metrics opv2-action-metrics">
      ${metric("When", fmtDate(op.scheduledAt, gtz))}
      ${metric("System", systemLabel(op.meetingSystem ?? "stanton"))}
      ${metric("Rendezvous", op.meetingLocation || "Not set")}
      ${metric("Leaders", op.leaders.length || "None")}
      ${metric("Event Voice", eventVoiceName)}
      <div class="opv2-metric">
        <span>Discord</span>
        <strong>
          ${opts.guildDiscordInviteUrl
            ? html`<a href="${opts.guildDiscordInviteUrl}" target="_blank" rel="noopener noreferrer"
                >Join server</a
              >`
            : "Not set"}
        </strong>
      </div>
    </div>
    ${statusControls}
  </div>`;

  const fleetPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Fleet Units</div>
      <div class="opv2-stack">${unitRows}</div>
      ${user && (op.status === "open" || op.status === "draft")
        ? html`<details class="opv2-edit-block mt-1">
            <summary class="btn btn-sm">Register Unit</summary>
            <form
              method="post"
              action="${bp}/api/ops/${op.id}/units"
              class="opv2-form opv2-unit-form mt-1"
              novalidate
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="form-errors opv2-unit-errors" hidden></div>
              <label>Fleet need</label>
              <select name="requirementId">
                <option value="">Unslotted</option>
                ${availableSlots.map(
                  (slot) => html`<option value="${slot.id}">${slot.label}</option>`,
                )}
              </select>
              <label>Unit type</label>
              <select name="unitType" class="opv2-unit-type">
                <option value="ship">Ship</option>
                <option value="squad">FPS Squad</option>
              </select>
              <div class="unit-ship-fields">
                <label>Owned ship</label>
                <select name="ownedShipId" class="opv2-owned-ship-select mandatory">
                  <option value="">Select owned ship for ship units...</option>
                  ${opts.ownedShips.map(
                    (ship) => html`<option value="${ship.id}">${ship.name}</option>`,
                  )}
                </select>
                <label>Ship search</label>
                <input
                  type="search"
                  class="opv2-ship-search mandatory"
                  placeholder="Search ship catalog..."
                  autocomplete="off"
                />
                <input type="hidden" name="shipId" class="opv2-ship-id-field" />
                <div class="ship-results opv2-ship-results"></div>
              </div>
              <div class="unit-squad-fields" hidden>
                <div class="opv2-form-grid">
                  <div>
                    <label>Squad name</label>
                    <input
                      type="text"
                      name="squadName"
                      class="mandatory"
                      maxlength="80"
                      placeholder="FPS Team"
                    />
                  </div>
                  <div>
                    <label>Squad size</label>
                    <input
                      type="number"
                      name="squadSize"
                      class="mandatory"
                      min="2"
                      max="8"
                      value="4"
                    />
                  </div>
                </div>
              </div>
              <label>Captain note</label>
              <input
                type="text"
                name="captainNote"
                maxlength="240"
                placeholder="Role, loadout, crew preference..."
              />
              <button type="submit" class="btn btn-sm mt-1">Register</button>
            </form>
          </details>`
        : safe("")}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Need Assignment</div>
      ${op.crewRequests.length
        ? html`<div class="opv2-crew-drag-list">
            ${op.crewRequests.map(
              (request) =>
                html`<div
                  class="opv2-crew-chip"
                  draggable="${isLeader ? "true" : "false"}"
                  data-crew-user-id="${request.user.id}"
                  title="${request.note || "No note"}"
                >
                  <strong>${nm(request.user.username)}</strong>
                  <span>${request.note || "No note"}</span>
                </div>`,
            )}
          </div>`
        : html`<p class="text-dim text-sm">No unassigned crewmembers.</p>`}
      ${isLeader && op.crewRequests.length
        ? html`<p class="text-dim text-sm mt-1">
            Drag a crewmember onto an open accepted seat to assign them.
          </p>`
        : safe("")}
      <div id="opv2-dnd-assign-forms" hidden>
        ${activeUnits.flatMap((unit) =>
          unit.seats
            .filter((seat) => seat.active && !seat.userId && unit.status === "accepted")
            .map(
              (seat) =>
                html`<form
                  method="post"
                  action="${bp}/api/seats/${seat.id}/assign"
                  data-seat-assign-form="${seat.id}"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <input type="hidden" name="userId" value="" />
                </form>`,
            ),
        )}
      </div>
      <div class="opv2-panel-title mt-2">Fleet Requirements</div>
      ${canManage
        ? html`<details class="opv2-edit-block mt-1" open>
            <summary class="btn btn-sm">Add Need</summary>
            <form method="post" action="${bp}/api/ops/${op.id}/requirements" class="opv2-form mt-1">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="opv2-form-grid">
                <div>
                  <label>What do you need?</label>
                  <input
                    type="text"
                    name="label"
                    maxlength="80"
                    placeholder="e.g. 4-man Squad, Capital Ship, Fighter"
                    required
                  />
                </div>
                <div>
                  <label>Type</label>
                  <select name="category">
                    ${REQUIREMENT_CATEGORIES.map(
                      (category) =>
                        html`<option value="${category}">${categoryLabel(category)}</option>`,
                    )}
                  </select>
                </div>
              </div>
              <div class="opv2-form-grid">
                <div>
                  <label>How many?</label>
                  <input type="number" name="count" value="1" min="1" max="20" />
                </div>
                <div>
                  <label>Details</label>
                  <input
                    type="text"
                    name="note"
                    maxlength="160"
                    placeholder="e.g. 4 people each, medical, cargo, bomber loadout"
                  />
                </div>
              </div>
              <button type="submit" class="btn btn-sm mt-1">Add Need</button>
            </form>
          </details>`
        : safe("")}
      <div class="opv2-stack">${compositionRows}</div>
      ${canManage
        ? html`<details class="opv2-edit-block mt-1">
            <summary class="btn btn-sm btn-ghost">Advanced: Groups</summary>
            <form
              method="post"
              action="${bp}/api/ops/${op.id}/groups"
              class="opv2-inline-form mt-1"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <input type="text" name="name" placeholder="Group name" maxlength="80" required />
              <button type="submit" class="btn btn-sm">Add Group</button>
            </form>
            ${op.groups.map(
              (group) =>
                html`<div class="opv2-composition-group mt-1">
                  <div class="opv2-panel-title">${group.name}</div>
                  <form
                    method="post"
                    action="${bp}/api/ops/${op.id}/groups/${group.id}/requirements"
                    class="opv2-form"
                  >
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    ${returnFields("fleet")}
                    <div class="opv2-form-grid">
                      <div>
                        <label>Need</label>
                        <input type="text" name="label" maxlength="80" required />
                      </div>
                      <div>
                        <label>Type</label>
                        <select name="category">
                          ${REQUIREMENT_CATEGORIES.map(
                            (category) =>
                              html`<option value="${category}">${categoryLabel(category)}</option>`,
                          )}
                        </select>
                      </div>
                    </div>
                    <div class="opv2-form-grid">
                      <div>
                        <label>Count</label>
                        <input type="number" name="count" value="1" min="1" max="20" />
                      </div>
                      <div>
                        <label>Note</label>
                        <input type="text" name="note" maxlength="160" />
                      </div>
                    </div>
                    <button type="submit" class="btn btn-sm mt-1">Add Need</button>
                  </form>
                </div>`,
            )}
          </details>`
        : safe("")}
    </section>
  </div>`;

  const adminPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Operation Control</div>
      <div class="opv2-actions">
        ${canManage
          ? html`<a href="${tabUrl("overview")}" class="btn btn-sm">Edit Overview</a>`
          : ""}
        ${canManage
          ? html`<form method="post" action="${bp}/ops/${op.id}/delete" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="btn btn-sm btn-danger"
                onclick="return confirm('Delete this operation?')"
              >
                Delete
              </button>
            </form>`
          : safe("")}
      </div>
      <p class="text-dim text-sm mt-1">Status controls are in the Action Details bar above.</p>
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Leaders</div>
      ${op.leaders.length
        ? op.leaders.map(
            (leader) =>
              html`<div class="opv2-row">
                <div>
                  <strong>${nm(leader.user.username)}</strong>
                  <span>${roleLabel(leader.leaderRole)}</span>
                </div>
                ${canManage
                  ? html`<form
                      method="post"
                      action="${bp}/api/ops/${op.id}/leaders/remove"
                      class="inline"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="userId" value="${leader.user.id}" />
                      ${returnFields("admin")}
                      <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
                    </form>`
                  : safe("")}
              </div>`,
          )
        : html`<p class="text-dim text-sm">No leaders assigned.</p>`}
      ${canManage
        ? html`<form method="post" action="${bp}/api/ops/${op.id}/leaders" class="opv2-form mt-1">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("admin")}
            <div class="opv2-form-grid">
              <div>
                <label>Add leader</label>
                <select name="userId" required>
                  <option value="">Select user...</option>
                  ${opts.assignableUsers.map(
                    (assignableUser) =>
                      html`<option value="${assignableUser.id}">
                        ${assignableUser.username} (${assignableUser.role})
                      </option>`,
                  )}
                </select>
              </div>
              <div>
                <label>Role</label>
                <select name="leaderRole">
                  <option value="event_leader">Event Leader</option>
                  <option value="fleet_commander">Fleet Commander</option>
                  <option value="raid_leader">Raid Leader</option>
                  <option value="wing_commander">Wing Commander</option>
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-sm mt-1">Add Leader</button>
          </form>`
        : safe("")}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Ask the Fleet Operator</div>
      ${op.questions.length
        ? op.questions.map(
            (q) => html`<div class="opv2-row" style="display:block">
              <div><strong>${nm(q.asker)}:</strong> ${q.body}</div>
              ${q.answer
                ? html`<div class="text-sm" style="color:var(--green,#3ad07a);margin-top:4px">
                    Reply from <strong>${q.answeredBy}:</strong> ${q.answer}
                  </div>`
                : canManage
                  ? html`<form
                      method="post"
                      action="${bp}/ops/${op.id}/questions/${q.id}/answer"
                      class="opv2-form mt-1"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input name="answer" maxlength="1000" placeholder="Answer..." />
                      <button type="submit" class="btn btn-sm btn-green mt-1">Answer</button>
                    </form>`
                  : html`<div class="text-dim text-sm" style="margin-top:4px">Not answered yet</div>`}
            </div>`,
          )
        : html`<p class="text-dim text-sm">No questions yet.</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Audit Log</div>
      ${op.auditLogs.length
        ? html`<div class="text-sm" style="line-height:1.7">
            ${op.auditLogs.slice(0, 30).map(
              (a) => html`<div style="border-bottom:1px solid rgba(255,255,255,.05);padding:3px 0">
                <span class="text-dim">${fmtDate(a.createdAt, gtz)}</span>
                <strong>${nm(a.actor)}</strong> ${a.action}${a.detail
                  ? html` <span class="text-dim">(${a.detail})</span>`
                  : safe("")}
              </div>`,
            )}
          </div>`
        : html`<p class="text-dim text-sm">No audit entries yet.</p>`}
    </section>
  </div>`;

  // All tab panels are rendered; client-side JS toggles visibility so switching
  // a tab never reloads the page (no jump to top, no mobile scrollbar reflow).
  // The initially-active one is visible; the rest are [hidden].
  const tabPage = (tab: string, panel: SafeHtml) =>
    html`<div class="opv2-tabpage" data-tab="${tab}" ${activeTab === tab ? safe("") : safe("hidden")}>
      ${panel}
    </div>`;
  const tabPages = html`
    ${tabPage("overview", overviewPanel)} ${tabPage("fleet", fleetPanel)}
    ${tabPage("crew", crewPanel)} ${tabPage("voice", voicePanel)}
    ${canManage ? tabPage("commanders", commandersPanel) : safe("")}
    ${user ? tabPage("admin", adminPanel) : safe("")}
  `;

  const guestBanner = !realUser
    ? html`<div
        class="flash flash-warn"
        style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap"
      >
        <span>Public operation - member names are hidden. Sign in to claim seats or join as crew.</span>
        <a class="btn btn-sm btn-gold" href="${bp}/login">Sign in</a>
      </div>`
    : safe("");

  // Participant join CTA (FR-P1 join focus): a logged-in non-leader instantly
  // sees their signup state or one clear "I want to join" action while open.
  // Leaders/managers skip it because they have the operator controls.
  const myId = user?.id;
  const hasSeat = !!myId && activeSeats.some((seat) => seat.userId === myId);
  const hasCrewReq = !!myId && op.crewRequests.some((r) => r.user.id === myId);
  const participantCta =
    !user || isLeader
      ? safe("")
      : hasSeat
        ? html`<div class="opv2-cta done">Seat claimed.</div>`
        : hasCrewReq
          ? html`<div class="opv2-cta done">
              Signup received - waiting for Fleet Operator assignment.
            </div>`
          : op.status === "open"
            ? html`<div class="opv2-cta">
                <div class="opv2-cta-h">I want to join</div>
                <div class="opv2-cta-actions">
                  <a class="btn btn-green" href="${bp}/ops/${op.id}">Join</a>
                  <a class="btn" href="${bp}/ops/${op.id}#open-seats">Choose an open seat</a>
                </div>
              </div>`
            : op.status === "locked"
              ? html`<div class="opv2-cta closed">
                  Signup closed - contact the Fleet Operator.
                </div>`
              : safe("");

  const body = html`${guestBanner}${joinInviteBanner(opts.joinInviteUrl)}<div class="opv2-shell">
      <header
        class="opv2-hero opv2-hero-mission"
        style="background-image:linear-gradient(90deg, rgba(5,8,16,.97), rgba(5,8,16,.72), rgba(5,8,16,.2)), url('${missionImageUrl(
          bp,
          op.opType,
        )}')"
      >
        <div>
          <div class="opv2-eyebrow">
            ${opTypeTag(op.opType)} ${statusTag(op.status)}
            ${visibilityTag(opts.visibility ?? "private")}
          </div>
          <h1>${op.title}</h1>
          <p>
            ${fmtDate(op.scheduledAt, gtz)} at
            ${op.meetingLocation || systemLabel(op.meetingSystem ?? "stanton")}
          </p>
          ${opts.canEditVisibility
            ? html`<div class="mt-2">
                ${visibilityControl({
                  visibility: opts.visibility ?? "private",
                  canEdit: true,
                  action: `${bp}/ops/${op.id}/visibility`,
                  csrfToken: opts.csrfToken,
                })}
              </div>`
            : safe("")}
        </div>
        <div class="opv2-switch">
          ${canRealManage
            ? html`<div class="opv2-view-switch">
                <span class="text-dim text-sm">View</span>
                <a class="active" href="${bp}/ops/${op.id}/manage?tab=${activeTab}">Operator</a>
                <a href="${bp}/ops/${op.id}">Player Signup</a>
              </div>`
            : ""}
        </div>
      </header>

      <div class="opv2-metrics">
        ${metric("Ships", shipUnits.length)}
        ${metric(
          "Ship Seats",
          `${shipSeatStats.filled}/${shipSeatStats.total}`,
          shipSeatStats.open ? "warn" : "good",
        )}
        ${metric("FPS Teams", fpsUnits.length)}
        ${metric(
          "FPS Seats",
          `${fpsSeatStats.filled}/${fpsSeatStats.total}`,
          fpsSeatStats.open ? "warn" : "good",
        )}
        ${metric("Pending Review", pendingUnits.length, pendingUnits.length ? "warn" : "")}
        ${metric("Fleet Requirements", `${compositionFilled}/${compositionTotal}`)}
        ${metric("Need Assignment", crewWaiting, crewWaiting ? "warn" : "")}
      </div>

      ${actionDetailsPanel}

      ${participantCta}
      <nav class="opv2-tabs">
        ${shellLink("overview", "Overview")} ${shellLink("fleet", "Fleet")}
        ${shellLink("crew", "Crew")} ${shellLink("voice", "Voice")}
        ${canManage ? shellLink("commanders", "Commanders") : safe("")}
        ${user ? shellLink("admin", "Admin") : safe("")}
      </nav>

      ${tabPages}
    </div>
    <script>
      document.querySelectorAll(".opv2-form").forEach((form) => {
        const shipSearch = form.querySelector(".opv2-ship-search");
        const shipResults = form.querySelector(".opv2-ship-results");
        const shipIdField = form.querySelector(".opv2-ship-id-field");
        const ownedShipSelect = form.querySelector(".opv2-owned-ship-select");
        let searchTimer;

        // Unit type → show only the relevant fields (ship picker vs squad).
        const unitType = form.querySelector(".opv2-unit-type");
        const shipFields = form.querySelector(".unit-ship-fields");
        const squadFields = form.querySelector(".unit-squad-fields");
        if (unitType && shipFields && squadFields) {
          const syncUnitType = () => {
            const isShip = unitType.value === "ship";
            shipFields.hidden = !isShip;
            squadFields.hidden = isShip;
            // Clear the hidden side so stale values aren't submitted.
            if (isShip) {
              squadFields.querySelectorAll("input").forEach((i) => {
                if (i.name === "squadSize") i.value = "4";
                else i.value = "";
              });
            } else {
              if (shipIdField) shipIdField.value = "";
              if (shipSearch) shipSearch.value = "";
              if (ownedShipSelect) ownedShipSelect.value = "";
              if (shipResults) shipResults.innerHTML = "";
            }
          };
          unitType.addEventListener("change", syncUnitType);
          syncUnitType();

          // Validate BEFORE submit so a missing ship/squad field never hits the
          // server, reloads the page and collapses this <details> (losing all
          // entered data). Keeps the form open and points at what's missing.
          const errBox = form.querySelector(".opv2-unit-errors");
          const squadName = form.querySelector('[name="squadName"]');
          const squadSize = form.querySelector('[name="squadSize"]');
          const markBad = (el, bad) => el && el.classList.toggle("field-error", bad);
          form.addEventListener("submit", (e) => {
            const missing = [];
            const isShip = unitType.value === "ship";
            markBad(ownedShipSelect, false);
            markBad(shipSearch, false);
            markBad(squadName, false);
            markBad(squadSize, false);
            if (isShip) {
              const hasShip =
                (ownedShipSelect && ownedShipSelect.value) ||
                (shipIdField && shipIdField.value);
              if (!hasShip) {
                missing.push("Schiff (Owned ship oder Ship search)");
                markBad(ownedShipSelect, true);
                markBad(shipSearch, true);
              }
            } else {
              if (!squadName || !squadName.value.trim()) {
                missing.push("Squad name");
                markBad(squadName, true);
              }
              if (!squadSize || !squadSize.value) {
                missing.push("Squad size");
                markBad(squadSize, true);
              }
            }
            if (missing.length > 0) {
              e.preventDefault();
              if (errBox) {
                errBox.textContent = "Bitte ausfüllen: " + missing.join(", ") + ".";
                errBox.hidden = false;
                errBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            } else if (errBox) {
              errBox.hidden = true;
            }
          });
        }
        if (ownedShipSelect && shipIdField) {
          ownedShipSelect.addEventListener("change", () => {
            if (ownedShipSelect.value) {
              shipIdField.value = "";
              if (shipSearch) shipSearch.value = "";
              if (shipResults) shipResults.innerHTML = "";
            }
          });
        }
        if (shipSearch && shipResults && shipIdField) {
          shipSearch.addEventListener("input", () => {
            clearTimeout(searchTimer);
            const q = shipSearch.value.trim();
            shipIdField.value = "";
            if (ownedShipSelect) ownedShipSelect.value = "";
            if (q.length < 2) {
              shipResults.innerHTML = "";
              return;
            }
            searchTimer = setTimeout(async () => {
              const res = await fetch("${bp}/api/ships?q=" + encodeURIComponent(q));
              const ships = await res.json();
              shipResults.innerHTML = ships
                .map(
                  (s) =>
                    '<button type="button" class="ship-row" data-id="' +
                    opv2EscHtml(s.id) +
                    '" data-name="' +
                    opv2EscHtml(s.name) +
                    '"><strong>' +
                    opv2EscHtml(s.name) +
                    "</strong><span>" +
                    opv2EscHtml(s.manufacturer || "") +
                    " // " +
                    opv2EscHtml(s.size || "") +
                    "</span></button>",
                )
                .join("");
            }, 180);
          });
          shipResults.addEventListener("click", (event) => {
            const el = event.target.closest(".ship-row");
            if (!el) return;
            shipResults
              .querySelectorAll(".ship-row")
              .forEach((row) => row.classList.remove("selected"));
            el.classList.add("selected");
            shipIdField.value = el.dataset.id || "";
            shipSearch.value = el.dataset.name || "";
            if (ownedShipSelect) ownedShipSelect.value = "";
          });
        }
      });
      let opv2DraggedCrewUserId = "";
      document.querySelectorAll("[data-crew-user-id]").forEach((chip) => {
        chip.addEventListener("dragstart", (event) => {
          opv2DraggedCrewUserId = chip.dataset.crewUserId || "";
          if (event.dataTransfer) {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", opv2DraggedCrewUserId);
          }
          chip.classList.add("dragging");
        });
        chip.addEventListener("dragend", () => {
          chip.classList.remove("dragging");
          opv2DraggedCrewUserId = "";
        });
      });
      document.querySelectorAll("[data-drop-seat]").forEach((seat) => {
        seat.addEventListener("dragover", (event) => {
          if (!opv2DraggedCrewUserId) return;
          event.preventDefault();
          seat.classList.add("drop-ready");
          if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        });
        seat.addEventListener("dragleave", () => {
          seat.classList.remove("drop-ready");
        });
        seat.addEventListener("drop", (event) => {
          event.preventDefault();
          seat.classList.remove("drop-ready");
          const userId =
            (event.dataTransfer && event.dataTransfer.getData("text/plain")) ||
            opv2DraggedCrewUserId;
          const seatId = seat.dataset.seatId || "";
          const form = document.querySelector('[data-seat-assign-form="' + seatId + '"]');
          const input = form ? form.querySelector('input[name="userId"]') : null;
          if (!form || !input || !userId) return;
          input.value = userId;
          form.submit();
        });
      });
      function opv2EscHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      // Client-side tab switching: show/hide pre-rendered panels without a page
      // reload, so picking a tab never scrolls back to the top. The URL is kept
      // in sync (replaceState) so a later reload or form POST lands on the same
      // tab. Falls back to the plain link navigation if JS is off.
      (function () {
        const shell = document.querySelector(".opv2-shell");
        if (!shell) return;
        const tabs = shell.querySelectorAll(".opv2-tab");
        const pages = shell.querySelectorAll(".opv2-tabpage");
        tabs.forEach((tab) => {
          tab.addEventListener("click", (e) => {
            const name = tab.dataset.tab;
            if (!name) return;
            e.preventDefault();
            tabs.forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
            pages.forEach((p) => {
              p.hidden = p.dataset.tab !== name;
            });
            const href = tab.getAttribute("href");
            if (href) {
              try {
                history.replaceState(null, "", href);
              } catch (_) {}
            }
          });
        });
      })();
    </script>`;

  const { WEB_PUBLIC_URL } = getEnv();
  // Share embed (OpenGraph). Discord renders og:description with newlines, so we
  // pack the structured op details (When / System / Rendezvous / Leaders / Voice
  // / Org / Discord) as one multiline block — mirrors the Action Details panel.
  const ogLeaders = op.leaders.length
    ? op.leaders.map((l) => l.user.username).join(", ")
    : "None";
  const ogOrg = opts.orgName?.trim() || opts.guildName;
  const ogLines = [
    `🕗 When: ${fmtDate(op.scheduledAt, gtz)}`,
    `🌌 System: ${systemLabel(op.meetingSystem ?? "stanton")}`,
    `📍 Rendezvous: ${op.meetingLocation || "Not set"}`,
    `👥 Leaders: ${ogLeaders}`,
    `🔊 Event Voice: ${eventVoiceName}`,
  ];
  if (ogOrg) ogLines.push(`🛰 Org: ${ogOrg}`);
  if (opts.guildDiscordInviteUrl) ogLines.push(`💬 Discord: ${opts.guildDiscordInviteUrl}`);
  return layout({
    title: op.title,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
    ogMeta: {
      title: op.title,
      description: ogLines.join("\n"),
      imageUrl: `${WEB_PUBLIC_URL}${missionImageUrl(bp, op.opType)}`,
      pageUrl: `${WEB_PUBLIC_URL}${bp}/ops/${op.id}`,
    },
  });
}

// Operation form (create / edit)
type OwnedShipRow = {
  id: string;
  nickname: string | null;
  createdAt: Date;
  ship: Ship;
};

export function profilePage(opts: {
  basePath: string;
  currentUser: NonNullable<LayoutOptions["currentUser"]>;
  csrfToken?: string;
  flash?: string;
  ownedShips: OwnedShipRow[];
  searchResults: Ship[];
  query: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";

  const ownedRows = opts.ownedShips.map(
    (owned) =>
      html` <tr>
        <td class="text-mono" style="color:var(--cyan)">${owned.ship.name}</td>
        <td>${owned.nickname ?? ""}</td>
        <td class="text-dim">${owned.ship.manufacturer}</td>
        <td>${shipSizeLabel(owned.ship)}</td>
        <td>${owned.ship.career}</td>
        <td>${owned.ship.role}</td>
        <td class="text-mono text-right">${owned.ship.minCrew}-${owned.ship.maxCrew}</td>
        <td class="text-right">
          <form method="post" action="${bp}/profile/ships/${owned.id}/delete" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <button
              type="submit"
              class="btn btn-sm btn-danger"
              onclick="return confirm('Remove this ship from your profile?')"
            >
              Remove
            </button>
          </form>
        </td>
      </tr>`,
  );

  const resultRows = opts.searchResults.map((ship) => {
    const alreadyOwned = opts.ownedShips.some((owned) => owned.ship.id === ship.id);
    return html` <tr>
      <td class="text-mono" style="color:var(--cyan)">${ship.name}</td>
      <td class="text-dim">${ship.manufacturer}</td>
      <td>${shipSizeLabel(ship)}</td>
      <td>${ship.career}</td>
      <td>${ship.role}</td>
      <td class="text-mono text-right">${ship.minCrew}-${ship.maxCrew}</td>
      <td class="text-right">
        ${alreadyOwned
          ? html`<span class="tag tag-green">Owned</span>`
          : html` <form method="post" action="${bp}/profile/ships" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="shipId" value="${ship.id}" />
              <button type="submit" class="btn btn-sm">Add</button>
            </form>`}
      </td>
    </tr>`;
  });

  const body = html` <div class="page-header">
      <h1 class="page-title">PROFILE</h1>
      <p class="page-subtitle">${opts.currentUser.username} // ${opts.currentUser.role}</p>
    </div>

    <div class="section">
      <div class="section-title">Owned Ships (${opts.ownedShips.length})</div>
      ${opts.ownedShips.length
        ? html` <div style="overflow-x:auto">
            <table>
              <thead>
                <tr>
                  <th>Ship</th>
                  <th>Nickname</th>
                  <th>Manufacturer</th>
                  <th>Size</th>
                  <th>Career</th>
                  <th>Role</th>
                  <th class="text-right">Crew</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${ownedRows}
              </tbody>
            </table>
          </div>`
        : html`<p class="text-dim text-sm">
            No ships added yet. Search the ship database below and add the ships you own.
          </p>`}
    </div>

    <div class="section">
      <div class="section-title">Add Ship</div>
      <form method="get" action="${bp}/profile" class="flex gap-1 mb-2" style="flex-wrap:wrap">
        <input
          type="search"
          name="q"
          value="${opts.query}"
          placeholder="Search ship name..."
          style="max-width:24rem"
        />
        <button type="submit" class="btn btn-sm">Search</button>
        ${opts.query ? html`<a href="${bp}/profile" class="btn btn-sm btn-ghost">Clear</a>` : ""}
      </form>
      ${opts.query
        ? opts.searchResults.length
          ? html` <div style="overflow-x:auto">
              <table>
                <thead>
                  <tr>
                    <th>Ship</th>
                    <th>Manufacturer</th>
                    <th>Size</th>
                    <th>Career</th>
                    <th>Role</th>
                    <th class="text-right">Crew</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${resultRows}
                </tbody>
              </table>
            </div>`
          : html`<p class="text-dim text-sm">No ships found.</p>`
        : html`<p class="text-dim text-sm">Search for a ship to add it to your profile.</p>`}
    </div>`;

  return layout({
    title: "Profile",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}
export function opFormPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op?:
    | (Pick<
        Operation,
        | "id"
        | "title"
        | "description"
        | "opType"
        | "meetingSystem"
        | "meetingLocation"
        | "scheduledAt"
      > & { guildId?: string; eventVoiceChannelId?: string | null })
    | null;
  locations: Pick<
    Location,
    "slug" | "name" | "system" | "systemSlug" | "parentName" | "classification"
  >[];
  /** For new operations: guilds the user can create ops for. Show picker when >1. */
  operatorGuilds?: Array<{ id: string; name: string }>;
  selectedOperatorGuildId?: string;
  /** Discord voice channels for the selected guild (type 2) */
  guildVoiceChannels?: Array<{ id: string; name: string }>;
  /** IANA timezone for display/parse of scheduledAt. Defaults to Europe/Berlin. */
  guildTimezone?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const action = op ? `${bp}/ops/${op.id}/edit` : `${bp}/ops/new`;
  const csrf = opts.csrfToken ?? "";

  const opTypes = OP_TYPES;
  const selectedOperatorGuild = opts.operatorGuilds?.find(
    (g) => g.id === opts.selectedOperatorGuildId,
  );
  const locationOptions = opts.locations
    .filter((location) => SYSTEMS.includes(location.systemSlug as (typeof SYSTEMS)[number]))
    .map((location) => ({
      slug: location.slug,
      value: `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`,
      system: location.systemSlug,
      label: `${location.name} // ${location.system}${location.classification ? ` // ${location.classification}` : ""}`,
    }));
  const selectedLocation =
    locationOptions.find((location) => location.value === op?.meetingLocation) ??
    locationOptions.find((location) => location.value.startsWith(`${op?.meetingLocation ?? ""} (`));
  const meetingSystem = selectedLocation?.system ?? op?.meetingSystem ?? "stanton";

  const body = html` <div class="page-header">
      <h1 class="page-title">${op ? "EDIT OPERATION" : "NEW OPERATION"}</h1>
    </div>
    <div class="card">
      <form method="post" action="${action}" id="op-form" novalidate>
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="form-errors" id="op-form-errors" hidden></div>
        ${!op && opts.operatorGuilds && opts.operatorGuilds.length > 0
          ? html` <div class="form-group">
              <label>Server <span class="req" title="Pflichtfeld">*</span></label>
              ${selectedOperatorGuild
                ? html` <input type="hidden" name="guildId" value="${selectedOperatorGuild.id}" />
                    <div class="guild-selected-badge">${selectedOperatorGuild.name}</div>`
                : opts.operatorGuilds.length === 1
                  ? html` <input
                        type="hidden"
                        name="guildId"
                        value="${opts.operatorGuilds[0].id}"
                      />
                      <div class="guild-selected-badge">${opts.operatorGuilds[0].name}</div>`
                  : html` <select name="guildId" required class="guild-picker-select-form">
                      <option value="">— Select server —</option>
                      ${opts.operatorGuilds.map(
                        (g) => html`<option value="${g.id}">${g.name}</option>`,
                      )}
                    </select>`}
            </div>`
          : safe("")}
        <div class="form-group">
          <label>Operation Title <span class="req" title="Pflichtfeld">*</span></label>
          <input
            type="text"
            name="title"
            value="${op?.title ?? ""}"
            required
            placeholder="Operation Darkstar"
          />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Scheduled Date/Time (${gtz}) <span class="req" title="Pflichtfeld">*</span></label>
            <input
              type="datetime-local"
              name="scheduledAt"
              value="${op ? fmtDateLocal(op.scheduledAt, gtz) : ""}"
              required
            />
          </div>
          <div class="form-group">
            <label>Operation Type</label>
            <select name="opType">
              ${opTypes.map(
                (t) =>
                  html`<option value="${t}" ${op?.opType === t ? safe(" selected") : ""}>
                    ${t}
                  </option>`,
              )}
            </select>
          </div>
          ${!op
            ? html`<div class="form-group">
                <label>Visibility</label>
                <select name="visibility">
                  <option value="private" selected>🔒 Private (this Discord only)</option>
                  <option value="partners">🤝 Partners (this Discord + linked ones)</option>
                  <option value="public">🌐 Public (any logged-in user)</option>
                </select>
              </div>`
            : safe("")}
          <div class="form-group">
            <label>Meeting System</label>
            <select name="meetingSystem" id="meeting-system-select">
              ${SYSTEMS.map(
                (s) =>
                  html`<option value="${s}" ${meetingSystem === s ? safe("selected") : ""}>
                    ${systemLabel(s)}
                  </option>`,
              )}
            </select>
          </div>
          <div class="form-group">
            <label>Meeting Location</label>
            <select name="meetingLocationSlug" id="meeting-location-select">
              <option value="" data-system="">-- Select location --</option>
              ${locationOptions.map(
                (location) =>
                  html` <option
                    value="${location.slug}"
                    data-system="${location.system}"
                    data-label="${location.value}"
                    ${selectedLocation?.slug === location.slug ? safe("selected") : ""}
                  >
                    ${location.label}
                  </option>`,
              )}
            </select>
            <input
              type="hidden"
              name="meetingLocation"
              id="meeting-location-label"
              value="${op?.meetingLocation ?? ""}"
            />
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" placeholder="Briefing, objectives, notes…">
${op?.description ?? ""}</textarea
          >
        </div>
        ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
          ? html` <div class="form-group">
              <label
                >Discord Event Voice Channel
                <span style="font-weight:normal;opacity:.65"
                  >(optional — Discord scheduled event location)</span
                ></label
              >
              <select name="eventVoiceChannelId">
                <option value="">— No voice channel —</option>
                ${opts.guildVoiceChannels.map(
                  (ch) =>
                    html`<option
                      value="${ch.id}"
                      ${op?.eventVoiceChannelId === ch.id ? safe("selected") : ""}
                    >
                      ${ch.name}
                    </option>`,
                )}
              </select>
            </div>`
          : safe("")}
        <div class="form-actions">
          <button type="submit" class="btn">${op ? "Save Changes" : "Create Operation"}</button>
          <a href="${op ? `${bp}/ops/${op.id}` : `${bp}/`}" class="btn btn-ghost">Cancel</a>
        </div>
      </form>
    </div>
    <script>
      const meetingLocationSelect = document.getElementById("meeting-location-select");
      const meetingSystemSelect = document.getElementById("meeting-system-select");
      const meetingLocationLabel = document.getElementById("meeting-location-label");
      function syncMeetingLocationLabel() {
        if (!meetingLocationSelect || !meetingSystemSelect || !meetingLocationLabel) return;
        const opt = meetingLocationSelect.selectedOptions[0];
        meetingLocationLabel.value = opt?.dataset.label || "";
      }
      function filterMeetingLocations() {
        if (!meetingLocationSelect || !meetingSystemSelect || !meetingLocationLabel) return;
        const system = meetingSystemSelect.value;
        const placeholder = meetingLocationSelect.options[0];
        if (placeholder)
          placeholder.textContent =
            "-- Select " +
            meetingSystemSelect.options[meetingSystemSelect.selectedIndex].text +
            " location --";
        let selectedAllowed = false;
        for (const opt of Array.from(meetingLocationSelect.options)) {
          if (!opt.value) {
            opt.hidden = false;
            opt.disabled = false;
            continue;
          }
          const allowed = opt.dataset.system === system;
          opt.hidden = !allowed;
          opt.disabled = !allowed;
          if (opt.selected && allowed) selectedAllowed = true;
        }
        if (!selectedAllowed) meetingLocationSelect.value = "";
        syncMeetingLocationLabel();
      }
      meetingSystemSelect?.addEventListener("change", filterMeetingLocations);
      meetingLocationSelect?.addEventListener("change", syncMeetingLocationLabel);
      filterMeetingLocations();

      // ── Client-side validation BEFORE submit ──────────────────────
      // Marks every missing required field at once (red border) and shows a
      // summary banner, instead of the native one-field-at-a-time bubble.
      (function () {
        const form = document.getElementById("op-form");
        const errorBox = document.getElementById("op-form-errors");
        if (!form || !errorBox) return;
        const labelFor = (el) => {
          const group = el.closest(".form-group");
          const lbl = group ? group.querySelector("label") : null;
          return (lbl ? lbl.textContent : el.name).replace("*", "").trim();
        };
        const clearError = (el) => {
          el.classList.remove("field-error");
          const group = el.closest(".form-group");
          if (group) group.classList.remove("has-error");
        };
        form.querySelectorAll("[required]").forEach((el) => {
          el.addEventListener("input", () => clearError(el));
          el.addEventListener("change", () => clearError(el));
        });
        form.addEventListener("submit", (e) => {
          const missing = [];
          form.querySelectorAll("[required]").forEach((el) => {
            clearError(el);
            if (!el.value || !el.value.trim()) {
              missing.push(el);
              el.classList.add("field-error");
              const group = el.closest(".form-group");
              if (group) group.classList.add("has-error");
            }
          });
          if (missing.length > 0) {
            e.preventDefault();
            errorBox.innerHTML =
              "Bitte fülle die Pflichtfelder aus: " +
              missing.map(labelFor).join(", ") + ".";
            errorBox.hidden = false;
            missing[0].focus();
            errorBox.scrollIntoView({ behavior: "smooth", block: "center" });
          } else {
            errorBox.hidden = true;
          }
        });
      })();
    </script>`;

  return layout({
    title: op ? `Edit: ${op.title}` : "New Operation",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Operation creation wizard (Admin assistant, FR-P1 Phase 1) ───────
// Stepped single-page guided create flow. Same field NAMES as opFormPage so
// it posts to the existing POST /ops/new — no backend/schema change.
export function opWizardPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  operatorGuilds?: Array<{ id: string; name: string }>;
  selectedOperatorGuildId?: string;
  guildVoiceChannels?: Array<{ id: string; name: string }>;
  locations: Pick<
    Location,
    "slug" | "name" | "system" | "systemSlug" | "parentName" | "classification"
  >[];
  guildTimezone?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const csrf = opts.csrfToken ?? "";
  const opTypes = OP_TYPES;
  const selectedOperatorGuild = opts.operatorGuilds?.find(
    (g) => g.id === opts.selectedOperatorGuildId,
  );
  const locationOptions = opts.locations
    .filter((l) => SYSTEMS.includes(l.systemSlug as (typeof SYSTEMS)[number]))
    .map((l) => ({
      slug: l.slug,
      value: `${l.name}${l.parentName ? ` (${l.parentName})` : ""}`,
      system: l.systemSlug,
      label: `${l.name} // ${l.system}${l.classification ? ` // ${l.classification}` : ""}`,
    }));
  const steps = ["Basics", "Briefing", "Discord", "Fleet Requirements", "Review"];

  const body = html` <style>
      .wiz-layout { display: grid; grid-template-columns: 210px minmax(0, 1fr) 300px; gap: 1rem; align-items: start; }
      .wiz-rail ol { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
      .wiz-rail-step { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border-radius: 8px; opacity: .5; }
      .wiz-rail-step.active { opacity: 1; background: rgba(53,208,224,.08); color: var(--cyan, #35d0e0); }
      .wiz-rail-step.done { opacity: .85; cursor: pointer; }
      .wiz-rnum { display: inline-flex; width: 24px; height: 24px; align-items: center; justify-content: center; border-radius: 50%; border: 1px solid currentColor; font-size: .75rem; flex: none; }
      .wiz-rail-hint { color: var(--dim, #7a8a96); font-size: .75rem; margin-top: 16px; line-height: 1.45; }
      .wiz-main .wiz-step { padding: 1.1rem 1.2rem; }
      .wiz-aside-h { font-weight: 700; display: flex; align-items: center; gap: 8px; margin: 0 0 14px; }
      .wiz-ready { list-style: none; padding: 0; margin: 0 0 20px; display: flex; flex-direction: column; gap: 10px; }
      .wiz-ready li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: .85rem; }
      .wiz-tag { font-size: .62rem; padding: 2px 7px; border-radius: 5px; font-weight: 700; letter-spacing: .5px; white-space: nowrap; }
      .wiz-tag.ok { color: var(--green, #3ad07a); border: 1px solid var(--green, #3ad07a); }
      .wiz-tag.warn { color: #e0b835; border: 1px solid #e0b835; }
      .wiz-tag.info { color: var(--dim, #7a8a96); border: 1px solid rgba(255,255,255,.18); }
      .wiz-sum-h { font-weight: 700; margin: 0 0 10px; }
      .wiz-sum { display: grid; grid-template-columns: auto 1fr; gap: 6px 10px; font-size: .82rem; margin: 0; }
      .wiz-sum dt { color: var(--dim, #7a8a96); }
      .wiz-sum dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
      .wiz-aside-actions { display: flex; flex-direction: column; gap: 8px; margin-top: 18px; }
      .wiz-md-prev { border: 1px solid rgba(255,255,255,.12); border-radius: 8px; padding: 12px 14px; background: rgba(0,0,0,.2); min-height: 120px; }
      .wiz-md-prev h4 { margin: .7rem 0 .25rem; color: var(--cyan, #35d0e0); }
      .wiz-md-prev h4:first-child { margin-top: 0; }
      @media (max-width: 1100px) {
        .wiz-layout { grid-template-columns: 1fr; }
        .wiz-rail ol { flex-direction: row; flex-wrap: wrap; }
        .wiz-rail-hint { display: none; }
      }
    </style>
    <div class="page-header"><h1 class="page-title">CREATE EVENT</h1></div>
    <form method="post" action="${bp}/ops/new" id="wiz-form" novalidate>
      <input type="hidden" name="_csrf" value="${csrf}" />
      <div class="wiz-layout">
        <aside class="wiz-rail card">
          <ol>
            ${steps.map(
              (s, i) =>
                html`<li class="wiz-rail-step${i === 0 ? safe(" active") : ""}" data-rs="${i}">
                  <span class="wiz-rnum">${i + 1}</span><span>${s}</span>
                </li>`,
            )}
          </ol>
          <p class="wiz-rail-hint">
            Create an event in a few steps. You can save as draft at any time.
          </p>
        </aside>

        <div class="wiz-main">
          <div class="form-errors" id="wiz-errors" hidden></div>

          <section class="wiz-step card" data-step="0">
            <h3 class="wiz-sum-h">Basics</h3>
            ${opts.operatorGuilds && opts.operatorGuilds.length > 0
              ? html` <div class="form-group">
                  <label>Server <span class="req" title="required">*</span></label>
                  ${selectedOperatorGuild
                    ? html`<input type="hidden" name="guildId" value="${selectedOperatorGuild.id}" />
                        <div class="guild-selected-badge">${selectedOperatorGuild.name}</div>`
                    : opts.operatorGuilds.length === 1
                      ? html`<input type="hidden" name="guildId" value="${opts.operatorGuilds[0].id}" />
                          <div class="guild-selected-badge">${opts.operatorGuilds[0].name}</div>`
                      : html`<select name="guildId" required class="guild-picker-select-form">
                          <option value="">— select server —</option>
                          ${opts.operatorGuilds.map(
                            (g) => html`<option value="${g.id}">${g.name}</option>`,
                          )}
                        </select>`}
                </div>`
              : safe("")}
            <div class="form-group">
              <label>Event Name <span class="req" title="required">*</span></label>
              <input type="text" name="title" required placeholder="Operation Darkstar" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>Start Time (${gtz}) <span class="req" title="required">*</span></label>
                <input type="datetime-local" name="scheduledAt" required />
              </div>
              <div class="form-group">
                <label>Mission Type</label>
                <select name="opType">
                  ${opTypes.map((t) => html`<option value="${t}">${t}</option>`)}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>System</label>
                <select name="meetingSystem" id="meeting-system-select">
                  ${SYSTEMS.map((s) => html`<option value="${s}">${systemLabel(s)}</option>`)}
                </select>
              </div>
              <div class="form-group">
                <label>Rendezvous</label>
                <select name="meetingLocationSlug" id="meeting-location-select">
                  <option value="" data-system="">-- select location --</option>
                  ${locationOptions.map(
                    (l) =>
                      html`<option value="${l.slug}" data-system="${l.system}" data-label="${l.value}">
                        ${l.label}
                      </option>`,
                  )}
                </select>
                <input type="hidden" name="meetingLocation" id="meeting-location-label" value="" />
              </div>
            </div>
            <div class="form-group">
              <label>Visibility</label>
              <select name="visibility">
                <option value="private" selected>🔒 Private (this Discord only)</option>
                <option value="partners">🤝 Partners (this + linked)</option>
                <option value="public">🌐 Public (any logged-in user)</option>
              </select>
            </div>
          </section>

          <section class="wiz-step card" data-step="1" hidden>
            <div
              class="form-group"
              style="display:flex;align-items:center;justify-content:space-between;gap:8px"
            >
              <label style="margin:0"
                >Briefing <span style="font-weight:normal;opacity:.65">(Markdown)</span></label
              >
              <button type="button" class="btn btn-sm btn-ghost" id="wiz-md-toggle">Preview</button>
            </div>
            <textarea
              name="description"
              id="wiz-md"
              rows="12"
              placeholder="## Mission Objective&#10;…&#10;&#10;## RoE&#10;…&#10;&#10;## Equipment&#10;…"
            ></textarea>
            <div class="wiz-md-prev" id="wiz-md-prev" hidden></div>
          </section>

          <section class="wiz-step card" data-step="2" hidden>
            <h3 class="wiz-sum-h">Discord</h3>
            ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
              ? html` <div class="form-group">
                  <label
                    >Event Voice Channel
                    <span style="font-weight:normal;opacity:.65">(optional)</span></label
                  >
                  <select name="eventVoiceChannelId">
                    <option value="">— none —</option>
                    ${opts.guildVoiceChannels.map(
                      (ch) => html`<option value="${ch.id}">${ch.name}</option>`,
                    )}
                  </select>
                </div>`
              : html`<p class="text-dim text-sm">No Discord voice channels available for this server.</p>`}
            <p class="wiz-rail-hint" style="margin-top:10px">
              Announcement channel + Commander Net are configured in Server Settings.
            </p>
          </section>

          <section class="wiz-step card" data-step="3" hidden>
            <div
              class="form-group"
              style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"
            >
              <h3 class="wiz-sum-h" style="margin:0">Fleet Requirements</h3>
              <select id="wiz-tpl" class="guild-picker-select-form" style="max-width:230px">
                <option value="">📁 Load template…</option>
                ${COMPOSITION_TEMPLATES.map((t, i) => html`<option value="${i}">${t.name}</option>`)}
              </select>
            </div>
            <p class="wiz-rail-hint" style="margin:0 0 12px">
              What does the mission need? Requested counts per role — crew claims the seats later.
            </p>
            <div id="wiz-comp-rows"></div>
            <button type="button" class="btn btn-sm btn-ghost" id="wiz-comp-add" style="margin-top:8px">
              + Add requirement
            </button>
            <input type="hidden" name="compositionJson" id="wiz-comp-json" value="[]" />
            <div class="form-row" style="margin-top:16px">
              <div class="form-group">
                <label>Minimum Participants</label>
                <input type="number" name="minParticipants" min="0" value="0" />
              </div>
              <div class="form-group">
                <label>Maximum Participants <span style="font-weight:normal;opacity:.65">(optional)</span></label>
                <input type="number" name="maxParticipants" min="0" placeholder="—" />
              </div>
            </div>
          </section>

          <section class="wiz-step card" data-step="4" hidden>
            <h3 class="wiz-sum-h">Review</h3>
            <dl class="wiz-sum" id="wiz-review"></dl>
          </section>
        </div>

        <aside class="wiz-aside card">
          <div class="wiz-aside-h">✓ Ready to Open</div>
          <ul class="wiz-ready" id="wiz-ready"></ul>
          <div class="wiz-sum-h">Summary</div>
          <dl class="wiz-sum" id="wiz-summary"></dl>
          <div class="wiz-aside-actions">
            <button type="submit" class="btn btn-green" id="wiz-draft">💾 Save as Draft</button>
            <button type="button" class="btn btn-ghost" id="wiz-next">Continue ›</button>
            <button type="submit" class="btn btn-green" id="wiz-submit" hidden>Create Event</button>
            <button type="button" class="btn btn-ghost" id="wiz-back" hidden>‹ Back</button>
          </div>
        </aside>
      </div>
    </form>
    <script>
      (function () {
        const ms = document.getElementById("meeting-system-select");
        const ml = document.getElementById("meeting-location-select");
        const mlab = document.getElementById("meeting-location-label");
        function syncLabel() {
          if (!ml || !mlab) return;
          mlab.value = ml.selectedOptions[0]?.dataset.label || "";
          updateAside();
        }
        function filterLoc() {
          if (!ml || !ms) return;
          for (const o of Array.from(ml.options)) {
            if (!o.value) { o.hidden = false; o.disabled = false; continue; }
            const ok = o.dataset.system === ms.value;
            o.hidden = !ok; o.disabled = !ok;
            if (o.selected && !ok) ml.value = "";
          }
          syncLabel();
        }
        ms?.addEventListener("change", filterLoc);
        ml?.addEventListener("change", syncLabel);
        filterLoc();

        const sections = Array.from(document.querySelectorAll(".wiz-step"));
        const rail = Array.from(document.querySelectorAll(".wiz-rail-step"));
        const back = document.getElementById("wiz-back");
        const next = document.getElementById("wiz-next");
        const submit = document.getElementById("wiz-submit");
        const errs = document.getElementById("wiz-errors");
        const review = document.getElementById("wiz-review");
        const summary = document.getElementById("wiz-summary");
        const ready = document.getElementById("wiz-ready");
        let cur = 0;

        function val(name) {
          const el = document.querySelector('[name="' + name + '"]');
          if (!el) return "";
          if (el.tagName === "SELECT") return el.selectedOptions[0]?.textContent.trim() || el.value;
          return el.value;
        }
        function esc(s) { return String(s || "—").replace(/</g, "&lt;"); }
        function rows() {
          const server =
            document.querySelector(".guild-selected-badge")?.textContent?.trim() || val("guildId") || "—";
          return [
            ["Name", val("title") || "—"], ["Start", val("scheduledAt") || "—"],
            ["Mission Type", val("opType")], ["Rendezvous", document.getElementById("meeting-location-label")?.value || "—"],
            ["Visibility", val("visibility")], ["Voice", val("eventVoiceChannelId") || "—"],
            ["Server", server],
          ];
        }
        function dl(node) {
          node.innerHTML = rows().map((r) => "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>").join("");
        }
        function updateAside() {
          dl(summary);
          let compN = 0, compTotal = 0;
          try {
            const arr = JSON.parse(document.getElementById("wiz-comp-json")?.value || "[]");
            compN = arr.length;
            arr.forEach((r) => (compTotal += r.count || 0));
          } catch (e) {}
          const minP = parseInt(val("minParticipants") || "0", 10) || 0;
          const items = [];
          const voiceOk = !!val("eventVoiceChannelId");
          items.push(["Event Voice Channel", voiceOk ? "ok" : "info", voiceOk ? "OK" : "OPTIONAL"]);
          items.push(["Announcement Channel", "info", "SETTINGS"]);
          items.push(["Fleet Requirements", compN ? "ok" : "warn", compN ? compN + " roles" : "EMPTY"]);
          items.push(
            minP > 0
              ? ["Minimum Participants", compTotal >= minP ? "ok" : "warn", compTotal + " / " + minP]
              : ["Minimum Participants", "info", "—"],
          );
          items.push(["Commander Net", "info", "SETTINGS"]);
          ready.innerHTML = items
            .map((it) => '<li><span>' + it[0] + '</span><span class="wiz-tag ' + it[1] + '">' + it[2] + "</span></li>")
            .join("");
        }

        function show(i) {
          sections.forEach((s, n) => (s.hidden = n !== i));
          rail.forEach((r, n) => { r.classList.toggle("active", n === i); r.classList.toggle("done", n < i); });
          back.hidden = i === 0;
          next.hidden = i === sections.length - 1;
          submit.hidden = i !== sections.length - 1;
          errs.hidden = true;
          if (i === sections.length - 1) dl(review);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
        function validate(i) {
          const miss = [];
          sections[i].querySelectorAll("[required]").forEach((el) => {
            el.classList.remove("field-error");
            if (!el.value || !el.value.trim()) { miss.push(el); el.classList.add("field-error"); }
          });
          if (miss.length) { errs.textContent = "Bitte Pflichtfelder ausfüllen."; errs.hidden = false; miss[0].focus(); }
          return miss.length === 0;
        }

        // Markdown preview (minimal: ## heading, **bold**, line breaks).
        const mdToggle = document.getElementById("wiz-md-toggle");
        const md = document.getElementById("wiz-md");
        const mdPrev = document.getElementById("wiz-md-prev");
        function renderMd(t) {
          return esc(t)
            .replace(/^##\\s?(.*)$/gm, "<h4>$1</h4>")
            .replace(/\\*\\*(.+?)\\*\\*/g, "<b>$1</b>")
            .replace(/\\n/g, "<br>");
        }
        mdToggle?.addEventListener("click", () => {
          if (mdPrev.hidden) {
            mdPrev.innerHTML = renderMd(md.value);
            mdPrev.hidden = false; md.hidden = true; mdToggle.textContent = "Bearbeiten";
          } else {
            mdPrev.hidden = true; md.hidden = false; mdToggle.textContent = "Vorschau";
          }
        });

        const form = document.getElementById("wiz-form");
        form.addEventListener("input", updateAside);
        form.addEventListener("change", updateAside);
        rail.forEach((r, n) => r.addEventListener("click", () => { if (n < cur) { cur = n; show(cur); } }));
        next.addEventListener("click", () => { if (validate(cur) && cur < sections.length - 1) { cur++; show(cur); } });
        back.addEventListener("click", () => { if (cur > 0) { cur--; show(cur); } });

        // ── Fleet Requirements editor (Phase 3) ──────────────────────
        const TPL = ${safe(JSON.stringify(COMPOSITION_TEMPLATES))};
        const CATS = ${safe(JSON.stringify(REQUIREMENT_CATEGORIES))};
        const CATLBL = ${safe(
          JSON.stringify(Object.fromEntries(REQUIREMENT_CATEGORIES.map((c) => [c, categoryLabel(c)]))),
        )};
        const compRows = document.getElementById("wiz-comp-rows");
        const compJsonEl = document.getElementById("wiz-comp-json");
        function compSerialize() {
          const data = Array.from(compRows.querySelectorAll(".comp-row"))
            .map((r) => ({
              category: r.querySelector(".comp-cat").value,
              label: r.querySelector(".comp-label").value.trim(),
              count: Math.max(1, Math.min(99, parseInt(r.querySelector(".comp-count").value, 10) || 1)),
            }))
            .filter((x) => x.label);
          compJsonEl.value = JSON.stringify(data);
          updateAside();
        }
        function compAddRow(row) {
          const div = document.createElement("div");
          div.className = "comp-row";
          div.style.cssText =
            "display:grid;grid-template-columns:1.2fr 1.6fr 70px 34px;gap:8px;margin-bottom:8px;align-items:center";
          const cat = (row && row.category) || CATS[0];
          const opts = CATS.map(
            (c) => '<option value="' + c + '"' + (c === cat ? " selected" : "") + ">" + (CATLBL[c] || c) + "</option>",
          ).join("");
          const lbl = ((row && row.label) || "").replace(/"/g, "&quot;");
          div.innerHTML =
            '<select class="comp-cat">' + opts + "</select>" +
            '<input class="comp-label" type="text" placeholder="e.g. Fireteam Alpha" value="' + lbl + '">' +
            '<input class="comp-count" type="number" min="1" max="99" value="' + ((row && row.count) || 1) + '">' +
            '<button type="button" class="btn btn-sm btn-ghost comp-del">✕</button>';
          compRows.appendChild(div);
          div.querySelector(".comp-del").addEventListener("click", () => { div.remove(); compSerialize(); });
          div.querySelectorAll("input,select").forEach((el) => el.addEventListener("input", compSerialize));
        }
        document.getElementById("wiz-comp-add").addEventListener("click", () => { compAddRow(); compSerialize(); });
        document.getElementById("wiz-tpl").addEventListener("change", (e) => {
          if (e.target.value === "") return;
          compRows.innerHTML = "";
          (TPL[e.target.value].requirements || []).forEach(compAddRow);
          compSerialize();
          e.target.value = "";
        });
        compSerialize();

        show(0);
        updateAside();
      })();
    </script>`;

  return layout({
    title: "Neue Operation — Assistent",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Participant join view (FR-P1 Phase 2/4 — mobile-first sign-up) ───
// Focused "I want to join" page: the three sign-up paths, Open Seats, Fleet
// Requirements, briefing, and a "My Signup" sidebar. Reuses existing
// endpoints (crew-requests, seat claim on the Fleet tab).
export function opJoinPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op: NonNullable<OpFull>;
  guildTimezone?: string;
  voiceChannelName?: string | null;
  ownedShips?: Ship[];
  canManage?: boolean;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const csrf = opts.csrfToken ?? "";
  const myId = opts.currentUser?.id;
  const isOpen = op.status === "open";
  const hasSeat = !!myId && op.units.some((u) => u.seats.some((s) => s.active && s.userId === myId));
  const hasReq = !!myId && op.crewRequests.some((r) => r.user.id === myId);
  const acceptedUnits = op.units.filter((u) => u.status === "accepted");
  const openSeats = acceptedUnits
    .flatMap((u) =>
      u.seats
        .filter((s) => s.active && !s.userId)
        .map((s) => ({
          unit: u.squadName || u.ship?.name || "Unit",
          seatId: s.id,
          label: s.label,
        })),
    )
    .slice(0, 24);
  const seatSummary = acceptedUnits
    .map((u) => {
      const seats = u.seats.filter((s) => s.active);
      return {
        name: u.squadName || u.ship?.name || "Unit",
        open: seats.filter((s) => !s.userId).length,
        total: seats.length,
      };
    })
    .filter((u) => u.open > 0);
  const requirements = op.groups.flatMap((g) => g.requirements);
  const ownedShips = opts.ownedShips ?? [];
  // Open composition slots (accepted units < requested) the player can target
  // when offering a ship. Phase-1: no allowed-ship restriction yet (FR-P1 §5).
  const availableSlots = requirements
    .filter((r) => r.fleetUnits.filter((u) => u.status === "accepted").length < r.count)
    .map((r) => ({ id: r.id, label: r.label }));
  const minP = (op as { minParticipants?: number }).minParticipants ?? 0;
  const maxP = (op as { maxParticipants?: number | null }).maxParticipants ?? null;
  // Player view only ever shows the viewer's own questions. Operators answer in
  // the manage shell (opDetailPageV2 Admin tab), not on this signup page.
  const myQuestions = op.questions.filter((q) => q.askerId === myId);
  const canManage = opts.canManage === true;
  const requirementRows = requirements.map((r) => {
    const fulfilled = r.fleetUnits.filter((u) => u.status === "accepted").length;
    const pending = r.fleetUnits.filter((u) => u.status === "pending").length;
    return {
      label: r.label,
      category: categoryLabel(r.category),
      requested: r.count,
      fulfilled,
      pending,
      open: Math.max(0, r.count - fulfilled),
    };
  });
  const requestedTotal = requirementRows.reduce((sum, r) => sum + r.requested, 0);
  const fulfilledTotal = requirementRows.reduce((sum, r) => sum + r.fulfilled, 0);
  const openTotal = requirementRows.reduce((sum, r) => sum + r.open, 0);
  const statusUpper = op.status.toUpperCase();
  const visUpper = ((op as { visibility?: string }).visibility ?? "private").toUpperCase();

  const stateBanner = hasSeat
    ? html`<div class="opv2-cta done">Seat claimed.</div>`
    : hasReq
      ? html`<div class="opv2-cta done">Waiting for Fleet Operator assignment.</div>`
      : !isOpen
        ? html`<div class="opv2-cta closed">Sign-up closed.</div>`
        : safe("");

  const body = html` <style>
      .event-shell { max-width: 1180px; margin: 0 auto; }
      .event-hero {
        min-height: 250px;
        display: grid;
        align-content: end;
        gap: 1rem;
        padding: 1.25rem;
        border: 1px solid var(--cyan-28);
        background-size: cover;
        background-position: center;
        margin-bottom: 1rem;
      }
      .event-hero-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; }
      .event-hero h1 { margin: 0; font-size: clamp(1.65rem, 3vw, 2.55rem); line-height: 1.05; }
      .event-hero p { margin: .45rem 0 0; color: var(--dim); font-size: .95rem; }
      .event-manage { display: flex; gap: .5rem; flex-wrap: wrap; justify-content: flex-end; }
      .join-badges { display: flex; gap: 8px; flex-wrap: wrap; }
      .join-badge { font-size: 0.7rem; font-weight: 700; letter-spacing: 0.5px; padding: 4px 10px; border-radius: 4px; border: 1px solid currentColor; background: rgba(0,0,0,.35); }
      .join-badge.open { color: var(--green, #3ad07a); }
      .join-badge.pub { color: var(--cyan, #35d0e0); }
      .join-badge.time { color: var(--text); }
      .event-facts { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: .75rem; margin-bottom: 1rem; }
      .event-fact { border: 1px solid var(--border); background: var(--bg2); padding: .85rem; min-width: 0; }
      .event-fact span { display: block; color: var(--dim); font-family: var(--font-mono); font-size: .68rem; text-transform: uppercase; letter-spacing: .08em; }
      .event-fact strong { display: block; margin-top: .35rem; overflow-wrap: anywhere; }
      .join-layout { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 1rem; align-items: start; }
      .join-row2 { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; margin-top: 1rem; }
      .join-opt { display: grid; grid-template-columns: 4rem minmax(0, 1fr) auto; align-items: center; gap: 14px; padding: 14px 16px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10px; text-decoration: none; color: inherit; background: rgba(255,255,255,.015); }
      .join-opt:hover { border-color: var(--cyan, #35d0e0); background: var(--cyan-08); }
      .join-opt .ico { font-family: var(--font-mono); font-size: .72rem; color: var(--cyan); text-transform: uppercase; }
      .join-opt .ttl { font-weight: 700; }
      .join-opt .sub { font-size: 0.8rem; color: var(--dim, #7a8a96); }
      .join-opt .arr { color: var(--dim, #7a8a96); }
      .join-seat { display: flex; justify-content: space-between; gap: .75rem; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.88rem; }
      .join-seat .free { color: var(--green, #3ad07a); font-weight: 600; white-space: nowrap; }
      .req-table { display: grid; gap: .35rem; }
      .req-row { display: grid; grid-template-columns: minmax(0, 1fr) 5.8rem 5.8rem 6.5rem; gap: .5rem; align-items: center; padding: .55rem 0; border-bottom: 1px solid rgba(255,255,255,.06); }
      .req-head { color: var(--dim); font-family: var(--font-mono); font-size: .66rem; text-transform: uppercase; letter-spacing: .08em; }
      .req-name { min-width: 0; }
      .req-name strong { display: block; overflow-wrap: anywhere; }
      .req-name span { color: var(--dim); font-size: .76rem; }
      .req-num { font-family: var(--font-mono); font-weight: 700; }
      .join-md { white-space: pre-wrap; font-size: 0.9rem; line-height: 1.55; color: var(--text, #cdd9e1); }
      .join-aside { position: sticky; top: 1rem; }
      .join-aside textarea { width: 100%; box-sizing: border-box; min-height: 100px; margin: 6px 0 10px; }
      .join-cta-btn { width: 100%; }
      .join-q { padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.88rem; }
      .join-a { margin-top: 4px; color: var(--green, #3ad07a); }
      .join-ans { display: flex; gap: 6px; margin-top: 6px; }
      .join-ans input { flex: 1; }
      .join-audit { font-size: 0.8rem; line-height: 1.7; }
      .join-au { border-bottom: 1px solid rgba(255,255,255,0.05); padding: 3px 0; }
      @media (max-width: 900px) {
        .event-hero-top { flex-direction: column; }
        .event-facts, .join-layout, .join-row2 { grid-template-columns: 1fr; }
        .join-aside { position: static; }
        .req-row { grid-template-columns: 1fr 4.5rem 4.5rem 5rem; }
      }
    </style>
    <div class="event-shell">
    <section
      class="event-hero"
      style="background-image:linear-gradient(90deg, rgba(5,8,16,.96), rgba(5,8,16,.76), rgba(5,8,16,.3)), url('${missionImageUrl(
        bp,
        op.opType,
      )}')"
    >
      <div class="event-hero-top">
        <div class="join-badges">
          <span class="join-badge ${isOpen ? "open" : ""}">${statusUpper}</span>
          <span class="join-badge pub">${visUpper}</span>
          <span class="join-badge time">${fmtDateLocal(op.scheduledAt, gtz)} (${gtz})</span>
        </div>
        ${canManage
          ? html`<div class="event-manage">
              <a class="btn btn-sm btn-cyan" href="${bp}/ops/${op.id}/manage">Manage Event</a>
            </div>`
          : safe("")}
      </div>
      <div>
        <h1>${op.title}</h1>
        <p>${op.meetingLocation || "Rendezvous not set"} · ${systemLabel(op.meetingSystem)}</p>
      </div>
    </section>
    <div class="event-facts">
      <div class="event-fact"><span>Rendezvous</span><strong>${op.meetingLocation || "Not set"}</strong></div>
      <div class="event-fact"><span>System</span><strong>${systemLabel(op.meetingSystem)}</strong></div>
      <div class="event-fact"><span>Voice</span><strong>${opts.voiceChannelName || "Not set"}</strong></div>
      <div class="event-fact">
        <span>Participants</span>
        <strong>${minP > 0 ? `Min ${minP}` : "No minimum"}${maxP ? ` / Max ${maxP}` : ""}</strong>
      </div>
    </div>

    <div class="join-layout">
      <div class="join-main">
        <section class="card">
          <h3 class="wiz-sum-h">I want to join</h3>
          <a class="join-opt" href="#signup">
            <span class="ico">Assign</span>
            <span
              ><span class="ttl">Let the operator assign me</span><br /><span class="sub"
                >I am flexible or need help finding a role.</span
              ></span
            >
            <span class="arr">&gt;</span>
          </a>
          <a class="join-opt" href="#open-seats">
            <span class="ico">Seat</span>
            <span
              ><span class="ttl">Choose an open seat</span><br /><span class="sub"
                >Pick an available seat in an accepted ship or fireteam.</span
              ></span
            >
            <span class="arr">&gt;</span>
          </a>
          <a class="join-opt" href="#offer-ship">
            <span class="ico">Ship</span>
            <span
              ><span class="ttl">Offer a ship</span><br /><span class="sub"
                >Offer one of your ships for this mission.</span
              ></span
            >
            <span class="arr">&gt;</span>
          </a>
        </section>

        <div class="join-row2">
          <section class="card" id="open-seats">
            <h3 class="wiz-sum-h">Open Seats</h3>
            ${openSeats.length
              ? openSeats.map(
                  (s) =>
                    html`<div class="join-seat">
                      <span>${s.unit} - ${s.label}</span>
                      ${isOpen && myId
                        ? html`<form
                            method="post"
                            action="${bp}/api/seats/${s.seatId}/claim"
                            class="inline"
                          >
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <input type="hidden" name="ui" value="player" />
                            <input type="hidden" name="tab" value="fleet" />
                            <button type="submit" class="btn btn-sm btn-green">Claim</button>
                          </form>`
                        : isOpen
                          ? html`<a class="btn btn-sm btn-green" href="${bp}/login">Sign in</a>`
                        : html`<span class="free">open</span>`}
                    </div>`,
                )
              : html`<p class="text-dim text-sm">No open seats right now.</p>`}
            ${canManage
              ? html`<a
                  href="${bp}/ops/${op.id}/manage?tab=fleet"
                  class="text-sm"
                  style="display:inline-block;margin-top:8px"
                  >Manage all positions &gt;</a
                >`
              : safe("")}
          </section>
          <section class="card">
            <h3 class="wiz-sum-h">Fleet Requirements</h3>
            ${requirementRows.length
              ? html`<div class="req-table">
                  <div class="req-row req-head">
                    <span>Requirement</span>
                    <span>Requested</span>
                    <span>Fulfilled</span>
                    <span>Open Slots</span>
                  </div>
                  ${requirementRows.map(
                    (r) => html`<div class="req-row">
                      <span class="req-name"><strong>${r.label}</strong><span>${r.category}</span></span>
                      <span class="req-num">${r.requested}</span>
                      <span class="req-num">${r.fulfilled}${r.pending ? html` <span class="tag tag-gold">${r.pending} pending</span>` : safe("")}</span>
                      <span class="req-num">${r.open}</span>
                    </div>`,
                  )}
                  <div class="req-row">
                    <span class="req-name"><strong>Total</strong><span>Accepted units count as fulfilled</span></span>
                    <span class="req-num">${requestedTotal}</span>
                    <span class="req-num">${fulfilledTotal}</span>
                    <span class="req-num">${openTotal}</span>
                  </div>
                </div>`
              : html`<p class="text-dim text-sm">No requirements defined.</p>`}
          </section>
        </div>

        <section class="card" id="offer-ship" style="margin-top:1rem">
          <h3 class="wiz-sum-h">Offer a ship or fireteam</h3>
          ${!myId
            ? html`<p class="text-dim text-sm">Sign in to offer a ship for this mission.</p>
                <a class="btn btn-sm btn-green" href="${bp}/login">Sign in</a>`
            : !isOpen
              ? html`<p class="text-dim text-sm">Sign-up is closed.</p>`
              : html`<form
                  method="post"
                  action="${bp}/api/ops/${op.id}/units"
                  class="opv2-form join-unit-form"
                  novalidate
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <input type="hidden" name="ui" value="player" />
                  <input type="hidden" name="tab" value="fleet" />
                  <div class="form-errors join-unit-errors" hidden></div>
                  <label>Fleet need <span style="font-weight:normal;opacity:.65">(optional)</span></label>
                  <select name="requirementId">
                    <option value="">Unslotted — let the operator place it</option>
                    ${availableSlots.map(
                      (s) => html`<option value="${s.id}">${s.label}</option>`,
                    )}
                  </select>
                  <label>Type</label>
                  <select name="unitType" class="join-unit-type">
                    <option value="ship">Ship</option>
                    <option value="squad">FPS fireteam</option>
                  </select>
                  <div class="unit-ship-fields">
                    <label>From your hangar</label>
                    <select name="ownedShipId" class="join-owned-ship-select">
                      <option value="">Select an owned ship…</option>
                      ${ownedShips.map(
                        (ship) => html`<option value="${ship.id}">${ship.name}</option>`,
                      )}
                    </select>
                    <label>…or search the ship catalog</label>
                    <input
                      type="search"
                      class="join-ship-search"
                      placeholder="Search ship catalog…"
                      autocomplete="off"
                    />
                    <input type="hidden" name="shipId" class="join-ship-id-field" />
                    <label style="font-weight:normal">
                      <input type="checkbox" name="storeOwnedShip" value="1" /> Save this ship to my
                      hangar
                    </label>
                    <div class="ship-results join-ship-results"></div>
                  </div>
                  <div class="unit-squad-fields" hidden>
                    <label>Fireteam name</label>
                    <input type="text" name="squadName" maxlength="80" placeholder="FPS Team" />
                    <label>Fireteam size</label>
                    <input type="number" name="squadSize" min="2" max="8" value="4" />
                  </div>
                  <label>Note to the Fleet Operator <span style="font-weight:normal;opacity:.65">(optional)</span></label>
                  <input
                    type="text"
                    name="captainNote"
                    maxlength="240"
                    placeholder="Role, loadout, crew preference…"
                  />
                  <button type="submit" class="btn btn-green mt-1">Offer</button>
                </form>`}
        </section>

        <section class="card" style="margin-top:1rem">
          <h3 class="wiz-sum-h">Briefing</h3>
          ${op.description
            ? html`<div class="join-md">${op.description}</div>`
            : html`<p class="text-dim text-sm">No briefing yet.</p>`}
        </section>

        ${myQuestions.length
          ? html`<section class="card" style="margin-top:1rem">
              <h3 class="wiz-sum-h">My Questions</h3>
              ${myQuestions.map(
                (q) => html`<div class="join-q">
                  <div><b>${q.asker}:</b> ${q.body}</div>
                  ${q.answer
                    ? html`<div class="join-a">Reply from <b>${q.answeredBy}:</b> ${q.answer}</div>`
                    : html`<div class="join-a text-dim">Not answered yet</div>`}
                </div>`,
              )}
            </section>`
          : safe("")}
      </div>

      <aside class="card join-aside" id="signup">
        <h3 class="wiz-sum-h">My Signup</h3>
        ${stateBanner}
        ${!myId
          ? html`<p class="text-dim text-sm">Sign in to claim seats, offer ships, or ask the Fleet Operator a question.</p>
              <a class="btn btn-green join-cta-btn" href="${bp}/login">Sign in</a>`
          : isOpen && !hasSeat && !hasReq
          ? html`<form method="post" action="${bp}/api/ops/${op.id}/crew-requests">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="ui" value="player" />
              <input type="hidden" name="tab" value="crew" />
              <label
                >Note to Fleet Operator
                <span style="font-weight:normal;opacity:.65">(optional)</span></label
              >
              <textarea
                name="note"
                maxlength="240"
                placeholder="e.g. experience, preferred role, ships you can bring..."
              ></textarea>
              <button type="submit" class="btn btn-green join-cta-btn">Join</button>
            </form>`
          : !hasSeat && !hasReq
            ? html`<p class="text-dim text-sm">Not signed up yet.</p>`
            : safe("")}
        ${myId
          ? html`<form method="post" action="${bp}/ops/${op.id}/questions" style="margin-top:12px">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label>Ask a question</label>
              <textarea name="body" maxlength="1000" placeholder="e.g. which loadouts? exact time?"></textarea>
              <button type="submit" class="btn btn-ghost join-cta-btn">Ask a question</button>
            </form>`
          : safe("")}
        ${seatSummary.length
          ? html`<div style="margin-top:14px">
              <div class="wiz-sum-h" style="font-size:.9rem">Available Seats</div>
              ${seatSummary.map(
                (s) => html`<div class="join-seat">
                  <span>${s.name}</span><span class="free">${s.open}/${s.total} open</span>
                </div>`,
              )}
            </div>`
          : safe("")}
        <p class="text-dim text-sm" style="margin-top:10px">
          Your signup is visible to the operator once you join.
        </p>
      </aside>
    </div>
    </div>
    <script>
      document.querySelectorAll(".join-unit-form").forEach((form) => {
        const unitType = form.querySelector(".join-unit-type");
        const shipFields = form.querySelector(".unit-ship-fields");
        const squadFields = form.querySelector(".unit-squad-fields");
        const owned = form.querySelector(".join-owned-ship-select");
        const search = form.querySelector(".join-ship-search");
        const shipId = form.querySelector(".join-ship-id-field");
        const results = form.querySelector(".join-ship-results");
        const errBox = form.querySelector(".join-unit-errors");
        let timer;
        const esc = (s) =>
          String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
        const sync = () => {
          if (!unitType || !shipFields || !squadFields) return;
          const isShip = unitType.value === "ship";
          shipFields.hidden = !isShip;
          squadFields.hidden = isShip;
        };
        if (unitType) {
          unitType.addEventListener("change", sync);
          sync();
        }
        if (owned && shipId) {
          owned.addEventListener("change", () => {
            if (owned.value) {
              shipId.value = "";
              if (search) search.value = "";
              if (results) results.innerHTML = "";
            }
          });
        }
        if (search && results && shipId) {
          search.addEventListener("input", () => {
            clearTimeout(timer);
            const q = search.value.trim();
            shipId.value = "";
            if (owned) owned.value = "";
            if (q.length < 2) {
              results.innerHTML = "";
              return;
            }
            timer = setTimeout(async () => {
              const res = await fetch("${bp}/api/ships?q=" + encodeURIComponent(q));
              const ships = await res.json();
              results.innerHTML = ships
                .map(
                  (s) =>
                    '<button type="button" class="ship-row" data-id="' +
                    esc(s.id) +
                    '" data-name="' +
                    esc(s.name) +
                    '"><strong>' +
                    esc(s.name) +
                    "</strong><span>" +
                    esc(s.manufacturer || "") +
                    " // " +
                    esc(s.size || "") +
                    "</span></button>",
                )
                .join("");
            }, 180);
          });
          results.addEventListener("click", (event) => {
            const el = event.target.closest(".ship-row");
            if (!el) return;
            results.querySelectorAll(".ship-row").forEach((r) => r.classList.remove("selected"));
            el.classList.add("selected");
            shipId.value = el.dataset.id || "";
            search.value = el.dataset.name || "";
            if (owned) owned.value = "";
          });
        }
        form.addEventListener("submit", (e) => {
          const missing = [];
          const isShip = !unitType || unitType.value === "ship";
          if (isShip) {
            if (!(owned && owned.value) && !(shipId && shipId.value))
              missing.push("a ship (hangar or catalog search)");
          } else {
            const sn = form.querySelector('[name="squadName"]');
            if (!sn || !sn.value.trim()) missing.push("a fireteam name");
          }
          if (missing.length) {
            e.preventDefault();
            if (errBox) {
              errBox.textContent = "Please provide: " + missing.join(", ") + ".";
              errBox.hidden = false;
            }
          } else if (errBox) {
            errBox.hidden = true;
          }
        });
      });
    </script>`;

  return layout({
    title: `Join: ${op.title}`,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Ship browser ─────────────────────────────────────────────────────

export function shipsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  ships: Ship[];
  query: string;
}): SafeHtml {
  const bp = opts.basePath;

  const rows = opts.ships.map(
    (s) =>
      html` <tr>
        <td class="text-mono" style="color:var(--cyan)">${s.name}</td>
        <td class="text-dim">${s.manufacturer}</td>
        <td>${shipSizeLabel(s)}</td>
        <td>${s.career}</td>
        <td>${s.role}</td>
        <td class="text-mono text-right">${s.minCrew}–${s.maxCrew}</td>
        <td class="text-mono text-right">${s.weaponCrew}</td>
        <td class="text-mono text-right">${s.operationCrew}</td>
      </tr>`,
  );

  const body = html` <div class="page-header">
      <h1 class="page-title">SHIP DATABASE</h1>
      <p class="page-subtitle">Sourced from star-citizen.wiki</p>
    </div>
    <form method="get" action="${bp}/ships" class="flex gap-1 mb-2">
      <input
        type="search"
        name="q"
        value="${opts.query}"
        placeholder="Search ship name…"
        style="max-width:24rem"
      />
      <button type="submit" class="btn btn-sm">Search</button>
      ${opts.query ? html`<a href="${bp}/ships" class="btn btn-sm btn-ghost">Clear</a>` : ""}
    </form>
    ${opts.ships.length
      ? html` <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Manufacturer</th>
                <th>Size</th>
                <th>Career</th>
                <th>Role</th>
                <th class="text-right">Crew</th>
                <th class="text-right">Gunners</th>
                <th class="text-right">Engineers</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>`
      : html`<p class="text-dim text-sm">
          ${opts.query ? "No ships found." : "Search for a ship above."}
        </p>`}`;

  return layout({
    title: "Ship Database",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Admin panel ──────────────────────────────────────────────────────

export function feedbackPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html` <div class="page-header">
      <h1 class="page-title">FEEDBACK</h1>
      <p class="page-subtitle">Send a bug report, idea, or issue to the fleetplanner team.</p>
    </div>
    <div class="section">
      <form method="post" action="${bp}/feedback" style="max-width:48rem">
        <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
        <div class="form-group">
          <label>Subject</label>
          <input type="text" name="subject" maxlength="120" required />
        </div>
        <div class="form-group">
          <label>Message</label>
          <textarea
            name="message"
            maxlength="1800"
            required
            placeholder="What happened? What should happen instead?"
          ></textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn">Send Feedback</button>
        </div>
      </form>
    </div>`;

  return layout({
    title: "Feedback",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

type UserRow = Pick<User, "id" | "username" | "role" | "active" | "joinedAt" | "lastSeenAt"> & {
  identities?: Array<{ provider: string; providerId: string; username: string | null }>;
  guildMemberships?: Array<{ guildId: string; role: string; guild: { name: string } }>;
};

export type ShipSyncView = {
  enabled: boolean;
  intervalDays: number;
  lastRunAt: Date | null;
  lastResult: string | null;
  running: boolean;
  shipCount: number;
};

export type LocationSyncView = {
  enabled: boolean;
  intervalDays: number;
  lastRunAt: Date | null;
  lastResult: string | null;
  running: boolean;
  locationCount: number;
};

export function adminPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  users: UserRow[];
  sync: ShipSyncView;
  locationSync: LocationSyncView;
  feedbackChannelId: string;
  guilds?: Array<{
    id: string;
    name: string;
    active: boolean;
    bannedAt: Date | null;
    ownerUserId: string | null;
    memberCount: number;
  }>;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const isSuperAdmin = opts.currentUser?.role === "superadmin";
  const isFleetOp =
    opts.currentUser?.role === "superadmin" || opts.currentUser?.role === "fleetoperator";
  const s = opts.sync;
  const ls = opts.locationSync;

  const syncPanel = html` <div class="section">
    <div class="section-title">Ship Catalog</div>
    <div class="ship-sync card" style="padding:1rem">
      <div
        class="ship-sync-stats"
        style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-bottom:.75rem"
      >
        <div>
          <span class="text-dim text-sm">Ships cached</span><br /><strong class="text-mono"
            >${String(s.shipCount)}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Auto-refresh</span><br /><strong
            >${s.enabled ? safe(`every ${s.intervalDays} day(s)`) : safe("disabled")}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Last run</span><br /><strong
            >${s.lastRunAt ? fmtDate(s.lastRunAt) : safe("never")}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Status</span><br /><strong
            >${s.running ? safe("⟳ running…") : safe("idle")}</strong
          >
        </div>
      </div>
      ${s.lastResult
        ? html`<p class="text-dim text-sm" style="margin:0 0 .75rem">${s.lastResult}</p>`
        : safe("")}
      ${isFleetOp
        ? html`
            <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end">
              <form method="post" action="${bp}/admin/ships/sync" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  class="btn btn-cyan"
                  ${s.running ? safe("disabled") : safe("")}
                >
                  ${s.running ? safe("Syncing…") : safe("Sync now")}
                </button>
              </form>
              <form
                method="post"
                action="${bp}/admin/ships/config"
                class="inline"
                style="display:flex;gap:.5rem;align-items:flex-end"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="text-sm text-dim"
                  >Interval (days)
                  <input
                    type="number"
                    name="intervalDays"
                    min="1"
                    max="90"
                    value="${String(s.intervalDays)}"
                    style="width:5rem"
                  />
                </label>
                <label class="text-sm text-dim" style="display:flex;align-items:center;gap:.35rem">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    ${s.enabled ? safe("checked") : safe("")}
                  />
                  auto-refresh
                </label>
                <button type="submit" class="btn btn-ghost btn-sm">Save</button>
              </form>
            </div>
            <p class="text-dim text-sm" style="margin:.5rem 0 0">
              A full sync pulls every ship from the Star&nbsp;Citizen wiki — it can take a couple of
              minutes.
            </p>
          `
        : safe("")}
    </div>
  </div>`;

  const feedbackPanel = html` <div class="section">
    <div class="section-title">Feedback</div>
    <div class="card" style="padding:1rem">
      <form
        method="post"
        action="${bp}/admin/feedback/config"
        class="inline"
        style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap"
      >
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim"
          >Discord Channel ID
          <input
            type="text"
            name="channelId"
            value="${opts.feedbackChannelId}"
            placeholder="123456789012345678"
            style="min-width:18rem"
          />
        </label>
        <button type="submit" class="btn btn-ghost btn-sm">Save</button>
      </form>
      <p class="text-dim text-sm" style="margin:.5rem 0 0">
        Feedback tickets are posted to this Discord channel by the configured bot.
      </p>
    </div>
  </div>`;

  const locationSyncPanel = html` <div class="section">
    <div class="section-title">Location Catalog</div>
    <div class="ship-sync card" style="padding:1rem">
      <div
        class="ship-sync-stats"
        style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-bottom:.75rem"
      >
        <div>
          <span class="text-dim text-sm">Locations cached</span><br /><strong class="text-mono"
            >${String(ls.locationCount)}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Auto-refresh</span><br /><strong
            >${ls.enabled ? safe(`every ${ls.intervalDays} day(s)`) : safe("disabled")}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Last run</span><br /><strong
            >${ls.lastRunAt ? fmtDate(ls.lastRunAt) : safe("never")}</strong
          >
        </div>
        <div>
          <span class="text-dim text-sm">Status</span><br /><strong
            >${ls.running ? safe("running...") : safe("idle")}</strong
          >
        </div>
      </div>
      ${ls.lastResult
        ? html`<p class="text-dim text-sm" style="margin:0 0 .75rem">${ls.lastResult}</p>`
        : safe("")}
      ${isFleetOp
        ? html`
            <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end">
              <form method="post" action="${bp}/admin/locations/sync" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button
                  type="submit"
                  class="btn btn-cyan"
                  ${ls.running ? safe("disabled") : safe("")}
                >
                  ${ls.running ? safe("Syncing...") : safe("Sync now")}
                </button>
              </form>
              <form
                method="post"
                action="${bp}/admin/locations/config"
                class="inline"
                style="display:flex;gap:.5rem;align-items:flex-end"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="text-sm text-dim"
                  >Interval (days)
                  <input
                    type="number"
                    name="intervalDays"
                    min="1"
                    max="90"
                    value="${String(ls.intervalDays)}"
                    style="width:5rem"
                  />
                </label>
                <label class="text-sm text-dim" style="display:flex;align-items:center;gap:.35rem">
                  <input
                    type="checkbox"
                    name="enabled"
                    value="1"
                    ${ls.enabled ? safe("checked") : safe("")}
                  />
                  auto-refresh
                </label>
                <button type="submit" class="btn btn-ghost btn-sm">Save</button>
              </form>
            </div>
            <p class="text-dim text-sm" style="margin:.5rem 0 0">
              A full sync pulls locations from the Star Citizen wiki location API.
            </p>
          `
        : safe("")}
    </div>
  </div>`;

  const rows = opts.users.map(
    (u) => {
      const discordIdentity = u.identities?.find((identity) => identity.provider === "discord");
      const linkedProviders =
        u.identities && u.identities.length > 0
          ? u.identities.map((identity) => identity.provider).join(", ")
          : "none";
      const guilds = u.guildMemberships ?? [];
      return html` <tr>
        <td class="text-mono" style="font-size:0.72rem;color:var(--dim)">${u.id}</td>
        <td>${u.username}</td>
        <td class="text-mono text-sm">
          ${discordIdentity
            ? html`${discordIdentity.providerId}
                ${discordIdentity.username
                  ? html`<br /><span class="text-dim">${discordIdentity.username}</span>`
                  : safe("")}`
            : html`<span class="tag tag-red">not linked</span>`}
        </td>
        <td class="text-sm">
          ${guilds.length
            ? guilds.map(
                (membership) =>
                  html`<div>
                    ${membership.guild.name}
                    <span class="tag tag-role">${membership.role}</span>
                    <span class="text-mono text-dim">${membership.guildId}</span>
                  </div>`,
              )
            : html`<span class="text-dim">none</span>`}
        </td>
        <td class="text-sm">${linkedProviders}</td>
        <td>
          ${isSuperAdmin
            ? html` <form method="post" action="${bp}/admin/users/${u.id}/role" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <select name="role" onchange="this.form.submit()" class="user-table">
                  ${["superadmin", "fleetoperator", "crew"].map(
                    (r) =>
                      html`<option value="${r}" ${u.role === r ? safe("selected") : ""}>
                        ${r}
                      </option>`,
                  )}
                </select>
              </form>`
            : html`<span class="tag tag-role">${u.role}</span>`}
        </td>
        <td>
          ${isSuperAdmin
            ? html` <form method="post" action="${bp}/admin/users/${u.id}/active" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm ${u.active ? "btn-ghost" : "btn-gold"}">
                  ${u.active ? "Active" : "Disabled"}
                </button>
              </form>`
            : html`<span class="${u.active ? "tag-green" : "tag-red"} tag"
                >${u.active ? "Active" : "Disabled"}</span
              >`}
        </td>
        <td class="text-dim text-sm">${fmtDate(u.lastSeenAt)}</td>
      </tr>`;
    },
  );

  const guildsPanel =
    isSuperAdmin && opts.guilds
      ? html`<div class="section">
          <div class="section-title">Discord Servers (${opts.guilds.length})</div>
          <div class="card" style="padding:0">
            <table>
              <thead>
                <tr><th>Server</th><th>ID</th><th>Members</th><th>Status</th><th></th></tr>
              </thead>
              <tbody>
                ${opts.guilds.map((srv) => {
                  const statusTagHtml = srv.bannedAt
                    ? html`<span class="tag tag-red">BANNED</span>`
                    : srv.active
                      ? html`<span class="tag tag-green">active</span>`
                      : html`<span class="tag tag-dim">inactive</span>`;
                  return html`<tr>
                    <td><strong>${srv.name}</strong></td>
                    <td class="text-mono text-sm text-dim">${srv.id}</td>
                    <td class="text-mono text-sm">${String(srv.memberCount)}</td>
                    <td>${statusTagHtml}</td>
                    <td class="text-right">
                      ${srv.bannedAt
                        ? html`<form method="post" action="${bp}/admin/guilds/${srv.id}/unban" class="inline">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <button type="submit" class="btn btn-ghost btn-sm">Unban</button>
                          </form>`
                        : html`<form method="post" action="${bp}/admin/guilds/${srv.id}/ban" class="inline"
                            onsubmit="return confirm('Ban ${srv.name}? It is forced inactive and cannot be re-added until unbanned.');">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            <button type="submit" class="btn btn-danger btn-sm">Ban</button>
                          </form>`}
                    </td>
                  </tr>`;
                })}
              </tbody>
            </table>
          </div>
        </div>`
      : safe("");

  const body = html` <div class="page-header">
      <h1 class="page-title">ADMIN PANEL</h1>
    </div>
    ${syncPanel} ${locationSyncPanel} ${isFleetOp ? feedbackPanel : ""} ${guildsPanel}
    <div class="section">
      <div class="section-title">Users (${opts.users.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead>
            <tr>
              <th>Internal ID</th>
              <th>Username</th>
              <th>Discord</th>
              <th>Guilds</th>
              <th>Providers</th>
              <th>Role</th>
              <th>Status</th>
              <th>Last Seen</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    </div>`;

  return layout({
    title: "Admin",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Bridge admin (voice-bridge config absorbed from bridge /admin) ───

type BridgeGuildRow = {
  guildId: string;
  name: string;
  enabled: boolean | null; // null = bridge unreachable / status unknown
  error?: string;
};

export function bridgeAdminOverviewPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guilds: BridgeGuildRow[];
  /** Raumdock-wide global gates. Only passed for the protected/initial
   *  superadmin; absent → the settings card is hidden. */
  globalSettings?: {
    raumdockGuildId: string | null;
    bridgeRequiredRoleId: string | null;
    relayRequiredRoleId: string | null;
    updatedAt: string | null;
  } | null;
}): SafeHtml {
  const bp = opts.basePath;
  const gs = opts.globalSettings;

  const globalSettingsCard = gs
    ? html` <div class="section">
        <div class="section-title">Raumdock Global Gates</div>
        <p class="text-dim text-sm" style="margin-bottom:0.75rem">
          Server-weite Discord-Rollen-Gates (NICHT pro Tenant). Geprüft gegen die unten gesetzte
          Raumdock-Guild. Leer lassen = Gate aus.
        </p>
        <form method="post" action="${bp}/admin/bridge/global-settings" class="opv2-form">
          <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
          <label>Raumdock Guild ID</label>
          <input
            type="text"
            name="raumdockGuildId"
            value="${gs.raumdockGuildId ?? ""}"
            placeholder="z.B. 1500000000000000000"
            pattern="[0-9]{17,20}"
          />
          <label>Bridge-Rolle (Squad Link Zugang)</label>
          <input
            type="text"
            name="bridgeRequiredRoleId"
            value="${gs.bridgeRequiredRoleId ?? ""}"
            placeholder="Discord Role-ID"
            pattern="[0-9]{17,20}"
          />
          <label>Relay-Rolle (Voice-to-All Publisher)</label>
          <input
            type="text"
            name="relayRequiredRoleId"
            value="${gs.relayRequiredRoleId ?? ""}"
            placeholder="Discord Role-ID"
            pattern="[0-9]{17,20}"
          />
          <div style="margin-top:0.75rem">
            <button type="submit" class="btn btn-cyan">Speichern</button>
            ${gs.updatedAt
              ? html`<span class="text-dim text-sm" style="margin-left:0.75rem"
                  >Zuletzt geändert: ${gs.updatedAt}</span
                >`
              : safe("")}
          </div>
        </form>
      </div>`
    : safe("");

  const rows = opts.guilds.map((g) => {
    const status =
      g.enabled === null
        ? html`<span class="tag tag-red">UNREACHABLE</span>`
        : g.enabled
          ? html`<span class="tag tag-green">ENABLED</span>`
          : html`<span class="tag tag-dim">DISABLED</span>`;
    return html` <tr>
      <td class="text-mono" style="font-size:0.72rem;color:var(--dim)">${g.guildId}</td>
      <td>${g.name}</td>
      <td>
        ${status}${g.error ? html`<br /><span class="text-dim text-sm">${g.error}</span>` : ""}
      </td>
      <td class="text-right">
        <a class="btn btn-sm" href="${bp}/admin/bridge/${g.guildId}">Manage</a>
      </td>
    </tr>`;
  });

  const body = html` <div class="page-header">
      <h1 class="page-title">VOICE BRIDGE</h1>
      <p class="page-subtitle">
        Manage the voice-bridge guild config (enable, commander roles, allowed channels) and bridge
        admins — without opening the bridge admin UI.
      </p>
    </div>
    ${globalSettingsCard}
    <div class="section">
      <div class="section-title">Guilds (${opts.guilds.length})</div>
      ${opts.guilds.length === 0
        ? html`<p class="text-dim">
            No fleetplanner guilds yet. Install the bot on a Discord server first.
          </p>`
        : html`<div style="overflow-x:auto">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Guild ID</th>
                  <th>Name</th>
                  <th>Bridge status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return layout({
    title: "Voice Bridge",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

type BridgeAdminRow = {
  userId: string;
  role: string;
  protected: boolean;
  addedBy: string | null;
};

export function bridgeGuildConfigPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  config: {
    enabled: boolean;
    commanderRoleIds: string[];
    allowedVoiceChannelIds: string[];
    bridgeMode: string;
  };
  admins: BridgeAdminRow[];
  invites: Array<{
    id: string;
    label: string;
    role: string;
    expiresAt: string;
    usedAt: string | null;
    usedBy: string | null;
  }>;
  freshInvite?: { url: string; role: string };
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const cfg = opts.config;

  const configPanel = html` <div class="section">
    <div class="section-title">Guild Config</div>
    <div class="card" style="padding:1.5rem">
      <form method="post" action="${bp}/admin/bridge/${opts.guildId}/config">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="form-group">
          <label style="display:flex;align-items:center;gap:.5rem">
            <input
              type="checkbox"
              name="enabled"
              value="1"
              ${cfg.enabled ? safe("checked") : safe("")}
              style="width:auto"
            />
            Guild enabled (commanders may connect the companion)
          </label>
        </div>
        <div class="form-group">
          <label>Commander role IDs (one per line, or comma-separated)</label>
          <textarea name="commanderRoleIds" rows="3" placeholder="123456789012345678">
${cfg.commanderRoleIds.join("\n")}</textarea
          >
        </div>
        <div class="form-group">
          <label>Allowed voice channel IDs (one per line, or comma-separated)</label>
          <textarea name="allowedVoiceChannelIds" rows="3" placeholder="123456789012345678">
${cfg.allowedVoiceChannelIds.join("\n")}</textarea
          >
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-cyan">Save config</button>
        </div>
      </form>
      <p class="text-dim text-sm" style="margin:.75rem 0 0">
        Bridge mode: <span class="text-mono">${cfg.bridgeMode}</span>
      </p>
    </div>
  </div>`;

  const adminRows = opts.admins.map(
    (a) =>
      html` <tr>
        <td class="text-mono" style="font-size:0.72rem;color:var(--dim)">${a.userId}</td>
        <td>
          ${a.protected
            ? html`<span class="tag ${a.role === "admiral" ? "tag-gold" : "tag-dim"}"
                  >${a.role}</span
                >
                <span class="tag tag-cyan">protected</span>`
            : html`<form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/admins/${a.userId}/role"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <select name="role" onchange="this.form.submit()" style="width:auto">
                  <option value="vice_admiral" ${a.role === "vice_admiral" ? safe("selected") : ""}>
                    vice_admiral
                  </option>
                  <option value="admiral" ${a.role === "admiral" ? safe("selected") : ""}>
                    admiral
                  </option>
                </select>
              </form>`}
        </td>
        <td class="text-dim text-sm">${a.addedBy ?? safe("—")}</td>
        <td class="text-right">
          ${a.protected
            ? html`<span class="text-dim text-sm">locked</span>`
            : html`<form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/admins/${a.userId}/delete"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-danger">Remove</button>
              </form>`}
        </td>
      </tr>`,
  );

  const inviteRows = opts.invites.map(
    (inv) =>
      html` <tr>
        <td>${inv.label}</td>
        <td>
          <span class="tag ${inv.role === "admiral" ? "tag-gold" : "tag-dim"}">${inv.role}</span>
        </td>
        <td class="text-dim text-sm">${inv.expiresAt}</td>
        <td>
          ${inv.usedAt
            ? html`<span class="tag tag-dim">used</span>`
            : html`<span class="tag tag-green">unused</span>`}
        </td>
        <td class="text-right">
          ${inv.usedAt
            ? ""
            : html`<form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/invites/${inv.id}/revoke"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-danger">Revoke</button>
              </form>`}
        </td>
      </tr>`,
  );

  const invitePanel = html` <div class="section">
    <div class="section-title">Admin invite links (${opts.invites.length})</div>
    ${opts.freshInvite
      ? html` <div class="flash flash-ok">
          New ${opts.freshInvite.role} invite (shown once):
          <span class="text-mono">${opts.freshInvite.url}</span>
        </div>`
      : ""}
    ${opts.invites.length > 0
      ? html`<div style="overflow-x:auto">
          <table class="user-table">
            <thead>
              <tr>
                <th>Label</th>
                <th>Role</th>
                <th>Expires</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${inviteRows}
            </tbody>
          </table>
        </div>`
      : html`<p class="text-dim">No invite links.</p>`}
    <div class="card" style="padding:1.25rem;margin-top:1rem">
      <form
        method="post"
        action="${bp}/admin/bridge/${opts.guildId}/invites"
        style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap"
      >
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim" style="flex:1 1 14rem"
          >Label
          <input
            type="text"
            name="label"
            placeholder="New admiral onboarding"
            maxlength="120"
            required
          />
        </label>
        <label class="text-sm text-dim"
          >Role
          <select name="role" style="width:auto">
            <option value="vice_admiral">vice_admiral</option>
            <option value="admiral">admiral</option>
          </select>
        </label>
        <label class="text-sm text-dim"
          >TTL (days)
          <input type="number" name="ttlDays" min="1" max="90" value="7" style="width:5rem" />
        </label>
        <button type="submit" class="btn btn-cyan btn-sm">Mint invite</button>
      </form>
      <p class="text-dim text-sm" style="margin:.5rem 0 0">
        The invite link is consumed on the bridge (Discord OAuth). Single-use, time-limited.
      </p>
    </div>
  </div>`;

  const adminPanel = html` <div class="section">
    <div class="section-title">Bridge Admins (${opts.admins.length})</div>
    <div style="overflow-x:auto">
      <table class="user-table">
        <thead>
          <tr>
            <th>Discord ID</th>
            <th>Role</th>
            <th>Added by</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          ${adminRows}
        </tbody>
      </table>
    </div>
    <div class="card" style="padding:1.25rem;margin-top:1rem">
      <form
        method="post"
        action="${bp}/admin/bridge/${opts.guildId}/admins"
        style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap"
      >
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim" style="flex:1 1 16rem"
          >Discord user ID
          <input type="text" name="userId" placeholder="123456789012345678" required />
        </label>
        <label class="text-sm text-dim"
          >Role
          <select name="role" style="width:auto">
            <option value="vice_admiral">vice_admiral</option>
            <option value="admiral">admiral</option>
          </select>
        </label>
        <button type="submit" class="btn btn-ghost btn-sm">Add admin</button>
      </form>
    </div>
  </div>`;

  const body = html` <div class="page-header">
      <h1 class="page-title">${opts.guildName}</h1>
      <p class="page-subtitle text-mono">${opts.guildId}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge">← All guilds</a>
        &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/dashboard">Dashboard</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/sessions">Sessions</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/discord-voice">Discord Voice</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/relay-bots">Relay Bots</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/downloads">Downloads</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/monitoring">Monitoring</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/audit">Audit log</a>
      </p>
    </div>
    ${configPanel} ${adminPanel} ${invitePanel}`;

  return layout({
    title: "Bridge Guild",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeMonitoringPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  guildId: string;
  guildName: string;
  snapshot: {
    generatedAt: string;
    uptimeSeconds: number;
    activeRooms: number;
    activeCommanders: number;
    speakingCommanders: number;
    system: {
      cpuPercent: number | null;
      memory: { processRssBytes: number; systemUsedBytes: number; systemTotalBytes: number };
    };
    bandwidth: { source: string; bitrateIn: number | null; bitrateOut: number | null };
  } | null;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const s = opts.snapshot;
  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(0)} MB`;

  const body = html` <div class="page-header">
      <h1 class="page-title">MONITORING</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge/${opts.guildId}">← Back to guild</a>
      </p>
    </div>
    ${!s
      ? html`<div class="flash flash-error">
          Bridge unreachable${opts.error ? html`: ${opts.error}` : ""}
        </div>`
      : html` <div class="section">
          <div class="section-title">Live</div>
          <div class="card" style="padding:1.25rem">
            <div style="display:flex;flex-wrap:wrap;gap:1.5rem">
              <div>
                <span class="text-dim text-sm">Active rooms</span><br /><strong class="text-mono"
                  >${String(s.activeRooms)}</strong
                >
              </div>
              <div>
                <span class="text-dim text-sm">Commanders</span><br /><strong class="text-mono"
                  >${String(s.activeCommanders)}</strong
                >
              </div>
              <div>
                <span class="text-dim text-sm">Speaking</span><br /><strong class="text-mono"
                  >${String(s.speakingCommanders)}</strong
                >
              </div>
              <div>
                <span class="text-dim text-sm">Uptime</span><br /><strong class="text-mono"
                  >${String(Math.round(s.uptimeSeconds / 60))} min</strong
                >
              </div>
              <div>
                <span class="text-dim text-sm">CPU</span><br /><strong class="text-mono"
                  >${s.system.cpuPercent === null ? safe("—") : `${s.system.cpuPercent}%`}</strong
                >
              </div>
              <div>
                <span class="text-dim text-sm">Memory (sys)</span><br /><strong class="text-mono"
                  >${mb(s.system.memory.systemUsedBytes)} /
                  ${mb(s.system.memory.systemTotalBytes)}</strong
                >
              </div>
            </div>
            <p class="text-dim text-sm" style="margin:1rem 0 0">
              Bandwidth (${s.bandwidth.source}): in ${s.bandwidth.bitrateIn ?? safe("—")} / out
              ${s.bandwidth.bitrateOut ?? safe("—")} bps
            </p>
            <p class="text-dim text-sm" style="margin:.35rem 0 0">Snapshot ${s.generatedAt}</p>
          </div>
        </div>`}`;

  return layout({
    title: "Bridge Monitoring",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

export function bridgeAuditPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  guildId: string;
  guildName: string;
  entries: Array<{
    id: string;
    actorLabel: string | null;
    actorUserId: string | null;
    action: string;
    target: string | null;
    createdAt: string;
  }>;
  total: number;
  limit: number;
  offset: number;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;

  const rows = opts.entries.map(
    (e) =>
      html` <tr>
        <td class="text-dim text-sm">${e.createdAt}</td>
        <td>${e.actorLabel ?? e.actorUserId ?? safe("—")}</td>
        <td class="text-mono text-sm">${e.action}</td>
        <td class="text-dim text-sm">${e.target ?? safe("—")}</td>
      </tr>`,
  );

  const prevOffset = Math.max(0, opts.offset - opts.limit);
  const nextOffset = opts.offset + opts.limit;
  const hasPrev = opts.offset > 0;
  const hasNext = nextOffset < opts.total;

  const body = html` <div class="page-header">
      <h1 class="page-title">AUDIT LOG</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge/${opts.guildId}">← Back to guild</a>
      </p>
    </div>
    ${opts.error
      ? html`<div class="flash flash-error">Bridge unreachable: ${opts.error}</div>`
      : html` <div class="section">
          <div class="section-title">Entries (${String(opts.total)})</div>
          <div style="overflow-x:auto">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Actor</th>
                  <th>Action</th>
                  <th>Target</th>
                </tr>
              </thead>
              <tbody>
                ${rows}
              </tbody>
            </table>
          </div>
          <div style="display:flex;gap:.75rem;margin-top:1rem">
            ${hasPrev
              ? html`<a
                  class="btn btn-sm btn-ghost"
                  href="${bp}/admin/bridge/${opts.guildId}/audit?limit=${String(
                    opts.limit,
                  )}&offset=${String(prevOffset)}"
                  >← Newer</a
                >`
              : ""}
            ${hasNext
              ? html`<a
                  class="btn btn-sm btn-ghost"
                  href="${bp}/admin/bridge/${opts.guildId}/audit?limit=${String(
                    opts.limit,
                  )}&offset=${String(nextOffset)}"
                  >Older →</a
                >`
              : ""}
          </div>
        </div>`}`;

  return layout({
    title: "Bridge Audit",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

// ── Bridge Phase 2 panels: Dashboard / Sessions / Relay Bots / Discord Voice ──

function bridgeBackLink(bp: string, guildId: string, label: string): SafeHtml {
  return html`<p style="margin-top:.5rem">
    <a href="${bp}/admin/bridge/${guildId}">← ${label}</a>
  </p>`;
}

function healthDot(ok: boolean): SafeHtml {
  return html`<span class="tag ${ok ? "tag-green" : "tag-red"}">${ok ? "OK" : "DOWN"}</span>`;
}

export function bridgeDashboardPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  dashboard: {
    enabled: boolean;
    health: { bridgeOk: boolean; botOk: boolean; livekitOk: boolean };
    activeCommanders: Array<{ userId: string; displayName?: string; speaking: boolean }>;
    commanderRoleMembers: Array<{
      userId: string;
      displayName: string;
      inVoice: boolean;
      inAllowedChannel: boolean;
    }>;
  } | null;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const d = opts.dashboard;

  const body = html` <div class="page-header">
      <h1 class="page-title">DASHBOARD</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge/${opts.guildId}">← Back to guild</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/dashboard">↻ Refresh</a>
      </p>
    </div>
    ${!d
      ? html`<div class="flash flash-error">
          Bridge unreachable${opts.error ? html`: ${opts.error}` : ""}
        </div>`
      : html` <div class="section">
            <div class="section-title">Health</div>
            <div class="card" style="padding:1.25rem;display:flex;gap:2rem;flex-wrap:wrap">
              <div>
                <span class="text-dim text-sm">Guild</span><br />${d.enabled
                  ? html`<span class="tag tag-green">ENABLED</span>`
                  : html`<span class="tag tag-dim">DISABLED</span>`}
              </div>
              <div>
                <span class="text-dim text-sm">Bridge</span><br />${healthDot(d.health.bridgeOk)}
              </div>
              <div><span class="text-dim text-sm">Bot</span><br />${healthDot(d.health.botOk)}</div>
              <div>
                <span class="text-dim text-sm">LiveKit</span><br />${healthDot(d.health.livekitOk)}
              </div>
            </div>
          </div>
          <div class="section">
            <div class="section-title">
              Active commanders (${String(d.activeCommanders.length)})
            </div>
            ${d.activeCommanders.length === 0
              ? html`<p class="text-dim">None connected.</p>`
              : html`<div style="overflow-x:auto">
                  <table class="user-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Discord ID</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      ${d.activeCommanders.map(
                        (c) =>
                          html` <tr>
                            <td>${c.displayName ?? c.userId}</td>
                            <td class="text-mono text-sm text-dim">${c.userId}</td>
                            <td>
                              ${c.speaking
                                ? html`<span class="tag tag-cyan">SPEAKING</span>`
                                : html`<span class="tag tag-dim">idle</span>`}
                            </td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}
          </div>
          <div class="section">
            <div class="section-title">
              Commander roster (${String(d.commanderRoleMembers.length)})
            </div>
            ${d.commanderRoleMembers.length === 0
              ? html`<p class="text-dim">
                  No members with a configured commander role (or bot can't read members).
                </p>`
              : html`<div style="overflow-x:auto">
                  <table class="user-table">
                    <thead>
                      <tr>
                        <th>User</th>
                        <th>Discord ID</th>
                        <th>Voice</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${d.commanderRoleMembers.map(
                        (m) =>
                          html` <tr>
                            <td>${m.displayName}</td>
                            <td class="text-mono text-sm text-dim">${m.userId}</td>
                            <td>
                              ${m.inAllowedChannel
                                ? html`<span class="tag tag-green">in allowed ch</span>`
                                : m.inVoice
                                  ? html`<span class="tag tag-gold">in voice</span>`
                                  : html`<span class="tag tag-dim">offline</span>`}
                            </td>
                            <td class="text-right">
                              <form
                                method="post"
                                action="${bp}/admin/bridge/${opts.guildId}/commander-roles/${m.userId}/strip"
                                class="inline"
                                onsubmit="return confirm('Strip all commander roles from ${m.displayName}?')"
                              >
                                <input type="hidden" name="_csrf" value="${csrf}" />
                                <button type="submit" class="btn btn-sm btn-danger">
                                  Strip roles
                                </button>
                              </form>
                            </td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}
          </div>`}`;

  return layout({
    title: "Bridge Dashboard",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeSessionsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  sessions: Array<{
    id: string;
    label: string;
    status: string;
    createdAt: string;
    inviteCount?: number;
  }>;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";

  const body = html` <div class="page-header">
      <h1 class="page-title">SESSIONS</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      ${bridgeBackLink(bp, opts.guildId, "Back to guild")}
    </div>
    ${opts.error
      ? html`<div class="flash flash-error">Bridge unreachable: ${opts.error}</div>`
      : html` <div class="section">
            <div class="section-title">New session</div>
            <div class="card" style="padding:1.25rem">
              <form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/sessions"
                style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <label class="text-sm text-dim" style="flex:1 1 16rem"
                  >Label
                  <input
                    type="text"
                    name="label"
                    placeholder="Op Nightfall"
                    maxlength="80"
                    required
                  />
                </label>
                <button type="submit" class="btn btn-cyan">Create session</button>
              </form>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Active sessions (${String(opts.sessions.length)})</div>
            ${opts.sessions.length === 0
              ? html`<p class="text-dim">No active sessions.</p>`
              : html`<div style="overflow-x:auto">
                  <table class="user-table">
                    <thead>
                      <tr>
                        <th>Label</th>
                        <th>Created</th>
                        <th>Invites</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      ${opts.sessions.map(
                        (s) =>
                          html` <tr>
                            <td>
                              <a href="${bp}/admin/bridge/${opts.guildId}/sessions/${s.id}"
                                >${s.label}</a
                              >
                            </td>
                            <td class="text-dim text-sm">${s.createdAt}</td>
                            <td class="text-mono">${String(s.inviteCount ?? 0)}</td>
                            <td class="text-right">
                              <form
                                method="post"
                                action="${bp}/admin/bridge/${opts.guildId}/sessions/${s.id}/end"
                                class="inline"
                                onsubmit="return confirm('End session ${s.label}?')"
                              >
                                <input type="hidden" name="_csrf" value="${csrf}" />
                                <button type="submit" class="btn btn-sm btn-danger">End</button>
                              </form>
                            </td>
                          </tr>`,
                      )}
                    </tbody>
                  </table>
                </div>`}
          </div>`}`;

  return layout({
    title: "Bridge Sessions",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeSessionDetailPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  session: { id: string; label: string; status: string; createdAt: string; livekitRoom: string };
  invites: Array<{
    id: string;
    label: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedBy: string | null;
  }>;
  freshInvite?: { plaintext: string; label: string };
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const s = opts.session;

  const body = html` <div class="page-header">
      <h1 class="page-title">${s.label}</h1>
      <p class="page-subtitle text-mono">${s.status.toUpperCase()} · room ${s.livekitRoom}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge/${opts.guildId}/sessions">← All sessions</a>
      </p>
    </div>
    ${opts.freshInvite
      ? html` <div class="flash flash-ok">
          New invite "${opts.freshInvite.label}" — token (shown once):
          <span class="text-mono">${opts.freshInvite.plaintext}</span>
        </div>`
      : ""}
    <div class="section">
      <div class="section-title">Mint invite</div>
      <div class="card" style="padding:1.25rem">
        <form
          method="post"
          action="${bp}/admin/bridge/${opts.guildId}/sessions/${s.id}/invites"
          style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <label class="text-sm text-dim" style="flex:1 1 12rem"
            >Label
            <input type="text" name="label" placeholder="Commander A" maxlength="80" required />
          </label>
          <label class="text-sm text-dim"
            >TTL (hours)
            <input type="number" name="ttlHours" min="1" max="168" value="24" style="width:6rem" />
          </label>
          <button type="submit" class="btn btn-cyan">Mint</button>
        </form>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Invites (${String(opts.invites.length)})</div>
      ${opts.invites.length === 0
        ? html`<p class="text-dim">No invites yet.</p>`
        : html`<div style="overflow-x:auto">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${opts.invites.map(
                  (inv) =>
                    html` <tr>
                      <td>${inv.label}</td>
                      <td class="text-dim text-sm">${inv.expiresAt}</td>
                      <td>
                        ${inv.usedAt
                          ? html`<span class="tag tag-dim">used</span>`
                          : html`<span class="tag tag-green">unused</span>`}
                      </td>
                      <td class="text-right">
                        ${inv.usedAt
                          ? ""
                          : html`<form
                              method="post"
                              action="${bp}/admin/bridge/${opts.guildId}/sessions/${s.id}/invites/${inv.id}/revoke"
                              class="inline"
                            >
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              <button type="submit" class="btn btn-sm btn-danger">Revoke</button>
                            </form>`}
                      </td>
                    </tr>`,
                )}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return layout({
    title: "Bridge Session",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeRelayBotsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  config: {
    livekitUrl: string;
    livekitApiKey: string;
    livekitApiSecret: string;
    roomName: string;
    guildId: string;
    bots: Array<{ name: string; token: string; channelId: string }>;
  } | null;
  metrics?: unknown;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const c = opts.config;

  // Bots are edited as a JSON textarea (keeps the SSR form simple, no
  // client JS). Matches the relayConfigSchema the bridge validates.
  const botsJson = c ? JSON.stringify(c.bots, null, 2) : "[]";

  // Metrics shape varies with the relay-bots service version — render a
  // pretty-printed snapshot rather than guessing fields. {offline:true}
  // when the service is unreachable.
  const metricsOffline =
    !opts.metrics ||
    (typeof opts.metrics === "object" && (opts.metrics as { offline?: boolean }).offline === true);
  const metricsJson = opts.metrics ? JSON.stringify(opts.metrics, null, 2) : "";

  const body = html` <div class="page-header">
      <h1 class="page-title">RELAY BOTS</h1>
      <p class="page-subtitle text-mono">${opts.guildName} · singleton config</p>
      ${bridgeBackLink(bp, opts.guildId, "Back to guild")}
    </div>
    ${!c
      ? html`<div class="flash flash-error">
          Bridge unreachable${opts.error ? html`: ${opts.error}` : ""}
        </div>`
      : html` <div class="section">
            <div class="section-title">LiveKit + bots</div>
            <div class="card" style="padding:1.5rem">
              <form method="post" action="${bp}/admin/bridge/${opts.guildId}/relay-bots/config">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <div class="form-row">
                  <div class="form-group">
                    <label>LiveKit URL</label
                    ><input
                      type="text"
                      name="livekitUrl"
                      value="${c.livekitUrl}"
                      placeholder="wss://voice.raumdock.org"
                    />
                  </div>
                  <div class="form-group">
                    <label>Room name</label
                    ><input type="text" name="roomName" value="${c.roomName}" />
                  </div>
                </div>
                <div class="form-row">
                  <div class="form-group">
                    <label>LiveKit API key</label
                    ><input type="text" name="livekitApiKey" value="${c.livekitApiKey}" />
                  </div>
                  <div class="form-group">
                    <label>LiveKit API secret</label
                    ><input type="text" name="livekitApiSecret" value="${c.livekitApiSecret}" />
                  </div>
                </div>
                <div class="form-group">
                  <label>Relay guild ID</label
                  ><input
                    type="text"
                    name="guildId"
                    value="${c.guildId}"
                    placeholder="123456789012345678"
                  />
                </div>
                <div class="form-group">
                  <label>Bots (JSON array of {name, token, channelId})</label>
                  <textarea name="botsJson" rows="8" class="text-mono">${botsJson}</textarea>
                </div>
                <div class="form-actions">
                  <button type="submit" class="btn btn-cyan">Save + reload</button>
                </div>
              </form>
            </div>
          </div>
          <div class="section">
            <div class="section-title">Service</div>
            <div
              class="card"
              style="padding:1.25rem;display:flex;gap:1rem;align-items:center;flex-wrap:wrap"
            >
              <form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/relay-bots/restart"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-gold btn-sm">
                  Restart relay-bots service
                </button>
              </form>
              <a class="btn btn-ghost btn-sm" href="${bp}/admin/bridge/${opts.guildId}/relay-bots"
                >↻ Refresh metrics</a
              >
            </div>
          </div>
          <div class="section">
            <div class="section-title">Metrics</div>
            <div class="card" style="padding:1.25rem">
              ${metricsOffline
                ? html`<p class="text-dim">
                    Relay-bots service offline or no metrics. (Reload to retry.)
                  </p>`
                : html`<pre class="text-mono text-sm" style="overflow-x:auto;margin:0">
${metricsJson}</pre
                  >`}
            </div>
          </div>`}`;

  return layout({
    title: "Bridge Relay Bots",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeDiscordVoicePage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  channels: Array<{ id: string; name: string }>;
  roles: Array<{ id: string; name: string }>;
  members: Array<{ userId: string; displayName: string; channelId: string | null }>;
  /** Allowed (managed) voice channels in current Discord display order. */
  allowedChannels?: Array<{ id: string; name: string }>;
  offline?: boolean;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const channelName = new Map(opts.channels.map((c) => [c.id, c.name]));
  const allowedChannels = opts.allowedChannels ?? [];
  const orderCsv = allowedChannels.map((c) => c.id).join(",");

  const channelOptions = (selected: string | null): SafeHtml =>
    html` <option value="" ${selected === null ? safe("selected") : ""}>— disconnect —</option>
      ${opts.channels.map(
        (c) =>
          html`<option value="${c.id}" ${selected === c.id ? safe("selected") : ""}>
            ${c.name}
          </option>`,
      )}`;

  const memberRows = opts.members.map(
    (m) =>
      html` <tr>
        <td>${m.displayName}</td>
        <td class="text-dim text-sm">
          ${m.channelId ? (channelName.get(m.channelId) ?? m.channelId) : safe("—")}
        </td>
        <td>
          <form
            method="post"
            action="${bp}/admin/bridge/${opts.guildId}/discord-voice/move/${m.userId}"
            style="display:flex;gap:.5rem;align-items:center"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            <select name="channelId" style="width:auto">
              ${channelOptions(m.channelId)}
            </select>
            <button type="submit" class="btn btn-sm btn-ghost">Move</button>
          </form>
        </td>
        <td>
          <form
            method="post"
            action="${bp}/admin/bridge/${opts.guildId}/discord-voice/role/${m.userId}"
            style="display:flex;gap:.5rem;align-items:center"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            <select name="roleId" style="width:auto">
              ${opts.roles.map((r) => html`<option value="${r.id}">${r.name}</option>`)}
            </select>
            <button type="submit" name="action" value="add" class="btn btn-sm btn-green">
              Add
            </button>
            <button type="submit" name="action" value="remove" class="btn btn-sm btn-danger">
              Remove
            </button>
          </form>
        </td>
      </tr>`,
  );

  const body = html` <div class="page-header">
      <h1 class="page-title">DISCORD VOICE</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      <p style="margin-top:.5rem">
        <a href="${bp}/admin/bridge/${opts.guildId}">← Back to guild</a> &nbsp;·&nbsp;
        <a href="${bp}/admin/bridge/${opts.guildId}/discord-voice">↻ Refresh</a>
      </p>
    </div>
    ${opts.error
      ? html`<div class="flash flash-error">Bridge unreachable: ${opts.error}</div>`
      : ""}
    ${opts.offline
      ? html`<div class="flash flash-warn">
          Discord not configured on the bridge — live data unavailable.
        </div>`
      : ""}
    <div class="section">
      <div class="section-title">Members in voice (${String(opts.members.length)})</div>
      ${opts.members.length === 0
        ? html`<p class="text-dim">No members currently in tracked voice channels.</p>`
        : html`<div style="overflow-x:auto">
            <table class="user-table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Channel</th>
                  <th>Move</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                ${memberRows}
              </tbody>
            </table>
          </div>`}
      <p class="text-dim text-sm" style="margin-top:1rem">
        Server-rendered snapshot — reload the page to refresh.
      </p>
    </div>
    <div class="section">
      <div class="section-title">Channel order (${String(allowedChannels.length)})</div>
      ${allowedChannels.length < 2
        ? html`<p class="text-dim">
            Need at least two allowed voice channels to reorder. Configure them under
            <a href="${bp}/admin/bridge/${opts.guildId}/config">guild config</a>.
          </p>`
        : html`<table class="user-table">
            <tbody>
              ${allowedChannels.map(
                (c, idx) => html`<tr>
                  <td class="text-mono">${String(idx + 1)}</td>
                  <td>${c.name}</td>
                  <td style="display:flex;gap:.5rem">
                    <form method="post" action="${bp}/admin/bridge/${opts.guildId}/discord-voice/reorder">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="ordered" value="${orderCsv}" />
                      <input type="hidden" name="channelId" value="${c.id}" />
                      <button type="submit" name="dir" value="up" class="btn btn-sm btn-ghost" ${idx === 0 ? safe("disabled") : ""}>▲</button>
                      <button type="submit" name="dir" value="down" class="btn btn-sm btn-ghost" ${idx === allowedChannels.length - 1 ? safe("disabled") : ""}>▼</button>
                    </form>
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>`}
    </div>
    <div class="section">
      <div class="section-title">Strategy channel</div>
      <p class="text-dim text-sm">
        Create a temporary voice channel and pull the selected members in. It is auto-deleted after
        15 minutes idle. Only members currently in a voice channel can be pulled (Discord rejects
        moving users who aren't in voice).
      </p>
      ${opts.members.length === 0
        ? html`<p class="text-dim">No members in voice to pull.</p>`
        : html`<form
            method="post"
            action="${bp}/admin/bridge/${opts.guildId}/discord-voice/strategy"
            style="display:flex;flex-direction:column;gap:.75rem;max-width:32rem"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input
              type="text"
              name="name"
              placeholder="Strategy channel name"
              maxlength="100"
              required
              style="width:100%"
            />
            <div style="display:flex;flex-direction:column;gap:.25rem">
              ${opts.members.map(
                (m) => html`<label style="display:flex;gap:.5rem;align-items:center">
                  <input type="checkbox" name="userIds" value="${m.userId}" />
                  ${m.displayName}
                  <span class="text-dim text-sm">
                    ${m.channelId ? (channelName.get(m.channelId) ?? m.channelId) : safe("—")}
                  </span>
                </label>`,
              )}
            </div>
            <button type="submit" class="btn btn-sm btn-green" style="align-self:flex-start">
              Create &amp; pull in
            </button>
          </form>`}
    </div>`;

  return layout({
    title: "Bridge Discord Voice",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function bridgeDownloadsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guildId: string;
  guildName: string;
  configured: boolean;
  tokens: Array<{
    id: string;
    label: string;
    createdAt: string;
    expiresAt: string;
    usedAt: string | null;
    usedFrom: string | null;
  }>;
  release: {
    tagName: string;
    name: string | null;
    asset: { name: string; size: number } | null;
  } | null;
  freshUrl?: string;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";

  const tokenRows = opts.tokens.map(
    (t) =>
      html` <tr>
        <td>${t.label}</td>
        <td class="text-dim text-sm">${t.expiresAt}</td>
        <td>
          ${t.usedAt
            ? html`<span class="tag tag-dim">used</span>`
            : html`<span class="tag tag-green">unused</span>`}
        </td>
        <td class="text-right">
          ${t.usedAt
            ? ""
            : html`<form
                method="post"
                action="${bp}/admin/bridge/${opts.guildId}/downloads/${t.id}/revoke"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-danger">Revoke</button>
              </form>`}
        </td>
      </tr>`,
  );

  const body = html` <div class="page-header">
      <h1 class="page-title">COMPANION DOWNLOADS</h1>
      <p class="page-subtitle text-mono">${opts.guildName}</p>
      ${bridgeBackLink(bp, opts.guildId, "Back to guild")}
    </div>
    ${opts.error
      ? html`<div class="flash flash-error">Bridge unreachable: ${opts.error}</div>`
      : ""}
    ${opts.freshUrl
      ? html`<div class="flash flash-ok">
          New download link (shown once): <span class="text-mono">${opts.freshUrl}</span>
        </div>`
      : ""}
    ${!opts.configured
      ? html`<div class="flash flash-warn">
          GITHUB_REPO not set on the bridge — the companion EXE cannot be served. Download links
          won't work until it is configured.
        </div>`
      : ""}
    <div class="section">
      <div class="section-title">Latest release</div>
      <div class="card" style="padding:1.25rem">
        ${opts.release
          ? html`<div class="text-mono">
                ${opts.release.tagName}${opts.release.name ? ` — ${opts.release.name}` : ""}
              </div>
              <p class="text-dim text-sm" style="margin:.35rem 0 0">
                ${opts.release.asset
                  ? `Asset: ${opts.release.asset.name} (${Math.round(opts.release.asset.size / 1024 / 1024)} MB)`
                  : safe("No matching .exe asset found")}
              </p>`
          : html`<p class="text-dim">
              No release info (GITHUB_REPO unset or GitHub unreachable).
            </p>`}
      </div>
    </div>
    <div class="section">
      <div class="section-title">Create download link</div>
      <div class="card" style="padding:1.25rem">
        <form
          method="post"
          action="${bp}/admin/bridge/${opts.guildId}/downloads"
          style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <label class="text-sm text-dim" style="flex:1 1 14rem"
            >Label
            <input type="text" name="label" placeholder="for Alice" maxlength="120" required />
          </label>
          <button type="submit" class="btn btn-cyan btn-sm">Mint link</button>
        </form>
        <form
          method="post"
          action="${bp}/admin/bridge/${opts.guildId}/downloads/dm"
          style="display:flex;gap:.75rem;align-items:flex-end;flex-wrap:wrap;margin-top:1rem"
        >
          <input type="hidden" name="_csrf" value="${csrf}" />
          <label class="text-sm text-dim" style="flex:1 1 14rem"
            >DM to Discord user ID
            <input type="text" name="userId" placeholder="123456789012345678" required />
          </label>
          <button type="submit" class="btn btn-ghost btn-sm">Mint + DM link</button>
        </form>
        <p class="text-dim text-sm" style="margin:.5rem 0 0">
          Links are single-use, 7-day TTL. The raw URL is shown once on mint (re-mint if lost).
        </p>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Tokens (${String(opts.tokens.length)})</div>
      ${opts.tokens.length === 0
        ? html`<p class="text-dim">No download tokens.</p>`
        : html`<div style="overflow-x:auto">
            <table class="user-table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Expires</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${tokenRows}
              </tbody>
            </table>
          </div>`}
    </div>`;

  return layout({
    title: "Bridge Downloads",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Login / error pages ──────────────────────────────────────────────

export function loginPage(opts: {
  basePath: string;
  flash?: string;
  discord: boolean;
  github: boolean;
  google: boolean;
}): SafeHtml {
  const bp = opts.basePath;
  const buttons = [
    opts.discord &&
      html`<a
        href="${bp}/auth/discord/start"
        class="btn btn-login btn-discord"
        style="display:flex;align-items:center;gap:.6rem;justify-content:center"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"
          />
        </svg>
        Login with Discord
      </a>`,
    opts.github &&
      html`<a
        href="${bp}/auth/github/start"
        class="btn btn-login btn-github"
        style="display:flex;align-items:center;gap:.6rem;justify-content:center"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"
          />
        </svg>
        Login with GitHub
      </a>`,
    opts.google &&
      html`<a
        href="${bp}/auth/google/start"
        class="btn btn-login btn-google"
        style="display:flex;align-items:center;gap:.6rem;justify-content:center"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <path
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
            fill="#4285F4"
          />
          <path
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
            fill="#34A853"
          />
          <path
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
            fill="#FBBC05"
          />
          <path
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
            fill="#EA4335"
          />
        </svg>
        Login with Google
      </a>`,
  ].filter(Boolean);

  const body = html` <div style="max-width:22rem;margin:4rem auto;text-align:center">
    <h1 class="page-title" style="font-size:2rem;margin-bottom:1rem">RDOC FLEETPLANNER</h1>
    <p class="text-dim text-sm" style="margin-bottom:1.5rem">
      Star Citizen fleet operations — calendar, unit registration, seat assignment.
    </p>
    <div style="display:flex;flex-direction:column;gap:.65rem;margin-bottom:1.5rem">
      ${safe((buttons.filter(Boolean) as SafeHtml[]).map(rawHtml).join(""))}
    </div>
    <p class="text-dim text-sm">
      Public operations are visible without login.
      <a href="${bp}/">Browse operations →</a>
    </p>
  </div>`;

  return layout({
    title: "Login",
    basePath: bp,
    currentUser: null,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function accountPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  identities: Array<{
    provider: string;
    username: string | null;
    email: string | null;
    createdAt: Date;
  }>;
  discord: boolean;
}): SafeHtml {
  const bp = opts.basePath;
  const providerLabel: Record<string, string> = {
    discord: "Discord",
    github: "GitHub",
    google: "Google",
  };
  const hasDiscord = opts.identities.some((i) => i.provider === "discord");

  const rows = opts.identities.map(
    (i) =>
      html` <div
        class="identity-row"
        style="display:flex;align-items:center;gap:1rem;padding:.6rem 0;border-bottom:1px solid var(--bg3)"
      >
        <span class="tag" style="min-width:5rem;text-align:center"
          >${providerLabel[i.provider] ?? i.provider}</span
        >
        <span>${i.username ?? "—"}</span>
        ${i.email ? html`<span class="text-dim text-sm">${i.email}</span>` : safe("")}
        <span class="text-dim text-sm" style="margin-left:auto">since ${fmtDate(i.createdAt)}</span>
      </div>`,
  );

  const linkDiscordBtn =
    !hasDiscord && opts.discord
      ? html`<a href="${bp}/auth/discord/link/start" class="btn btn-cyan" style="margin-top:1rem"
          >Link Discord account</a
        >`
      : safe("");

  const body = html` <div class="page-header"><h1 class="page-title">MY ACCOUNT</h1></div>
    <div class="section">
      <div class="section-title">Linked accounts</div>
      <div class="card" style="padding:1rem">${rows} ${linkDiscordBtn}</div>
    </div>`;

  return layout({
    title: "My Account",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function errorPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  status: number;
  message: string;
}): SafeHtml {
  const body = html` <div style="max-width:32rem;margin:4rem auto;text-align:center">
    <div class="page-title" style="font-size:3rem;color:var(--red);margin-bottom:0.5rem">
      ${opts.status}
    </div>
    <p class="text-dim">${opts.message}</p>
    <a href="${opts.basePath}/" class="btn btn-sm mt-2" style="margin-top:1.5rem"
      >← Back to Operations</a
    >
  </div>`;

  return layout({
    title: `Error ${opts.status}`,
    basePath: opts.basePath,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

/** Shown when a logged-out guest opens a non-public op link (e.g. the accepted-
 *  captain Discord link). A plain 404 looked like a broken URL (user feedback),
 *  so explain that login is required instead — without revealing op details. */
export function loginRequiredPage(opts: {
  basePath: string;
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html` <div style="max-width:34rem;margin:4rem auto;text-align:center">
    <div class="page-title" style="font-size:1.6rem;color:var(--cyan);margin-bottom:0.75rem">
      Login required
    </div>
    <p class="text-dim" style="line-height:1.7">
      This operation link is private. Please log in — if you have access (you're a
      member of the hosting or a partner Discord, or it was shared with you), the
      operation will open after sign-in. This is not a broken link.
    </p>
    <a href="${bp}/login" class="btn" style="margin-top:1.5rem">Login</a>
  </div>`;
  return layout({
    title: "Login required",
    basePath: bp,
    currentUser: null,
    csrfToken: opts.csrfToken,
    body,
  });
}

// ── Public info pages ────────────────────────────────────────────────

export function howToPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  /** Free-text SuperAdmin contact. */
  superadminContact?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html` <div class="page-header">
      <h1 class="page-title">HOW TO USE RDOC FLEETPLANNER</h1>
    </div>

    <div class="section">
      <div class="section-title">What is this?</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          RDOC Fleetplanner organises Star Citizen fleet operations across multiple Discord servers.
          Admirals plan operations, captains register their ships, crew members claim seats — all
          coordinated through Discord and posted as Discord scheduled events.
        </p>
        <p style="margin-top:.5rem">
          During an operation, mission voice connects the team through the
          <strong>RDOC Squad Link</strong> companion app: a <span class="text-mono">Command Net</span>
          for mission leaders and a <span class="text-mono">Global Radio Net</span> that broadcasts
          into Discord voice channels. See <strong>Mission voice</strong> below.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Roles</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          Fleet-level roles and mission roles are separate. A fleet role grants platform or server
          permissions; it does <strong>not</strong> automatically grant mission voice access — that is
          assigned per operation.
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr>
              <th>Fleet role</th>
              <th>What they can do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-role">Superadmin</span></td>
              <td>Instance-wide admin: manage all Discord servers, ban/unban servers, trigger ship sync, configure the bridge.</td>
            </tr>
            <tr>
              <td><span class="tag tag-role">Fleetadmin</span></td>
              <td>
                A server's admin (the &ldquo;Admiral&rdquo;). Add the bot to a Discord server, create &amp;
                manage operations, accept/reject units, assign mission leaders, manage composition,
                post Discord scheduled events.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-role">Captain</span></td>
              <td>Register ships or FPS squads, manage own unit seats, and assign crew to their unit.</td>
            </tr>
            <tr>
              <td><span class="tag tag-role">Crew</span></td>
              <td>Claim open seats and submit crew assignment requests. The default role for new members.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Mission voice</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          Mission voice runs over a separate LiveKit audio path (Discord audio is never touched) and
          is reached through the <strong>RDOC Squad Link</strong> companion app using two push-to-talk
          keys. It is granted per operation via the <strong>Commanders</strong> tab — a mission
          roster, not an admin roster. Fleet admins are not on the nets unless assigned a mission role.
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr><th>Net</th><th>Who &amp; what</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-cyan">Command Net</span></td>
              <td>Mission commander voice for mission leaders and commanders.</td>
            </tr>
            <tr>
              <td><span class="tag tag-gold">Global Radio Net</span></td>
              <td>
                RelayBot broadcast into assigned Discord voice channels. Intentionally narrower than
                Command Net — granted only to users who may broadcast.
              </td>
            </tr>
          </tbody>
        </table>
        <table class="user-table" style="width:100%;margin-top:1rem">
          <thead>
            <tr>
              <th>Mission role</th>
              <th>Command Net</th>
              <th>Global Radio Net</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>Event Leader</td><td>Yes</td><td>Yes</td></tr>
            <tr><td>Raidleader</td><td>Yes</td><td>Yes</td></tr>
            <tr><td>Wingcommander (deputy)</td><td>Yes</td><td>Yes</td></tr>
            <tr><td>Fleetcommander</td><td>No by default</td><td>No by default</td></tr>
            <tr><td>Ship Captain</td><td>Yes</td><td>No by default</td></tr>
            <tr><td>CQB Captain</td><td>Yes</td><td>No by default</td></tr>
            <tr><td>Added Commander</td><td>Yes</td><td>Optional</td></tr>
          </tbody>
        </table>
        <p class="text-dim text-sm" style="margin-top:.75rem;margin-bottom:0">
          Fleetcommander manages mission needs and confirms units but is not automatically on the
          Command Net. To request Global Radio (RelayBot) voice for your server, contact the
          SuperAdmin (see Contact &amp; support below).
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Getting started — for Admirals</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <ol style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li><strong>Login</strong> via Discord (or GitHub / Google if configured).</li>
          <li>
            Click <strong>Servers → + Add Fleetplanner bot to a Discord</strong> and authorise the
            bot on your server. You become that server's Admiral.
          </li>
          <li>
            Go to <strong>Servers → Settings</strong> to set an optional event voice channel and
            Discord-role mapping (auto-assigns Admiral permissions on login).
          </li>
          <li>
            Click <strong>+ New Operation</strong>, fill in title, date, meeting location, and op
            type. Save as draft.
          </li>
          <li>Add <strong>Fleet Requirements</strong> to define which ship types and teams you need.</li>
          <li>
            Set status to <strong>Open</strong> — a Discord scheduled event is posted automatically
            to your server.
          </li>
          <li>
            Accept incoming unit registrations. Accepted units get their seats opened
            for Crew.
          </li>
          <li>
            When done, set status to <strong>Completed</strong> or <strong>Cancelled</strong> (event
            is removed from Discord).
          </li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Getting started — for Crew</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <ol style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li>
            <strong>Login</strong> and make sure your Discord account is linked (required to see
            your server's operations).
          </li>
          <li>
            Open an operation and click <strong>Register a Unit</strong>. Pick your ship (search or
            use your hangar) or create an FPS squad.
          </li>
          <li>Wait for the Admiral to <strong>accept</strong> your unit.</li>
          <li>Once accepted, open seats become visible — crew members can claim them.</li>
          <li>
            Add ships to <strong>Profile → My Hangar</strong> for quick access when registering.
          </li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Multiple Discord servers</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          One Fleetplanner instance supports many Discord servers. Each server has its own
          operations and members. Switch between servers via <strong>Servers</strong> in the nav.
          You only see operations from servers you are a Discord member of.
        </p>
        <p style="margin-top:.5rem">
          Admiral permissions can be auto-assigned from a Discord role in the server settings.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Operation visibility</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Every operation has a visibility setting, independent of its status. Set it when creating
          the op, or change it any time from the op detail page (Admiral or an Event Leader of that
          op).
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr><th>Visibility</th><th>Who can see &amp; join</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-dim">🔒 Private</span></td>
              <td>Only members of this Discord server. Default for new ops.</td>
            </tr>
            <tr>
              <td><span class="tag tag-gold">🤝 Partners</span></td>
              <td>Your server + any linked partner servers (see Partnerships below).</td>
            </tr>
            <tr>
              <td><span class="tag tag-green">🌐 Public</span></td>
              <td>
                Any logged-in user, and a read-only preview even without login. Anyone authenticated
                can register a unit and claim seats.
              </td>
            </tr>
          </tbody>
        </table>
        <p style="margin-top:.5rem">
          Cross-server participants are always treated as <strong>Crew</strong> — they can join but
          never manage the op.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Server partnerships</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Link two Discord servers so both sides can see each other's
          <span class="tag tag-gold">🤝 Partners</span> operations. Partnerships are mutual and use a
          single-use token.
        </p>
        <ol style="margin:.5rem 0 0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.6rem">
          <li>
            Server A: <strong>Servers → Settings → Partnerships</strong>, enter a label and
            <strong>Create invite token</strong>. The link is shown once — copy it.
          </li>
          <li>Send the token/link to the Admiral of Server B (out of band).</li>
          <li>
            Server B: open <strong>Partnerships</strong>, paste the token under
            <strong>Accept an invite</strong>. Both servers are now partners.
          </li>
          <li>
            Either side can <strong>Revoke</strong> at any time — that is permanent; mint a fresh
            token to re-link.
          </li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Removing or banning a server</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          <strong>Remove a server</strong> (server owner or instance SuperAdmin): in
          <strong>Servers → Settings</strong>, the Danger zone hides the server from Fleetplanner
          (<em>active = off</em>). Operations, members and partnerships are kept — adding the bot
          again reactivates everything. Nothing is deleted.
        </p>
        <p style="margin-top:.5rem">
          <strong>Ban a server</strong> (SuperAdmin only): in <strong>Admin → Discord Servers</strong>,
          Ban forces a server inactive and blocks it from being (re)added until Unban. Use it to keep
          an abusive server out.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Ship catalog</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Ships are pulled from the
          <a href="https://api.star-citizen.wiki" target="_blank" rel="noopener"
            >Star Citizen Wiki API</a
          >
          and cached locally. The catalog refreshes weekly automatically. Admins can trigger a
          manual sync in the Admin panel.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Contact &amp; support</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p>
          Found a bug or have a feature request? Use the
          <a href="${bp}/feedback">Feedback</a> tab.
        </p>
        <p style="margin-top:.5rem">
          To reach the instance SuperAdmin directly (e.g. to request Voice Permission for your
          server):
          ${
            opts.superadminContact
              ? html`<strong class="text-mono">${opts.superadminContact}</strong>`
              : safe("ask in your community's Discord.")
          }
        </p>
      </div>
    </div>`;

  return layout({
    title: "How to",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

export function changelogPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const entries = CHANGELOG.map(
    (e) => html`<div class="card" style="padding:1rem 1.25rem;max-width:52rem;margin-bottom:1rem">
      <div class="card-header" style="margin-bottom:.75rem;padding-bottom:.6rem">
        <span class="card-title" style="flex:1">${e.title}</span>
        <span class="tag tag-cyan">${e.date}</span>
      </div>
      <ul style="margin:0;padding-left:1.25rem;display:flex;flex-direction:column;gap:.45rem">
        ${e.changes.map((c) => html`<li>${c}</li>`)}
      </ul>
    </div>`,
  );

  const body = html`<div class="page-header">
      <h1 class="page-title">CHANGELOG</h1>
      <div class="page-subtitle">What's new in RDOC Fleetplanner.</div>
    </div>
    <div class="section">${entries}</div>`;

  return layout({
    title: "Changelog",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

export function licensePage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html` <div class="page-header"><h1 class="page-title">LICENSE</h1></div>
    <div class="section">
      <div class="card" style="padding:1.25rem;max-width:48rem">
        <pre
          style="font-family:var(--font-mono);font-size:.82rem;white-space:pre-wrap;color:var(--text);margin:0"
        >
RDOC-Suite License and Notices

Code license:
PolyForm Noncommercial License 1.0.0
https://polyformproject.org/licenses/noncommercial/1.0.0

Required Notice: RDOC-Suite Copyright (c) 2026 xheadwigx and justcallmedeimos.
Required Notice: Authors: xheadwigx (https://github.com/cccdemon) and justcallmedeimos (https://twitch.tv/justcallmedeimos).
Required Notice: RDOC-Suite source: https://github.com/cccdemon/RDOC-Suite
Required Notice: RDOC-Suite is licensed for noncommercial use under the PolyForm Noncommercial License 1.0.0. Commercial use requires prior written permission from the authors.
Required Notice: The RDOC-Suite credit banner, stamp, logo, and visible attribution notices must not be removed, hidden, or materially altered in public deployments or redistributed versions without prior written permission from the authors.</pre
        >
        <p class="text-dim text-sm" style="margin-top:1rem">
          Source:
          <a href="https://github.com/cccdemon/RDOC-Suite" target="_blank" rel="noopener"
            >github.com/cccdemon/RDOC-Suite</a
          >
        </p>
      </div>
    </div>`;

  return layout({
    title: "License",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

export function whyUnsignedPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;

  const option = (n: string, title: string, body: SafeHtml) => html`
    <div class="card" style="padding:1.1rem;margin-bottom:.85rem">
      <h2 style="margin:0 0 .5rem;font-size:1rem;color:var(--cyan)">
        <span class="text-dim">${n}.</span> ${title}
      </h2>
      <div class="text-sm" style="color:var(--text);line-height:1.55">${body}</div>
    </div>
  `;

  const body = html`
    <div class="page-header"><h1 class="page-title">WHY OUR BINARY IS NOT SIGNED</h1></div>
    <div class="section" style="max-width:52rem">
      <p class="text-sm" style="color:var(--text);line-height:1.6;margin:0 0 1.25rem">
        When you install <strong>RDOC Squad Link</strong>, Windows SmartScreen may warn that the
        publisher is unknown. That is because the installer is not (yet) code-signed. Code signing
        for a small, non-commercial squad tool is surprisingly expensive and bureaucratic. Here is
        an honest rundown of every option we evaluated and where we currently stand.
      </p>

      ${option(
        "1",
        "Azure Trusted Signing — best value (~$10/month)",
        html`Microsoft's own cloud signing service. Gives <strong>instant SmartScreen
          reputation</strong> (no warmup), no hardware token. Integrates with
          <code>signtool</code> and ships a GitHub Action → straight into our
          <code>companion-build.yml</code>.<br />
          <span class="text-dim">Catch:</span> the organization must be verifiable (ideally 3+
          years old; otherwise extra validation), or an individual account. Currently the cheapest
          legitimate route.`,
      )}

      ${option(
        "2",
        "EV Code Signing Certificate (~$300–600/year)",
        html`Also <strong>instant reputation</strong>, no warmup. Requires a hardware token (USB
          HSM) or cloud HSM → makes CI signing more cumbersome. Providers: DigiCert, Sectigo,
          SSL.com.`,
      )}

      ${option(
        "3",
        "OV Certificate (~$100–250/year, e.g. Certum)",
        html`Cheaper, but reputation has to <strong>build up first</strong> (a number of
          downloads/installs) — SmartScreen still warns at the beginning. Since 2023 only with a
          token/cloud HSM as well (no more simple .pfx files). Certum has cheap open-source
          options.`,
      )}

      ${option(
        "4",
        "Microsoft Store / MSIX",
        html`Store apps bypass SmartScreen completely. But: MSIX packaging + store submission
          effort, store policies. For an internal/squad tool usually overkill.`,
      )}

      ${option(
        "5",
        "Don't sign at all — user bypass ($0)",
        html`SmartScreen dialog → <strong>"More info" → "Run anyway"</strong>. Works, but
          off-putting and resets with every new build hash. This is the route we currently
          document in the commander guide.`,
      )}

      ${option(
        "6",
        "For private individuals on Azure",
        html`Artifact Signing is currently available to <strong>organizations</strong> in the USA,
          Canada, European Union &amp; United Kingdom. Individual-developer validation is limited
          to the <strong>USA &amp; Canada</strong> — so a private individual in the EU cannot use
          the cheapest route as a person, only as a verifiable organization.`,
      )}

      <div class="card" style="padding:1.1rem;margin-top:.4rem;border-color:var(--gold-38)">
        <h2 style="margin:0 0 .5rem;font-size:1rem;color:var(--gold)">Where we stand</h2>
        <p class="text-sm" style="color:var(--text);line-height:1.55;margin:0">
          We are pursuing <strong>Azure Trusted Signing</strong> as a verified organization. Until
          that validation completes, the installer ships unsigned. To install safely in the
          meantime: on the SmartScreen prompt choose <strong>"More info" → "Run anyway"</strong>.
          The build is open source — you can verify it yourself at
          <a href="https://github.com/cccdemon/RDOC-Suite" target="_blank" rel="noopener"
            >github.com/cccdemon/RDOC-Suite</a
          >.
        </p>
      </div>
    </div>
  `;

  return layout({
    title: "Why Unsigned",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

// ── Multi-tenant: no-guild landing + guild settings ─────────────────

export function noGuildPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html` <div style="max-width:32rem;margin:4rem auto;text-align:center">
    <h1 class="page-title" style="font-size:1.6rem;margin-bottom:1rem">No Discord server yet</h1>
    <p class="text-dim" style="margin-bottom:1.5rem">
      Fleetplanner is organised per Discord server. To start planning, add the bot to a Discord you
      manage — or log in with a Discord account that is a member of a server where the bot is
      already installed.
    </p>
    <a href="${bp}/guilds/add" class="btn btn-cyan" style="font-size:1rem;padding:.75rem 2rem">
      + Add Fleetplanner bot to my Discord
    </a>
    <p class="text-dim text-sm" style="margin-top:1.5rem">
      Already a member somewhere? <a href="${bp}/account">Link your Discord account →</a>
    </p>
  </div>`;
  return layout({
    title: "Get started",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function guildsListPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guilds: Array<{ guildId: string; role: string; guildName: string }>;
  activeGuildId: string | null;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const roleLabel: Record<string, string> = {
    fleetoperator: "Admiral",
    crew: "Crew",
  };
  const isSuperAdmin = opts.currentUser?.role === "superadmin";

  const rows = opts.guilds.map((g) => {
    const isActive = g.guildId === opts.activeGuildId;
    const canManage = isSuperAdmin || g.role === "fleetoperator";
    return html` <div
      class="card"
      style="display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;margin-bottom:.5rem"
    >
      <strong style="flex:1"
        >${g.guildName}
        ${isActive ? safe('<span class="tag tag-green">active</span>') : safe("")}</strong
      >
      <span class="tag tag-role">${roleLabel[g.role] ?? g.role}</span>
      ${canManage
        ? isActive
          ? html`<a href="${bp}/guilds/settings" class="btn btn-ghost btn-sm">Settings</a>`
          : html` <form method="post" action="${bp}/guilds/switch" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="guildId" value="${g.guildId}" />
              <input type="hidden" name="next" value="/guilds/settings" />
              <button type="submit" class="btn btn-ghost btn-sm">Settings</button>
            </form>`
        : safe("")}
      ${isActive
        ? safe("")
        : html` <form method="post" action="${bp}/guilds/switch" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="guildId" value="${g.guildId}" />
            <button type="submit" class="btn btn-cyan btn-sm">Switch to this server</button>
          </form>`}
    </div>`;
  });

  const body = html` <div class="page-header"><h1 class="page-title">SERVERS</h1></div>
    <div class="section">
      ${opts.guilds.length
        ? html`<div>${rows}</div>`
        : html`<p class="text-dim">You're not a member of any server yet.</p>`}
      <a href="${bp}/guilds/add" class="btn btn-cyan" style="margin-top:1rem"
        >+ Add Fleetplanner bot to a Discord</a
      >
    </div>`;

  return layout({
    title: "Servers",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

export function guildSettingsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  guild: {
    id: string;
    name: string;
    orgName?: string | null;
    ownerUserId?: string | null;
    voiceChannelCategoryId: string | null;
    admiralRoleId: string | null;
    globalVoiceRoleId: string | null;
    commanderVoiceRoleId: string | null;
    discordInviteUrl: string | null;
    voiceEnabled: boolean;
    timezone: string;
  };
  voiceBots: Array<{
    id: string;
    label: string;
    botUserId: string;
    assignedChannelId: string | null;
    createdAt: Date;
    updatedAt: Date;
  }>;
  memberships: Array<{
    userId: string;
    role: string;
    user: {
      username: string;
      identities?: Array<{ providerId: string; username: string | null }>;
    };
    createdAt: Date;
  }>;
  activeGuildId: string;
  activeGuildName: string;
  /** Whether the viewer may remove this server (owner or superadmin). */
  canRemove?: boolean;
  /** Free-text SuperAdmin contact (shown when voice is disabled). */
  superadminContact?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const g = opts.guild;
  const relayBotInvitePermissions = "282574843809040";

  const memberRows = opts.memberships.map(
    (m) => {
      const discordIdentity = m.user.identities?.[0] ?? null;
      return html` <tr>
        <td>${m.user.username}</td>
        <td class="text-mono text-sm text-dim">${m.userId}</td>
        <td class="text-mono text-sm">
          ${discordIdentity
            ? html`${discordIdentity.providerId}
                ${discordIdentity.username
                  ? html`<br /><span class="text-dim">${discordIdentity.username}</span>`
                  : safe("")}`
            : html`<span class="tag tag-red">not linked</span>`}
        </td>
        <td>
          <form method="post" action="${bp}/guilds/members/${m.userId}/role" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <select name="role" onchange="this.form.submit()" class="user-table">
              ${["fleetoperator", "crew"].map(
                (r) =>
                  html`<option value="${r}" ${m.role === r ? safe("selected") : ""}>${r}</option>`,
              )}
            </select>
          </form>
        </td>
        <td class="text-dim text-sm">${fmtDate(m.createdAt)}</td>
      </tr>`;
    },
  );

  const voiceBotRows = opts.voiceBots.map(
    (bot) =>
      html` <tr>
          <td>${bot.label}</td>
          <td class="text-mono text-sm text-dim">${bot.botUserId}</td>
          <td>
            ${bot.assignedChannelId
              ? html`<span class="tag tag-gold">assigned</span>`
              : html`<span class="tag tag-green">available</span>`}
          </td>
          <td class="text-dim text-sm">${fmtDate(bot.updatedAt)}</td>
          <td>
            <a
              href="${discordBotInviteUrl(bot.botUserId, relayBotInvitePermissions)}"
              class="btn btn-sm btn-ghost"
              target="_blank"
              rel="noopener"
              >Invite</a
            >
            <button type="button" class="btn btn-sm btn-ghost" onclick="toggleBotEdit('${bot.id}')">
              Edit
            </button>
            <form method="post" action="${bp}/guilds/voice-bots/${bot.id}/delete" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="btn btn-sm btn-danger"
                onclick="return confirm('Remove this encrypted voice bot token?')"
              >
                Delete
              </button>
            </form>
          </td>
        </tr>
        <tr id="bot-edit-${bot.id}" style="display:none">
          <td colspan="5" style="padding:.75rem 0">
            <form
              method="post"
              action="${bp}/guilds/voice-bots/${bot.id}/edit"
              style="display:grid;grid-template-columns:1fr 1.8fr auto;gap:.5rem;align-items:flex-end"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label class="text-sm text-dim"
                >New label
                <input type="text" name="label" value="${bot.label}" placeholder="Funkrelais 1" />
              </label>
              <label class="text-sm text-dim"
                >New token <span style="opacity:.6">(leave empty to keep current)</span>
                <input type="text" name="botToken" placeholder="Bot token…" autocomplete="off" />
              </label>
              <button type="submit" class="btn btn-sm btn-cyan">Save</button>
            </form>
          </td>
        </tr>`,
  );

  const body = html`
    <div class="page-header">
      <h1 class="page-title">SERVER SETTINGS<span class="sep"> // </span><em>${g.name}</em></h1>
      <div class="page-actions">
        <a href="${bp}/guilds/partnerships" class="btn btn-gold btn-sm">Partnerships</a>
        <a href="${bp}/guilds/diagnostics" class="btn btn-cyan btn-sm">Run Install Tests</a>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Discord integration</div>
      <form method="post" action="${bp}/guilds/settings" class="card" style="padding:1rem;display:flex;flex-direction:column;gap:.75rem;max-width:30rem">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim">Operation voice category ID
          <input type="text" name="voiceChannelCategoryId" value="${g.voiceChannelCategoryId ?? ""}" placeholder="1507879660724162770" />
        </label>
        <label class="text-sm text-dim">Admiral role ID (Discord role → fleetoperator)
          <input type="text" name="admiralRoleId" value="${g.admiralRoleId ?? ""}" placeholder="optional" />
        </label>
        <label class="text-sm text-dim">Org name <span style="opacity:.65">(Star Citizen org shown in shared op embeds — defaults to the Discord server name if empty)</span>
          <input type="text" name="orgName" value="${g.orgName ?? ""}" maxlength="80" placeholder="e.g. RDOC" />
        </label>
        <label class="text-sm text-dim">Discord invite link <span style="opacity:.65">(permanent invite shown to guests who aren't in this Discord, e.g. https://discord.gg/raumdock)</span>
          <input type="text" name="discordInviteUrl" value="${g.discordInviteUrl ?? ""}" placeholder="https://discord.gg/yourserver" />
        </label>
        <label class="text-sm text-dim">Timezone <span style="opacity:.65">(used for scheduling dates — shown to all members)</span>
          <select name="timezone">
            ${TIMEZONE_OPTIONS.map(
              (opt) =>
                html`<option
                  value="${opt.value}"
                  ${g.timezone === opt.value ? safe("selected") : ""}
                >
                  ${opt.label}
                </option>`,
            )}
          </select>
        </label>
        <button type="submit" class="btn btn-cyan btn-sm" style="align-self:flex-start">Save</button>
      </form>
      <p class="text-dim text-sm" style="margin-top:.5rem">
        Scheduled events for this server's operations are posted to this Discord.
        Role IDs are optional — set them to auto-map Discord roles to fleet roles on login.
      </p>
    </div>

    ${
      opts.currentUser?.role === "superadmin"
        ? html` <div class="section">
            <div class="section-title">
              RDOC Voice Permission
              <span class="tag ${g.voiceEnabled ? safe("tag-green") : safe("tag-dim")}"
                >${g.voiceEnabled ? safe("GRANTED") : safe("NOT GRANTED")}</span
              >
            </div>
            <p class="text-dim text-sm">
              Controls whether this server can use the LiveKit voice server (Mission Voice Sessions,
              relay bots, voice channels).
            </p>
            <form
              method="post"
              action="${bp}/guilds/settings/voice-permission"
              style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="guildId" value="${g.id}" />
              ${g.voiceEnabled
                ? html`<input type="hidden" name="voiceEnabled" value="0" /><button
                      type="submit"
                      class="btn btn-sm btn-danger"
                    >
                      Revoke Voice Permission
                    </button>`
                : html`<input type="hidden" name="voiceEnabled" value="1" /><button
                      type="submit"
                      class="btn btn-sm btn-cyan"
                    >
                      Grant Voice Permission
                    </button>`}
            </form>
          </div>`
        : safe("")
    }

    ${
      g.voiceEnabled
        ? html` <div class="section">
            <div class="section-title">Mission Voice — Companion &amp; Relay</div>
            <p class="text-dim text-sm" style="margin-bottom:.75rem">
              Discord roles assigned automatically when a Mission Voice session opens and revoked when it closes.
              Leave empty to skip role assignment.
            </p>
            <form method="post" action="${bp}/guilds/settings" class="card" style="padding:1rem;display:flex;flex-direction:column;gap:.75rem;max-width:30rem">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label class="text-sm text-dim">Command Net role ID
                <span style="opacity:.65">(granted to mission Command Net users; enables Companion PTT into the commander room)</span>
                <input type="text" name="commanderVoiceRoleId" value="${g.commanderVoiceRoleId ?? ""}" placeholder="optional" />
              </label>
              <label class="text-sm text-dim">Global Radio Net role ID
                <span style="opacity:.65">(granted only to commanders with Global Radio Net enabled; gates Discord relay bot access)</span>
                <input type="text" name="globalVoiceRoleId" value="${g.globalVoiceRoleId ?? ""}" placeholder="optional" />
              </label>
              <button type="submit" class="btn btn-cyan btn-sm" style="align-self:flex-start">Save</button>
            </form>
          </div>
          <div class="section">
            <div class="section-title">Voice relay bots (${opts.voiceBots.length}/6)</div>
            <form method="post" action="${bp}/guilds/voice-bots" class="card" style="padding:1rem;display:grid;grid-template-columns:1fr 1.2fr 1.8fr auto;gap:.75rem;align-items:flex-end">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label class="text-sm text-dim">Label
                <input type="text" name="label" maxlength="60" placeholder="Funkrelais 1" required />
              </label>
              <label class="text-sm text-dim">Bot user ID
                <input type="text" name="botUserId" placeholder="1509191397264064689" required />
              </label>
              <label class="text-sm text-dim">Bot token
                <input type="password" name="botToken" autocomplete="new-password" placeholder="Stored encrypted with per-token salt" required />
              </label>
              <button type="submit" class="btn btn-cyan btn-sm">Save Bot</button>
            </form>
            <p class="text-dim text-sm" style="margin-top:.5rem">
              Tokens are encrypted before storage and never rendered back to the browser. Use six entries for the six Funkrelais bots.
            </p>
            <div style="overflow-x:auto;margin-top:1rem">
              <table class="user-table">
                <thead><tr><th>Label</th><th>Bot ID</th><th>Status</th><th>Updated</th><th>Actions</th></tr></thead>
                <tbody>${
                  voiceBotRows.length
                    ? voiceBotRows
                    : html`<tr>
                        <td colspan="5" class="text-dim">No relay bots configured.</td>
                      </tr>`
                }</tbody>
              </table>
            </div>
          </div>`
        : html` <div class="section">
            <div class="section-title">
              Voice relay bots <span class="tag tag-dim">RDOC Voice Permission required</span>
            </div>
            <div class="card">
              <p class="text-dim text-sm">
                Voice features (relay bots, the RTC voice bridge and Mission Voice Sessions) are
                <strong>disabled</strong> for this server. A SuperAdmin must grant
                <strong>RDOC Voice Permission</strong> before the voice bot configuration becomes
                available.
              </p>
              ${
                opts.superadminContact
                  ? html`<p class="text-sm" style="margin-top:.5rem">
                      Request access from the SuperAdmin:
                      <strong class="text-mono">${opts.superadminContact}</strong>
                    </p>`
                  : html`<p class="text-sm" style="margin-top:.5rem">
                      Contact the instance SuperAdmin to request access.
                    </p>`
              }
            </div>
          </div>`
    }

    <div class="section">
      <div class="section-title">Members (${opts.memberships.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead>
            <tr>
              <th>User</th>
              <th>Internal ID</th>
              <th>Discord</th>
              <th>Role (this server)</th>
              <th>Joined</th>
            </tr>
          </thead>
          <tbody>${memberRows}</tbody>
        </table>
      </div>
    </div>
    <script>
    function toggleBotEdit(id) {
      var row = document.getElementById('bot-edit-' + id);
      if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
    }
    </script>
    ${opts.canRemove
      ? html`<div class="section">
          <div class="section-title">Danger zone</div>
          <div class="card" style="border-color:rgba(255,68,68,0.38)">
            <div class="card-title" style="color:var(--red)">Remove this server from Fleetplanner</div>
            <p class="text-dim text-sm mt-1">
              The server is hidden from Fleetplanner and stops appearing in all lists. Operations,
              members and partnerships are kept in the database — adding the bot again reactivates
              everything. Nothing is deleted.
            </p>
            <form method="post" action="${bp}/guilds/remove" class="mt-2"
              onsubmit="return confirm('Remove ${g.name} from Fleetplanner? It disappears from all lists until the bot is added again.');">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="guildId" value="${g.id}" />
              <button type="submit" class="btn btn-danger">Remove server</button>
            </form>
          </div>
        </div>`
      : safe("")}`;

  return layout({
    title: `Settings — ${g.name}`,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

function diagnosticBadge(check: BotDiagnostic): SafeHtml {
  if (check.severity === "ok") return html`<span class="tag tag-green">OK</span>`;
  if (check.severity === "warn") return html`<span class="tag tag-gold">ACTION</span>`;
  return html`<span class="tag tag-red">MISSING</span>`;
}

export function guildDiagnosticsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  diagnostics: DiscordInstallDiagnostics;
  activeGuildId: string;
  activeGuildName: string;
}): SafeHtml {
  const bp = opts.basePath;
  const d = opts.diagnostics;
  const rows = d.bots.map((check) => {
    const missing = check.missingPermissions.length
      ? html` <div class="text-sm text-dim" style="margin-top:.5rem">
          Missing:
          ${check.missingPermissions.map(
            (perm) => html`<span class="tag tag-red">${perm.key}</span>`,
          )}
        </div>`
      : html`<div class="text-sm text-dim" style="margin-top:.5rem">
          All required permissions are present.
        </div>`;
    const action = check.inviteUrl
      ? html`<a href="${check.inviteUrl}" class="btn btn-cyan btn-sm" target="_blank" rel="noopener"
          >${check.installed ? "Reinvite / Fix Permissions" : "Invite / Fix Permissions"}</a
        >`
      : html`<a href="${bp}/guilds/settings" class="btn btn-ghost btn-sm"
          >Configure in Server Settings</a
        >`;

    return html` <div class="card" style="padding:1rem;margin-bottom:.75rem">
      <div style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap">
        <div style="flex:1;min-width:16rem">
          <div style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
            <strong style="color:var(--cyan)">${check.name}</strong>
            ${diagnosticBadge(check)}
            ${check.installed
              ? html`<span class="tag tag-green">installed</span>`
              : html`<span class="tag tag-red">not installed</span>`}
          </div>
          <div class="text-sm text-dim" style="margin-top:.35rem">${check.note}</div>
          <div class="text-sm text-dim" style="margin-top:.35rem">
            App ID: <span class="text-mono">${check.appId ?? "not configured"}</span>
            ${check.username ? html` · User: <span class="text-mono">${check.username}</span>` : ""}
          </div>
          ${missing}
          <div class="text-sm text-dim" style="margin-top:.5rem">
            Required:
            ${check.requiredPermissions.map((perm) => html`<span class="tag">${perm.key}</span>`)}
          </div>
        </div>
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">${action}</div>
      </div>
    </div>`;
  });

  const body = html` <div class="page-header">
      <h1 class="page-title">INSTALL TESTS<span class="sep"> // </span><em>${d.guild.name}</em></h1>
      <div class="page-actions">
        <a href="${bp}/guilds/settings" class="btn btn-ghost btn-sm">Server Settings</a>
        <a href="${bp}/guilds/diagnostics" class="btn btn-cyan btn-sm">Retest</a>
      </div>
    </div>

    <div class="section">
      <div
        class="card"
        style="padding:1rem;display:flex;gap:.75rem;align-items:center;flex-wrap:wrap"
      >
        <span class="tag tag-green">${d.summary.ok} OK</span>
        <span class="tag tag-gold">${d.summary.warn} ACTION</span>
        <span class="tag tag-red">${d.summary.error} MISSING</span>
        <span class="text-sm text-dim">
          Selected Discord server: <span class="text-mono">${opts.activeGuildName}</span> (<span
            class="text-mono"
            >${opts.activeGuildId}</span
          >)
        </span>
      </div>
      ${!d.canInspectPermissions
        ? html` <div class="card" style="padding:1rem;margin-top:.75rem;border-color:var(--red)">
            <strong class="tag tag-red">Inspector limited</strong>
            <p class="text-dim text-sm" style="margin:.75rem 0 0">
              Fleetplanner could not read the server role list. Install/fix the RDOC-Fleetplanner
              bot first, then run this test again for exact permission results.
            </p>
          </div>`
        : safe("")}
    </div>

    <div class="section">
      <div class="section-title">Bots</div>
      ${rows}
    </div>

    <div class="section">
      <div class="section-title">Companion App</div>
      <div class="card" style="padding:1rem">
        <p class="text-dim text-sm" style="margin:0">
          The Companion App uses this Fleetplanner page as the source of truth for Discord setup.
          Open Fleetplanner Server Settings, select the Discord server, and run these install tests
          whenever voice permissions or bot invites are changed.
        </p>
      </div>
    </div>`;

  return layout({
    title: `Install Tests - ${d.guild.name}`,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Guild partnerships ──────────────────────────────────────────────
export type PartnershipView = {
  id: string;
  label: string;
  status: string;
  partnerGuildName: string | null;
  isInitiator: boolean;
  activatedAt: Date | null;
  createdAt: Date;
};

export function partnershipsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  activeGuildId: string;
  activeGuildName: string;
  partnerships: PartnershipView[];
  freshInviteUrl?: string;
  prefillToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const active = opts.partnerships.filter((p) => p.status === "active");
  const pending = opts.partnerships.filter((p) => p.status === "pending");

  const activeRows = active.length
    ? active.map(
        (p) => html`<tr>
          <td><strong>${p.partnerGuildName ?? "—"}</strong></td>
          <td><span class="text-dim text-sm">${p.label}</span></td>
          <td><span class="text-mono text-sm">${p.activatedAt ? fmtDate(p.activatedAt) : "—"}</span></td>
          <td class="text-right">
            <form method="post" action="${bp}/guilds/partnerships/${p.id}/revoke" class="inline"
              onsubmit="return confirm('Really end the partnership with ${p.partnerGuildName ?? "this Discord"}? This is permanent.');">
              <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
              <button type="submit" class="btn btn-danger btn-sm">Revoke</button>
            </form>
          </td>
        </tr>`,
      )
    : [html`<tr><td colspan="4"><span class="text-dim text-sm">No active partnerships.</span></td></tr>`];

  const pendingRows = pending.map(
    (p) => html`<tr>
      <td><strong>${p.label}</strong></td>
      <td>
        <span class="tag ${p.isInitiator ? "tag-gold" : "tag-dim"}">
          ${p.isInitiator ? "issued by us" : "incoming"}
        </span>
      </td>
      <td><span class="text-mono text-sm">${fmtDate(p.createdAt)}</span></td>
      <td class="text-right">
        ${p.isInitiator
          ? html`<form method="post" action="${bp}/guilds/partnerships/${p.id}/revoke" class="inline">
              <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
              <button type="submit" class="btn btn-ghost btn-sm">Withdraw</button>
            </form>`
          : safe("")}
      </td>
    </tr>`,
  );

  const fresh = opts.freshInviteUrl
    ? html`<div class="card" style="border-color:var(--gold-38);margin-bottom:1.25rem">
        <div class="card-title" style="color:var(--gold)">NEW PARTNER LINK — shown only once</div>
        <p class="text-dim text-sm mt-1">
          Send this link to the fleetoperator of the other Discord. It can be redeemed once.
        </p>
        <div class="text-mono" style="background:var(--bg3);border:1px solid var(--border);padding:.75rem;margin-top:.75rem;word-break:break-all;font-size:.8rem">
          ${opts.freshInviteUrl}
        </div>
      </div>`
    : safe("");

  const body = html`<div class="page-header">
      <h1 class="page-title">PARTNERSHIPS<span class="sep"> // </span><em>${opts.activeGuildName}</em></h1>
      <div class="page-subtitle">
        Link this Discord with others so both sides can see operations with
        <span class="tag tag-gold">🤝 PARTNERS</span> visibility. Public operations are visible to
        every logged-in user without a partnership.
      </div>
    </div>

    ${fresh}

    <div class="section">
      <div class="section-title">Active partners</div>
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>Discord</th><th>Label</th><th>Since</th><th></th></tr></thead>
          <tbody>${activeRows}</tbody>
        </table>
      </div>
    </div>

    ${pending.length
      ? html`<div class="section">
          <div class="section-title">Pending invites</div>
          <div class="card" style="padding:0">
            <table>
              <thead><tr><th>Label</th><th>Direction</th><th>Created</th><th></th></tr></thead>
              <tbody>${pendingRows}</tbody>
            </table>
          </div>
        </div>`
      : safe("")}

    <div class="section">
      <div class="section-title">Invite a partner</div>
      <div class="card">
        <form method="post" action="${bp}/guilds/partnerships/invite" class="opv2-form" style="max-width:32rem">
          <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
          <div class="form-group">
            <label for="label">Label (e.g. alliance name)</label>
            <input type="text" id="label" name="label" maxlength="80" required placeholder="Raumdock Alliance" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-gold">Create invite token</button>
          </div>
        </form>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Accept an invite</div>
      <div class="card">
        <form method="post" action="${bp}/guilds/partnerships/accept" class="opv2-form" style="max-width:32rem">
          <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
          <div class="form-group">
            <label for="token">Partner token</label>
            <input type="text" id="token" name="token" required value="${opts.prefillToken ?? ""}" placeholder="Paste the token from the other Discord" />
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-green">Accept</button>
          </div>
        </form>
      </div>
    </div>`;

  return layout({
    title: `Partnerships - ${opts.activeGuildName}`,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Legal Notice / Impressum (English — mirrors raumdock.org) ───────
export function impressumPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html`<div class="page-header">
      <h1 class="page-title">IMPRESSUM</h1>
      <div class="page-subtitle">Angaben gemäß § 5 DDG (Digitale-Dienste-Gesetz).</div>
    </div>

    <div class="section">
      <div class="card" style="padding:1.25rem;max-width:52rem">
        <div class="card-title">Verantwortlich für den Inhalt</div>
        <p style="margin-top:.5rem;line-height:1.8">
          JustCallMeDeimos - Torsten Ennenbach<br />
          c/o Online-Impressum.de #4910<br />
          Europaring 90<br />
          53757 Sankt Augustin<br />
          Deutschland<br />
          E-Mail: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>
        </p>
      </div>
      <div class="card" style="padding:1.25rem;max-width:52rem;margin-top:1rem">
        <div class="card-title">Hinweise</div>
        <p class="text-dim text-sm mt-1">
          Diese Seite enthält Links zu externen Webseiten Dritter, auf deren Inhalte wir keinen
          Einfluss haben und für die wir keine Haftung übernehmen. Raumdock ist eine private,
          nicht-kommerzielle Online-Gemeinschaft ohne Gewinnabsicht – wir sind Spieler, die
          zufällig dasselbe Spiel spielen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">English translation (non-binding)</div>
      <div class="card" style="padding:1.25rem;max-width:52rem">
        <div class="card-title">Responsible for the content</div>
        <p style="margin-top:.5rem;line-height:1.8">
          JustCallMeDeimos - Torsten Ennenbach<br />
          c/o Online-Impressum.de #4910<br />
          Europaring 90<br />
          53757 Sankt Augustin<br />
          Germany<br />
          Email: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>
        </p>
        <p class="text-dim text-sm" style="margin-top:.75rem">
          This site contains links to external third-party websites over whose content we have no
          influence and for which we accept no liability. Raumdock is a private, non-commercial
          online community with no profit motive – we are players who happen to play the same game.
          The German version above is the legally binding one.
        </p>
      </div>
    </div>`;
  return layout({
    title: "Impressum",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

// ── Privacy policy (English — mirrors raumdock.org + app data) ──────
export function datenschutzPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html`<div class="page-header">
      <h1 class="page-title">PRIVACY POLICY</h1>
    </div>
    <div class="section" style="max-width:52rem">
      <p class="text-dim">
        This describes exactly what data RDOC Fleetplanner stores and logs. We keep it to the minimum
        needed to run the service. There are no tracking or advertising scripts and no advertising
        cookies.
      </p>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Controller</div>
        <p class="mt-1">
          <strong>Raumdock – Star Citizen Orga</strong><br />
          Email: <a href="mailto:tower@raumdock.org">tower@raumdock.org</a><br />
          Full details in the <a href="${bp}/impressum">Legal Notice</a>.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Account &amp; login data we store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>An internal account ID, your instance role and an active flag, plus join and last-seen timestamps.</li>
          <li>
            For each linked login (Discord, and optionally GitHub or Google): the external account ID,
            display name, avatar URL, and an email address <em>if the provider returns one</em>. Our
            Discord login requests only <span class="text-mono">identify</span> and
            <span class="text-mono">guilds</span> — it does <strong>not</strong> request your Discord
            email. GitHub and Google logins do include your email.
          </li>
          <li>
            The list of Discord server IDs you share with the bot (from the
            <span class="text-mono">guilds</span> scope) and your role per server, so we can scope
            your access.
          </li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Content &amp; configuration we store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>Operations, fleet units / ships, seat assignments and crew requests you create or join.</li>
          <li>Ships you save to your hangar.</li>
          <li>
            For servers you administer: Discord guild, role and channel IDs, timezone and voice
            settings, and server partnerships.
          </li>
          <li>
            Relay voice-bot tokens you enter are stored <strong>encrypted</strong> (AES with a
            per-token salt) and are never shown back in the browser.
          </li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Sessions &amp; cookies</div>
        <p class="text-dim text-sm mt-1">
          A login session (with a CSRF token) and, for the companion app, a bearer token stored on
          <em>your own device</em>. These expire automatically and can be cleared by logging out.
          We use no third-party or advertising cookies.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">What we do NOT store</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>No passwords — login is OAuth only.</li>
          <li>
            No OAuth access tokens — they are used once during sign-in to read your profile and guild
            list, then discarded (never written to the database).
          </li>
          <li>No voice or audio data.</li>
        </ul>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Server logs</div>
        <p class="text-dim text-sm mt-1">
          The application and its hosting provider write operational access logs containing your IP
          address, timestamp, HTTP method and requested path, and the response status — used only for
          debugging and system security. Secrets and tokens are not logged. Logs are rotated and
          deleted according to the host's retention policy.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Third parties</div>
        <p class="text-dim text-sm mt-1">
          Login is handled via <strong>Discord</strong> (and optionally GitHub or Google). When you
          authenticate, your IP address is transmitted to that provider. The bot reads your Discord
          guild list and posts scheduled events to servers you administer. Legal basis: Art. 6(1)(b)
          GDPR (performance of the service you request) and Art. 6(1)(f) GDPR (legitimate interest in
          operating it).
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Retention &amp; deletion</div>
        <p class="text-dim text-sm mt-1">
          Account and content data is kept until you ask us to delete it or your server is removed.
          Sessions expire on their own. To request access, correction or deletion of your data, email
          <a href="mailto:tower@raumdock.org">tower@raumdock.org</a>.
        </p>
      </div>

      <div class="card" style="padding:1.25rem;margin-top:1rem">
        <div class="card-title">Your rights</div>
        <ul class="text-dim text-sm mt-1" style="padding-left:1.25rem;line-height:1.7">
          <li>Access, rectification, erasure / restriction</li>
          <li>Data portability and objection where legally permitted</li>
        </ul>
      </div>
    </div>`;
  return layout({
    title: "Privacy",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}
