import { html, safe, rawHtml, layout, renderMarkdown, type SafeHtml, type LayoutOptions } from "./render.js";
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
import { t, LOCALES, LOCALE_NAMES } from "../i18n/index.js";
import { CHANGELOG } from "../lib/changelog.js";
import { ROADMAP, type RoadmapStatus } from "../lib/roadmap.js";
import { matchesCategory, suggestSlot, isCqbCategory, shipClass } from "../services/composition.js";
import { SHIP_TYPES, shipTypeLabel, CQB_TEAM_DEFAULT, CQB_TEAM_MAX } from "../services/needs.js";
import { normShipName } from "../services/fleetyards.js";
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

// Inline "?" help bubble — plain-language ("for dummies") explanation of an
// operator control. CSS-only popover (see .help in render.ts).
function helpIcon(text: string): SafeHtml {
  return html`<span class="help" tabindex="0" role="note" aria-label="${text}"
    >?<span class="help-pop">${text}</span></span
  >`;
}

function categoryLabel(category: string): string {
  return REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])
    ? t(`cat.${category}`)
    : category;
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
  const label = map[status] ? t(`status.${status}`) : status.replace("_", " ");
  return html`<span class="tag ${cls}">${label.toUpperCase()}</span>`;
}

function opTypeText(opType: string): string {
  return (OP_TYPES as readonly string[]).includes(opType) ? t(`optype.${opType}`) : opType;
}

function opTypeTag(opType: string): SafeHtml {
  return html`<span class="tag">${opTypeText(opType).toUpperCase()}</span>`;
}

const VISIBILITY_META: Record<string, { cls: string; icon: string }> = {
  private: { cls: "tag-dim", icon: "🔒" },
  partners: { cls: "tag-gold", icon: "🤝" },
  public: { cls: "tag-green", icon: "🌐" },
};

function visibilityTag(visibility: string): SafeHtml {
  const key = VISIBILITY_META[visibility] ? visibility : "private";
  const m = VISIBILITY_META[key];
  return html`<span class="tag ${m.cls}">${m.icon} ${t(`vis.${key}`).toUpperCase()}</span>`;
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
    <select name="visibility" aria-label="${t("vis.aria")}">
      ${option("private", `🔒 ${t("vis.private.long")}`)}
      ${option("partners", `🤝 ${t("vis.partners.long")}`)}
      ${option("public", `🌐 ${t("vis.public.long")}`)}
    </select>
    <button type="submit" class="btn btn-sm">${t("vis.set")}</button>
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
  // Star system names are proper nouns — not translated, only cased.
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
      ${t("oppreview.loginToView")}
    </p>
    <a href="${bp}/login" class="btn">${t("nav.login")}</a>
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
  /** Per-op signup state for the viewer: "joined" (claimed seat) | "waitlist" (crew request). */
  signupState?: Map<string, "joined" | "waitlist">;
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
                const pct = total ? Math.round((accepted / total) * 100) : 0;
                const leaders = op.leaders.map((leader) => leader.user.username).join(", ");
                const sign = opts.signupState?.get(op.id);
                return html` <a
                  href="${bp}/ops/${op.id}"
                  class="op-card ${opTypeClass(op.opType)}"
                  data-op-status="${op.status}"
                  data-op-type="${op.opType}"
                  data-op-title="${op.title.toLowerCase()}"
                  data-op-signed="${sign ?? ""}"
                  style="color:inherit;text-decoration:none;"
                >
                  <div class="op-card-top">
                    <span class="op-card-time">${fmtTime(op)}</span>
                    ${sign === "joined"
                      ? html`<span class="op-sign joined">✓ ${t("home.joined")}</span>`
                      : sign === "waitlist"
                        ? html`<span class="op-sign wait">${t("home.waitlisted")}</span>`
                        : html`<span class="op-type-pill">${opTypeText(op.opType).toUpperCase()}</span>`}
                  </div>
                  <div class="op-card-title">${op.title}</div>
                  <div class="op-card-meta">
                    <span class="op-guild-badge ${guildClass(op.guild.id)}">${op.guild.name}</span>
                    ${statusTag(op.status)}
                  </div>
                  <div class="op-fill" title="${t("home.unitsAccepted", { accepted, total })}">
                    <div class="op-fill-bar" style="width:${pct}%"></div>
                  </div>
                  <div class="op-card-footer">
                    <span>${t("home.unitsCount", { accepted, total })}</span>
                    <span>${leaders || op.createdBy.username}</span>
                  </div>
                </a>`;
              })}
            </div>
          </section>`;
        })}
      </div>`
    : html`<p class="text-dim text-sm">
        ${t("home.noOps")} ${canCreate ? html`<a href="${bp}/ops/new">${t("home.createOne")}</a>` : ""}
      </p>`;

  // Quick new-op picker: inline guild selector when user has multiple servers
  const newOpControl = canCreate
    ? (() => {
        const guilds = opts.operatorGuilds!;
        if (guilds.length === 1) {
          return html`<a href="${bp}/ops/new" class="btn btn-sm">+ ${t("home.newOp")}</a>`;
        }
        return html` <form method="get" action="${bp}/ops/new" class="inline new-op-picker">
          <select
            name="_guild"
            class="guild-picker-select"
            onchange="this.form.submit()"
            title="${t("home.selectServerForOp")}"
          >
            <option value="">+ ${t("home.newOpOn")}</option>
            ${guilds.map((g) => html`<option value="${g.id}">${g.name}</option>`)}
          </select>
        </form>`;
      })()
    : safe("");

  const showMine = !!opts.signupState && opts.signupState.size > 0;
  const body = html` <style>
      .op-fill { height: 5px; background: rgba(255,255,255,.08); border-radius: 3px; overflow: hidden; margin: .5rem 0 .35rem; }
      .op-fill-bar { height: 100%; background: var(--cyan, #35d0e0); }
      .op-sign { font-size: .62rem; font-weight: 700; letter-spacing: .5px; padding: 2px 8px; border-radius: 4px; border: 1px solid currentColor; }
      .op-sign.joined { color: var(--green, #3ad07a); }
      .op-sign.wait { color: var(--gold, #e0b835); }
      .ov-filter { display: flex; gap: .6rem; flex-wrap: wrap; align-items: center; margin: 0 0 1rem; }
      .ov-filter input[type=search], .ov-filter select { padding: .4rem .6rem; }
      .ov-filter input[type=search] { flex: 1; min-width: 12rem; max-width: 24rem; }
      .ov-filter .ov-mine { display: flex; align-items: center; gap: .35rem; font-size: .85rem; color: var(--dim, #7a8a96); }
      .op-day-group[hidden] { display: none; }
    </style>
    <div class="page-header">
      <h1 class="page-title">${t("home.title")}</h1>
      <p class="page-subtitle">${t("home.subtitle")}</p>
    </div>
    <div class="flex gap-2 mb-1">
      ${newOpControl}
      ${opts.includePast
        ? html`<a href="${bp}/" class="btn btn-sm btn-ghost">${t("home.hidePast")}</a>`
        : html`<a href="${bp}/?past=1" class="btn btn-sm btn-ghost">${t("home.showPast")}</a>`}
    </div>
    <div class="ov-filter">
      <input type="search" id="ov-search" placeholder="${t("home.searchOps")}" autocomplete="off" />
      <select id="ov-status">
        <option value="">${t("home.anyStatus")}</option>
        ${["open", "locked", "starting", "in_progress", "draft", "completed", "cancelled"].map(
          (s) => html`<option value="${s}">${t(`status.${s}`)}</option>`,
        )}
      </select>
      <select id="ov-type">
        <option value="">${t("home.anyType")}</option>
        ${OP_TYPES.map((ot) => html`<option value="${ot}">${opTypeText(ot)}</option>`)}
      </select>
      ${showMine
        ? html`<label class="ov-mine"><input type="checkbox" id="ov-mine" /> ${t("home.mySignups")}</label>`
        : safe("")}
    </div>
    <div class="mt-2">${rows}</div>
    <script>
      (function () {
        const q = document.getElementById("ov-search");
        const st = document.getElementById("ov-status");
        const ty = document.getElementById("ov-type");
        const mine = document.getElementById("ov-mine");
        const cards = Array.from(document.querySelectorAll(".op-card"));
        const groups = Array.from(document.querySelectorAll(".op-day-group"));
        function apply() {
          const text = (q && q.value.trim().toLowerCase()) || "";
          const status = (st && st.value) || "";
          const type = (ty && ty.value) || "";
          const onlyMine = !!(mine && mine.checked);
          cards.forEach((c) => {
            const ok =
              (!text || (c.dataset.opTitle || "").includes(text)) &&
              (!status || c.dataset.opStatus === status) &&
              (!type || c.dataset.opType === type) &&
              (!onlyMine || !!c.dataset.opSigned);
            c.style.display = ok ? "" : "none";
          });
          groups.forEach((g) => {
            const any = g.querySelectorAll('.op-card:not([style*="display: none"])').length > 0;
            g.hidden = !any;
          });
        }
        [q, st, ty, mine].forEach((el) => {
          if (!el) return;
          el.addEventListener("input", apply);
          el.addEventListener("change", apply);
        });
      })();
    </script>`;

  return layout({
    title: t("home.tabTitle"),
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
    <span>${t("op.joinInviteBanner")}</span>
    <a class="btn btn-sm btn-gold" href="${url}" target="_blank" rel="noopener noreferrer"
      >${t("op.joinEventDiscord")}</a
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
    title="${t("op.multiPosTitle")}"
    style="margin-left:.35rem;font-size:.6rem"
    >⚑ ${t("op.multiPos")}</span
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
  const nm = (name?: string | null) => (redactNames ? t("common.member") : (name ?? "?"));
  // Display-only clip (does not change stored names) — keeps long handles tidy.
  const clip = (s?: string | null, n = 30) => {
    const t = s ?? "";
    return t.length > n ? `${t.slice(0, n - 1)}…` : t;
  };
  const activeUnits = op.units.filter((unit) => unit.status !== "rejected");
  // Vehicle carrier reassignment (Phase 4): ships a vehicle can ride in + any
  // vehicle that is currently not assigned to a ship (orphan).
  const carrierShipUnits = activeUnits.filter((u) => u.unitType === "ship");
  const orphanVehicles = activeUnits.filter((u) => u.unitType === "vehicle" && !u.carrierUnitId);
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
  const shipSeatStats = seatStats(shipUnits);
  // FPS strength now lives in CQB teams (CompositionGroup kind="squad") with
  // CqbSignup members — NOT legacy FleetUnit squads (which the new model never
  // creates, so the old seatStats was always 0/0).
  const cqbTeamGroups = op.groups.filter((g) => g.kind === "squad");
  const cqbTeamIds = new Set(cqbTeamGroups.map((g) => g.id));
  const fpsTotal = cqbTeamGroups.reduce(
    (a, g) => a + ((g as { targetSize?: number | null }).targetSize ?? 0),
    0,
  );
  const fpsFilled = (op.cqbSignups ?? []).filter(
    (s) => s.assignedGroupId && cqbTeamIds.has(s.assignedGroupId),
  ).length;
  const fpsSeatStats = { total: fpsTotal, filled: fpsFilled, open: Math.max(0, fpsTotal - fpsFilled) };
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


  const metric = (label: string, value: string | number, tone = "") =>
    html`<div class="opv2-metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>`;

  const unitName = (unit: UnitFull) =>
    unit.unitType === "ship" ? (unit.ship?.name ?? t("common.unknownShip")) : (unit.squadName ?? t("common.squad"));

  const unitTypeLabel = (unit: UnitFull) => (unit.unitType === "ship" ? "SHIP" : "FPS");

  const unitTypeDetail = (unit: UnitFull) =>
    unit.unitType === "ship" ? (unit.ship?.name ?? t("common.unknownShip")) : (unit.squadName ?? t("common.squad"));

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
        ${claimed ? nm(seat.user?.username) : t("common.open")}${claimed && !redactNames ? multiPosTag(seat.userId, multiPos) : ""}
      </div>
      <div class="opv2-seat-actions">
        ${!seat.active ? html`<span class="tag tag-dim">${t("common.disabled")}</span>` : safe("")}
        ${canClaim
          ? html`<form method="post" action="${bp}/api/seats/${seat.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <button type="submit" class="btn btn-sm btn-green">${t("common.claim")}</button>
            </form>`
          : safe("")}
        ${canAssign
          ? html`<details class="opv2-seat-assign">
              <summary class="btn btn-sm btn-ghost">${t("common.assign")}</summary>
              <form method="post" action="${bp}/api/seats/${seat.id}/assign">
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <select name="userId" required>
                  <option value="">${t("common.selectUser")}</option>
                  ${opts.assignableUsers.map(
                    (assignableUser) =>
                      html`<option value="${assignableUser.id}">
                        ${assignableUser.username} (${assignableUser.role})
                      </option>`,
                  )}
                </select>
                <button type="submit" class="btn btn-sm">${t("common.add")}</button>
              </form>
            </details>`
          : safe("")}
        ${canUnclaim
          ? html`<form method="post" action="${bp}/api/seats/${seat.id}/unclaim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <button type="submit" class="btn btn-sm btn-ghost">${t("common.release")}</button>
            </form>`
          : safe("")}
      </div>
    </div>`;
  };

  const seatSetup = (unit: UnitFull) => {
    const canConfigureSeats = !!(user && unit.captainId === user.id) || canManage;
    if (!canConfigureSeats) return safe("");

    return html`<details class="opv2-edit-block">
      <summary class="btn btn-sm btn-ghost">${t("op.seatSetup")}</summary>
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
              ? t("op.seatPlaceholderFps")
              : t("op.seatPlaceholderShip");
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
              ${t("common.active")}
            </label>
          </div>`;
        })}
        <button type="submit" class="btn btn-sm">${t("op.saveSeats")}</button>
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

  // FR-P1 step 6: compact seat/turret map — one chip per seat, coloured by
  // state (filled / open / disabled). Quick "who sits where, what's free" above
  // the detailed seat list. (Manager view = chips only; the big ship silhouette
  // lives in the JOIN wizard where players actually sign up.)
  const seatTurretMap = (unit: UnitFull): SafeHtml => {
    if (!unit.seats.length) return safe("");
    const chips = unit.seats.map((seat) => {
        const state = !seat.active ? "disabled" : seat.userId ? "filled" : "open";
        const color =
          state === "filled"
            ? "var(--green,#3ad07a)"
            : state === "open"
              ? "var(--gold,#e0b835)"
              : "var(--dim,#6b7280)";
        const who = seat.user
          ? ` · ${nm(seat.user.username)}`
          : state === "open"
            ? ` · ${t("common.open")}`
            : ` · ${t("common.off")}`;
        return html`<span
          title="${seat.label}${who}"
          style="display:inline-flex;align-items:center;gap:4px;font-size:10px;line-height:1;padding:3px 6px;border-radius:3px;border:1px solid ${color};color:${color};opacity:${state === "disabled" ? "0.5" : "1"}"
          ><span style="width:6px;height:6px;border-radius:50%;background:${color}"></span>${seat.label}</span
        >`;
    });
    return html`<div
      class="seat-map"
      style="display:flex;flex-wrap:wrap;gap:4px;margin:.1rem 0 .5rem"
    >
      ${chips}
    </div>`;
  };

  const unitRows = activeUnits.length
    ? activeUnits
        // Vehicles are shown nested or in the orphan list; any unit attached to a
        // carrier ship (carrierUnitId set) nests under it, so hide it top-level.
        .filter((u) => u.unitType !== "vehicle" && !u.carrierUnitId)
        .map((unit) => {
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
                  <button type="submit" class="btn btn-sm btn-green">${t("common.accept")}</button>
                </form>
                <form
                  method="post"
                  action="${bp}/api/ops/${op.id}/units/${unit.id}/reject"
                  class="inline"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <button type="submit" class="btn btn-sm btn-danger">${t("common.reject")}</button>
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
                  onclick="return confirm('${t("op.confirmDeleteUnit")}')"
                >
                  ${t("common.delete")}
                </button>
              </form>`
            : safe("")}
        `;
        const editUnit = canEditUnit
          ? html`<details class="opv2-edit-block">
              <summary class="btn btn-sm btn-ghost">${t("op.editUnit")}</summary>
              <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/edit"
                class="opv2-form mt-1"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <label>${t("op.fleetNeed")}</label>
                <select name="requirementId">
                  <option value="">${t("op.unslotted")}</option>
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
                <label>${t("op.unitType")}</label>
                <select name="unitType">
                  <option value="ship" ${unit.unitType === "ship" ? safe("selected") : ""}>
                    ${t("op.unitTypeShip")}
                  </option>
                  <option value="squad" ${unit.unitType === "squad" ? safe("selected") : ""}>
                    ${t("cat.fps")}
                  </option>
                </select>
                <label>${t("op.ownedShip")}</label>
                <select name="ownedShipId" class="opv2-owned-ship-select mandatory">
                  <option value="">${t("op.keepCurrentShip")}</option>
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
                <label>${t("op.shipSearch")}</label>
                <input
                  type="search"
                  class="opv2-ship-search mandatory"
                  placeholder="${t("op.searchShipCatalog")}"
                  autocomplete="off"
                />
                <div class="ship-results opv2-ship-results"></div>
                <div class="opv2-form-grid">
                  <div>
                    <label>${t("op.squadName")}</label>
                    <input
                      type="text"
                      name="squadName"
                      maxlength="80"
                      value="${unit.squadName ?? ""}"
                      placeholder="FPS Team"
                    />
                  </div>
                  <div>
                    <label>${t("op.squadSize")}</label>
                    <input
                      type="number"
                      name="squadSize"
                      min="2"
                      max="8"
                      value="${unit.squadSize ?? 4}"
                    />
                  </div>
                </div>
                <label>${t("op.captainNote")}</label>
                <input
                  type="text"
                  name="captainNote"
                  maxlength="240"
                  value="${unit.captainNote ?? ""}"
                  placeholder="${t("op.captainNotePlaceholder")}"
                />
                ${unit.status === "accepted"
                  ? html`<p class="text-dim text-sm">
                      ${t("op.saveMovesToPending")}
                    </p>`
                  : safe("")}
                <button type="submit" class="btn btn-sm">${t("op.saveUnit")}</button>
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
              ${unit.ship
                ? html`<span class="tag tag-dim" title="${t("op.derivedShipClass")}">${shipClass(unit.ship)}</span>`
                : safe("")}
              <span class="tag ${free > 0 ? "tag-green" : "tag-dim"}">${t("op.free", { n: free })}</span>
              <span class="text-mono">${t("op.seats", { filled: assigned, total: seats.length })}</span>
              ${statusTag(unit.status)}
            </div>
          </summary>
          <div class="opv2-unit-body">
            ${unitActions}
            ${seatTurretMap(unit)}
            <div class="opv2-seat-list">${unit.seats.map((seat) => seatRow(unit, seat))}</div>
            ${activeUnits
              .filter((v) => v.carrierUnitId === unit.id)
              .map(
                (v) => html`<div class="opv2-unit-vehicle">
                  <div class="opv2-unit-main">
                    <strong>${unitName(v)}</strong> <span class="tag tag-cyan">${v.unitType === "ship" ? t("op.ship") : t("op.vehicle")}</span>
                  </div>
                  <div class="opv2-seat-list">${v.seats.map((seat) => seatRow(v, seat))}</div>
                  ${canManage
                    ? html`<div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:center;margin-top:.35rem">
                      <form method="post" action="${bp}/api/ops/${op.id}/units/${v.id}/carrier" class="inline" data-async title="${t("op.moveDetachShip")}">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("fleet")}
                        <select name="carrierUnitId" onchange="this.form.requestSubmit()">
                          <option value="">${t("op.detach")}</option>
                          ${carrierShipUnits.map((s) => html`<option value="${s.id}" ${s.id === unit.id ? safe("selected") : ""}>${unitName(s)}</option>`)}
                        </select>
                      </form>
                      <form method="post" action="${bp}/api/ops/${op.id}/units/${v.id}/delete" class="inline">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("fleet")}
                        <button type="submit" class="btn btn-sm btn-ghost" onclick="return confirm('${t("op.confirmRemoveVehicle")}')">
                          ${t("op.removeVehicle")}
                        </button>
                      </form>
                    </div>`
                    : safe("")}
                </div>`,
              )}
            <div class="opv2-unit-actions" style="display:flex;gap:.5rem;flex-wrap:wrap;align-items:flex-start;margin-top:.5rem">
            ${canManage && unit.unitType === "ship"
              ? html`<details class="opv2-edit-block">
                  <summary class="btn btn-sm btn-ghost">${t("op.addGroundVehicle")}</summary>
                  <form method="post" action="${bp}/api/ops/${op.id}/units" class="opv2-form mt-1" novalidate>
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    ${returnFields("fleet")}
                    <input type="hidden" name="unitType" value="vehicle" />
                    <input type="hidden" name="carrierUnitId" value="${unit.id}" />
                    <label>${t("op.vehicleCatalog")}</label>
                    <input type="search" class="opv2-ship-search" placeholder="Cyclone, Nova, ATLS…" autocomplete="off" />
                    <input type="hidden" name="shipId" class="opv2-ship-id-field" />
                    <div class="ship-results opv2-ship-results"></div>
                    <button type="submit" class="btn btn-sm mt-1">${t("op.addVehicle")}</button>
                  </form>
                </details>`
              : safe("")}
            ${(() => {
              const attachable = activeUnits.filter(
                (v) => v.unitType !== "squad" && v.id !== unit.id && v.carrierUnitId !== unit.id,
              );
              return canManage && unit.unitType === "ship" && attachable.length
                ? html`<form method="post" class="inline" data-async title="Attach a ship/vehicle already in the mission">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    ${returnFields("fleet")}
                    <select
                      onchange="this.form.action='${bp}/api/ops/${op.id}/units/'+this.value+'/carrier'; this.form.requestSubmit()"
                    >
                      <option value="" disabled selected hidden>${t("op.attachExisting")}</option>
                      ${attachable.map(
                        (v) => html`<option value="${v.id}">${unitName(v)} (${v.unitType === "ship" ? t("op.ship").toLowerCase() : t("op.vehicle").toLowerCase()}${v.carrierUnitId ? `, ${t("op.moveHere")}` : ""})</option>`,
                      )}
                    </select>
                    <input type="hidden" name="carrierUnitId" value="${unit.id}" />
                  </form>`
                : safe("");
            })()}
            ${editUnit} ${seatSetup(unit)}
            </div>
          </div>
        </details>`;
      })
    : [html`<p class="text-dim text-sm">${t("op.noUnits")}</p>`];

  const needGroups = op.groups.filter((g) => g.requirements.length > 0);
  const compositionRows = needGroups.length
    ? needGroups.map(
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
                      ? html`<form
                          method="post"
                          action="${bp}/api/ops/${op.id}/requirements/${requirement.id}/delete"
                          class="inline"
                        >
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          ${returnFields("fleet")}
                          <button
                            type="submit"
                            class="btn btn-sm btn-ghost"
                            onclick="return confirm('${t("op.confirmDeleteNeed")}')"
                          >
                            ${t("common.delete")}
                          </button>
                        </form>`
                      : safe("")}
                  </div>`;
                })
              : html`<p class="text-dim text-sm">${t("op.noRequirements")}</p>`}
          </div>`,
      )
    : [html`<p class="text-dim text-sm">${t("op.noFleetNeeds")}</p>`];
  const statusControls = canManage
    ? html`<div class="opv2-actions opv2-status-controls">
        ${["draft", "open", "locked", "starting", "in_progress", "completed", "cancelled"].map((status) =>
          status === op.status
            ? html`<button
                type="button"
                class="btn btn-green opv2-status-current"
                disabled
                aria-current="true"
                title="${t("op.currentStatus")}"
              >
                ${t(`status.${status}`)}
              </button>`
            : html`<form method="post" action="${bp}/api/ops/${op.id}/status" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="status" value="${status}" />
                ${returnFields(activeTab)}
                <button type="submit" class="btn">${t(`status.${status}`)}</button>
              </form>`,
        )}
      </div>`
    : safe("");

  // Full participant roster: everyone with their position (multi-seat = multiple
  // rows). Operator-facing single-glance "who is where".
  type PRow = { id: string; name: string; where: string; tone: "good" | "warn" };
  const rawParticipants: PRow[] = [];
  for (const u of acceptedUnits) {
    const uname = u.squadName || u.ship?.name || "Unit";
    for (const s of u.seats) {
      if (s.active && s.userId) {
        rawParticipants.push({
          id: s.userId,
          name: nm((s as { user?: { username?: string } }).user?.username),
          where: `${uname} — ${s.label}`,
          tone: "good",
        });
      }
    }
  }
  for (const sg of op.cqbSignups ?? []) {
    if (sg.assignedGroupId) {
      const grp = op.groups.find((g) => g.id === sg.assignedGroupId);
      const label = grp?.kind === "fighter_squad" ? t("op.fighterWing") : t("op.cqbTeam");
      rawParticipants.push({ id: sg.userId, name: nm(sg.user.username), where: `${label} — ${grp?.name ?? "?"}`, tone: "good" });
    } else {
      rawParticipants.push({ id: sg.userId, name: nm(sg.user.username), where: t("op.cqbPoolAwaiting"), tone: "warn" });
    }
  }
  for (const r of op.crewRequests) {
    rawParticipants.push({ id: r.user.id, name: nm(r.user.username), where: t("op.requestedPlacement"), tone: "warn" });
  }
  for (const u of op.units.filter((x) => x.status === "pending")) {
    rawParticipants.push({
      id: u.captainId,
      name: nm(u.captain.username),
      where: `${u.ship?.name || u.squadName || t("op.ship")} — ${t("op.pendingReview")}`,
      tone: "warn",
    });
  }
  // One row per member; all their positions listed together.
  const participantMap = new Map<string, { name: string; positions: Array<{ where: string; tone: "good" | "warn" }> }>();
  for (const p of rawParticipants) {
    const e = participantMap.get(p.id) ?? { name: p.name, positions: [] };
    e.positions.push({ where: p.where, tone: p.tone });
    participantMap.set(p.id, e);
  }
  const participants = [...participantMap.values()].sort((a, b) => a.name.localeCompare(b.name));
  // For placing "let the operator place me" crew: CQB teams + open ship seats.
  const placeSquads = op.groups.filter((g) => g.kind === "squad");
  const placeOpenSeats = activeUnits.flatMap((u) =>
    u.seats
      .filter((s) => s.active && !s.userId)
      .map((s) => ({ id: s.id, label: `${u.squadName || u.ship?.name || t("op.unit")} — ${s.label}` })),
  );
  const crewPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.participants")} (${participants.length})${helpIcon(t("op.participantsHelp"))}</div>
      ${participants.length
        ? html`<table class="user-table" style="width:100%">
            <thead>
              <tr><th>${t("common.member")}</th><th>${t("op.positions")}</th></tr>
            </thead>
            <tbody>
              ${participants.map(
                (p) => html`<tr>
                  <td><strong>${p.name}</strong></td>
                  <td>
                    <div style="display:flex;flex-wrap:wrap;gap:.35rem">
                      ${p.positions.map(
                        (pos) => html`<span class="tag ${pos.tone === "good" ? "tag-green" : "tag-gold"}">${pos.where}</span>`,
                      )}
                    </div>
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>`
        : html`<p class="text-dim text-sm">${t("op.noParticipants")}</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.needAssignment")}${helpIcon(t("op.needAssignmentHelp"))}</div>
      ${op.crewRequests.length
        ? op.crewRequests.map(
            (request) =>
              html`<div class="opv2-row" style="flex-wrap:wrap;gap:.4rem">
                <div style="flex:1;min-width:9rem">
                  <strong>${nm(request.user.username)}</strong>
                  <span class="text-dim text-sm">${request.note || t("op.noNote")}</span>
                </div>
                ${isLeader
                  ? html`<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
                      ${placeSquads.length
                        ? html`<form method="post" action="${bp}/api/ops/${op.id}/cqb/place" class="inline" data-async title="Place into a CQB team">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            ${returnFields("crew")}
                            <input type="hidden" name="userId" value="${request.user.id}" />
                            <select name="groupId" onchange="this.form.requestSubmit()">
                              <option value="" disabled selected hidden>${t("op.placeInTeam")}</option>
                              ${placeSquads.map((sq) => html`<option value="${sq.id}">${sq.name}</option>`)}
                            </select>
                          </form>`
                        : safe("")}
                      ${placeOpenSeats.length
                        ? html`<form method="post" action="${bp}/api/ops/${op.id}/seats/assign" class="inline" data-async title="Place into a ship seat">
                            <input type="hidden" name="_csrf" value="${csrf}" />
                            ${returnFields("crew")}
                            <input type="hidden" name="userId" value="${request.user.id}" />
                            <select name="seatId" onchange="this.form.requestSubmit()">
                              <option value="" disabled selected hidden>${t("op.placeInSeat")}</option>
                              ${placeOpenSeats.map((s) => html`<option value="${s.id}">${s.label}</option>`)}
                            </select>
                          </form>`
                        : safe("")}
                      <form
                        method="post"
                        action="${bp}/api/ops/${op.id}/crew-requests/remove"
                        class="inline"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <input type="hidden" name="userId" value="${request.user.id}" />
                        ${returnFields("crew")}
                        <button type="submit" class="btn btn-sm btn-ghost">${t("common.remove")}</button>
                      </form>
                    </div>`
                  : safe("")}
              </div>`,
          )
        : html`<p class="text-dim text-sm">${t("op.noUnassignedCrew")}</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.crewAction")}</div>
      ${user && (op.status === "open" || op.status === "draft")
        ? html`<form method="post" action="${bp}/api/ops/${op.id}/crew-requests">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("crew")}
            <label>${t("op.assignmentNote")}</label>
            <input
              type="text"
              name="note"
              maxlength="240"
              placeholder="${t("op.assignmentNotePlaceholder")}"
            />
            <button type="submit" class="btn btn-sm mt-1">${t("op.requestAssignment")}</button>
          </form>`
        : html`<p class="text-dim text-sm">
            ${t("op.crewRequestsAvail")}
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
          <div class="opv2-panel-title">${t("op.primaryVoice")}</div>
          <p class="text-dim text-sm">
            ${t("op.primaryVoiceDesc")}
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
                    <span>${effectiveName}${a.chosenUnitId ? "" : ` ${t("op.autoParen")}`}</span>
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
                      ${t("op.autoFirstUnit")}
                    </option>
                    ${a.units.map(
                      (u) =>
                        html`<option
                          value="${u.unitId}"
                          ${a.chosenUnitId === u.unitId ? safe("selected") : ""}
                        >
                          ${u.name} (${u.unitType === "ship" ? t("op.ship") : "FPS"})${u.hasChannel
                            ? ""
                            : ` ${t("op.noChannel")}`}
                        </option>`,
                    )}
                  </select>
                </div>
                <button type="submit" class="btn btn-sm">${t("common.save")}</button>
              </form>`;
            })}
          </div>
        </section>`
      : safe("");

  const voicePanel = html`<div class="opv2-grid">
    ${primaryPanel}
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.missionVoice")}</div>
      ${opts.voiceEnabled
        ? opts.missionVoice?.globalVoiceRoom
          ? html`<div class="opv2-stack">
              <div class="detail-row">
                <span>Global Radio Net</span>
                <strong>${opts.missionVoice.globalVoiceRoom}</strong>
              </div>
              <div class="detail-row">
                <span>Command Net</span>
                <strong>${opts.missionVoice.commanderVoiceRoom ?? t("op.none")}</strong>
              </div>
            </div>`
          : html`<p class="text-dim text-sm">
              ${t("op.noActiveVoiceRoom")}
            </p>`
        : html`<p class="text-dim text-sm">${t("op.voiceNotEnabled")}</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.unitChannels")}</div>
      ${op.voiceChannels.length
        ? op.voiceChannels.map((channel) => {
            const name =
              channel.channelName ||
              (channel.unit.unitType === "ship"
                ? (channel.unit.ship?.name ?? t("common.unknownShip"))
                : (channel.unit.squadName ?? t("common.squad")));
            return html`<div class="opv2-row">
              <div>
                <strong>${name}</strong>
                <span>${unitLeadTitle(channel.unit.ship)}: ${channel.unit.captain.username}</span>
              </div>
              <div class="opv2-row-meta">
                <span class="tag tag-cyan">${channel.voiceBot?.label ?? t("op.discord")}</span>
                ${canManage
                  ? html`<form
                        method="post"
                        action="${bp}/api/ops/${op.id}/voice-channels/${channel.id}/rename"
                        class="opv2-inline-form"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("voice")}
                        <input type="text" name="name" value="${name}" maxlength="100" required />
                        <button type="submit" class="btn btn-sm btn-ghost">${t("op.rename")}</button>
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
                          onclick="return confirm('${t("op.confirmDeleteVoiceChannel")}')"
                        >
                          ${t("common.delete")}
                        </button>
                      </form>`
                  : safe("")}
              </div>
            </div>`;
          })
        : html`<p class="text-dim text-sm">${t("op.noUnitChannels")}</p>`}
      ${canManage && opts.availableVoiceBotCount > 0
        ? html`<form
            method="post"
            action="${bp}/api/ops/${op.id}/voice-channels/launch"
            class="mt-1"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("voice")}
            <button type="submit" class="btn btn-sm btn-cyan">${t("op.launchVoiceChannels")}</button>
          </form>`
        : safe("")}
    </section>
    ${canManage && opts.voiceEnabled && opts.voiceControl && opts.voiceControl.length
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title">${t("op.voiceControl")}</div>
          <p class="text-dim text-sm" style="margin-bottom:.75rem">
            ${t("op.voiceControlDesc")}
          </p>
          <div class="opv2-stack">
            ${opts.voiceControl.map(
              (unit) => html`<div class="opv2-row" style="flex-wrap:wrap;gap:.5rem">
                <div>
                  <strong>${unit.channelName}</strong>
                  <span>${t("op.crewCount", { n: unit.crew.length })}</span>
                </div>
                <div class="opv2-row-meta" style="gap:.4rem;flex-wrap:wrap">
                  <form
                    method="post"
                    action="${bp}/ops/${op.id}/voice/move-unit/${unit.unitId}"
                    class="inline"
                  >
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <button type="submit" class="btn btn-sm btn-cyan">${t("op.pullAllCrew")}</button>
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
                              ${t("op.move")} ${member.username}
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
    k === "squadleader" ? t("op.kindSquadleader") : k === "leader" ? t("op.kindLeader") : t("op.kindAdded");
  const commanderKindTone = (k: "squadleader" | "leader" | "participant") =>
    k === "participant" ? "tag-gold" : k === "leader" ? "tag-green" : "tag-cyan";
  const rosterIds = new Set((opts.commanderRoster?.entries ?? []).map((e) => e.userId));
  const addableUsers = opts.assignableUsers.filter((u) => !rosterIds.has(u.id));

  const voiceEntries = opts.commanderRoster?.entries ?? [];
  const commandNetCount = voiceEntries.length;
  const globalNetCount = voiceEntries.filter((e) => e.globalVoice).length;
  const commandersPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.voiceAccess")}</div>
      ${!opts.voiceEnabled
        ? html`<p class="text-dim text-sm">${t("op.voiceNotEnabled")}</p>`
        : html`
            <p class="text-dim text-sm" style="margin-bottom:.5rem">
              <strong style="color:var(--cyan,#35d0e0)">Command Net</strong> ${t("op.commandNetDesc")}
              <strong style="color:var(--gold,#e0b835)">Global Radio Net</strong> ${t("op.globalNetDesc")}
            </p>
            <div style="display:flex;gap:.5rem;flex-wrap:wrap;margin-bottom:.75rem">
              <span class="tag tag-cyan">Command Net · ${String(commandNetCount)}</span>
              <span class="tag tag-gold">Global Radio Net · ${String(globalNetCount)}</span>
            </div>
            ${opts.commanderRoster && !opts.commanderRoster.voiceActive
              ? html`<div class="banner banner-dim text-sm" style="margin-bottom:.75rem">
                  ${t("op.noVoiceSession")}
                </div>`
              : safe("")}
            <div class="opv2-stack">
              ${voiceEntries.length
                ? voiceEntries.map(
                    (e) => html`<div class="opv2-row" style="flex-wrap:wrap;gap:.5rem">
                      <div>
                        <strong>${e.username}</strong>
                        <span class="tag ${commanderKindTone(e.kind)}"
                          >${commanderKindLabel(e.kind)}</span
                        >
                      </div>
                      <div
                        class="opv2-row-meta"
                        style="flex:1;justify-content:flex-end;gap:.4rem;min-width:18rem;align-items:center"
                      >
                        <span class="tag tag-cyan" title="${t("op.onCommandNet")}">Command Net</span>
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
                                onclick="const i=this.previousElementSibling;i.select();navigator.clipboard.writeText(i.value).then(()=>{const b=this,o=b.textContent;b.textContent='${t("op.copied")}';b.disabled=true;setTimeout(()=>{b.textContent=o;b.disabled=false;},1200);}).catch(()=>{document.execCommand('copy');});"
                              >
                                ${t("op.copy")}
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
                            title="${t("op.toggleGlobalRadio")}"
                          >
                            Global Radio ${e.globalVoice ? t("common.on") : t("common.off2")}
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
                              <button type="submit" class="btn btn-sm btn-danger">${t("common.remove")}</button>
                            </form>`
                          : safe("")}
                      </div>
                    </div>`,
                  )
                : html`<p class="text-dim text-sm">${t("op.noOneCommandNet")}</p>`}
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
                    <option value="">${t("op.addToCommandNet")}</option>
                    ${addableUsers.map(
                      (u) => html`<option value="${u.id}">${u.username} (${u.role})</option>`,
                    )}
                  </select>
                  <label class="seat-toggle text-sm">
                    <input type="checkbox" name="globalVoice" value="1" />
                    + Global Radio Net
                  </label>
                  <button type="submit" class="btn btn-sm btn-green">${t("common.add")}</button>
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
    needType: string;
    count: number;
    fulfilled: number;
    pending: number;
    open: number;
    extra: number;
    mismatches: number;
  };
  const compRows: CompRow[] = op.groups.flatMap((g) =>
    g.requirements.map((r) => {
      const needType =
        (r as { needType?: string | null }).needType ?? (isCqbCategory(r.category) ? "cqb_team" : "ship");
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
        needType,
        count: r.count,
        fulfilled,
        pending,
        open: Math.max(0, r.count - fulfilled),
        extra: Math.max(0, fulfilled - r.count),
        mismatches,
      };
    }),
  );
  const compChips = (r: CompRow) => {
    const filledOk = Math.max(0, r.fulfilled - r.mismatches);
    const chips: SafeHtml[] = [];
    for (let i = 0; i < filledOk; i++) chips.push(html`<span class="comp-chip filled"></span>`);
    for (let i = 0; i < r.mismatches; i++)
      chips.push(html`<span class="comp-chip mismatch" title="${t("board.chipMismatch")}"></span>`);
    for (let i = 0; i < r.open; i++) chips.push(html`<span class="comp-chip open"></span>`);
    return chips;
  };
  const compTone = (r: CompRow) =>
    r.open === 0 ? "tag-green" : r.fulfilled === 0 ? "tag-dim" : "tag-gold";
  // Row tint by fulfillment: fully met = green, partly = gold, none = red.
  const rowTone = (filled: number, open: number) =>
    open === 0 && filled > 0 ? "green" : filled === 0 ? "red" : "gold";
  // Three fleet-need axes (FR-P1 structured): hulls (ships, from requirements),
  // fighter squads and CQB teams (from materialized CompositionGroups — they
  // hold CqbSignups, not FleetUnits, so fulfilled comes from team membership).
  const hullRows = compRows.filter((r) => r.needType === "ship");
  const teamAxis = (kind: string) => {
    const groups = op.groups.filter((g) => g.kind === kind);
    const teams = groups.map((g) => {
      const members = (op.cqbSignups ?? []).filter((s) => s.assignedGroupId === g.id).length;
      const cap = (g as { targetSize?: number | null }).targetSize ?? 0;
      return { name: g.name, members, cap, open: Math.max(0, cap - members) };
    });
    const slots = teams.reduce((a, t) => a + t.cap, 0);
    const filled = teams.reduce((a, t) => a + t.members, 0);
    return { teams, slots, filled, open: Math.max(0, slots - filled) };
  };
  const fighterAxis = teamAxis("fighter_squad");
  const cqbAxis = teamAxis("squad");
  const teamAxisTable = (
    title: string,
    sumWord: string,
    axis: ReturnType<typeof teamAxis>,
  ): SafeHtml =>
    axis.teams.length
      ? html`<div class="fleet-req-board" style="margin-bottom:1rem">
          <div class="fleet-req-row fleet-req-head">
            <span>${title}</span><span>${t("board.target")}</span><span>${t("board.actual")}</span><span>${t("board.open")}</span>
          </div>
          ${axis.teams.map(
            (t) => html`<div class="comp-row comp-row-${rowTone(t.members, t.open)}">
              <div class="comp-row-head">
                <div class="fleet-req-name"><strong>${t.name}</strong></div>
                <strong class="fleet-req-num">${t.cap}</strong>
                <span class="fleet-req-num"
                  ><span class="tag ${t.open === 0 ? "tag-green" : t.members === 0 ? "tag-dim" : "tag-gold"}"
                    >${t.members}</span
                  ></span
                >
                <span class="fleet-req-num"
                  ><span class="tag ${t.open ? "tag-red" : "tag-green"}">${t.open}</span></span
                >
              </div>
            </div>`,
          )}
          <div class="fleet-req-row fleet-req-total">
            <span>${t("board.sum")} ${sumWord}</span>
            <strong>${axis.slots}</strong>
            <strong>${axis.filled}</strong>
            <strong>${axis.open}</strong>
          </div>
        </div>`
      : safe("");
  // Render one need-group as its own Soll/Ist/Offen table; empty group → nothing.
  const reqGroupTable = (title: string, sumWord: string, rows: CompRow[]): SafeHtml => {
    if (rows.length === 0) return safe("");
    const req = rows.reduce((a, r) => a + r.count, 0);
    const ful = rows.reduce((a, r) => a + r.fulfilled, 0);
    const opn = rows.reduce((a, r) => a + r.open, 0);
    return html`<div class="fleet-req-board" style="margin-bottom:1rem">
      <div class="fleet-req-row fleet-req-head">
        <span>${title}</span>
        <span>${t("board.target")}</span>
        <span>${t("board.actual")}</span>
        <span>${t("board.open")}</span>
      </div>
      ${rows.map(
        (r) => html`<div class="comp-row comp-row-${rowTone(r.fulfilled, r.open)}">
          <div class="comp-row-head">
            <div class="fleet-req-name">
              <strong>${r.label}</strong>
              <span class="tag tag-dim">${categoryLabel(r.category)}</span>
              ${r.group ? html`<span class="text-dim text-sm">${r.group}</span>` : safe("")}
            </div>
            <strong class="fleet-req-num">${r.count}</strong>
            <span class="fleet-req-num">
              <span class="tag ${compTone(r)}">${r.fulfilled}</span>
              ${r.pending ? html`<span class="tag tag-gold">${t("board.pending", { n: r.pending })}</span>` : safe("")}
              ${r.mismatches
                ? html`<span class="tag tag-gold" title="${t("board.mismatchTitle")}"
                    >${t("board.mismatch", { n: r.mismatches })}</span
                  >`
                : safe("")}
            </span>
            <span class="fleet-req-num">
              <span class="tag ${r.open ? "tag-red" : "tag-green"}">${r.open}</span>
              ${r.extra ? html`<span class="tag tag-cyan">${t("board.extra", { n: r.extra })}</span>` : safe("")}
            </span>
          </div>
          <div class="comp-chips">
            ${r.open === 0 && r.fulfilled > 0 && r.mismatches === 0
              ? html`<span class="tag tag-green">✓ ${t("board.fulfilled")}</span>`
              : compChips(r)}
          </div>
        </div>`,
      )}
      <div class="fleet-req-row fleet-req-total">
        <span>${t("board.sum")} ${sumWord}</span>
        <strong>${req}</strong>
        <strong>${ful}</strong>
        <strong>${opn}</strong>
      </div>
    </div>`;
  };
  // Open requirement slots (for accept-into-slot + auto-match suggestion).
  const openSlots = op.groups.flatMap((g) =>
    g.requirements.map((r) => ({
      id: r.id,
      label: r.label,
      category: r.category,
      open: Math.max(0, r.count - r.fleetUnits.filter((u) => u.status === "accepted").length),
    })),
  );
  // Accept (or slot an already-accepted) unit into a requirement in one action.
  // Posts to /accept with requirementId; the slot defaults to the auto-match.
  const slotAcceptForm = (unit: UnitFull, actionLabel: string) => {
    const suggested = suggestSlot({ unitType: unit.unitType, ship: unit.ship }, openSlots);
    return html`<form
      method="post"
      action="${bp}/api/ops/${op.id}/units/${unit.id}/accept"
      class="mg-slot-form"
    >
      <input type="hidden" name="_csrf" value="${csrf}" />
      ${returnFields("overview")}
      <select name="requirementId">
        <option value="">${t("op.unslottedDash")}</option>
        ${openSlots
          // Only slots this unit can actually fill (a ship never fits a CQB
          // soldier need), and that still have room (or the auto-match).
          .filter((s) => matchesCategory(s.category, { unitType: unit.unitType, ship: unit.ship }))
          .filter((s) => s.open > 0 || s.id === suggested)
          .map(
            (s) => html`<option value="${s.id}" ${s.id === suggested ? safe("selected") : ""}>
              ${s.label}${matchesCategory(s.category, { unitType: unit.unitType, ship: unit.ship })
                ? " ✓"
                : ""}
            </option>`,
          )}
      </select>
      <button type="submit" class="btn btn-sm btn-green">${actionLabel}</button>
    </form>`;
  };
  const boardRequested =
    hullRows.reduce((a, r) => a + r.count, 0) + fighterAxis.slots + cqbAxis.slots;
  const boardFulfilled =
    hullRows.reduce((a, r) => a + r.fulfilled, 0) + fighterAxis.filled + cqbAxis.filled;
  const boardOpen = hullRows.reduce((a, r) => a + r.open, 0) + fighterAxis.open + cqbAxis.open;
  const boardHasNeeds = hullRows.length || fighterAxis.teams.length || cqbAxis.teams.length;
  const compositionBoard = html`<section class="opv2-panel">
    <div class="opv2-panel-title">${t("board.fleetNeeds")}</div>
    ${boardHasNeeds
      ? html`${reqGroupTable(t("board.hullNeed"), t("board.ships"), hullRows)}
          ${teamAxisTable(t("board.fighterNeed"), t("board.pilots"), fighterAxis)}
          ${teamAxisTable(t("board.cqbNeed"), t("board.soldiers"), cqbAxis)}
          <div class="fleet-req-row fleet-req-total">
            <span>${t("board.total")}</span>
            <strong>${boardRequested}</strong>
            <strong>${boardFulfilled}</strong>
            <strong>${boardOpen}</strong>
          </div>
          <p class="text-dim text-sm" style="margin:.6rem 0 0">
            ${t("board.legend")}
          </p>`
      : html`<p class="text-dim text-sm">
          ${t("board.noNeeds")}${canManage ? ` ${t("board.noNeedsManage")}` : ""}
        </p>`}
    ${canManage && pendingUnits.length
      ? html`<details class="mg-board-sub" open>
          <summary>${t("board.pendingReview", { n: String(pendingUnits.length) })}</summary>
          ${pendingUnits.map(
            (u) => html`<div class="opv2-row mg-board-row">
              <div>
                <strong>${unitName(u)}</strong>${u.captainNote
                  ? html`<span class="text-dim text-sm"> — "${u.captainNote}"</span>`
                  : safe("")}
              </div>
              <div class="mg-board-act">
                ${slotAcceptForm(u, t("common.accept"))}
                <form
                  method="post"
                  action="${bp}/api/ops/${op.id}/units/${u.id}/reject"
                  class="inline"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("overview")}
                  <button type="submit" class="btn btn-sm btn-ghost">${t("common.reject")}</button>
                </form>
              </div>
            </div>`,
          )}
        </details>`
      : safe("")}
    ${(() => {
      if (!canManage) return safe("");
      const unslotted = op.units.filter(
        (u) => u.status === "accepted" && !u.requirementId && u.unitType !== "vehicle",
      );
      if (unslotted.length === 0) return safe("");
      // Open only when there are pending units to deal with (the urgent case).
      return html`<details class="mg-board-sub" ${pendingUnits.length ? safe("open") : safe("")}>
        <summary>${t("board.unassignedAccepted", { n: String(unslotted.length) })}</summary>
        ${unslotted.map(
          (u) => html`<div class="opv2-row mg-board-row">
            <div><strong>${unitName(u)}</strong></div>
            <div class="mg-board-act">${slotAcceptForm(u, t("common.assign"))}</div>
          </div>`,
        )}
      </details>`;
    })()}
  </section>`;

  const participantsPanel =
    op.status === "completed" && opts.participants
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title" style="display:flex;justify-content:space-between;align-items:center;gap:.5rem">
            <span>${t("op.participants")} (${opts.participants.length})</span>
            <a class="btn btn-sm btn-ghost" href="${bp}/ops/${op.id}/participants.csv">${t("op.downloadCsv")}</a>
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
            : html`<p class="text-dim text-sm">${t("op.noAssignedParticipants")}</p>`}
        </section>`
      : safe("");

  const overviewPanel = html`<div class="opv2-grid">
    ${participantsPanel} ${compositionBoard}
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.briefing")}</div>
      ${op.description
        ? renderMarkdown(op.description)
        : html`<p class="text-dim text-sm">${t("op.noBriefing")}</p>`}
      ${canManage
        ? html`<details style="margin-top:.85rem">
            <summary class="mg-edit-toggle">✎ ${t("op.editEventDetails")}</summary>
            <form method="post" action="${bp}/ops/${op.id}/edit" class="opv2-form mt-1">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("overview")}
            <label>${t("op.fldTitle")}</label>
            <input type="text" name="title" value="${op.title}" maxlength="120" required />
            <div class="opv2-form-grid">
              <div>
                <label>${t("op.fldType")}</label>
                <select name="opType">
                  ${OP_TYPES.map(
                    (type) =>
                      html`<option value="${type}" ${op.opType === type ? safe("selected") : ""}>
                        ${opTypeText(type)}
                      </option>`,
                  )}
                </select>
              </div>
              <div>
                <label>${t("op.fldWhen")}</label>
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
                <label>${t("op.fldSystem")}</label>
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
                <label>${t("op.fldRendezvous")}</label>
                <input
                  type="text"
                  name="meetingLocation"
                  value="${op.meetingLocation ?? ""}"
                  maxlength="120"
                />
              </div>
            </div>
            <label>${t("op.fldDescription")}</label>
            <textarea name="description" rows="5">${op.description ?? ""}</textarea>
            ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
              ? html`<label
                    >${t("op.eventVoiceChannel")}
                    <span style="font-weight:normal;opacity:.65">
                      ${t("op.eventVoiceChannelHint")}
                    </span></label
                  >
                  <select name="eventVoiceChannelId">
                    <option value="">${t("op.noVoiceChannel")}</option>
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
            <button type="submit" class="btn btn-sm mt-1">${t("op.saveOverview")}</button>
            </form>
          </details>`
        : safe("")}
    </section>
  </div>`;

  // Action Details — rendered persistently in the shell (above the tab nav) so
  // mission time/location/Discord + status controls stay visible on every tab.
  // Styled as metric cards (label over value) to match the metrics row above.
  const eventVoiceName =
    opts.guildVoiceChannels?.find((channel) => channel.id === op.eventVoiceChannelId)?.name ??
    t("op.notSet");
  const actionDetailsPanel = html`<div class="opv2-action-details">
    <div class="opv2-metrics opv2-action-metrics">
      ${metric(t("op.fldWhen"), fmtDate(op.scheduledAt, gtz))}
      ${metric(t("op.fldSystem"), systemLabel(op.meetingSystem ?? "stanton"))}
      ${metric(t("op.fldRendezvous"), op.meetingLocation || t("op.notSet"))}
      ${metric(t("op.leaders"), op.leaders.length || t("op.none"))}
      ${metric(t("op.eventVoice"), eventVoiceName)}
      <div class="opv2-metric">
        <span>Discord</span>
        <strong>
          ${opts.guildDiscordInviteUrl
            ? html`<a href="${opts.guildDiscordInviteUrl}" target="_blank" rel="noopener noreferrer"
                >${t("op.joinServer")}</a
              >`
            : t("op.notSet")}
        </strong>
      </div>
    </div>
    ${statusControls}
  </div>`;

  // ── CQB personnel pool + operator squad bundling (FR-P1 step 4) ──────
  const cqbSignups = op.cqbSignups ?? [];
  const cqbPool = cqbSignups.filter((s) => !s.assignedGroupId);
  const cqbSquads = op.groups.filter((g) => g.kind === "squad");
  // Phase 4b: non-fighter accepted ships a CQB team can be embedded in.
  const carrierShips = op.units.filter(
    (u) => u.unitType === "ship" && u.status === "accepted" && shipClass(u.ship) !== "Fighter",
  );
  // Open ship seats — for giving a participant a secondary position.
  const openSeatOptions = acceptedUnits.flatMap((u) =>
    u.seats
      .filter((s) => s.active && !s.userId)
      .map((s) => ({ id: s.id, label: `${u.squadName || u.ship?.name || t("op.unit")} — ${s.label}` })),
  );
  const cqbPanel =
    cqbSignups.length || cqbSquads.length || canManage
      ? html`<section class="opv2-panel">
          <div class="opv2-panel-title">${t("op.cqbPersonnel")}${helpIcon(t("op.cqbPersonnelHelp"))}</div>
          <script>
            (function () {
              function flash(form, ok) {
                var b = form.querySelector('button[type=submit]');
                if (b) { var o = b.textContent; b.textContent = ok ? "✓" : "✕"; setTimeout(function () { b.textContent = o; }, 1100); return; }
                form.style.outline = ok ? "2px solid #3ad07a" : "2px solid #e0556a";
                setTimeout(function () { form.style.outline = ""; }, 1000);
              }
              function init() {
                document.querySelectorAll("form[data-async]").forEach(function (f) {
                  if (f.__async) return; f.__async = true;
                  f.addEventListener("submit", function (e) {
                    e.preventDefault();
                    fetch(f.action, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(new FormData(f)) })
                      .then(function (r) { flash(f, r.ok); })
                      .catch(function () { flash(f, false); });
                  });
                });
              }
              if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
            })();
          </script>
          ${cqbSignups.length === 0 && cqbSquads.length === 0
            ? html`<p class="text-dim text-sm">
                ${t("op.noCqbSignups")}${canManage
                  ? ` ${t("op.noCqbSignupsManage")}`
                  : ""}
              </p>`
            : safe("")}
          ${cqbSquads.map((g) => {
            const members = cqbSignups.filter((s) => s.assignedGroupId === g.id);
            const cap = (g as { targetSize?: number | null }).targetSize ?? null;
            const carrierId = (g as { carrierUnitId?: string | null }).carrierUnitId ?? null;
            const carrierUnit = carrierId ? op.units.find((u) => u.id === carrierId) : null;
            return html`<div class="opv2-row mg-board-row cqb-squad-drop" data-cqb-group="${g.id}">
              <div>
                <strong>${g.name}</strong>${helpIcon(t("op.cqbTeamHelp"))}
                <span class="tag tag-green">${members.length}${cap ? ` / ${cap}` : ""}</span>
                ${cap && members.length >= cap ? html` <span class="tag tag-gold">${t("op.full")}</span>` : safe("")}
                ${canManage
                  ? members.length
                    ? html`<div class="cqb-members" style="display:flex;flex-direction:column;gap:.25rem;margin-top:.35rem">
                        ${members.map(
                          (m) => html`<div class="cqb-member-row" style="display:flex;align-items:center;gap:.5rem;flex-wrap:wrap">
                            <span class="cqb-member-name" style="flex:0 0 12rem;max-width:12rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${nm(m.user.username)}">${clip(nm(m.user.username))}</span>
                            <form method="post" action="${bp}/api/ops/${op.id}/cqb/assign" class="inline" data-async>
                              <input type="hidden" name="_csrf" value="${csrf}" />
                              ${returnFields("fleet")}
                              <input type="hidden" name="signupId" value="${m.id}" />
                              <select name="groupId" onchange="this.form.requestSubmit()" title="${t("op.reassignSoldier")}">
                                <option value="" disabled selected hidden>${t("op.reassignTo")}</option>
                                <option value="">${t("op.pool")}</option>
                                ${cqbSquads.map(
                                  (sq) => html`<option value="${sq.id}">${sq.name}</option>`,
                                )}
                              </select>
                            </form>
                            ${openSeatOptions.length
                              ? html`<form method="post" action="${bp}/api/ops/${op.id}/seats/assign" class="inline" data-async>
                                  <input type="hidden" name="_csrf" value="${csrf}" />
                                  ${returnFields("fleet")}
                                  <input type="hidden" name="userId" value="${m.userId}" />
                                  <select name="seatId" onchange="this.form.requestSubmit()" title="${t("op.assignSecondarySeat")}">
                                    <option value="" disabled selected hidden>${t("op.secondarySeat")}</option>
                                    ${openSeatOptions.map(
                                      (s) => html`<option value="${s.id}">${s.label}</option>`,
                                    )}
                                  </select>
                                </form>`
                              : safe("")}
                          </div>`,
                        )}
                      </div>`
                    : html`<div class="text-dim text-sm">${t("op.empty")}</div>`
                  : html`<div class="text-dim text-sm">
                      ${members.map((m) => nm(m.user.username)).join(", ") || t("op.empty")}
                    </div>`}
                ${carrierUnit
                  ? html`<div class="text-dim text-sm">${t("op.ridesIn")} <strong>${unitName(carrierUnit)}</strong></div>`
                  : safe("")}
              </div>
              ${canManage
                ? html`<div style="display:flex;gap:.4rem;align-items:center;flex-wrap:wrap">
                    <form
                      method="post"
                      action="${bp}/api/ops/${op.id}/cqb/squads/${g.id}/rename"
                      class="inline"
                      data-async
                      style="display:flex;gap:.3rem;align-items:center"
                      title="${t("op.renameSquad")}"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      ${returnFields("fleet")}
                      <input type="text" name="name" value="${g.name}" maxlength="80" style="width:9rem" />
                      <button type="submit" class="btn btn-sm">${t("op.rename")}</button>
                    </form>
                    ${carrierShips.length
                      ? html`<form
                          method="post"
                          action="${bp}/api/ops/${op.id}/cqb/squads/${g.id}/carrier"
                          class="inline"
                          data-async
                          title="${t("op.embedTeamShip")}"
                        >
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          ${returnFields("fleet")}
                          <select name="carrierUnitId" onchange="this.form.requestSubmit()">
                            <option value="">${t("op.noShip")}</option>
                            ${carrierShips.map(
                              (s) => html`<option value="${s.id}" ${carrierId === s.id ? safe("selected") : ""}>${unitName(s)}</option>`,
                            )}
                          </select>
                        </form>`
                      : safe("")}
                    <form
                      method="post"
                      action="${bp}/api/ops/${op.id}/cqb/squads/${g.id}/size"
                      class="inline"
                      data-async
                      style="display:flex;gap:.3rem;align-items:center"
                      title="${t("op.targetSquadSize")}"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      ${returnFields("fleet")}
                      <select name="size" title="${t("op.squadSizeRange")}">
                        ${[2, 3, 4, 5, 6, 7, 8].map(
                          (n) => html`<option value="${n}" ${cap === n ? safe("selected") : ""}>${n}</option>`,
                        )}
                      </select>
                      <button type="submit" class="btn btn-sm">${t("op.size")}</button>
                    </form>
                    <details class="opv2-seat-assign">
                      <summary class="btn btn-sm btn-ghost">${t("common.assign")}</summary>
                      <form method="post" action="${bp}/api/ops/${op.id}/cqb/place" data-async title="${t("op.assignPlayerTeam")}">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("fleet")}
                        <input type="hidden" name="groupId" value="${g.id}" />
                        <select name="userId" required>
                          <option value="">${t("op.selectUserDots")}</option>
                          ${opts.assignableUsers.map(
                            (au) => html`<option value="${au.id}">${au.username} (${au.role})</option>`,
                          )}
                        </select>
                        <button type="submit" class="btn btn-sm">${t("common.add")}</button>
                      </form>
                    </details>
                    <form
                      method="post"
                      action="${bp}/api/ops/${op.id}/cqb/unbundle/${g.id}"
                      class="inline"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      ${returnFields("fleet")}
                      <button type="submit" class="btn btn-sm btn-ghost">${t("op.dissolve")}</button>
                    </form>
                  </div>`
                : safe("")}
            </div>`;
          })}
          ${cqbPool.length
            ? canManage
              ? html`<form method="post" action="${bp}/api/ops/${op.id}/cqb/bundle" class="mt-2">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    ${returnFields("fleet")}
                    <div class="text-dim text-sm" style="margin-bottom:.3rem">
                      ${t("op.unassignedSoldiers", { n: String(cqbPool.length) })}
                    </div>
                    ${cqbPool.map(
                      (s) => html`<label
                        class="cqb-pool-item"
                        draggable="true"
                        data-cqb-signup="${s.id}"
                        title="${t("op.dragOntoSquad")}"
                        style="display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0;cursor:grab"
                      >
                        <span
                          ><input type="checkbox" name="signupId" value="${s.id}" />
                          ${nm(s.user.username)}${s.note
                            ? html` <span class="text-dim text-sm">— ${s.note}</span>`
                            : safe("")}</span
                        >
                      </label>`,
                    )}
                    <div
                      style="display:flex;gap:.5rem;align-items:center;margin-top:.5rem;flex-wrap:wrap"
                    >
                      <input
                        type="text"
                        name="name"
                        maxlength="80"
                        placeholder="Squad name"
                        style="flex:1;min-width:120px"
                      />
                      <input
                        type="number"
                        name="size"
                        min="1"
                        max="24"
                        placeholder="${t("op.size")}"
                        title="${t("op.sizeOptTitle")}"
                        style="width:72px"
                      />
                      <button type="submit" class="btn btn-sm btn-green">${t("op.createSquadSelected")}</button>
                    </div>
                  </form>
                  <form
                    method="post"
                    action="${bp}/api/ops/${op.id}/cqb/auto-bundle"
                    class="mt-1"
                    style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap"
                  >
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    ${returnFields("fleet")}
                    <span class="text-dim text-sm">${t("op.autoBundleInto")}</span>
                    <input type="number" name="size" min="2" max="8" value="4" style="width:64px" />
                    <button type="submit" class="btn btn-sm">${t("op.autoBundle")}</button>
                  </form>`
              : html`<p class="text-dim text-sm mt-1">
                  ${t("op.soldiersWaiting", { n: String(cqbPool.length) })}
                </p>`
            : safe("")}
          ${canManage && cqbSquads.length && cqbPool.length
            ? html`<form
                  id="cqb-assign-form-${op.id}"
                  method="post"
                  action="${bp}/api/ops/${op.id}/cqb/assign"
                  hidden
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <input type="hidden" name="signupId" />
                  <input type="hidden" name="groupId" />
                </form>
                <script>
                  (function () {
                    var form = document.getElementById("cqb-assign-form-${op.id}");
                    if (!form) return;
                    var dragId = null;
                    document.querySelectorAll(".cqb-pool-item").forEach(function (el) {
                      el.addEventListener("dragstart", function (e) {
                        dragId = el.getAttribute("data-cqb-signup");
                        if (e.dataTransfer) e.dataTransfer.setData("text/plain", dragId || "");
                      });
                    });
                    document.querySelectorAll(".cqb-squad-drop").forEach(function (row) {
                      row.addEventListener("dragover", function (e) {
                        e.preventDefault();
                        row.style.outline = "1px dashed var(--cyan,#3cf)";
                      });
                      row.addEventListener("dragleave", function () {
                        row.style.outline = "";
                      });
                      row.addEventListener("drop", function (e) {
                        e.preventDefault();
                        row.style.outline = "";
                        var sid = dragId || (e.dataTransfer && e.dataTransfer.getData("text/plain"));
                        var gid = row.getAttribute("data-cqb-group");
                        if (!sid || !gid) return;
                        form.querySelector('[name="signupId"]').value = sid;
                        form.querySelector('[name="groupId"]').value = gid;
                        form.submit();
                      });
                    });
                  })();
                </script>`
            : safe("")}
        </section>`
      : safe("");

  // FR-P1 Phase 2: structured needs derived from requirements (needType).
  type NeedReq = {
    id: string;
    count: number;
    needType?: string | null;
    shipType?: string | null;
    squadSize?: number | null;
  };
  const allNeedReqs = op.groups.flatMap((g) => g.requirements) as unknown as NeedReq[];
  const shipNeeds = allNeedReqs.filter((r) => r.needType === "ship");
  const fighterReq = allNeedReqs.find((r) => r.needType === "fighter_squad");
  const cqbReq = allNeedReqs.find((r) => r.needType === "cqb_team");
  const fighterCount = fighterReq?.count ?? 0;
  const cqbCount = cqbReq?.count ?? 0;
  const cqbSize = cqbReq?.squadSize ?? CQB_TEAM_DEFAULT;

  // FR-P1 Phase 4a: formations (Verbände) — group accepted ships.
  const formationGroups = op.groups.filter((g) => g.kind === "formation");
  const acceptedShipsForFm = op.units.filter(
    (u) => u.unitType === "ship" && u.status === "accepted",
  );
  const fmShipFormationId = (u: (typeof op.units)[number]) =>
    (u as { formationId?: string | null }).formationId ?? null;
  const formations = formationGroups.map((g) => ({
    id: g.id,
    name: g.name,
    ships: acceptedShipsForFm.filter((u) => fmShipFormationId(u) === g.id),
  }));
  const formationsPanel = canManage || formations.length
    ? html`<section class="opv2-panel">
        <div class="opv2-panel-title">${t("op.formations")}${helpIcon(t("op.formationsHelp"))}</div>
        ${formations.length
          ? formations.map(
              (f) => html`<div class="opv2-row mg-board-row">
                <div>
                  <strong>${f.name}</strong>
                  <span class="tag tag-cyan">${t("op.shipsN", { n: f.ships.length })}</span>
                  <div class="text-dim text-sm">
                    ${f.ships.map((s) => unitName(s)).join(", ") || t("op.empty")}
                  </div>
                </div>
                ${canManage
                  ? html`<form method="post" action="${bp}/api/ops/${op.id}/formations/${f.id}/delete" class="inline">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      ${returnFields("fleet")}
                      <button type="submit" class="btn btn-sm btn-ghost">${t("op.dissolve")}</button>
                    </form>`
                  : safe("")}
              </div>`,
            )
          : html`<p class="text-dim text-sm">${t("op.noFormations")}</p>`}
        ${canManage
          ? html`<form method="post" action="${bp}/api/ops/${op.id}/formations" class="opv2-inline-form mt-1">
                <input type="hidden" name="_csrf" value="${csrf}" />
                ${returnFields("fleet")}
                <input type="text" name="name" maxlength="80" placeholder="${t("op.formationNamePlaceholder")}" required />
                <button type="submit" class="btn btn-sm">${t("op.addFormation")}</button>
              </form>
              ${acceptedShipsForFm.length && formationGroups.length
                ? html`<div class="text-dim text-sm mt-2" style="margin-bottom:.3rem">${t("op.assignShipsToFormation")}</div>
                    ${acceptedShipsForFm.map(
                      (s) => html`<form method="post" action="${bp}/api/ops/${op.id}/units/${s.id}/formation" class="opv2-inline-form" style="margin:.2rem 0">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        ${returnFields("fleet")}
                        <span style="flex:1;min-width:8rem">${unitName(s)}</span>
                        <select name="formationId" onchange="this.form.submit()">
                          <option value="">${t("op.noneDash")}</option>
                          ${formationGroups.map(
                            (f) => html`<option value="${f.id}" ${fmShipFormationId(s) === f.id ? safe("selected") : ""}>${f.name}</option>`,
                          )}
                        </select>
                      </form>`,
                    )}`
                : safe("")}`
          : safe("")}
      </section>`
    : safe("");

  const fleetPanel = html`<div class="opv2-grid">
    ${cqbPanel}
    ${formationsPanel}
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.fleetUnits")}${helpIcon(t("op.fleetUnitsHelp"))}</div>
      <div class="opv2-stack" style="max-height:70vh;overflow-y:auto">${unitRows}</div>
      ${canManage && orphanVehicles.length
        ? html`<div class="opv2-edit-block mt-2">
            <div class="opv2-panel-title" style="font-size:.9rem">${t("op.unassignedVehicles")}</div>
            ${orphanVehicles.map(
              (v) => html`<div class="opv2-row" style="align-items:center">
                <div><strong>${unitName(v)}</strong> <span class="tag tag-cyan">${t("op.vehicle")}</span></div>
                <form method="post" action="${bp}/api/ops/${op.id}/units/${v.id}/carrier" class="inline" data-async title="${t("op.assignToShipTitle")}">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  ${returnFields("fleet")}
                  <select name="carrierUnitId" onchange="this.form.requestSubmit()">
                    <option value="" disabled selected hidden>${t("op.assignToShipOpt")}</option>
                    ${carrierShipUnits.map((s) => html`<option value="${s.id}">${unitName(s)}</option>`)}
                  </select>
                </form>
              </div>`,
            )}
          </div>`
        : safe("")}
      ${user && (op.status === "open" || op.status === "draft")
        ? html`<details class="opv2-edit-block mt-1">
            <summary class="btn btn-sm">${t("op.registerUnit")}</summary>
            <form
              method="post"
              action="${bp}/api/ops/${op.id}/units"
              class="opv2-form opv2-unit-form mt-1"
              novalidate
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="form-errors opv2-unit-errors" hidden></div>
              <label>${t("op.fleetNeed")}</label>
              <select name="requirementId">
                <option value="">${t("op.unslotted")}</option>
                ${availableSlots.map(
                  (slot) => html`<option value="${slot.id}">${slot.label}</option>`,
                )}
              </select>
              <label>${t("op.unitType")}</label>
              <select name="unitType" class="opv2-unit-type">
                <option value="ship">${t("op.unitTypeShip")}</option>
                <option value="squad">${t("cat.fps")}</option>
              </select>
              <div class="unit-ship-fields">
                <label>${t("op.ownedShip")}</label>
                <select name="ownedShipId" class="opv2-owned-ship-select mandatory">
                  <option value="">${t("op.selectOwnedShip")}</option>
                  ${opts.ownedShips.map(
                    (ship) => html`<option value="${ship.id}">${ship.name}</option>`,
                  )}
                </select>
                <label>${t("op.shipSearch")}</label>
                <input
                  type="search"
                  class="opv2-ship-search mandatory"
                  placeholder="${t("op.searchShipCatalog")}"
                  autocomplete="off"
                />
                <input type="hidden" name="shipId" class="opv2-ship-id-field" />
                <div class="ship-results opv2-ship-results"></div>
              </div>
              <div class="unit-squad-fields" hidden>
                <div class="opv2-form-grid">
                  <div>
                    <label>${t("op.squadName")}</label>
                    <input
                      type="text"
                      name="squadName"
                      class="mandatory"
                      maxlength="80"
                      placeholder="FPS Team"
                    />
                  </div>
                  <div>
                    <label>${t("op.squadSize")}</label>
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
              <label>${t("op.captainNote")}</label>
              <input
                type="text"
                name="captainNote"
                maxlength="240"
                placeholder="${t("op.captainNotePlaceholder")}"
              />
              <button type="submit" class="btn btn-sm mt-1">${t("op.register")}</button>
            </form>
          </details>`
        : safe("")}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.needAssignment")}${helpIcon(t("op.needAssignmentHelp"))}</div>
      ${op.crewRequests.length
        ? html`<div class="opv2-crew-drag-list">
            ${op.crewRequests.map(
              (request) =>
                html`<div
                  class="opv2-crew-chip"
                  draggable="${isLeader ? "true" : "false"}"
                  data-crew-user-id="${request.user.id}"
                  title="${request.note || t("op.noNote")}"
                >
                  <strong>${nm(request.user.username)}</strong>
                  <span>${request.note || t("op.noNote")}</span>
                </div>`,
            )}
          </div>`
        : html`<p class="text-dim text-sm">${t("op.noUnassignedCrew")}</p>`}
      ${isLeader && op.crewRequests.length
        ? html`<p class="text-dim text-sm mt-1">
            ${t("op.dragCrewHint")}
          </p>`
        : safe("")}
      ${op.eventInterests.length
        ? html`<div style="margin-top:.85rem;border-top:1px solid var(--border);padding-top:.6rem">
            <div class="text-dim text-sm" style="margin-bottom:.4rem">
              ${t("op.interestedViaDiscord")}${
                op.eventInterests.filter((i) => !i.userId).length
                  ? safe(
                      ` · <strong>${String(
                        op.eventInterests.filter((i) => !i.userId).length,
                      )}</strong> ${t("op.unknownToSystem")}`,
                    )
                  : safe("")
              }
            </div>
            <div class="opv2-crew-drag-list">
              ${op.eventInterests.map(
                (i) =>
                  html`<div
                    class="opv2-crew-chip"
                    draggable="${isLeader && i.userId ? "true" : "false"}"
                    data-crew-user-id="${i.userId ?? ""}"
                    title="${t("op.clickedInterested")}"
                  >
                    <strong>${nm(i.displayName)}</strong>
                    <span>${i.userId ? t("op.discordInterested") : t("op.discordNoAccount")}</span>
                  </div>`,
              )}
            </div>
          </div>`
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
      <div class="opv2-panel-title mt-2">${t("board.fleetNeeds")}${helpIcon(t("op.fleetNeedsEditorHelp"))}</div>
      ${canManage
        ? html`<div class="need-editor mt-1">
            <style>
              .need-editor { display: grid; gap: .8rem; }
              .need-block { border: 1px solid rgba(255,255,255,.08); padding: .6rem .7rem; }
              .need-h { font-weight: 600; margin-bottom: .45rem; }
              .need-chips { display: flex; flex-wrap: wrap; gap: .35rem .8rem; margin-bottom: .5rem; }
              .need-chip { display: inline-flex; align-items: center; gap: .3rem; font-size: .85rem; }
              .need-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
              .need-row input[type="text"] { flex: 1; min-width: 10rem; }
              .need-list { display: flex; flex-wrap: wrap; gap: .35rem; margin-top: .55rem; }
              .need-tag { display: inline-flex; align-items: center; gap: .3rem; border: 1px solid var(--cyan-28, rgba(53,208,224,.28)); padding: .15rem .5rem; font-size: .82rem; }
              .need-x { background: none; border: none; color: var(--red, #e0556a); cursor: pointer; font-size: 1rem; line-height: 1; padding: 0; }
            </style>
            <form method="post" action="${bp}/api/ops/${op.id}/needs/ships" class="need-block">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="need-h">${t("need.ships")} <span class="text-dim text-sm">${t("need.shipsHint")}</span>${helpIcon(t("need.shipsHelp"))}</div>
              <div class="need-chips">
                ${SHIP_TYPES.map(
                  (t) => html`<label class="need-chip"
                    ><input type="checkbox" name="shipType" value="${t.slug}" /> ${t.label}</label
                  >`,
                )}
              </div>
              <div class="need-row">
                <input type="text" name="details" maxlength="160" placeholder="${t("need.detailsOptional")}" />
                <button type="submit" class="btn btn-sm btn-green">${t("need.addShipNeeds")}</button>
              </div>
              ${shipNeeds.length
                ? html`<div class="need-list">
                    ${shipNeeds.map(
                      (n) => html`<span class="need-tag"
                        >${shipTypeLabel(n.shipType ?? "any")}
                        <button
                          type="submit"
                          formaction="${bp}/api/ops/${op.id}/needs/${n.id}/delete"
                          class="need-x"
                          title="${t("common.remove")}"
                        >
                          ×
                        </button></span
                      >`,
                    )}
                  </div>`
                : safe("")}
            </form>

            <form method="post" action="${bp}/api/ops/${op.id}/needs/fighters" class="need-block">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="need-h">${t("need.fighterSquads")} <span class="text-dim text-sm">${t("need.fighterHint")}</span>${helpIcon(t("need.fighterHelp"))}</div>
              <div class="need-row">
                <input type="number" name="count" min="0" max="50" value="${String(fighterCount)}" style="width:72px" />
                <span class="text-dim text-sm">${t("need.squads")}</span>
                <button type="submit" class="btn btn-sm">${t("common.save")}</button>
              </div>
            </form>

            <form method="post" action="${bp}/api/ops/${op.id}/needs/cqb" class="need-block">
              <input type="hidden" name="_csrf" value="${csrf}" />
              ${returnFields("fleet")}
              <div class="need-h">${t("need.cqbTeams")} <span class="text-dim text-sm">${t("need.cqbHint", { max: String(CQB_TEAM_MAX) })}</span>${helpIcon(t("need.cqbHelp"))}</div>
              <div class="need-row">
                <input type="number" name="count" min="0" max="50" value="${String(cqbCount)}" style="width:72px" />
                <span class="text-dim text-sm">${t("need.teamsX")}</span>
                <input type="number" name="size" min="1" max="${String(CQB_TEAM_MAX)}" value="${String(cqbSize)}" style="width:64px" />
                <span class="text-dim text-sm">${t("need.soldiers")}</span>
                <button type="submit" class="btn btn-sm">${t("common.save")}</button>
              </div>
            </form>
          </div>`
        : safe("")}
      <div class="opv2-stack">${compositionRows}</div>
    </section>
  </div>`;

  const adminPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("admin.opControl")}</div>
      <div class="opv2-actions">
        ${canManage
          ? html`<a href="${tabUrl("overview")}" class="btn btn-sm">${t("admin.editOverview")}</a>`
          : ""}
        ${canManage
          ? html`<form method="post" action="${bp}/ops/${op.id}/delete" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="btn btn-sm btn-danger"
                onclick="return confirm('${t("admin.confirmDeleteOp")}')"
              >
                ${t("common.delete")}
              </button>
            </form>`
          : safe("")}
      </div>
      <p class="text-dim text-sm mt-1">${t("admin.statusBarHint")}</p>
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("op.leaders")}</div>
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
                      <button type="submit" class="btn btn-sm btn-ghost">${t("common.remove")}</button>
                    </form>`
                  : safe("")}
              </div>`,
          )
        : html`<p class="text-dim text-sm">${t("admin.noLeaders")}</p>`}
      ${canManage
        ? html`<form method="post" action="${bp}/api/ops/${op.id}/leaders" class="opv2-form mt-1">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${returnFields("admin")}
            <div class="opv2-form-grid">
              <div>
                <label>${t("admin.addLeader")}</label>
                <select name="userId" required>
                  <option value="">${t("common.selectUser")}</option>
                  ${opts.assignableUsers.map(
                    (assignableUser) =>
                      html`<option value="${assignableUser.id}">
                        ${assignableUser.username} (${assignableUser.role})
                      </option>`,
                  )}
                </select>
              </div>
              <div>
                <label>${t("admin.role")}</label>
                <select name="leaderRole">
                  <option value="event_leader">${t("admin.roleEventLeader")}</option>
                  <option value="fleet_commander">${t("admin.roleFleetCommander")}</option>
                  <option value="raid_leader">${t("admin.roleRaidLeader")}</option>
                  <option value="wing_commander">${t("admin.roleWingCommander")}</option>
                </select>
              </div>
            </div>
            <button type="submit" class="btn btn-sm mt-1">${t("admin.addLeaderBtn")}</button>
          </form>`
        : safe("")}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("admin.askOperator")}</div>
      ${op.questions.length
        ? op.questions.map(
            (q) => html`<div class="opv2-row" style="display:block">
              <div><strong>${nm(q.asker)}:</strong> ${q.body}</div>
              ${q.answer
                ? html`<div class="text-sm" style="color:var(--green,#3ad07a);margin-top:4px">
                    ${t("admin.replyFrom")} <strong>${q.answeredBy}:</strong> ${q.answer}
                  </div>`
                : canManage
                  ? html`<form
                      method="post"
                      action="${bp}/ops/${op.id}/questions/${q.id}/answer"
                      class="opv2-form mt-1"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input name="answer" maxlength="1000" placeholder="${t("admin.answerPlaceholder")}" />
                      <button type="submit" class="btn btn-sm btn-green mt-1">${t("admin.answer")}</button>
                    </form>`
                  : html`<div class="text-dim text-sm" style="margin-top:4px">${t("admin.notAnswered")}</div>`}
            </div>`,
          )
        : html`<p class="text-dim text-sm">${t("admin.noQuestions")}</p>`}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("admin.auditLog")}</div>
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
        : html`<p class="text-dim text-sm">${t("admin.noAudit")}</p>`}
    </section>
  </div>`;

  // All tab panels are rendered; client-side JS toggles visibility so switching
  // a tab never reloads the page (no jump to top, no mobile scrollbar reflow).
  // The initially-active one is visible; the rest are [hidden].

  const guestBanner = !realUser
    ? html`<div
        class="flash flash-warn"
        style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap"
      >
        <span>${t("op.guestBanner")}</span>
        <a class="btn btn-sm btn-gold" href="${bp}/login">${t("op.signIn")}</a>
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
        ? html`<div class="opv2-cta done">${t("op.seatClaimed")}</div>`
        : hasCrewReq
          ? html`<div class="opv2-cta done">
              ${t("op.signupReceived")}
            </div>`
          : op.status === "open"
            ? html`<div class="opv2-cta">
                <div class="opv2-cta-h">${t("op.iWantToJoin")}</div>
                <div class="opv2-cta-actions">
                  <a class="btn btn-green" href="${bp}/ops/${op.id}">${t("op.join")}</a>
                  <a class="btn" href="${bp}/ops/${op.id}#open-seats">${t("op.chooseSeat")}</a>
                </div>
              </div>`
            : op.status === "locked"
              ? html`<div class="opv2-cta closed">
                  ${t("op.signupClosed")}
                </div>`
              : safe("");

  // ── Greenfield manage workspace: lifecycle spine + command rail ──────
  const minP = (op as { minParticipants?: number }).minParticipants ?? 0;
  const openSeatsTotal = shipSeatStats.open + fpsSeatStats.open;
  const unslottedAccepted = acceptedUnits.filter((u) => !u.requirementId).length;
  const unanswered = op.questions.filter((q) => !q.answer).length;
  const NEXT_STEP: Record<string, { to: string; label: string } | undefined> = {
    draft: { to: "open", label: t("mg.openSignups") },
    open: { to: "locked", label: t("mg.lockSignups") },
    locked: { to: "starting", label: t("mg.startPrebrief") },
    starting: { to: "in_progress", label: t("mg.markLive") },
    in_progress: { to: "completed", label: t("mg.completeOp") },
  };
  const nextStep = NEXT_STEP[op.status];
  const SPINE = [
    { key: "draft", label: t("mg.spineDraft") },
    { key: "open", label: t("mg.spineOpen") },
    { key: "locked", label: t("mg.spineLocked") },
    { key: "starting", label: t("mg.spineStarting") },
    { key: "in_progress", label: t("mg.spineLive") },
    { key: "completed", label: t("mg.spineDone") },
  ];
  const curIdx = SPINE.findIndex((s) => s.key === op.status);
  const statusSpine = html`<div class="mg-spine">
    ${op.status === "cancelled"
      ? html`<span class="mg-step active"><span class="dot"></span>${t("mg.cancelled")}</span>`
      : SPINE.map((s, i) => {
          const cls = i < curIdx ? "done" : i === curIdx ? "active" : "";
          return html`${i ? html`<span class="sep">›</span>` : safe("")}<span class="mg-step ${cls}"
              ><span class="dot"></span>${s.label}</span
            >`;
        })}
    <span style="flex:1"></span>
    <span class="text-dim text-sm">${fmtDate(op.scheduledAt, gtz)}</span>
  </div>`;
  const needs: Array<{ icon: string; label: string; tab: string }> = [];
  if (canManage && pendingUnits.length)
    needs.push({
      icon: "⚠",
      label: t("mg.needAcceptDecline", { n: pendingUnits.length }),
      tab: "overview",
    });
  if (canManage && unslottedAccepted)
    needs.push({
      icon: "⚠",
      label: t("mg.needAssignSlot", { n: unslottedAccepted }),
      tab: "overview",
    });
  if (openSeatsTotal)
    needs.push({
      icon: "⚠",
      label: t("mg.needFillSeats", { n: openSeatsTotal }),
      tab: "crew",
    });
  if (canManage && unanswered)
    needs.push({
      icon: "✉",
      label: t("mg.needAnswer", { n: unanswered }),
      tab: "admin",
    });
  const ready: Array<{ ok: boolean; label: string }> = [
    { ok: !!op.eventVoiceChannelId, label: t("mg.readyVoiceChannel") },
    { ok: op.leaders.length > 0, label: t("mg.readyLeaders", { n: op.leaders.length }) },
    { ok: opts.voiceEnabled === true, label: t("mg.readyVoiceEnabled") },
  ];
  if (minP > 0)
    ready.push({ ok: assignedSeats.length >= minP, label: t("mg.readyMinPlayers", { have: assignedSeats.length, min: minP }) });
  // Tabbed work area (attention-driven): which tab has open tasks → gold outline;
  // active tab is yellow. Default to the first attention tab so the operator
  // lands where action is needed.
  const tabAttn: Record<string, boolean> = {
    overview: canManage && (pendingUnits.length > 0 || unslottedAccepted > 0),
    fleet: false,
    crew: openSeatsTotal > 0 || crewWaiting > 0,
    voice: false,
    commanders: false,
    admin: !!user && unanswered > 0,
  };
  const tabDefs = [
    { id: "overview", label: t("tab.overview") },
    { id: "fleet", label: t("tab.fleet") },
    { id: "crew", label: t("op.participants") },
    { id: "voice", label: t("tab.voice") },
    // "Voice Access" (commanders) tab disabled while voice is reworked.
    ...(user ? [{ id: "admin", label: t("tab.admin") }] : []),
  ];
  const firstAttn = tabDefs.find((t) => tabAttn[t.id]);
  const mgActiveTab = tabDefs.some((t) => t.id === opts.tab)
    ? opts.tab!
    : firstAttn
      ? firstAttn.id
      : "overview";
  const mgTabPage = (id: string, panel: SafeHtml) =>
    html`<div class="mg-tabpage" data-tab="${id}" ${id === mgActiveTab ? safe("") : safe("hidden")}>
      ${panel}
    </div>`;
  const section = (id: string, title: string, panel: SafeHtml) =>
    html`<section class="mg-section" id="${id}"><h3>${title}</h3>${panel}</section>`;

  // Voice temporarily disabled in the GUI (containers stay up). The full
  // voicePanel/commandersPanel are kept defined below for a one-line revert;
  // we just render this notice instead. See RDOC-SUITE-MERGELOG 2026-06-08.
  const voiceReworkPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">${t("tab.voice")}</div>
      <div
        class="flash flash-warn"
        style="display:flex;align-items:center;gap:.75rem;flex-wrap:wrap"
      >
        <span
          ><strong>${t("op.voiceReworkTitle")}</strong>
          ${t("op.voiceReworkBody")}</span
        >
      </div>
    </section>
  </div>`;

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
            ${fmtDate(op.scheduledAt, gtz)} ${t("op.at")}
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
                <span class="text-dim text-sm">${t("op.view")}</span>
                <a class="active" href="${bp}/ops/${op.id}/manage?tab=${activeTab}">${t("op.operator")}</a>
                <a href="${bp}/ops/${op.id}">${t("op.playerSignup")}</a>
              </div>`
            : ""}
        </div>
      </header>

      <div class="opv2-metrics">
        ${metric(t("op.mShips"), shipUnits.length)}
        ${metric(
          t("op.mShipSeats"),
          `${shipSeatStats.filled}/${shipSeatStats.total}`,
          shipSeatStats.open ? "warn" : "good",
        )}
        ${metric(t("op.mCqbTeams"), cqbTeamGroups.length)}
        ${metric(
          t("op.mCqbSlots"),
          `${fpsSeatStats.filled}/${fpsSeatStats.total}`,
          fpsSeatStats.open ? "warn" : "good",
        )}
        ${metric(t("op.mPendingReview"), pendingUnits.length, pendingUnits.length ? "warn" : "")}
        ${metric(t("op.mFleetReq"), `${compositionFilled}/${compositionTotal}`)}
        ${metric(t("op.needAssignment"), crewWaiting, crewWaiting ? "warn" : "")}
        ${
          op.eventInterests.length
            ? metric(
                t("op.mDiscordInterested"),
                `${op.eventInterests.filter((i) => i.userId).length}+${op.eventInterests.filter((i) => !i.userId).length}?`,
              )
            : safe("")
        }
      </div>

      ${statusSpine}

      <div class="mg-2col">
        <aside class="mg-rail">
          ${canManage && nextStep
            ? html`<div class="mg-card mg-next">
                <h4>${t("mg.nextStepTitle")}</h4>
                <form method="post" action="${bp}/api/ops/${op.id}/status">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <input type="hidden" name="status" value="${nextStep.to}" />
                  ${returnFields("overview")}
                  <button type="submit" class="btn btn-green">${nextStep.label}</button>
                </form>
              </div>`
            : safe("")}
          <div class="mg-card mg-needs">
            <h4>${t("mg.openTasks")}</h4>
            ${needs.length
              ? needs.map(
                  (n) =>
                    html`<a href="#" data-jump="${n.tab}"><span>${n.icon}</span><span>${n.label}</span></a>`,
                )
              : html`<p class="text-dim text-sm">${t("mg.allClear")}</p>`}
          </div>
          <div class="mg-card mg-ready">
            <h4>${t("mg.readiness")}</h4>
            ${ready.map(
              (r) => html`<div>
                <span style="color:${r.ok ? "var(--green,#3ad07a)" : "var(--gold,#e0b835)"}"
                  >${r.ok ? "✓" : "⚠"}</span
                ><span>${r.label}</span>
              </div>`,
            )}
          </div>
          ${canManage
            ? html`<div class="mg-card">
                <h4>${t("mg.missionCover")}</h4>
                <a class="btn btn-sm" href="${bp}/ops/${op.id}/cover">${t("mg.coverCreateEdit")}</a>
              </div>`
            : safe("")}
          ${canManage && op.recurrence
            ? html`<div class="mg-card">
                <h4>${t("mg.recurringSeries")}</h4>
                <p class="text-dim text-sm">
                  ${op.recurrence.freq === "weekly"
                    ? t("mg.repeatsWeekly")
                    : op.recurrence.freq === "biweekly"
                      ? t("mg.repeatsBiweekly")
                      : op.recurrence.freq === "monthly_nth"
                        ? t("mg.repeatsMonthly")
                        : op.recurrence.freq === "yearly"
                          ? t("mg.repeatsYearly")
                          : t("mg.recurring")}${op.recurrence.active ? "" : ` ${t("mg.stopped")}`}. ${t("mg.eachOccurrence")}
                </p>
                ${op.recurrence.active
                  ? html`<form method="post" action="${bp}/ops/${op.id}/recurrence/stop">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <button
                        type="submit"
                        class="btn btn-sm"
                        onclick="return confirm('${t("mg.confirmStopSeries")}')"
                      >
                        ${t("mg.stopSeries")}
                      </button>
                    </form>`
                  : safe("")}
              </div>`
            : safe("")}
          ${canManage
            ? html`<details class="mg-card">
                <summary style="cursor:pointer;color:var(--dim);font-size:.85rem">${t("admin.confirmDeleteOpTitle")}</summary>
                <form method="post" action="${bp}/ops/${op.id}/delete" style="margin-top:.6rem">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <button
                    type="submit"
                    class="btn btn-sm btn-danger"
                    onclick="return confirm('${t("admin.confirmDeleteOp")}')"
                  >
                    ${t("common.delete")}
                  </button>
                </form>
              </details>`
            : safe("")}
        </aside>
        <div class="mg-work">
          ${actionDetailsPanel}
          <div class="mg-tabs" role="tablist">
            ${tabDefs.map(
              (t) => html`<button
                type="button"
                class="mg-tab${t.id === mgActiveTab ? " active" : ""}${tabAttn[t.id] ? " attn" : ""}"
                data-tab="${t.id}"
              >
                ${t.label}${tabAttn[t.id] ? html`<span class="mg-tab-dot"></span>` : safe("")}
              </button>`,
            )}
          </div>
          ${mgTabPage("overview", overviewPanel)} ${mgTabPage("fleet", fleetPanel)}
          ${mgTabPage("crew", crewPanel)} ${mgTabPage("voice", voiceReworkPanel)}
          ${user ? mgTabPage("admin", adminPanel) : safe("")}
        </div>
      </div>
    </div>
    <script>
      (function () {
        const work = document.querySelector(".mg-work");
        if (!work) return;
        let currentTab = ${safe(JSON.stringify(mgActiveTab))};
        function opv2EscHtml(s) {
          return String(s)
            .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
        }
        function activate(name) {
          if (!name) return;
          currentTab = name;
          work.querySelectorAll(".mg-tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
          work.querySelectorAll(".mg-tabpage").forEach((p) => { p.hidden = p.dataset.tab !== name; });
          try { history.replaceState(null, "", "?tab=" + encodeURIComponent(name)); } catch (_) {}
        }
        // (Re)bind per-element behaviour inside the work area — called at init
        // and again after every AJAX swap (the swapped DOM has fresh elements).
        function bindWork() {
          work.querySelectorAll(".mg-tab").forEach((tab) =>
            tab.addEventListener("click", () => activate(tab.dataset.tab)),
          );
          let opv2DraggedCrewUserId = "";
      work.querySelectorAll(".opv2-form").forEach((form) => {
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
                missing.push("${safe(t("op.valShip"))}");
                markBad(ownedShipSelect, true);
                markBad(shipSearch, true);
              }
            } else {
              if (!squadName || !squadName.value.trim()) {
                missing.push("${safe(t("op.squadName"))}");
                markBad(squadName, true);
              }
              if (!squadSize || !squadSize.value) {
                missing.push("${safe(t("op.squadSize"))}");
                markBad(squadSize, true);
              }
            }
            if (missing.length > 0) {
              e.preventDefault();
              if (errBox) {
                errBox.textContent = "${safe(t("op.pleaseFill"))} " + missing.join(", ") + ".";
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
      work.querySelectorAll("[data-crew-user-id]").forEach((chip) => {
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
      work.querySelectorAll("[data-drop-seat]").forEach((seat) => {
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
          const form = work.querySelector('[data-seat-assign-form="' + seatId + '"]');
          const input = form ? form.querySelector('input[name="userId"]') : null;
          if (!form || !input || !userId) return;
          input.value = userId;
          form.requestSubmit();
        });
      });
        } // end bindWork

        // AJAX action posts inside the work area: swap only .mg-work, keep the
        // current tab — no full-page reload. status/delete forms full-reload
        // (they change the spine/rail which live OUTSIDE the work area).
        work.addEventListener("submit", async (e) => {
          const form = e.target;
          if (!(form instanceof HTMLFormElement)) return;
          if (e.defaultPrevented) return; // a per-form validator blocked it
          if (/\\/(status|delete)$/.test(form.action)) return; // full reload
          e.preventDefault();
          const submitBtn = form.querySelector('button[type="submit"], input[type="submit"]');
          if (submitBtn) submitBtn.disabled = true;
          try {
            const res = await fetch(form.action, {
              method: form.method || "post",
              body: new FormData(form),
              headers: { "X-Requested-With": "fetch" },
            });
            if (!res.ok) { form.submit(); return; }
            const txt = await res.text();
            const doc = new DOMParser().parseFromString(txt, "text/html");
            const fresh = doc.querySelector(".mg-work");
            if (!fresh) { window.location.href = res.url || form.action; return; }
            work.innerHTML = fresh.innerHTML;
            bindWork();
            activate(currentTab);
            const fl = doc.querySelector(".flash");
            if (fl) {
              fl.classList.add("mg-flash");
              work.insertBefore(fl, work.firstChild);
              setTimeout(() => fl.remove(), 3500);
            }
          } catch (_) {
            form.submit();
          }
        });

        // Rail "Open tasks" links jump to the relevant tab (no reload).
        document.querySelectorAll("[data-jump]").forEach((a) =>
          a.addEventListener("click", (e) => {
            e.preventDefault();
            activate(a.dataset.jump);
            work.scrollIntoView({ behavior: "smooth", block: "start" });
          }),
        );

        bindWork();
        activate(currentTab);
      })();
    </script>`;

  const { WEB_PUBLIC_URL } = getEnv();
  // Share embed (OpenGraph). Discord renders og:description with newlines, so we
  // pack the structured op details (When / System / Rendezvous / Leaders / Voice
  // / Org / Discord) as one multiline block — mirrors the Action Details panel.
  const ogLeaders = op.leaders.length
    ? op.leaders.map((l) => l.user.username).join(", ")
    : t("op.none");
  const ogOrg = opts.orgName?.trim() || opts.guildName;
  const ogLines = [
    `🕗 ${t("op.fldWhen")}: ${fmtDate(op.scheduledAt, gtz)}`,
    `🌌 ${t("op.fldSystem")}: ${systemLabel(op.meetingSystem ?? "stanton")}`,
    `📍 ${t("op.fldRendezvous")}: ${op.meetingLocation || t("op.notSet")}`,
    `👥 ${t("op.leaders")}: ${ogLeaders}`,
    `🔊 ${t("op.eventVoice")}: ${eventVoiceName}`,
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
  unmatched?: string[];
  currentLocale: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const unmatched = opts.unmatched ?? [];

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
              onclick="return confirm('${t("profile.confirmRemoveShip")}')"
            >
              ${t("common.remove")}
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
          ? html`<span class="tag tag-green">${t("profile.owned")}</span>`
          : html` <form method="post" action="${bp}/profile/ships" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="shipId" value="${ship.id}" />
              <button type="submit" class="btn btn-sm">${t("common.add")}</button>
            </form>`}
      </td>
    </tr>`;
  });

  const body = html` <div class="page-header">
      <h1 class="page-title">${t("profile.title")}</h1>
      <p class="page-subtitle">${opts.currentUser.username} // ${opts.currentUser.role}</p>
    </div>

    <div class="section">
      <div class="section-title">${t("profile.language.title")}</div>
      <form method="post" action="${bp}/profile/locale" style="display:flex;gap:.6rem;align-items:center;flex-wrap:wrap">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <select name="locale" style="max-width:16rem">
          ${LOCALES.map(
            (loc) =>
              html`<option value="${loc}" ${loc === opts.currentLocale ? safe("selected") : ""}>
                ${LOCALE_NAMES[loc]}
              </option>`,
          )}
        </select>
        <button type="submit" class="btn btn-sm">${t("profile.language.save")}</button>
      </form>
      <p class="text-dim text-sm" style="margin-top:.4rem">${t("profile.language.help")}</p>
    </div>

    <div class="section">
      <div class="section-title">${t("profile.importFleet")}</div>
      <details>
        <summary style="cursor:pointer;color:var(--cyan,#35d0e0)">
          ${t("profile.importSummary")}
        </summary>
        <form method="post" action="${bp}/profile/fleet-import" style="margin-top:.6rem">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <p class="text-dim text-sm">
            ${safe(t("profile.importFormat"))}
          </p>
          <textarea
            name="fleetJson"
            rows="8"
            style="width:100%;box-sizing:border-box;font-family:var(--font-mono)"
            placeholder='[{"name":"600i Explorer","shipname":"Libertalia","type":"ship"},{"name":"Carrack Expedition","shipname":"Heureka","type":"ship"}]'
          ></textarea>
          <p class="text-dim text-sm">
            ${t("profile.importNote")}
          </p>
          <button type="submit" class="btn btn-sm btn-green">${t("profile.importShips")}</button>
        </form>
      </details>
    </div>

    ${unmatched.length
      ? html`<div class="section" id="resolve-section">
          <div class="section-title">${t("profile.unmatchedTitle", { n: unmatched.length })}</div>
          <p class="text-dim text-sm">
            ${t("profile.unmatchedHelp")}
          </p>
          <style>
            .resolve-row { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; padding: .45rem 0; border-bottom: 1px solid rgba(255,255,255,.06); }
            .resolve-name { font-weight: 600; min-width: 11rem; }
            .resolve-search { flex: 1; min-width: 12rem; }
            .resolve-results { flex-basis: 100%; }
          </style>
          ${unmatched.map(
            (name) => html`<div class="resolve-row">
              <span class="resolve-name">${name}</span>
              <input
                type="search"
                class="resolve-search"
                placeholder="${t("profile.searchShipDb")}"
                autocomplete="off"
              />
              <div class="ship-results resolve-results"></div>
              <form method="post" action="${bp}/profile/ships" class="resolve-assign inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="shipId" class="resolve-shipid" />
                <button type="submit" class="btn btn-sm btn-green" disabled>${t("common.assign")}</button>
              </form>
              <button type="button" class="btn btn-sm btn-ghost resolve-skip">${t("profile.skip")}</button>
            </div>`,
          )}
          <script>
            (function () {
              const sec = document.getElementById("resolve-section");
              if (!sec) return;
              const esc = (s) =>
                String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
              sec.querySelectorAll(".resolve-row").forEach((row) => {
                const search = row.querySelector(".resolve-search");
                const results = row.querySelector(".resolve-results");
                const hidden = row.querySelector(".resolve-shipid");
                const btn = row.querySelector(".resolve-assign button");
                let timer;
                row.querySelector(".resolve-skip").addEventListener("click", () => row.remove());
                search.addEventListener("input", () => {
                  clearTimeout(timer);
                  hidden.value = "";
                  btn.disabled = true;
                  btn.textContent = "${safe(t("common.assign"))}";
                  const q = search.value.trim();
                  if (q.length < 2) { results.innerHTML = ""; return; }
                  timer = setTimeout(async () => {
                    const res = await fetch("${bp}/api/ships?q=" + encodeURIComponent(q));
                    const ships = await res.json();
                    results.innerHTML = ships
                      .map(
                        (s) =>
                          '<button type="button" class="ship-row" data-id="' + esc(s.id) +
                          '" data-name="' + esc(s.name) + '"><strong>' + esc(s.name) +
                          "</strong><span>" + esc(s.manufacturer || "") + " // " + esc(s.size || "") +
                          "</span></button>",
                      )
                      .join("");
                  }, 180);
                });
                results.addEventListener("click", (e) => {
                  const el = e.target.closest(".ship-row");
                  if (!el) return;
                  results.querySelectorAll(".ship-row").forEach((r) => r.classList.remove("selected"));
                  el.classList.add("selected");
                  hidden.value = el.dataset.id || "";
                  search.value = el.dataset.name || "";
                  btn.disabled = false;
                  btn.textContent = "${safe(t("common.assign"))} " + (el.dataset.name || "");
                });
              });
            })();
          </script>
        </div>`
      : safe("")}

    <div class="section">
      <div class="section-title">${t("profile.ownedShips", { n: opts.ownedShips.length })}</div>
      ${opts.ownedShips.length
        ? html` <style>
              #owned-table th[data-col] { cursor: pointer; user-select: none; white-space: nowrap; }
              #owned-table th[data-col]:hover { color: var(--cyan, #35d0e0); }
              #owned-table th[data-dir]::after { content: " " attr(data-dir); color: var(--cyan, #35d0e0); }
            </style>
            <div style="overflow-x:auto">
            <table id="owned-table">
              <thead>
                <tr>
                  <th data-col="0" data-type="text">${t("profile.colShip")}</th>
                  <th data-col="1" data-type="text">${t("profile.colNickname")}</th>
                  <th data-col="2" data-type="text">${t("profile.colManufacturer")}</th>
                  <th data-col="3" data-type="size">${t("profile.colSize")}</th>
                  <th data-col="4" data-type="text">${t("profile.colCareer")}</th>
                  <th data-col="5" data-type="text">${t("profile.colRole")}</th>
                  <th class="text-right" data-col="6" data-type="num">${t("profile.colCrew")}</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                ${ownedRows}
              </tbody>
            </table>
            </div>
            <script>
              (function () {
                const t = document.getElementById("owned-table");
                if (!t) return;
                const tb = t.querySelector("tbody");
                const rank = { small: 1, medium: 2, large: 3, capital: 4, vehicle: 5 };
                let lastCol = -1, asc = true;
                t.querySelectorAll("th[data-col]").forEach((th) => {
                  th.addEventListener("click", () => {
                    const col = +th.dataset.col, type = th.dataset.type || "text";
                    asc = lastCol === col ? !asc : true;
                    lastCol = col;
                    const rows = Array.prototype.slice.call(tb.querySelectorAll("tr"));
                    rows.sort((a, b) => {
                      let x = a.children[col].textContent.trim();
                      let y = b.children[col].textContent.trim();
                      if (type === "num") { x = parseInt(x, 10) || 0; y = parseInt(y, 10) || 0; return asc ? x - y : y - x; }
                      if (type === "size") { x = rank[x.toLowerCase()] || 0; y = rank[y.toLowerCase()] || 0; return asc ? x - y : y - x; }
                      return asc ? x.localeCompare(y) : y.localeCompare(x);
                    });
                    rows.forEach((r) => tb.appendChild(r));
                    t.querySelectorAll("th[data-col]").forEach((h) => h.removeAttribute("data-dir"));
                    th.setAttribute("data-dir", asc ? "▲" : "▼");
                  });
                });
              })();
            </script>`
        : html`<p class="text-dim text-sm">
            ${t("profile.noShipsYet")}
          </p>`}
    </div>

    <div class="section">
      <div class="section-title">${t("profile.addShip")}</div>
      <form method="get" action="${bp}/profile" class="flex gap-1 mb-2" style="flex-wrap:wrap">
        <input
          type="search"
          name="q"
          value="${opts.query}"
          placeholder="${t("profile.searchShipName")}"
          style="max-width:24rem"
        />
        <button type="submit" class="btn btn-sm">${t("profile.search")}</button>
        ${opts.query ? html`<a href="${bp}/profile" class="btn btn-sm btn-ghost">${t("profile.clear")}</a>` : ""}
      </form>
      ${opts.query
        ? opts.searchResults.length
          ? html` <div style="overflow-x:auto">
              <table>
                <thead>
                  <tr>
                    <th>${t("profile.colShip")}</th>
                    <th>${t("profile.colManufacturer")}</th>
                    <th>${t("profile.colSize")}</th>
                    <th>${t("profile.colCareer")}</th>
                    <th>${t("profile.colRole")}</th>
                    <th class="text-right">${t("profile.colCrew")}</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  ${resultRows}
                </tbody>
              </table>
            </div>`
          : html`<p class="text-dim text-sm">${t("profile.noShipsFound")}</p>`
        : html`<p class="text-dim text-sm">${t("profile.searchToAdd")}</p>`}
    </div>`;

  return layout({
    title: t("profile.title"),
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
      <h1 class="page-title">${op ? t("opf.editTitle") : t("opf.newTitle")}</h1>
    </div>
    <div class="card">
      <form method="post" action="${action}" id="op-form" novalidate>
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="form-errors" id="op-form-errors" hidden></div>
        ${!op && opts.operatorGuilds && opts.operatorGuilds.length > 0
          ? html` <div class="form-group">
              <label>${t("opf.server")} <span class="req" title="${t("common.required")}">*</span></label>
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
                      <option value="">${t("opf.selectServer")}</option>
                      ${opts.operatorGuilds.map(
                        (g) => html`<option value="${g.id}">${g.name}</option>`,
                      )}
                    </select>`}
            </div>`
          : safe("")}
        <div class="form-group">
          <label>${t("opf.opTitle")} <span class="req" title="${t("common.required")}">*</span></label>
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
            <label>${t("opf.scheduledAt", { tz: gtz })} <span class="req" title="${t("common.required")}">*</span></label>
            <input
              type="datetime-local"
              name="scheduledAt"
              value="${op ? fmtDateLocal(op.scheduledAt, gtz) : ""}"
              required
            />
          </div>
          <div class="form-group">
            <label>${t("opf.opType")}</label>
            <select name="opType">
              ${opTypes.map(
                (ot) =>
                  html`<option value="${ot}" ${op?.opType === ot ? safe(" selected") : ""}>
                    ${opTypeText(ot)}
                  </option>`,
              )}
            </select>
          </div>
          ${!op
            ? html`<div class="form-group">
                <label>${t("vis.aria")}</label>
                <select name="visibility">
                  <option value="private" selected>🔒 ${t("vis.private.long")}</option>
                  <option value="partners">🤝 ${t("vis.partners.long")}</option>
                  <option value="public">🌐 ${t("vis.public.long")}</option>
                </select>
              </div>`
            : safe("")}
          <div class="form-group">
            <label>${t("opf.meetingSystem")}</label>
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
            <label>${t("opf.meetingLocation")}</label>
            <select name="meetingLocationSlug" id="meeting-location-select">
              <option value="" data-system="">${t("opf.selectLocation")}</option>
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
          <label>${t("op.fldDescription")}</label>
          <textarea name="description" placeholder="${t("opf.descPlaceholder")}">
${op?.description ?? ""}</textarea
          >
        </div>
        ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
          ? html` <div class="form-group">
              <label
                >${t("op.eventVoiceChannel")}
                <span style="font-weight:normal;opacity:.65"
                  >${t("op.eventVoiceChannelHint")}</span
                ></label
              >
              <select name="eventVoiceChannelId">
                <option value="">${t("opf.noVoiceChannelDash")}</option>
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
          <button type="submit" class="btn">${op ? t("opf.saveChanges") : t("opf.createOp")}</button>
          <a href="${op ? `${bp}/ops/${op.id}` : `${bp}/`}" class="btn btn-ghost">${t("common.cancel")}</a>
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
            "${safe(t("opf.selectLocPre"))}" +
            meetingSystemSelect.options[meetingSystemSelect.selectedIndex].text +
            "${safe(t("opf.selectLocPost"))}";
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
              "${safe(t("opf.fillRequired"))} " +
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
    title: op ? `${t("common.edit")}: ${op.title}` : t("opf.newTitleTab"),
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
  guildTextChannels?: Array<{ id: string; name: string }>;
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
  const steps = [
    t("wiz.stepBasics"),
    t("wiz.stepBriefing"),
    t("wiz.stepDiscord"),
    t("wiz.stepFleetReq"),
    t("wiz.stepReview"),
    t("wiz.stepShare"),
  ];

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
      .wiz-md-help { margin-top: .6rem; }
      .wiz-md-help summary { cursor: pointer; color: var(--cyan, #35d0e0); font-size: .82rem; }
      .wiz-md-cheat { width: 100%; margin-top: .5rem; border-collapse: collapse; font-size: .82rem; }
      .wiz-md-cheat td { padding: .25rem .5rem; border-bottom: 1px solid rgba(255,255,255,.05); }
      .wiz-md-cheat td:first-child { white-space: nowrap; color: var(--dim, #9fb0bd); }
      .wiz-md-cheat code { font-family: var(--font-mono, monospace); background: rgba(255,255,255,.06); padding: .05rem .3rem; border-radius: 3px; }
      .wiz-rev-block { margin-top: 1.1rem; padding-top: .85rem; border-top: 1px solid rgba(255,255,255,.08); }
      .wiz-rev-h { font-weight: 700; margin-bottom: .5rem; }
      .wiz-rev-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: .3rem; }
      .wiz-rev-list li { display: flex; justify-content: space-between; gap: 1rem; padding: .35rem .5rem; background: rgba(255,255,255,.02); border: 1px solid rgba(255,255,255,.06); }
      .wiz-rev-list b { color: var(--cyan, #35d0e0); white-space: nowrap; }
      .wiz-rev-md { white-space: pre-wrap; line-height: 1.55; font-size: .9rem; color: var(--text, #cdd9e1); }
      .wiz-rev-empty { color: var(--dim, #7a8a96); font-size: .85rem; }
      @media (max-width: 1100px) {
        .wiz-layout { grid-template-columns: 1fr; }
        .wiz-rail ol { flex-direction: row; flex-wrap: wrap; }
        .wiz-rail-hint { display: none; }
      }
    </style>
    <div class="page-header"><h1 class="page-title">${t("wiz.createEvent")}</h1></div>
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
            ${t("wiz.railHint")}
          </p>
        </aside>

        <div class="wiz-main">
          <div class="form-errors" id="wiz-errors" hidden></div>

          <section class="wiz-step card" data-step="0">
            <h3 class="wiz-sum-h">${t("wiz.stepBasics")}</h3>
            ${opts.operatorGuilds && opts.operatorGuilds.length > 0
              ? html` <div class="form-group">
                  <label>${t("opf.server")} <span class="req" title="${t("common.required")}">*</span></label>
                  ${selectedOperatorGuild
                    ? html`<input type="hidden" name="guildId" value="${selectedOperatorGuild.id}" />
                        <div class="guild-selected-badge">${selectedOperatorGuild.name}</div>`
                    : opts.operatorGuilds.length === 1
                      ? html`<input type="hidden" name="guildId" value="${opts.operatorGuilds[0].id}" />
                          <div class="guild-selected-badge">${opts.operatorGuilds[0].name}</div>`
                      : html`<select name="guildId" required class="guild-picker-select-form">
                          <option value="">${t("opf.selectServer")}</option>
                          ${opts.operatorGuilds.map(
                            (g) => html`<option value="${g.id}">${g.name}</option>`,
                          )}
                        </select>`}
                </div>`
              : safe("")}
            <div class="form-group">
              <label>${t("wiz.eventName")} <span class="req" title="${t("common.required")}">*</span></label>
              <input type="text" name="title" required placeholder="Operation Darkstar" />
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>${t("wiz.startTime", { tz: gtz })} <span class="req" title="${t("common.required")}">*</span></label>
                <input type="datetime-local" name="scheduledAt" required />
              </div>
              <div class="form-group">
                <label>${t("wiz.missionType")}</label>
                <select name="opType">
                  ${opTypes.map((ot) => html`<option value="${ot}">${opTypeText(ot)}</option>`)}
                </select>
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label>${t("wiz.repeat")}</label>
                <select name="recurFreq">
                  <option value="">${t("wiz.repeatNever")}</option>
                  <option value="weekly">${t("wiz.repeatWeekly")}</option>
                  <option value="biweekly">${t("wiz.repeatBiweekly")}</option>
                  <option value="monthly_nth">${t("wiz.repeatMonthly")}</option>
                  <option value="yearly">${t("wiz.repeatYearly")}</option>
                </select>
              </div>
              <div class="form-group">
                <label>${t("wiz.endsAfter")} <span style="font-weight:normal;opacity:.65">${t("wiz.optional")}</span></label>
                <input type="number" name="recurCount" min="1" max="365" placeholder="${t("wiz.nOccurrences")}" />
              </div>
              <div class="form-group">
                <label>${t("wiz.orUntil")} <span style="font-weight:normal;opacity:.65">${t("wiz.optional")}</span></label>
                <input type="date" name="recurUntil" />
              </div>
            </div>
            <p class="text-dim text-sm" style="margin:-4px 0 4px">
              ${t("wiz.recurNote")}
            </p>
            <div class="form-row">
              <div class="form-group">
                <label>${t("opf.meetingSystem")}</label>
                <select name="meetingSystem" id="meeting-system-select">
                  ${SYSTEMS.map((s) => html`<option value="${s}">${systemLabel(s)}</option>`)}
                </select>
              </div>
              <div class="form-group">
                <label>${t("op.fldRendezvous")}</label>
                <select name="meetingLocationSlug" id="meeting-location-select">
                  <option value="" data-system="">${t("opf.selectLocation")}</option>
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
              <label>${t("vis.aria")}</label>
              <select name="visibility">
                <option value="private" selected>🔒 ${t("vis.private.long")}</option>
                <option value="partners">🤝 ${t("vis.partners.long")}</option>
                <option value="public">🌐 ${t("vis.public.long")}</option>
              </select>
            </div>
          </section>

          <section class="wiz-step card" data-step="1" hidden>
            <div
              class="form-group"
              style="display:flex;align-items:center;justify-content:space-between;gap:8px"
            >
              <label style="margin:0"
                >${t("op.briefing")} <span style="font-weight:normal;opacity:.65">(Markdown)</span></label
              >
              <button type="button" class="btn btn-sm btn-ghost" id="wiz-md-toggle">${t("wiz.preview")}</button>
            </div>
            <textarea
              name="description"
              id="wiz-md"
              rows="12"
              placeholder="## Mission Objective&#10;…&#10;&#10;## RoE&#10;…&#10;&#10;## Equipment&#10;…"
            ></textarea>
            <div class="wiz-md-prev" id="wiz-md-prev" hidden></div>
            <details class="wiz-md-help">
              <summary>${t("wiz.mdHelp")}</summary>
              <table class="wiz-md-cheat">
                <tr><td><code>## Heading</code></td><td>${t("wiz.mdSectionTitle")}</td></tr>
                <tr><td><code>### Subheading</code></td><td>${t("wiz.mdSmallerTitle")}</td></tr>
                <tr><td><code>**bold**</code></td><td><b>${t("wiz.mdBold")}</b></td></tr>
                <tr><td><code>*italic*</code></td><td><i>${t("wiz.mdItalic")}</i></td></tr>
                <tr><td><code>&#96;code&#96;</code></td><td>${t("wiz.mdMonospace")}</td></tr>
                <tr><td><code>- item</code></td><td>${t("wiz.mdBulletList")}</td></tr>
                <tr><td><code>[label](https://…)</code></td><td>${t("wiz.mdLink")}</td></tr>
                <tr><td>${t("wiz.mdEmptyLine")}</td><td>${t("wiz.mdNewParagraph")}</td></tr>
              </table>
            </details>
          </section>

          <section class="wiz-step card" data-step="2" hidden>
            <h3 class="wiz-sum-h">${t("wiz.stepDiscord")}</h3>
            ${opts.guildVoiceChannels && opts.guildVoiceChannels.length > 0
              ? html` <div class="form-group">
                  <label
                    >${t("wiz.eventVoiceChannel")}
                    <span style="font-weight:normal;opacity:.65">${t("wiz.optionalShort")}</span></label
                  >
                  <select name="eventVoiceChannelId">
                    <option value="">${t("op.noneDash")}</option>
                    ${opts.guildVoiceChannels.map(
                      (ch) => html`<option value="${ch.id}">${ch.name}</option>`,
                    )}
                  </select>
                </div>`
              : html`<p class="text-dim text-sm">${t("wiz.noVoiceChannels")}</p>`}
            <p class="wiz-rail-hint" style="margin-top:10px">
              ${t("wiz.announceHint")}
            </p>
          </section>

          <section class="wiz-step card" data-step="3" hidden>
            <div
              class="form-group"
              style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px"
            >
              <h3 class="wiz-sum-h" style="margin:0">${t("wiz.stepFleetReq")}</h3>
              <select id="wiz-tpl" class="guild-picker-select-form" style="max-width:230px">
                <option value="">${t("wiz.loadTemplate")}</option>
                ${COMPOSITION_TEMPLATES.map((tpl, i) => html`<option value="${i}">${tpl.name}</option>`)}
              </select>
            </div>
            <p class="wiz-rail-hint" style="margin:0 0 12px">
              ${t("wiz.fleetReqHint")}
            </p>
            <div id="wiz-comp-rows"></div>
            <button type="button" class="btn btn-sm btn-ghost" id="wiz-comp-add" style="margin-top:8px">
              + ${t("wiz.addRequirement")}
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

          <section class="wiz-step card" data-step="5" hidden>
            <h3 class="wiz-sum-h">Share to Discord</h3>
            <p class="wiz-rail-hint" style="margin:0 0 12px">
              Optional: post an announcement (title, time, link) to a Discord channel right after creating.
            </p>
            ${opts.guildTextChannels && opts.guildTextChannels.length > 0
              ? html`<div class="form-group">
                  <label>Channel</label>
                  <select name="shareChannelId">
                    <option value="">— don't share —</option>
                    ${opts.guildTextChannels.map(
                      (c) => html`<option value="${c.id}">#${c.name}</option>`,
                    )}
                  </select>
                </div>`
              : html`<p class="text-dim text-sm">
                  No text channels available — the bot isn't in this server or lacks permission.
                </p>`}
          </section>
        </div>

        <aside class="wiz-aside card">
          <div class="wiz-aside-h">✓ Ready to Open</div>
          <ul class="wiz-ready" id="wiz-ready"></ul>
          <div class="wiz-sum-h">Summary</div>
          <dl class="wiz-sum" id="wiz-summary"></dl>
          <label class="wiz-opt" id="wiz-cover-opt" style="display:flex;gap:.5rem;align-items:center;margin:.4rem 0;font-size:.85rem;color:var(--dim)">
            <input type="checkbox" name="openCover" value="1" />
            Mission-Cover nach dem Erstellen öffnen (optional)
          </label>
          <div class="wiz-aside-actions">
            <button type="button" class="btn btn-ghost" id="wiz-back" hidden>‹ Back</button>
            <button type="button" class="btn btn-green" id="wiz-next">Continue ›</button>
            <button type="submit" class="btn btn-green" id="wiz-submit" hidden>Create Event</button>
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
        // NOTE: initial filterLoc() is called at the END of this IIFE — it
        // transitively reads consts (summary/ready/review) declared further
        // down, so calling it here would hit a temporal-dead-zone ReferenceError
        // and kill every handler below (Continue/Back/templates).

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
        // Full pre-publish recap (Review step): facts + participants + fleet
        // requirements + briefing preview — not just the aside's 7 facts.
        function renderReview() {
          const minP = parseInt(val("minParticipants") || "0", 10) || 0;
          const maxEl = document.querySelector('[name="maxParticipants"]');
          const maxP = maxEl && maxEl.value ? parseInt(maxEl.value, 10) : 0;
          const part = minP > 0 ? "min " + minP : "no minimum";
          const partStr = part + (maxP > 0 ? " / max " + maxP : "");
          let comp = [];
          try { comp = JSON.parse((compJsonEl && compJsonEl.value) || "[]"); } catch (_) {}
          const mdVal = (document.getElementById("wiz-md") || {}).value || "";
          const facts = rows()
            .map((r) => "<dt>" + r[0] + "</dt><dd>" + esc(r[1]) + "</dd>")
            .join("") + "<dt>Participants</dt><dd>" + esc(partStr) + "</dd>";
          const reqHtml = comp.length
            ? '<ul class="wiz-rev-list">' +
              comp
                .map(
                  (r) =>
                    "<li><span>" + esc((CATLBL[r.category] || r.category) + " — " + r.label) +
                    "</span><b>×" + esc(r.count) + "</b></li>",
                )
                .join("") +
              "</ul>"
            : '<p class="wiz-rev-empty">No fleet requirements added.</p>';
          const briefHtml = mdVal.trim()
            ? '<div class="wiz-rev-md">' + renderMd(mdVal) + "</div>"
            : '<p class="wiz-rev-empty">No briefing written.</p>';
          review.innerHTML =
            '<dl class="wiz-sum">' + facts + "</dl>" +
            '<div class="wiz-rev-block"><div class="wiz-rev-h">Fleet Requirements</div>' + reqHtml + "</div>" +
            '<div class="wiz-rev-block"><div class="wiz-rev-h">Briefing</div>' + briefHtml + "</div>";
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
          renderReview();
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
            .replace(/^###\\s+(.*)$/gm, "<h5>$1</h5>")
            .replace(/^##\\s+(.*)$/gm, "<h4>$1</h4>")
            .replace(/^#\\s+(.*)$/gm, "<h3>$1</h3>")
            .replace(/^[-*]\\s+(.*)$/gm, "&bull; $1")
            .replace(/\\*\\*([^*]+?)\\*\\*/g, "<b>$1</b>")
            .replace(/\\[([^\\]]+?)\\]\\((https?:\\/\\/[^\\s)]+)\\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
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
        // Only the final Review step may actually submit. Enter / any earlier
        // submit advances the wizard instead of creating the op prematurely.
        form.addEventListener("submit", (e) => {
          if (cur < sections.length - 1) {
            e.preventDefault();
            if (validate(cur)) { cur++; show(cur); }
          }
        });

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
        filterLoc();
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
  publicUrl?: string;
  discordInvite?: string | null;
  /** FR-P1 step 6: normalized-ship-name → Fleetyards silhouette URL, shown big
   *  in the join wizard's seat step. Built in the route via `silhouettesFor`. */
  shipSilhouettes?: Record<string, string>;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const csrf = opts.csrfToken ?? "";
  const myId = opts.currentUser?.id;
  // Guests (not signed in) never see other members' names (privacy — the guest
  // banner promises this). Signed-in members do.
  const hideNames = !opts.currentUser;
  const isOpen = op.status === "open";
  const acceptedUnits = op.units.filter((u) => u.status === "accepted");
  // You only "hold a seat" in an ACCEPTED unit. Seats in pending/rejected units
  // don't count (a rejected unit's seats are also cleared server-side).
  const hasSeat =
    !!myId && acceptedUnits.some((u) => u.seats.some((s) => s.active && s.userId === myId));
  const hasReq = !!myId && op.crewRequests.some((r) => r.user.id === myId);
  // The viewer's own offered ships still awaiting the operator's decision —
  // shown so they can edit seats or withdraw BEFORE acceptance.
  const myPendingUnits = myId
    ? op.units.filter((u) => u.status === "pending" && u.captainId === myId)
    : [];
  // Has the viewer already contributed in any way? Drives the assistant overlay:
  // auto-open on first visit (not yet signed up), manual re-open afterwards.
  const myCqb = !!myId && (op.cqbSignups ?? []).some((s) => s.userId === myId);
  const signedUp = hasSeat || hasReq || myPendingUnits.length > 0 || myCqb;
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
  // FR-P1 step 6: per-unit cards for the wizard seat step — big Fleetyards
  // silhouette + class + claimable open seats, so signers see the actual ship.
  const shipSilhouettes = opts.shipSilhouettes ?? {};
  const seatShipUnits = acceptedUnits
    .filter((u) => u.unitType !== "vehicle")
    .map((u) => ({
      name: u.squadName || u.ship?.name || "Unit",
      isShip: u.unitType === "ship",
      cls: u.ship ? shipClass(u.ship) : "",
      sil: u.ship ? shipSilhouettes[normShipName(u.ship.name)] : undefined,
      seats: u.seats
        .filter((s) => s.active)
        .map((s) => ({ id: s.id, label: s.label, open: !s.userId })),
    }))
    .filter((u) => u.seats.some((s) => s.open));
  // Accepted units + their seats (who's seated / open), so players see the
  // current composition and can claim/release directly on the page. Ground
  // vehicles are nested under their carrier ship.
  const seatView = (u: (typeof acceptedUnits)[number]) =>
    u.seats
      .filter((s) => s.active)
      .map((s) => ({
        id: s.id,
        label: s.label,
        user: hideNames ? null : ((s as { user?: { username?: string } }).user?.username ?? null),
        mine: !!myId && s.userId === myId,
        open: !s.userId,
      }));
  const acceptedRoster = acceptedUnits
    // Top-level = real units that aren't carried by another (carried units nest).
    .filter((u) => u.unitType !== "vehicle" && !u.carrierUnitId)
    .map((u) => ({
      id: u.id,
      name: u.squadName || u.ship?.name || "Unit",
      kind: u.unitType === "ship" ? "Ship" : "FPS Fireteam",
      isShip: u.unitType === "ship",
      // Any ship can carry a vehicle now (restriction lifted) — operator's call.
      canCarry: u.unitType === "ship",
      sil: u.ship ? shipSilhouettes[normShipName(u.ship.name)] : undefined,
      isMyUnit: !!myId && u.captainId === myId,
      seats: seatView(u),
      editSeats: u.seats.map((s) => ({ id: s.id, label: s.label, order: s.order, active: s.active })),
      // Any unit attached to this one (vehicle OR carried ship/fighter) nests here.
      vehicles: acceptedUnits
        .filter((v) => v.carrierUnitId === u.id)
        .map((v) => ({
          id: v.id,
          name: v.ship?.name || v.squadName || "Unit",
          kind: v.unitType === "ship" ? "Ship" : "Vehicle",
          group:
            v.unitType === "vehicle"
              ? "vehicle"
              : shipClass(v.ship) === "Fighter"
                ? "fighter"
                : "ship",
          isMine: !!myId && v.captainId === myId,
          seats: seatView(v),
        })),
    }));
  // Captain seat-config form (rename + enable/disable) — usable on a pending
  // OR accepted own unit; reuses the captain-gated /units/:id/seats route.
  const seatEditDetails = (
    unitId: string,
    editSeats: Array<{ id: string; label: string; order: number; active: boolean }>,
  ) => html`<details class="roster-edit">
    <summary>Edit seats — rename or enable / disable</summary>
    <form method="post" action="${bp}/api/ops/${op.id}/units/${unitId}/seats">
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="ui" value="player" />
      <input type="hidden" name="tab" value="fleet" />
      ${editSeats.map(
        (s) => html`<div class="roster-edit-row">
          <input type="text" name="label_${s.id}" value="${s.label}" maxlength="40" />
          ${s.order === 0
            ? html`<span class="tag tag-dim">pilot</span>`
            : html`<label class="seat-toggle"
                ><input type="checkbox" name="active_${s.id}" value="1" ${s.active ? safe("checked") : ""} />
                available</label
              >`}
        </div>`,
      )}
      <button type="submit" class="btn btn-sm mt-1">Save seats</button>
    </form>
  </details>`;
  // Withdraw (delete) an own ship from the operation. captain-gated server-side.
  const withdrawShipForm = (unitId: string) =>
    html`<form
      method="post"
      action="${bp}/api/ops/${op.id}/units/${unitId}/delete"
      class="inline"
      style="margin-top:.5rem"
    >
      <input type="hidden" name="_csrf" value="${csrf}" />
      <input type="hidden" name="ui" value="player" />
      <input type="hidden" name="tab" value="fleet" />
      <button
        type="submit"
        class="btn btn-sm btn-danger"
        onclick="return confirm('Withdraw this ship from the operation? It is removed and its crew freed.')"
      >
        Withdraw ship
      </button>
    </form>`;
  // One seat row — reused for carrier-ship seats and nested vehicle seats.
  // captainConfirm: warn before a unit captain leaves the pilot seat.
  type RosterSeat = { id: string; label: string; user: string | null; mine: boolean; open: boolean };
  const seatRowHtml = (s: RosterSeat, captainConfirm: boolean) =>
    html`<div class="roster-seat${s.open ? " open" : s.mine ? " mine" : ""}">
      <span class="roster-seat-label">${s.label}</span>
      ${s.open
        ? isOpen && myId
          ? html`<form method="post" action="${bp}/api/seats/${s.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="ui" value="player" />
              <input type="hidden" name="tab" value="fleet" />
              <button
                type="submit"
                class="btn btn-sm btn-green"
                ${captainConfirm
                  ? safe(
                      ` onclick="return confirm('You are the captain of this ship. Taking another seat empties the pilot seat — make sure someone else captains it, or you may lose Command Net voice. Continue?')"`,
                    )
                  : safe("")}
              >
                Claim
              </button>
            </form>`
          : isOpen
            ? html`<a class="btn btn-sm" href="${bp}/login">Sign in</a>`
            : html`<span class="free">open</span>`
        : s.mine
          ? html`<span class="roster-occ roster-you">You</span>
              <form method="post" action="${bp}/api/seats/${s.id}/unclaim" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="ui" value="player" />
                <input type="hidden" name="tab" value="fleet" />
                <button type="submit" class="btn btn-sm btn-ghost">Release</button>
              </form>`
          : html`<span class="roster-occ">${s.user ?? "Taken"}</span>`}
    </div>`;
  // Captain attaches a ground vehicle (catalog pick) to their ship.
  const addVehicleForm = (carrierUnitId: string) =>
    html`<details class="roster-edit">
      <summary>Add a ground vehicle</summary>
      <form method="post" action="${bp}/api/ops/${op.id}/units" class="opv2-form join-unit-form" novalidate>
        <input type="hidden" name="_csrf" value="${csrf}" />
        <input type="hidden" name="ui" value="player" />
        <input type="hidden" name="tab" value="fleet" />
        <input type="hidden" name="unitType" value="vehicle" />
        <input type="hidden" name="carrierUnitId" value="${carrierUnitId}" />
        <div class="form-errors join-unit-errors" hidden></div>
        <label>Vehicle (from catalog)</label>
        <input
          type="search"
          class="join-ship-search"
          placeholder="Search e.g. Cyclone, Nova, ATLS…"
          autocomplete="off"
        />
        <input type="hidden" name="shipId" class="join-ship-id-field" />
        <div class="ship-results join-ship-results"></div>
        <button type="submit" class="btn btn-sm btn-green mt-1">Add vehicle</button>
      </form>
    </details>`;
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
  // Always-visible "you're signed up" confirmation at the very top of the join
  // column. The detailed "My Signup" aside lives in the right rail, which drops
  // to the bottom on mobile — so a signed-up user (especially CQB-only, which
  // the assistant card never hinted at) otherwise saw no confirmation up top.
  const signupParts: string[] = [];
  // Each claimed seat with its ship/vehicle + position (a user can be multi-seated).
  const mySeatList = acceptedUnits.flatMap((u) =>
    u.seats
      .filter((s) => s.active && s.userId === myId)
      .map((s) => `${s.label} on ${u.squadName || u.ship?.name || "Unit"}`),
  );
  for (const seat of mySeatList) signupParts.push(`seat: ${seat}`);
  if (myPendingUnits.length)
    signupParts.push(myPendingUnits.length === 1 ? "1 ship pending review" : `${myPendingUnits.length} ships pending review`);
  if (myCqb) {
    const tgid = (op.cqbSignups ?? []).find((s) => s.userId === myId)?.assignedGroupId ?? null;
    const tname = tgid ? (op.groups.find((g) => g.id === tgid)?.name ?? null) : null;
    signupParts.push(tname ? `CQB soldier in ${tname}` : "signed up as CQB soldier");
  }
  if (hasReq && !hasSeat) signupParts.push("awaiting operator placement");
  const signupSummaryBanner =
    signedUp && signupParts.length
      ? html`<div class="opv2-cta done" style="margin-bottom:1rem">
          ✓ You're signed up — ${signupParts.join(" · ")}.
        </div>`
      : safe("");
  // Headcount for the top fact row. Confirmed = people who CLAIMED a spot:
  // a ship/vehicle seat OR a slot in a CQB/fighter team (assignedGroupId set).
  // Signed up = everyone who registered in any form, incl. the still-unassigned
  // CQB pool, crew requests and own ship offers awaiting review.
  const seatedUserIds = acceptedUnits.flatMap((u) =>
    u.seats.filter((s) => s.active && s.userId).map((s) => s.userId as string),
  );
  const teamMemberUserIds = (op.cqbSignups ?? [])
    .filter((s) => s.assignedGroupId)
    .map((s) => s.userId);
  const confirmedCount = new Set<string>([...seatedUserIds, ...teamMemberUserIds]).size;
  const signedUpCount = new Set<string>([
    ...seatedUserIds,
    ...op.crewRequests.map((r) => r.user.id),
    ...(op.cqbSignups ?? []).map((s) => s.userId),
    ...op.units.filter((u) => u.status === "pending").map((u) => u.captainId),
  ]).size;
  // CQB squads a player can join directly (sized squads = operator gave them a
  // target size). Open = not yet full; "mine" = the viewer is already in it.
  const myCqbGroupId = (op.cqbSignups ?? []).find((s) => s.userId === myId)?.assignedGroupId ?? null;
  const joinableSquads = op.groups
    .filter(
      (g) =>
        (g.kind === "squad" || g.kind === "fighter_squad") &&
        (g as { targetSize?: number | null }).targetSize != null,
    )
    .map((g) => {
      const members = (op.cqbSignups ?? []).filter((s) => s.assignedGroupId === g.id);
      const cap = (g as { targetSize?: number | null }).targetSize ?? null;
      return {
        id: g.id,
        kind: g.kind,
        name: g.name,
        cap,
        count: members.length,
        mine: myCqbGroupId === g.id,
        open: cap == null ? true : members.length < cap,
        carrierUnitId: (g as { carrierUnitId?: string | null }).carrierUnitId ?? null,
        members: members.map((m) => ({
          isMe: !!myId && m.userId === myId,
          name: hideNames ? null : m.user.username,
        })),
      };
    });
  // Embedded CQB teams ride inside a ship → shown under that ship, not in the
  // standalone "Join a CQB squad" list. Fighters are never embedded.
  const cqbJoinSquads = joinableSquads.filter((s) => s.kind === "squad" && !s.carrierUnitId);
  const fighterJoinSquads = joinableSquads.filter((s) => s.kind === "fighter_squad");
  const embeddedTeamsFor = (unitId: string) =>
    joinableSquads.filter((s) => s.kind === "squad" && s.carrierUnitId === unitId);
  // One team rendered as a ship-style roster unit (seat strip). Reused both in
  // the standalone join section and nested under a carrier ship.
  const teamSlotUnit = (
    sq: (typeof joinableSquads)[number],
    joinLabel: string,
    slotWord: string,
  ): SafeHtml => {
    const cap = sq.cap ?? sq.count;
    return html`<div class="roster-unit">
      <div class="roster-unit-head">
        <strong>${sq.name}</strong>
        ${sq.mine ? html`<span class="tag tag-green">You're in</span>` : safe("")}
        <span class="roster-unit-count">${sq.count}/${cap}</span>
      </div>
      <div class="roster-seats">
        ${Array.from({ length: cap }).map((_, i) => {
          const m = sq.members[i];
          if (m) {
            return html`<div class="roster-seat${m.isMe ? " mine" : ""}">
              <span class="roster-seat-label">${slotWord} ${i + 1}</span>
              ${m.isMe
                ? html`<span class="roster-occ roster-you">You</span>
                    <form method="post" action="${bp}/api/ops/${op.id}/cqb-signups/withdraw" class="inline">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="ui" value="player" />
                      <input type="hidden" name="tab" value="fleet" />
                      <button type="submit" class="btn btn-sm btn-ghost">Leave</button>
                    </form>`
                : html`<span class="roster-occ">${m.name ?? "Taken"}</span>`}
            </div>`;
          }
          return html`<div class="roster-seat open">
            <span class="roster-seat-label">${slotWord} ${i + 1}</span>
            ${sq.mine
              ? html`<span class="free">open</span>`
              : myId
                ? html`<form method="post" action="${bp}/api/ops/${op.id}/cqb/squads/${sq.id}/join" class="inline">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <input type="hidden" name="ui" value="player" />
                    <input type="hidden" name="tab" value="fleet" />
                    <button type="submit" class="btn btn-sm btn-green">${joinLabel}</button>
                  </form>`
                : html`<a class="btn btn-sm" href="${bp}/login">Sign in</a>`}
          </div>`;
        })}
      </div>
    </div>`;
  };
  const squadJoinCard = (
    title: string,
    sub: string,
    list: typeof joinableSquads,
    joinLabel: string,
    slotWord: string,
  ): SafeHtml =>
    isOpen && list.length
      ? html`<section class="card" style="margin-top:1rem">
          <h3 class="wiz-sum-h">${title}</h3>
          <p class="text-dim text-sm" style="margin:.2rem 0 .7rem">${sub}</p>
          ${list.map((sq) => teamSlotUnit(sq, joinLabel, slotWord))}
        </section>`
      : safe("");

  const body = html` <style>
      .event-shell { width: 100%; }
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
      .event-hero-main { display: grid; align-content: end; gap: 1rem; min-width: 0; }
      .event-hero-brief { min-width: 0; background: rgba(5,8,16,.62); border: 1px solid var(--cyan-28); padding: .7rem .9rem; overflow: auto; color: var(--text, #cdd9e1); }
      .event-hero-brief-h { font-weight: 700; margin-bottom: .4rem; color: var(--cyan, #35d0e0); font-size: .72rem; text-transform: uppercase; letter-spacing: .07em; font-family: var(--font-mono); }
      .event-hero-brief .join-md, .event-hero-brief p { font-size: .88rem; line-height: 1.5; }
      @media (min-width: 901px) {
        .event-hero.has-brief { grid-template-columns: minmax(0, 1fr) minmax(300px, 440px); align-content: stretch; align-items: stretch; }
        .event-hero.has-brief .event-hero-brief { max-height: 340px; align-self: stretch; }
      }
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
      /* Radio-driven join assistant: CSS-only inline disclosure, no JS. */
      .join-asst .ja-radio { position: absolute; opacity: 0; width: 0; height: 0; pointer-events: none; }
      details.join-asst > summary.ja-card-summary { cursor: pointer; list-style: none; display: flex; align-items: center; justify-content: space-between; gap: .75rem; }
      details.join-asst > summary.ja-card-summary::-webkit-details-marker { display: none; }
      details.join-asst > summary .wiz-sum-h { font-size: 1.05rem; }
      details.join-asst > summary::after { content: "▾"; color: var(--cyan, #35d0e0); font-size: .9rem; }
      details.join-asst > summary.ja-more-cta { background: var(--gold-08, rgba(224,184,74,.12)); border: 1px solid var(--gold, #e0b84a); padding: .75rem 1rem; border-radius: 6px; }
      details.join-asst > summary.ja-more-cta:hover { background: rgba(224,184,74,.2); }
      details.join-asst > summary.ja-more-cta .wiz-sum-h { color: var(--gold, #e0b84a); font-weight: 700; }
      details.join-asst > summary.ja-more-cta::after { color: var(--gold, #e0b84a); }
      details.join-asst[open] > summary::after { content: "▴"; }
      .direct-seats { display: grid; gap: .7rem; }
      .direct-seat-unit-name { font-weight: 600; margin-bottom: .35rem; }
      .direct-seat-btns { display: flex; flex-wrap: wrap; gap: 6px; }
      .ja-opt { display: grid; grid-template-columns: 4rem minmax(0, 1fr) 18px; align-items: center; gap: 14px; padding: 13px 16px; border: 1px solid rgba(255,255,255,0.1); margin-top: 10px; cursor: pointer; background: rgba(255,255,255,.015); }
      .ja-opt .ico { font-family: var(--font-mono); font-size: .72rem; color: var(--cyan); text-transform: uppercase; }
      .ja-txt { display: flex; flex-direction: column; min-width: 0; }
      .ja-txt .ttl { font-weight: 700; }
      .ja-txt .sub { font-size: 0.8rem; color: var(--dim, #7a8a96); }
      .ja-chk { width: 16px; height: 16px; border-radius: 50%; border: 1px solid rgba(255,255,255,.3); }
      .ja-radio:checked + .ja-opt { border-color: var(--cyan, #35d0e0); background: var(--cyan-08); }
      .ja-radio:checked + .ja-opt .ja-chk { border-color: var(--cyan, #35d0e0); background: var(--cyan, #35d0e0); box-shadow: inset 0 0 0 3px rgba(5,8,16,.9); }
      .ja-radio:focus-visible + .ja-opt { outline: 2px solid var(--cyan, #35d0e0); outline-offset: 2px; }
      .ja-panel { display: none; padding: 14px 16px 6px; border: 1px solid rgba(53,208,224,.22); border-top: none; }
      .ja-radio:checked + .ja-opt + .ja-panel { display: block; }
      .ja-radio:disabled + .ja-opt { opacity: .4; cursor: not-allowed; }
      .roster-ship-sil { height: 46px; width: 110px; object-fit: contain; opacity: .92; flex: 0 0 auto; }
      .roster-vehicle { margin: .4rem 0 .2rem 1.1rem; padding-left: .7rem; border-left: 2px solid var(--cyan-28, rgba(53,208,224,.28)); }
      .roster-embarked { margin: .5rem 0 .2rem 1.1rem; padding-left: .7rem; border-left: 2px solid var(--gold, #e0b84a); }
      .roster-embarked-h { font-size: .85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--gold, #e0b84a); font-family: var(--font-mono); margin: .3rem 0 .45rem; }
      .roster-nest { margin: .5rem 0 .2rem 1.1rem; padding-left: .7rem; border-left: 2px solid var(--cyan-28, rgba(53,208,224,.28)); }
      .roster-nest-h { font-size: .85rem; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--cyan, #35d0e0); font-family: var(--font-mono); margin: .3rem 0 .45rem; }
      .roster-veh-icon { color: var(--cyan, #35d0e0); }
      .join-seat { display: flex; justify-content: space-between; gap: .75rem; padding: 8px 0; border-bottom: 1px solid rgba(255,255,255,0.06); font-size: 0.88rem; }
      .join-seat .free { color: var(--green, #3ad07a); font-weight: 600; white-space: nowrap; }
      .roster-unit { border: 1px solid rgba(255,255,255,.08); padding: .6rem .8rem; margin-bottom: .6rem; }
      .roster-unit-head { display: flex; align-items: center; gap: .5rem; margin-bottom: .45rem; }
      .roster-unit-count { margin-left: auto; color: var(--dim); font-size: .76rem; font-family: var(--font-mono); }
      .roster-seats { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: .35rem; }
      .roster-seat { display: flex; align-items: center; justify-content: space-between; gap: .5rem; padding: .35rem .55rem; border: 1px solid rgba(255,255,255,.06); font-size: .85rem; }
      .roster-seat.open { border-color: rgba(53,208,224,.25); }
      .roster-seat.mine { border-color: var(--green, #3ad07a); background: rgba(58,208,122,.08); }
      .roster-seat-label { color: var(--dim); }
      .roster-occ { font-weight: 600; }
      .roster-you { color: var(--green, #3ad07a); font-weight: 700; }
      .roster-edit { margin-top: .5rem; }
      .roster-edit > summary { cursor: pointer; color: var(--cyan, #35d0e0); font-size: .78rem; }
      .roster-edit-row { display: flex; align-items: center; gap: .6rem; margin: .35rem 0; }
      .roster-edit-row input[type="text"] { flex: 1; max-width: 18rem; }
      .req-table { display: grid; gap: .35rem; }
      .req-row { display: grid; grid-template-columns: minmax(8rem, 1fr) 5rem 5rem 5.5rem; gap: .5rem; align-items: center; padding: .55rem 0; border-bottom: 1px solid rgba(255,255,255,.06); }
      .req-head { color: var(--dim); font-family: var(--font-mono); font-size: .66rem; text-transform: uppercase; letter-spacing: .08em; }
      .req-name { min-width: 0; }
      .req-name strong { display: block; overflow-wrap: normal; word-break: normal; }
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
      class="event-hero has-brief"
      style="${op.cover
        ? `min-height:340px;background-image:linear-gradient(180deg, rgba(5,8,16,.45), rgba(5,8,16,.85)), url('${op.cover.url}')`
        : `background-image:linear-gradient(90deg, rgba(5,8,16,.96), rgba(5,8,16,.76), rgba(5,8,16,.3)), url('${missionImageUrl(
            bp,
            op.opType,
          )}')`}"
    >
      <div class="event-hero-main">
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
      </div>
      <aside class="event-hero-brief">
        <div class="event-hero-brief-h">Briefing</div>
        ${op.description
          ? renderMarkdown(op.description)
          : html`<p class="text-dim text-sm">No briefing yet.</p>`}
      </aside>
    </section>
    <div class="event-facts">
      <div class="event-fact"><span>Time</span><strong>${fmtDateLocal(op.scheduledAt, gtz)} (${gtz})</strong></div>
      <div class="event-fact"><span>Rendezvous</span><strong>${op.meetingLocation || "Not set"}</strong></div>
      <div class="event-fact"><span>System</span><strong>${systemLabel(op.meetingSystem)}</strong></div>
      <div class="event-fact"><span>Voice</span><strong>${opts.voiceChannelName || "Not set"}</strong></div>
      <div class="event-fact">
        <span>Participants</span>
        <strong>${minP > 0 ? `Min ${minP}` : "No minimum"}${maxP ? ` / Max ${maxP}` : ""}</strong>
      </div>
      <div class="event-fact">
        <span>Gemeldet / Bestätigt</span>
        <strong>${signedUpCount} / ${confirmedCount}</strong>
      </div>
      ${opts.discordInvite
        ? html`<div class="event-fact">
            <span>Discord</span>
            <strong
              ><a href="${opts.discordInvite}" target="_blank" rel="noopener noreferrer"
                >Server beitreten ↗</a
              ></strong
            >
          </div>`
        : safe("")}
    </div>

    ${op.visibility === "public" && opts.publicUrl
      ? (() => {
          const shareUrl = `${opts.publicUrl}/ops/${op.id}`;
          const shareText = `${op.title} — ${fmtDateLocal(op.scheduledAt, gtz)}`;
          const img = op.cover ? op.cover.url : "";
          const e = encodeURIComponent;
          const textUrl = `${shareText} ${shareUrl}`;
          return html`<div
              class="event-share"
              data-share-url="${shareUrl}"
              data-share-text="${shareText}"
              data-share-image="${img}"
              style="display:flex;flex-wrap:wrap;gap:.4rem;align-items:center;margin:0 0 1rem"
            >
              <span class="text-dim text-sm" style="margin-right:.25rem">Teilen</span>
              <button type="button" class="btn btn-sm btn-cyan" data-share-native hidden>
                📤 Teilen…
              </button>
              <a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://twitter.com/intent/tweet?text=${e(shareText)}&url=${e(shareUrl)}">X</a>
              <a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://www.facebook.com/sharer/sharer.php?u=${e(shareUrl)}">Facebook</a>
              <a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://www.threads.net/intent/post?text=${e(textUrl)}">Threads</a>
              <a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://wa.me/?text=${e(textUrl)}">WhatsApp</a>
              <a class="btn btn-sm" target="_blank" rel="noopener"
                href="https://t.me/share/url?url=${e(shareUrl)}&text=${e(shareText)}">Telegram</a>
              <button type="button" class="btn btn-sm" data-share-copy>Link kopieren</button>
            </div>
            <script>
              (function () {
                var box = document.querySelector(".event-share");
                if (!box) return;
                var url = box.getAttribute("data-share-url");
                var text = box.getAttribute("data-share-text");
                var img = box.getAttribute("data-share-image");
                var nativeBtn = box.querySelector("[data-share-native]");
                var copyBtn = box.querySelector("[data-share-copy]");
                if (navigator.share && nativeBtn) {
                  nativeBtn.hidden = false;
                  nativeBtn.addEventListener("click", function () {
                    var data = { title: text, text: text, url: url };
                    var go = function () { navigator.share(data).catch(function () {}); };
                    if (img && navigator.canShare) {
                      fetch(img).then(function (r) { return r.blob(); }).then(function (b) {
                        var f = new File([b], "mission-cover.png", { type: b.type || "image/png" });
                        if (navigator.canShare({ files: [f] })) data.files = [f];
                        go();
                      }).catch(go);
                    } else { go(); }
                  });
                }
                if (copyBtn) {
                  copyBtn.addEventListener("click", function () {
                    (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject())
                      .then(function () {
                        copyBtn.textContent = "Kopiert ✓";
                        setTimeout(function () { copyBtn.textContent = "Link kopieren"; }, 1500);
                      }).catch(function () {});
                  });
                }
              })();
            </script>`;
        })()
      : safe("")}

    <div class="join-layout">
      <div class="join-main">
        ${signupSummaryBanner}
        ${!myId
          ? html`<section class="card">
              <h3 class="wiz-sum-h">I want to join</h3>
              <p class="text-dim text-sm">
                Sign in to claim a seat, offer a ship, or let the operator place you.
              </p>
              <a class="btn btn-green" href="${bp}/login">Sign in</a>
            </section>`
          : !isOpen
            ? html`<section class="card">
                <h3 class="wiz-sum-h">I want to join</h3>
                <div class="opv2-cta closed">Sign-up is closed.</div>
              </section>`
            : html`<details class="card join-asst"${signedUp ? safe("") : safe(" open")}>
                  <summary class="ja-card-summary${signedUp ? " ja-more-cta" : ""}">
                    <span class="wiz-sum-h" style="margin:0">${signedUp
                      ? "➕ Want to contribute something else, or claim another seat?"
                      : "I want to join"}</span>
                  </summary>
                  <div style="display:flex;justify-content:flex-end;align-items:center;gap:.75rem;flex-wrap:wrap;margin-top:.6rem">
                    <button type="button" id="jw-open" class="btn btn-sm btn-cyan">
                      ${signedUp ? "Restart sign-up assistant" : "Sign-up assistant"}
                    </button>
                  </div>
                  <p class="text-dim text-sm" style="margin:.5rem 0 .7rem">
                    Pick how you'll contribute — steps are optional and you can do several:
                    <strong>CQB, a seat and a ship are NOT mutually exclusive</strong>. In a hurry?
                    Use <em>"Let the operator place me"</em> at the bottom.
                  </p>
                  ${hasSeat
                    ? html`<p class="text-dim text-sm" style="margin:0 0 .6rem">
                        You already hold a seat — you can still add more below.
                      </p>`
                    : safe("")}
                  ${myPendingUnits.length
                    ? html`<p class="text-dim text-sm" style="margin:0 0 .6rem">
                        You have a ship pending review — you can still contribute more below.
                      </p>`
                    : safe("")}

                  ${openSeats.length
                    ? html`<input type="radio" name="join-mode" id="jm-seat" class="ja-radio" checked />
                        <label for="jm-seat" class="ja-opt">
                          <span class="ico">Seat</span>
                          <span class="ja-txt"
                            ><span class="ttl">Take an open seat</span
                            ><span class="sub"
                              >${openSeats.length} open seat${openSeats.length === 1 ? "" : "s"} in accepted units.</span
                            ></span
                          >
                          <span class="ja-chk"></span>
                        </label>
                        <div class="ja-panel">
                          ${seatShipUnits.map(
                            (u) => html`<div
                              class="join-ship-card"
                              style="border:1px solid var(--border,#26303d);border-radius:8px;padding:12px;margin-bottom:12px;background:var(--panel,rgba(13,17,23,.5))"
                            >
                              <div style="display:flex;align-items:center;gap:14px;flex-wrap:wrap">
                                ${u.sil
                                  ? html`<img
                                      src="${u.sil}"
                                      alt="${u.name}"
                                      loading="lazy"
                                      style="height:96px;width:200px;max-width:55%;object-fit:contain;flex:0 0 auto"
                                    />`
                                  : safe("")}
                                <div style="flex:1;min-width:140px">
                                  <div style="font-size:15px;font-weight:600">
                                    ${u.name}${u.cls
                                      ? html` <span class="tag tag-dim">${u.cls}</span>`
                                      : safe("")}
                                  </div>
                                  <div class="text-dim text-sm" style="margin:.15rem 0 .5rem">
                                    ${u.seats.filter((s) => s.open).length} open seat${u.seats.filter((s) => s.open).length === 1 ? "" : "s"}
                                  </div>
                                  <div style="display:flex;flex-wrap:wrap;gap:6px">
                                    ${u.seats.map((s) =>
                                      s.open
                                        ? html`<form
                                            method="post"
                                            action="${bp}/api/seats/${s.id}/claim"
                                            class="inline"
                                          >
                                            <input type="hidden" name="_csrf" value="${csrf}" />
                                            <input type="hidden" name="ui" value="player" />
                                            <input type="hidden" name="tab" value="fleet" />
                                            <button type="submit" class="btn btn-sm btn-green">
                                              ${s.label}
                                            </button>
                                          </form>`
                                        : html`<span
                                            class="tag tag-dim"
                                            style="opacity:.55"
                                            title="taken"
                                            >${s.label}</span
                                          >`,
                                    )}
                                  </div>
                                </div>
                              </div>
                            </div>`,
                          )}
                        </div>`
                    : safe("")}

                  <input type="radio" name="join-mode" id="jm-ship" class="ja-radio" ${openSeats.length ? safe("") : safe("checked")} />
                  <label for="jm-ship" class="ja-opt">
                    <span class="ico">Ship</span>
                    <span class="ja-txt"
                      ><span class="ttl">Offer a ship</span
                      ><span class="sub">Bring one of your ships; crew fill its seats.</span></span
                    >
                    <span class="ja-chk"></span>
                  </label>
                  <div class="ja-panel">
                    <form
                      method="post"
                      action="${bp}/api/ops/${op.id}/units"
                      class="opv2-form join-unit-form"
                      novalidate
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="ui" value="player" />
                      <input type="hidden" name="tab" value="fleet" />
                      <input type="hidden" name="unitType" class="join-unit-type" value="ship" />
                      <div class="form-errors join-unit-errors" hidden></div>
                      <label>Fleet need <span style="font-weight:normal;opacity:.65">(optional)</span></label>
                      <select name="requirementId">
                        <option value="">Unslotted — let the operator place it</option>
                        ${availableSlots.map((s) => html`<option value="${s.id}">${s.label}</option>`)}
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
                          <input type="checkbox" name="storeOwnedShip" value="1" /> Save this ship to
                          my hangar
                        </label>
                        <div class="ship-results join-ship-results"></div>
                      </div>
                      <label
                        >Note to the Fleet Operator
                        <span style="font-weight:normal;opacity:.65">(optional)</span></label
                      >
                      <input
                        type="text"
                        name="captainNote"
                        maxlength="240"
                        placeholder="Role, loadout, crew preference…"
                      />
                      <button type="submit" class="btn btn-green mt-1">Offer ship</button>
                    </form>
                  </div>

                  <input type="radio" name="join-mode" id="jm-cqb" class="ja-radio" />
                  <label for="jm-cqb" class="ja-opt">
                    <span class="ico">CQB</span>
                    <span class="ja-txt"
                      ><span class="ttl">Join as a CQB soldier</span
                      ><span class="sub">Sign up as infantry; the operator forms the squad.</span></span
                    >
                    <span class="ja-chk"></span>
                  </label>
                  <div class="ja-panel">
                    <form method="post" action="${bp}/api/ops/${op.id}/cqb-signups">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="ui" value="player" />
                      <input type="hidden" name="tab" value="fleet" />
                      <p class="text-dim text-sm" style="margin:0 0 .5rem">
                        You sign up as a single soldier. The Fleet Operator bundles everyone who
                        signs up into squads — you don't form the team yourself.
                      </p>
                      <label
                        >Note to the Fleet Operator
                        <span style="font-weight:normal;opacity:.65">(optional)</span></label
                      >
                      <input
                        type="text"
                        name="note"
                        maxlength="240"
                        placeholder="Loadout, experience, preferred squad…"
                      />
                      <button type="submit" class="btn btn-green mt-1">Sign up as CQB</button>
                    </form>
                  </div>

                  <input type="radio" name="join-mode" id="jm-assign" class="ja-radio" />
                  <label for="jm-assign" class="ja-opt">
                    <span class="ico">Place</span>
                    <span class="ja-txt"
                      ><span class="ttl">Let the operator place me</span
                      ><span class="sub">I'm flexible or need help finding a role.</span></span
                    >
                    <span class="ja-chk"></span>
                  </label>
                  <div class="ja-panel">
                    <form id="jw-place-form" method="post" action="${bp}/api/ops/${op.id}/crew-requests">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="ui" value="player" />
                      <input type="hidden" name="tab" value="crew" />
                      <label
                        >Note to the Fleet Operator
                        <span style="font-weight:normal;opacity:.65">(optional)</span></label
                      >
                      <textarea
                        name="note"
                        maxlength="240"
                        placeholder="e.g. experience, preferred role, ships you can bring…"
                      ></textarea>
                      <button type="submit" class="btn btn-green mt-1">Request a spot</button>
                    </form>
                  </div>

                  <div id="jw-ov" class="jw-ov" hidden role="dialog" aria-modal="true">
                    <div class="jw-ov-card">
                      <div class="jw-ov-head">
                        <strong>Sign-up assistant</strong>
                        <button type="button" class="jw-ov-x" data-jw-cancel aria-label="Close">×</button>
                      </div>
                      ${openSeats.length
                        ? html`<div class="jw-step" data-target="jm-seat">
                            <div class="jw-q">Take an open seat?</div>
                            <div class="jw-sub">
                              ${openSeats.length} open seat${openSeats.length === 1 ? "" : "s"} in accepted ships.
                            </div>
                            <div class="jw-yn">
                              <button type="button" class="btn btn-green" data-yes>Yes</button>
                              <button type="button" class="btn" data-no>No</button>
                            </div>
                          </div>`
                        : safe("")}
                      <div class="jw-step" data-target="jm-ship">
                        <div class="jw-q">Bring one of your ships?</div>
                        <div class="jw-sub">Offer a ship; crew fill its seats.</div>
                        <div class="jw-yn">
                          <button type="button" class="btn btn-green" data-yes>Yes</button>
                          <button type="button" class="btn" data-no>No</button>
                        </div>
                      </div>
                      <div class="jw-step" data-target="jm-cqb">
                        <div class="jw-q">Join as a CQB soldier?</div>
                        <div class="jw-sub">Sign up as infantry; the operator forms the squad.</div>
                        <div class="jw-yn">
                          <button type="button" class="btn btn-green" data-yes>Yes</button>
                          <button type="button" class="btn" data-no>No</button>
                        </div>
                      </div>
                      <div class="jw-step" data-target="jm-assign">
                        <div class="jw-q">Let the operator place you?</div>
                        <div class="jw-sub">Flexible, or need help finding a role.</div>
                        <div class="jw-yn">
                          <button type="button" class="btn btn-green" data-yes>Yes</button>
                          <button type="button" class="btn" data-no>No</button>
                        </div>
                      </div>
                      <div class="jw-done" hidden>
                        <p class="text-dim text-sm" style="margin:.2rem 0 1rem">
                          No problem — use the options on the page whenever you like.
                        </p>
                        <button type="button" class="btn btn-sm" data-jw-cancel>Close</button>
                      </div>
                      <div class="jw-ov-foot">
                        <button type="button" class="btn btn-sm btn-ghost" data-jw-skip>
                          Skip — just let the operator place me
                        </button>
                        <button type="button" class="btn btn-sm" data-jw-cancel>
                          Disable assistant (Cancel)
                        </button>
                      </div>
                    </div>
                  </div>
                  <style>
                    .jw-ov { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; background: rgba(2,6,12,.74); backdrop-filter: blur(2px); padding: 1rem; }
                    .jw-ov[hidden] { display: none; }
                    .jw-ov-card { background: var(--bg2,#0d1117); border: 1px solid var(--cyan,#35d0e0); border-radius: 14px; max-width: 480px; width: 100%; padding: 22px 24px; box-shadow: 0 24px 70px rgba(0,0,0,.65); }
                    .jw-ov-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 1.1rem; }
                    .jw-ov-head strong { font-size: .95rem; color: var(--cyan,#35d0e0); letter-spacing: 2px; text-transform: uppercase; font-family: var(--font-mono); }
                    .jw-ov-x { background: none; border: none; color: var(--dim,#7a8a96); font-size: 1.6rem; line-height: 1; cursor: pointer; }
                    #jw-ov .jw-q { font-size: 1.3rem; font-weight: 700; margin-bottom: .35rem; }
                    #jw-ov .jw-sub { color: var(--dim,#7a8a96); font-size: .92rem; margin-bottom: 1.1rem; }
                    #jw-ov .jw-yn { display: flex; gap: .6rem; }
                    #jw-ov .jw-yn .btn { min-width: 92px; }
                    .jw-ov-foot { display: flex; justify-content: space-between; gap: .5rem; margin-top: 1.4rem; flex-wrap: wrap; border-top: 1px solid rgba(255,255,255,.08); padding-top: .8rem; }
                  </style>
                  <script>
                    (function () {
                      var ov = document.getElementById("jw-ov");
                      if (!ov) return;
                      var steps = [].slice.call(ov.querySelectorAll(".jw-step"));
                      var done = ov.querySelector(".jw-done");
                      var i = 0;
                      function render() {
                        steps.forEach(function (s, n) { s.hidden = n !== i; });
                        if (done) done.hidden = true;
                      }
                      function openOv() { i = 0; render(); ov.hidden = false; document.body.style.overflow = "hidden"; }
                      function closeOv() { ov.hidden = true; document.body.style.overflow = ""; }
                      function placeSubmit() {
                        var f = document.getElementById("jw-place-form");
                        if (f) { closeOv(); f.submit(); }
                        else pick("jm-assign");
                      }
                      function pick(target) {
                        // "Let the operator place me" needs no extra input — submit it
                        // straight away so the answer actually does something.
                        if (target === "jm-assign") { placeSubmit(); return; }
                        var r = document.getElementById(target);
                        var lbl = document.querySelector('label[for="' + target + '"]');
                        if (r) r.checked = true;
                        closeOv();
                        if (lbl) lbl.scrollIntoView({ behavior: "smooth", block: "center" });
                      }
                      steps.forEach(function (s) {
                        var y = s.querySelector("[data-yes]");
                        var n = s.querySelector("[data-no]");
                        if (y) y.addEventListener("click", function () { pick(s.getAttribute("data-target")); });
                        if (n) n.addEventListener("click", function () {
                          if (i < steps.length - 1) { i++; render(); }
                          else { steps.forEach(function (x) { x.hidden = true; }); if (done) done.hidden = false; }
                        });
                      });
                      ov.querySelectorAll("[data-jw-cancel]").forEach(function (b) { b.addEventListener("click", closeOv); });
                      var skip = ov.querySelector("[data-jw-skip]");
                      if (skip) skip.addEventListener("click", placeSubmit);
                      ov.addEventListener("click", function (e) { if (e.target === ov) closeOv(); });
                      document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !ov.hidden) closeOv(); });
                      var openBtn = document.getElementById("jw-open");
                      if (openBtn) openBtn.addEventListener("click", openOv);
                      if (!${signedUp ? "true" : "false"}) openOv();
                    })();
                  </script>
                </details>`}

        ${squadJoinCard(
          "Join a CQB squad",
          "Pick a named fireteam and take a spot directly — no assistant needed.",
          cqbJoinSquads,
          "Claim",
          "Soldier",
        )}
        ${squadJoinCard(
          "Join a fighter squad",
          "Wingman pairs — bring your own fighter and take a slot.",
          fighterJoinSquads,
          "Claim",
          "Pilot",
        )}

        ${myPendingUnits.length
          ? html`<section class="card" style="margin-top:1rem">
              <h3 class="wiz-sum-h">Your offered ${myPendingUnits.length === 1 ? "ship" : "ships"}</h3>
              ${myPendingUnits.map(
                (u) => html`<div class="roster-unit">
                  <div class="roster-unit-head">
                    <strong>${u.squadName || u.ship?.name || "Unit"}</strong>
                    <span class="tag tag-gold">pending review</span>
                  </div>
                  <p class="text-dim text-sm">
                    Awaiting the Fleet Operator. Configure the seats now or withdraw the ship.
                  </p>
                  ${seatEditDetails(
                    u.id,
                    u.seats.map((s) => ({ id: s.id, label: s.label, order: s.order, active: s.active })),
                  )}
                  ${u.unitType === "ship" ? addVehicleForm(u.id) : safe("")}
                  ${withdrawShipForm(u.id)}
                </div>`,
              )}
            </section>`
          : safe("")}

        <section class="card" style="margin-top:1rem">
          <h3 class="wiz-sum-h">Accepted Units</h3>
          ${acceptedRoster.length
            ? acceptedRoster.map(
                (u) => html`<div class="roster-unit">
                  <div class="roster-unit-head">
                    ${u.sil
                      ? html`<img class="roster-ship-sil" src="${u.sil}" alt="${u.name}" loading="lazy" />`
                      : safe("")}
                    <strong>${u.name}</strong> <span class="tag tag-dim">${u.kind}</span>
                    <span class="roster-unit-count"
                      >${u.seats.filter((s) => !s.open).length}/${u.seats.length} crew</span
                    >
                  </div>
                  <div class="roster-seats">${u.seats.map((s) => seatRowHtml(s, u.isMyUnit))}</div>
                  ${(() => {
                    const nestUnit = (
                      v: (typeof u.vehicles)[number],
                      withTeams: boolean,
                    ) => html`<div class="roster-vehicle">
                      <div class="roster-unit-head">
                        <span class="roster-veh-icon">⬓</span> <strong>${v.name}</strong>
                        <span class="tag tag-dim">${v.kind}</span>
                      </div>
                      <div class="roster-seats">${v.seats.map((s) => seatRowHtml(s, false))}</div>
                      ${withTeams && embeddedTeamsFor(v.id).length
                        ? html`<div class="roster-embarked">
                            <div class="roster-embarked-h">Fireteams</div>
                            ${embeddedTeamsFor(v.id).map((t) => teamSlotUnit(t, "Claim", "Soldier"))}
                          </div>`
                        : safe("")}
                      ${v.isMine ? withdrawShipForm(v.id) : safe("")}
                    </div>`;
                    const sect = (label: string, grp: string, withTeams: boolean) => {
                      const items = u.vehicles.filter((v) => v.group === grp);
                      return items.length
                        ? html`<div class="roster-nest">
                            <div class="roster-nest-h">${label}</div>
                            ${items.map((v) => nestUnit(v, withTeams))}
                          </div>`
                        : safe("");
                    };
                    return html`${sect("Attached Vehicles", "vehicle", true)}${sect("Attached Fighters", "fighter", false)}${sect("Attached Ships", "ship", false)}`;
                  })()}
                  ${embeddedTeamsFor(u.id).length
                    ? html`<div class="roster-embarked">
                        <div class="roster-embarked-h">Fireteams</div>
                        ${embeddedTeamsFor(u.id).map((t) => teamSlotUnit(t, "Claim", "Soldier"))}
                      </div>`
                    : safe("")}
                  ${u.isMyUnit
                    ? html`${seatEditDetails(u.id, u.editSeats)}
                        ${u.isShip && u.canCarry ? addVehicleForm(u.id) : safe("")}
                        ${withdrawShipForm(u.id)}`
                    : safe("")}
                </div>`,
              )
            : html`<p class="text-dim text-sm">No ships or fireteams accepted yet.</p>`}
        </section>

        <section class="card" style="margin-top:1rem">
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
          : !hasSeat && !hasReq && !myCqb
            ? html`<p class="text-dim text-sm">Use “I want to join” on the left to sign up.</p>`
            : safe("")}
        ${myId && hasReq && !hasSeat
          ? html`<form
              method="post"
              action="${bp}/api/ops/${op.id}/crew-requests/remove"
              style="margin-top:10px"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="ui" value="player" />
              <input type="hidden" name="tab" value="crew" />
              <button type="submit" class="btn btn-sm btn-ghost join-cta-btn">
                Withdraw request
              </button>
            </form>`
          : safe("")}
        ${myId && myCqb
          ? html`<div style="margin-top:10px">
              <p class="text-dim text-sm" style="margin:0 0 .35rem">Signed up as CQB soldier.</p>
              <form method="post" action="${bp}/api/ops/${op.id}/cqb-signups/withdraw">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="ui" value="player" />
                <input type="hidden" name="tab" value="crew" />
                <button type="submit" class="btn btn-sm btn-ghost join-cta-btn">
                  Withdraw CQB signup
                </button>
              </form>
            </div>`
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
    // Mission cover doubles as the link-preview image when the op URL is shared.
    ogMeta:
      op.cover && opts.publicUrl
        ? {
            title: op.title,
            description: op.meetingLocation || systemLabel(op.meetingSystem),
            imageUrl: op.cover.url,
            pageUrl: `${opts.publicUrl}/ops/${op.id}`,
          }
        : undefined,
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
      <form
        method="post"
        action="${bp}/feedback"
        enctype="multipart/form-data"
        style="max-width:48rem"
      >
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
        <div class="form-group">
          <label>Screenshots <span style="opacity:.6">(optional)</span></label>
          <input type="file" name="screenshots" accept="image/*" multiple />
          <p class="form-hint" style="opacity:.6;font-size:.85rem;margin-top:.35rem">
            Up to 4 images, max 8&nbsp;MB each (PNG, JPG, GIF, WebP).
          </p>
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
        <!-- Discord Voice + Relay Bots tabs disabled while voice is reworked (routes stay live). -->
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

export function whatIsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  lang?: "de" | "en";
}): SafeHtml {
  const bp = opts.basePath;
  const card = "card";
  const de = (opts.lang ?? "de") === "de";

  const langToggle = html`<div style="margin-bottom:12px;display:flex;gap:10px;align-items:center">
    <a href="${bp}/${de ? "what-is" : "was-ist"}" class="btn btn-sm">${de ? "🇬🇧 English version" : "🇩🇪 Deutsche Version"}</a>
  </div>`;

  const deBody = html` <div class="page-header">
      <h1 class="page-title">WAS IST DER FLEETMANAGER?</h1>
      <p class="page-subtitle">Kurz erklärt — ohne Technik-Kauderwelsch.</p>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          Der <strong>Fleetmanager</strong> ist ein Planungs-Werkzeug für Star-Citizen-Einsätze
          („Operations"). Stell dir vor, deine Org will mit 30 Leuten und 10 Schiffen losziehen —
          den ganzen Kram im Discord-Chat zu organisieren wird schnell Chaos. Der Fleetmanager
          macht daraus eine ordentliche Liste: <strong>Wer fliegt was, wer sitzt wo, wann geht's los.</strong>
        </p>
        <p style="margin-top:.6rem">
          Er hängt direkt an deinem Discord-Server. Was du hier planst, taucht als
          <strong>Discord-Event</strong> auf — niemand muss eine neue App lernen.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Die einfache Idee</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">Denk an einen <strong>Tischplan für eine Hochzeit</strong> — nur für Raumschiffe:</p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead><tr><th>Im Fleetmanager</th><th>Ist wie…</th></tr></thead>
          <tbody>
            <tr><td><strong>Operation</strong></td><td>die Veranstaltung (z. B. „Angriff auf Daymar, Samstag 20 Uhr")</td></tr>
            <tr><td><strong>Schiff / Einheit</strong></td><td>ein Tisch</td></tr>
            <tr><td><strong>Sitzplatz</strong></td><td>ein Stuhl am Tisch (Pilot, Gunner, Sanitäter …)</td></tr>
            <tr><td><strong>Crew</strong></td><td>die Gäste, die sich einen Stuhl schnappen</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Wer macht was?</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <table class="user-table" style="width:100%">
          <thead><tr><th>Rolle</th><th>Aufgabe</th></tr></thead>
          <tbody>
            <tr><td><strong>Fleet&nbsp;Op</strong> <span class="text-dim">(Operator)</span></td><td>plant die Operation: Was, Wann, Wo. Der Veranstalter.</td></tr>
            <tr><td><strong>Crew</strong></td><td>jedes Mitglied. Schaut, welche Schiffe mitfliegen, und schnappt sich einen Platz.</td></tr>
            <tr><td><strong>Captain</strong> <span class="text-dim">(kein Rang)</span></td><td>wirst du automatisch, sobald du ein Schiff anmeldest — du verwaltest dann dessen Plätze. Gilt nur für dieses eine Schiff in dieser Operation.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">So läuft eine Operation ab</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Der Fleet Op legt die Operation an</strong> — Titel, Zeit, Treffpunkt. Sie erscheint sofort als Discord-Event.</li>
          <li><strong>Captains bieten ihre Schiffe an</strong> — „Ich bringe meine Carrack mit, 4 Plätze".</li>
          <li><strong>Der Fleet Op nimmt Schiffe an</strong> — angenommene Schiffe bekommen ihre Sitzplätze.</li>
          <li><strong>Crew schnappt sich Plätze</strong> — jeder sieht, was noch frei ist, und klickt sich rein.</li>
          <li><strong>Es geht los</strong> — alle wissen, wo sie hingehören. Danach gibt's eine Teilnehmerliste.</li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Nette Extras (optional)</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ul style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Mission Cover</strong> — ein schickes Briefing-Poster für die Operation, automatisch aus den Daten erzeugt.</li>
          <li><strong>Voice / Funk</strong> — Sprach-Kanäle für die Mission, <strong>über die Raumdock-Infrastruktur</strong>. Das bringt zwei Dinge (einfach gesagt):
            <ul style="margin:.35rem 0 0;padding-left:1.1rem;line-height:1.6">
              <li><strong>Geschlossener Missions-Funk:</strong> nur wer zur Mission gehört, hört mit — und das über Channel-Grenzen hinweg (ähnlich „Whisper to" bei TeamSpeak).</li>
              <li><strong>Durchsage in Discord-Kanäle:</strong> einer spricht, alle hören — direkt in euren Discord-Sprachkanälen.</li>
            </ul>
          </li>
          <li><strong>Erinnerungen</strong> — Discord schickt rechtzeitig eine Nachricht, bevor es losgeht.</li>
          <li><strong>Partner-Server</strong> — befreundete Orgs können gemeinsame Einsätze sehen und mitmachen.</li>
        </ul>
      </div>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem;border-left:3px solid var(--cyan,#22d3ee)">
        <p style="margin:0"><strong>Wichtig:</strong> Der Fleetmanager ändert <em>nichts im Spiel</em>.
        Er ist die Organisation <em>drumherum</em> — Planung, Plätze, Absprache. Im Spiel fliegt
        natürlich weiter jeder selbst. 🚀</p>
      </div>
    </div>

    <div class="section">
      <a href="${bp}/how-to" class="btn btn-cyan">Weiter zur ausführlichen Anleitung →</a>
    </div>`;

  const enBody = html` <div class="page-header">
      <h1 class="page-title">WHAT IS THE FLEETMANAGER?</h1>
      <p class="page-subtitle">The short version — no tech jargon.</p>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">
          The <strong>Fleetmanager</strong> is a planning tool for Star Citizen operations. Picture
          your org heading out with 30 people and 10 ships — coordinating all that in a Discord chat
          turns into chaos fast. The Fleetmanager turns it into a tidy list:
          <strong>who flies what, who sits where, when it kicks off.</strong>
        </p>
        <p style="margin-top:.6rem">
          It plugs straight into your Discord server. Whatever you plan here shows up as a
          <strong>Discord event</strong> — nobody has to learn a new app.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">The simple idea</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <p style="margin:0">Think of a <strong>wedding seating plan</strong> — just for spaceships:</p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead><tr><th>In the Fleetmanager</th><th>Is like…</th></tr></thead>
          <tbody>
            <tr><td><strong>Operation</strong></td><td>the event (e.g. "Daymar raid, Saturday 8pm")</td></tr>
            <tr><td><strong>Ship / unit</strong></td><td>a table</td></tr>
            <tr><td><strong>Seat</strong></td><td>a chair at the table (pilot, gunner, medic …)</td></tr>
            <tr><td><strong>Crew</strong></td><td>the guests who grab a chair</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Who does what?</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <table class="user-table" style="width:100%">
          <thead><tr><th>Role</th><th>Job</th></tr></thead>
          <tbody>
            <tr><td><strong>Fleet&nbsp;Op</strong> <span class="text-dim">(operator)</span></td><td>plans the operation: what, when, where. The host.</td></tr>
            <tr><td><strong>Crew</strong></td><td>every member. Sees which ships are flying and grabs a seat.</td></tr>
            <tr><td><strong>Captain</strong> <span class="text-dim">(not a rank)</span></td><td>you become one automatically the moment you register a ship — you then manage its seats. Only for that one ship in that one operation.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">How an operation runs</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ol style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>The Fleet Op creates the operation</strong> — title, time, rendezvous. It instantly appears as a Discord event.</li>
          <li><strong>Captains offer their ships</strong> — "I'll bring my Carrack, 4 seats".</li>
          <li><strong>The Fleet Op accepts ships</strong> — accepted ships open their seats.</li>
          <li><strong>Crew grab seats</strong> — everyone sees what's still free and clicks in.</li>
          <li><strong>It kicks off</strong> — everyone knows where they belong. Afterwards there's a participant list.</li>
        </ol>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Nice extras (optional)</div>
      <div class="${card}" style="padding:1.1rem;max-width:54rem">
        <ul style="margin:0;padding-left:1.2rem;line-height:1.7">
          <li><strong>Mission Cover</strong> — a slick briefing-poster image for the operation, generated automatically from its data.</li>
          <li><strong>Voice / comms</strong> — mission voice channels, <strong>powered by the Raumdock infrastructure</strong>. In plain terms it gives you two things:
            <ul style="margin:.35rem 0 0;padding-left:1.1rem;line-height:1.6">
              <li><strong>Closed mission comms:</strong> only people in the mission hear it — across channel boundaries (like TeamSpeak's "Whisper to").</li>
              <li><strong>Broadcast into Discord channels:</strong> one person talks, everyone hears — straight into your Discord voice channels.</li>
            </ul>
          </li>
          <li><strong>Reminders</strong> — Discord pings everyone in time before it starts.</li>
          <li><strong>Partner servers</strong> — friendly orgs can see and join shared operations.</li>
        </ul>
      </div>
    </div>

    <div class="section">
      <div class="${card}" style="padding:1.1rem;max-width:54rem;border-left:3px solid var(--cyan,#22d3ee)">
        <p style="margin:0"><strong>Important:</strong> the Fleetmanager changes <em>nothing in the game</em>.
        It's the organisation <em>around</em> it — planning, seats, coordination. In game everyone
        still flies for themselves. 🚀</p>
      </div>
    </div>

    <div class="section">
      <a href="${bp}/how-to" class="btn btn-cyan">On to the detailed guide →</a>
    </div>`;

  return layout({
    title: de ? "Was ist der Fleetmanager?" : "What is the Fleetmanager?",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body: html`${langToggle}${de ? deBody : enBody}`,
  });
}

export function scToolsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  tools: Array<{ url: string; domain: string; name: string; desc: string; image: string | null }>;
}): SafeHtml {
  const bp = opts.basePath;
  const body = html`<div class="page-header">
      <h1 class="page-title">STAR CITIZEN TOOLS</h1>
      <p class="page-subtitle">made by the Community — nützliche externe Werkzeuge rund um Star Citizen.</p>
    </div>
    <style>
      .sct-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; }
      .sct-card { display: flex; flex-direction: column; border: 1px solid var(--border, #26303d); background: var(--bg2, #0d1117); text-decoration: none; color: inherit; overflow: hidden; transition: border-color .15s; }
      .sct-card:hover { border-color: var(--cyan, #35d0e0); }
      .sct-img { aspect-ratio: 1200/630; background: #05080f center/cover no-repeat; border-bottom: 1px solid var(--border, #26303d); }
      .sct-noimg { aspect-ratio: 1200/630; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, #0b1320, #111c2b); color: var(--cyan, #35d0e0); font-family: var(--font-mono); font-weight: 700; letter-spacing: 1px; border-bottom: 1px solid var(--border, #26303d); }
      .sct-body { padding: .7rem .85rem; display: flex; flex-direction: column; gap: .3rem; }
      .sct-name { font-weight: 700; }
      .sct-desc { font-size: .85rem; color: var(--text, #cdd9e1); line-height: 1.4; }
      .sct-domain { font-size: .72rem; color: var(--dim, #7a8a96); font-family: var(--font-mono); margin-top: auto; }
    </style>
    <div class="section">
      <div class="sct-grid">
        ${opts.tools.map(
          (t) => html`<a class="sct-card" href="${t.url}" target="_blank" rel="noopener noreferrer">
            ${t.image
              ? html`<div class="sct-img" style="background-image:url('${t.image}')"></div>`
              : html`<div class="sct-noimg">${t.domain}</div>`}
            <div class="sct-body">
              <span class="sct-name">${t.name}</span>
              <span class="sct-desc">${t.desc}</span>
              <span class="sct-domain">${t.domain} ↗</span>
            </div>
          </a>`,
        )}
      </div>
    </div>
    <div class="section">
      <p class="text-dim text-sm" style="max-width:54rem">
        Diese Tools werden von der Community gepflegt und stehen in keiner Verbindung zu Raumdock.
        Links öffnen extern.
      </p>
    </div>`;
  return layout({
    title: "Star Citizen Tools",
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    body,
  });
}

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
          The core — planning operations and posting them as Discord scheduled events — needs nothing
          but this web app and the Fleetplanner Discord bot. Voice, briefing covers and metrics are
          <strong>optional add-ons</strong> (see below).
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Optional features</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          These extend the Fleetplanner but are not required to plan and run operations:
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr><th>Add-on</th><th>What it adds</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-cyan">RDOC Squad Link (Companion)</span></td>
              <td>
                The desktop app for <strong>mission voice</strong> (Command Net + Global Radio Net).
                Only needed by people who use voice during an op, and only when a server has voice
                enabled by the SuperAdmin. Without it, planning still works fully.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-gold">Mission Cover</span></td>
              <td>
                A generator for cinematic briefing-cover images per operation (banner, share preview,
                Discord-event image). If the cover service isn't configured, the op simply uses no
                custom cover.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-dim">Monitoring</span></td>
              <td>Operational metrics dashboard for operators of the instance. Not player-facing.</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Roles</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          There are only <strong>three</strong> roles, shown as a coloured tag next to your name.
          Fleet roles and mission roles are separate: a fleet role grants platform/server
          permissions; it does <strong>not</strong> automatically grant mission voice — that is
          assigned per operation (see Mission voice).
        </p>
        <table class="user-table" style="width:100%;margin-top:.75rem">
          <thead>
            <tr>
              <th>Tag</th>
              <th>Role</th>
              <th>What they can do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-role">ADMIRAL</span></td>
              <td>Superadmin</td>
              <td>Instance owner. Manage all Discord servers, ban/unban servers, trigger ship sync, configure the voice bridge. One per instance.</td>
            </tr>
            <tr>
              <td><span class="tag tag-role">FLEET OP</span></td>
              <td>Fleetoperator</td>
              <td>
                A server's operator. Add the bot to a Discord, create &amp; manage operations,
                accept/reject units, assign mission leaders, manage composition, post Discord
                scheduled events. (Auto-assigned from the server's mapped Discord role; the
                installing user becomes Fleet Op.)
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-role">CREW</span></td>
              <td>Crew</td>
              <td>Default role for every member. Claim open seats, request assignments, and offer ships/CQB teams.</td>
            </tr>
          </tbody>
        </table>
        <p class="text-dim text-sm" style="margin-top:.75rem;margin-bottom:0">
          <strong>"Captain" is not a fleet role.</strong> Anyone — Crew or Fleet Op — becomes the
          <em>captain</em> of a unit simply by registering a ship or CQB team in an operation; they
          then manage that unit's seats. It is per-unit and per-operation, not a rank.
        </p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Mission voice</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <p style="margin-top:0">
          <em>Optional add-on.</em> Mission voice runs over a separate LiveKit audio path (Discord
          audio is never touched) and is reached through the optional <strong>RDOC Squad Link</strong>
          companion app using two push-to-talk keys. It requires the server to have voice enabled by
          the SuperAdmin. It is granted per operation via the <strong>Commanders</strong> tab — a
          mission roster, not an admin roster. Fleet admins are not on the nets unless assigned a
          mission role.
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
            <tr><td>Fleet Op (operator)</td><td>No by default</td><td>No by default</td></tr>
            <tr><td>Ship Captain</td><td>Yes</td><td>No by default</td></tr>
            <tr><td>CQB Captain</td><td>Yes</td><td>No by default</td></tr>
            <tr><td>Added Commander</td><td>Yes</td><td>Optional</td></tr>
          </tbody>
        </table>
        <p class="text-dim text-sm" style="margin-top:.75rem;margin-bottom:0">
          The Fleet Op (server operator) manages mission needs and confirms units but is not
          automatically on the Command Net. To request Global Radio (RelayBot) voice for your server,
          contact the SuperAdmin (see Contact &amp; support below).
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
            Go to <strong>Servers → Settings</strong> to set an optional event voice channel, a
            Discord invite link (shown to guests on the signup page), and Discord-role mapping
            (auto-assigns Admiral permissions on login).
          </li>
          <li>
            Click <strong>+ New Operation</strong> to launch the <strong>guided wizard</strong>:
            basics (title, date in your server's timezone, type) → briefing (Markdown) → Discord →
            <strong>Fleet Requirements</strong> (with templates) → review. Optionally make it
            <strong>recurring</strong> (weekly / every 2 weeks / monthly / yearly) and/or jump to the
            Mission Cover after creating.
          </li>
          <li>
            You land in the <strong>management workspace</strong> (status flow Draft → Open → Live →
            Done, with a "next step" button and attention tabs).
          </li>
          <li>
            Set status to <strong>Open</strong> — a Discord scheduled event is posted automatically
            (with the cover image if you made one).
          </li>
          <li>
            Accept incoming ships / CQB teams (and any carried ground vehicles). Accepted units open
            their seats for crew; assign people to composition slots as needed.
          </li>
          <li>
            Optionally (with voice enabled): prepare mission voice and pull unit crews into their
            Discord voice channels.
          </li>
          <li>
            When done, set status to <strong>Completed</strong> (export participants as CSV) or
            <strong>Cancelled</strong> (event removed from Discord).
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
            your server's operations). Guests of public ops can use the <strong>Discord</strong>
            invite link on the signup page to join the server.
          </li>
          <li>
            Open an operation — the <strong>signup page</strong> has an "I want to join" assistant
            with three choices: <strong>let the operator place me</strong>, <strong>take an open
            seat</strong>, or <strong>offer a ship / CQB team</strong>.
          </li>
          <li>
            If you offer a ship: configure its seats (rename, enable/disable) while it's still
            pending, withdraw it if needed, and (on a ship with a big-enough cargo bay) add a
            <strong>ground vehicle</strong> as a crewable sub-unit. Wait for the operator to accept.
          </li>
          <li>
            See the <strong>accepted units</strong> right on the page and claim/release seats inline —
            no separate edit mode.
          </li>
          <li>
            Fill <strong>Profile → Owned Ships</strong> for quick selection — type by hand or
            <strong>import a CCU-Game JSON</strong> export; unmatched names can be assigned manually.
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

export function roadmapPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const groups: Array<{ key: RoadmapStatus; label: string; tag: string }> = [
    { key: "planned", label: "Geplant", tag: "tag-gold" },
    { key: "blocked", label: "Blockiert", tag: "tag-dim" },
    { key: "rejected", label: "Abgelehnt", tag: "tag-red" },
    { key: "done", label: "Erledigt", tag: "tag-green" },
  ];
  const sections = groups.map((g) => {
    const items = ROADMAP.filter((r) => r.status === g.key);
    if (!items.length) return safe("");
    return html`<div class="section">
      <div class="section-title">${g.label} (${items.length})</div>
      ${items.map(
        (r) => html`<div class="card" style="padding:1rem 1.25rem;max-width:52rem;margin-bottom:.85rem">
          <div class="card-header" style="margin-bottom:.6rem;padding-bottom:.55rem">
            <span class="card-title" style="flex:1">${r.title}</span>
            <span class="tag ${g.tag}">${g.label}</span>
          </div>
          <p style="margin:0">${r.desc}</p>
          ${r.note ? html`<p class="text-dim text-sm" style="margin:.4rem 0 0">${r.note}</p>` : safe("")}
          ${r.reason
            ? html`<div style="margin:.5rem 0 0;border-left:2px solid var(--red,#e0556b);padding-left:.8rem">
                ${r.reason.split("\n\n").map((p, i) =>
                  i === 0
                    ? html`<p style="margin:0 0 .4rem;font-weight:600">${p}</p>`
                    : html`<p class="text-dim" style="margin:0 0 .4rem">${p}</p>`,
                )}
              </div>`
            : safe("")}
        </div>`,
      )}
    </div>`;
  });

  const body = html`<div class="page-header">
      <h1 class="page-title">ROADMAP</h1>
      <div class="page-subtitle">Was geplant ist und was schon umgesetzt wurde.</div>
    </div>
    ${sections}
    <div class="section">
      <div class="card" style="padding:1rem;max-width:52rem">
        <p class="text-dim text-sm">
          Idee oder Wunsch? Nutze den <a href="${bp}/feedback">Feedback</a>-Tab.
        </p>
      </div>
    </div>`;

  return layout({
    title: "Roadmap",
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
  incomingShared?: number;
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
        <a href="${bp}/guilds/partnerships" class="btn btn-gold btn-sm">Partnerships${
          opts.incomingShared ? safe(` <span class="tag tag-gold">${String(opts.incomingShared)}</span>`) : safe("")
        }</a>
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
  partnerGuildId: string | null;
  partnerGuildName: string | null;
  isInitiator: boolean;
  activatedAt: Date | null;
  createdAt: Date;
  /** FR-P1: auto-post THIS partner's events into our Discord. */
  autoShare?: boolean;
};

export type IncomingDistributionView = {
  id: string;
  opTitle: string;
  scheduledAt: Date;
  meetingSystem: string;
  meetingLocation: string;
  hostGuildName: string;
  hostOrgName: string | null;
};

export function partnershipsPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  activeGuildId: string;
  activeGuildName: string;
  partnerships: PartnershipView[];
  incoming?: IncomingDistributionView[];
  freshInviteUrl?: string;
  prefillToken?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const active = opts.partnerships.filter((p) => p.status === "active");
  const pending = opts.partnerships.filter((p) => p.status === "pending");
  const incoming = opts.incoming ?? [];

  const incomingSection = incoming.length
    ? html`<div class="section">
        <div class="section-title">
          Shared with us <span class="tag tag-gold">${String(incoming.length)}</span>
        </div>
        <p class="text-dim text-sm" style="margin:-.25rem 0 .75rem">
          Partner Discords want to post these operations into <em>${opts.activeGuildName}</em>.
          Any fleetoperator can decide. Approving creates the event in your Discord; declining is
          per-event only and never blocks future invites.
        </p>
        <div class="card" style="padding:0">
          <table>
            <thead><tr><th>Operation</th><th>From</th><th>When</th><th></th></tr></thead>
            <tbody>
              ${incoming.map(
                (d) => html`<tr>
                  <td><strong>${d.opTitle}</strong>
                    <div class="text-dim text-sm">${d.meetingLocation ? `${d.meetingSystem} · ${d.meetingLocation}` : d.meetingSystem}</div>
                  </td>
                  <td>${d.hostOrgName ? html`<strong>${d.hostOrgName}</strong><div class="text-dim text-sm">${d.hostGuildName}</div>` : html`<strong>${d.hostGuildName}</strong>`}</td>
                  <td><span class="text-mono text-sm">${fmtDate(d.scheduledAt)}</span></td>
                  <td class="text-right" style="white-space:nowrap">
                    <form method="post" action="${bp}/guilds/partnerships/event/${d.id}/approve" class="inline">
                      <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
                      <button type="submit" class="btn btn-green btn-sm">Teilen</button>
                    </form>
                    <form method="post" action="${bp}/guilds/partnerships/event/${d.id}/decline" class="inline">
                      <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
                      <button type="submit" class="btn btn-ghost btn-sm">Ablehnen</button>
                    </form>
                  </td>
                </tr>`,
              )}
            </tbody>
          </table>
        </div>
      </div>`
    : safe("");

  const activeRows = active.length
    ? active.map(
        (p) => html`<tr>
          <td><strong>${p.partnerGuildName ?? "—"}</strong></td>
          <td><span class="text-dim text-sm">${p.label}</span></td>
          <td><span class="text-mono text-sm">${p.activatedAt ? fmtDate(p.activatedAt) : "—"}</span></td>
          <td>
            ${p.partnerGuildId
              ? html`<form method="post" action="${bp}/guilds/partnerships/${p.partnerGuildId}/auto-share" class="inline">
                  <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
                  <input type="hidden" name="autoShare" value="${p.autoShare ? "0" : "1"}" />
                  <button type="submit" class="btn btn-sm ${p.autoShare ? "btn-green" : "btn-ghost"}"
                    title="When on, this partner's operations auto-post into our Discord with no per-event approval.">
                    ${p.autoShare ? "Auto-share: ON" : "Auto-share: off"}
                  </button>
                </form>`
              : safe("—")}
          </td>
          <td class="text-right">
            <form method="post" action="${bp}/guilds/partnerships/${p.id}/revoke" class="inline"
              onsubmit="return confirm('Really end the partnership with ${p.partnerGuildName ?? "this Discord"}? This is permanent.');">
              <input type="hidden" name="_csrf" value="${opts.csrfToken ?? ""}" />
              <button type="submit" class="btn btn-danger btn-sm">Revoke</button>
            </form>
          </td>
        </tr>`,
      )
    : [html`<tr><td colspan="5"><span class="text-dim text-sm">No active partnerships.</span></td></tr>`];

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

    ${incomingSection}

    <div class="section">
      <div class="section-title">Active partners</div>
      <div class="card" style="padding:0">
        <table>
          <thead><tr><th>Discord</th><th>Label</th><th>Since</th><th>Their events</th><th></th></tr></thead>
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
