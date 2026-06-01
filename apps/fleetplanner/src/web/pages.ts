import { html, safe, rawHtml, layout, type SafeHtml, type LayoutOptions } from "./render.js";
import type { User, Operation, Ship, Location } from "@prisma/client";
import type { DiscordInstallDiagnostics, BotDiagnostic } from "../services/discordDiagnostics.js";
import { fmtDateTz, fmtDateLocalTz, TIMEZONE_OPTIONS, DEFAULT_TIMEZONE } from "../lib/timezone.js";

// ── Re-export layout for routes ─────────────────────────────────────
export { layout, rawHtml } from "./render.js";

// ── Types returned by getOperation() includes ───────────────────────
type OpFull = Awaited<ReturnType<typeof import("../services/operations.js").getOperation>>;
type UnitFull = NonNullable<OpFull>["units"][number];

// ── Shared helpers ───────────────────────────────────────────────────

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

function roleLabel(role: string): string {
  return role.replace(/_/g, " ");
}

function eventStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Planning",
    open: "Planning",
    locked: "Locked",
    in_progress: "In Progress",
    completed: "Completed",
    cancelled: "Canceled",
  };
  return map[status] ?? status;
}

function discordAvatarUrl(user: Pick<User, "id" | "avatarHash">): string | null {
  return user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatarHash}.webp?size=80`
    : null;
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

function opUiSwitch(bp: string, opId: string, mode: "classic" | "new", tab = "overview"): SafeHtml {
  return html`<span class="nav-ui-switch" aria-label="Operation UI switch">
    <a href="${bp}/ops/${opId}" class="${mode === "classic" ? "active" : ""}">Classic</a>
    <a href="${bp}/ops/${opId}?ui=new&tab=${tab}" class="${mode === "new" ? "active" : ""}">New</a>
  </span>`;
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

type OpListItem = {
  id: string;
  title: string;
  opType: string;
  scheduledAt: Date;
  status: string;
  guild: { id: string; name: string; iconHash: string | null };
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

  // Assign a consistent CSS class per guild for the colored badge
  const guildIndex = new Map<string, number>();
  let guildCounter = 0;
  const GUILD_COLORS = ["guild-a", "guild-b", "guild-c", "guild-d", "guild-e"];
  function guildClass(guildId: string): string {
    if (!guildIndex.has(guildId)) guildIndex.set(guildId, guildCounter++ % GUILD_COLORS.length);
    return GUILD_COLORS[guildIndex.get(guildId)!];
  }

  const rows = opts.ops.length
    ? html` <div class="op-list">
        ${opts.ops.map((op) => {
          const accepted = op.units.filter((u) => u.status === "accepted").length;
          const total = op.units.length;
          return html` <a
            href="${bp}/ops/${op.id}"
            class="op-row"
            style="color:inherit;text-decoration:none;"
          >
            <span class="op-guild-badge ${guildClass(op.guild.id)}">${op.guild.name}</span>
            <span class="op-time">${fmtDate(op.scheduledAt)}</span>
            <span class="op-title">${op.title}</span>
            ${opTypeTag(op.opType)} ${statusTag(op.status)}
            <span class="op-count">${accepted}/${total} units</span>
          </a>`;
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
  availableVoiceBotCount: number;
  voiceEnabled: boolean;
  missionVoice?: { globalVoiceRoom: string | null; commanderVoiceRoom: string | null } | null;
  /** IANA timezone of the guild — used to display/parse scheduledAt. */
  guildTimezone?: string;
  /** Fleet voice links per eligible user — only passed for fleetoperator+ views */
  fleetVoiceLinks?: Array<{ userId: string; username: string; link: string }> | null;
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
  viewAsRole?: string;
};

export function opDetailPage(opts: OpDetailPageOptions): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const realUser = opts.currentUser;
  const previewRoles = ["guest", "crew", "captain", "fleetoperator", "superadmin"];
  const canPreview =
    !!realUser && (realUser.role === "superadmin" || realUser.role === "fleetoperator");
  const viewAsRole =
    canPreview && opts.viewAsRole && previewRoles.includes(opts.viewAsRole) ? opts.viewAsRole : "";
  const u =
    viewAsRole === "guest"
      ? null
      : viewAsRole && realUser
        ? { ...realUser, role: viewAsRole }
        : realUser;
  const csrf = opts.csrfToken ?? "";

  const currentUserId = u?.id;
  const isLeader =
    !!u &&
    (u.role === "superadmin" ||
      u.role === "fleetoperator" ||
      op.leaders.some((l) => l.user.id === currentUserId));
  const canManage = u && (u.role === "superadmin" || u.role === "fleetoperator");
  const canRealManage =
    realUser && (realUser.role === "superadmin" || realUser.role === "fleetoperator");

  // Separate unslotted units (no requirementId) from slotted ones
  const unslottedUnits = op.units.filter((unit) => !unit.requirementId);

  // ── Unit card ──────────────────────────────────────────────────────
  function unitCard(unit: UnitFull): SafeHtml {
    const isCaptain = u && unit.captainId === u.id;
    const unitName =
      unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
    const canConfigureSeats = !!(isCaptain || canManage);

    const seats = unit.seats.map((seat) => {
      const claimed = !!seat.userId;
      const isMe = u && seat.userId === u.id;
      const canClaim =
        u && seat.active && seat.order !== 0 && !claimed && unit.status === "accepted";
      const canAssign =
        isLeader && seat.active && seat.order !== 0 && !claimed && unit.status === "accepted";
      const canUnclaim = claimed && (isMe || isLeader);

      return html` <div class="seat-row ${seat.active ? "" : "seat-disabled"}">
        <span class="seat-label">${seat.label}</span>
        <span class="seat-type text-mono" style="font-size:0.65rem;color:var(--dim)"
          >${seat.seatType}</span
        >
        <span class="seat-user ${claimed ? "" : "empty"}"
          >${claimed ? (seat.user?.username ?? "?") : "— open —"}</span
        >
        ${!seat.active ? html`<span class="tag tag-dim">disabled</span>` : ""}
        ${canClaim
          ? html` <form method="post" action="${bp}/api/seats/${seat.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-green">Claim</button>
            </form>`
          : ""}
        ${canAssign
          ? html` <details class="seat-assign-details">
              <summary class="btn btn-sm btn-ghost">Assign to user...</summary>
              <form
                method="post"
                action="${bp}/api/seats/${seat.id}/assign"
                class="seat-assign-form"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <select name="userId" required>
                  <option value="">Select user...</option>
                  ${opts.assignableUsers.map(
                    (user) => html`
                      <option value="${user.id}">${user.username} (${user.role})</option>
                    `,
                  )}
                </select>
                <button type="submit" class="btn btn-sm">Add</button>
              </form>
            </details>`
          : ""}
        ${canUnclaim && !(seat.order === 0 && !canManage)
          ? html` <form method="post" action="${bp}/api/seats/${seat.id}/unclaim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-ghost">Release</button>
            </form>`
          : ""}
      </div>`;
    });

    const seatSetup = canConfigureSeats
      ? html` <details class="seat-setup">
          <summary>Seat Setup</summary>
          <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/seats">
            <input type="hidden" name="_csrf" value="${csrf}" />
            ${unit.seats.map((seat) => {
              const placeholder =
                seat.seatType === "fps"
                  ? "Boomtuber, Railgunner, Medic, Soldier, Sniper"
                  : "Turret top, Turret bottom, Engineer, Scanner";
              return html` <div class="seat-setup-row">
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
        </details>`
      : "";

    return html` <div class="unit-card status-${unit.status}">
      <div class="unit-card-header">
        <span class="unit-name">${unitName}</span>
        ${unit.unitType === "squad" ? html`<span class="tag">FPS</span>` : ""}
        ${statusTag(unit.status)}
        ${canManage && unit.status === "accepted"
          ? html` <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/discord-role"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="role" value="commander" />
                <button type="submit" class="btn btn-sm btn-gold">Commander</button>
              </form>
              <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/discord-role"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="role" value="admiral" />
                <button type="submit" class="btn btn-sm btn-gold">Admiral</button>
              </form>`
          : ""}
        ${isLeader && unit.status === "pending"
          ? html` <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/accept"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-green">Accept</button>
              </form>
              <form
                method="post"
                action="${bp}/api/ops/${op.id}/units/${unit.id}/reject"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-danger">Reject</button>
              </form>`
          : ""}
        ${isCaptain || canManage
          ? html` <form
              method="post"
              action="${bp}/api/ops/${op.id}/units/${unit.id}/delete"
              class="inline"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="btn btn-sm btn-ghost"
                onclick="return confirm('Delete this unit?')"
              >
                ✕
              </button>
            </form>`
          : ""}
      </div>
      <div class="unit-captain">Captain: ${unit.captain.username}</div>
      ${unit.captainNote
        ? html`<div class="text-dim text-sm mb-1">Note: ${unit.captainNote}</div>`
        : ""}
      ${unit.leaderNote
        ? html`<div class="text-dim text-sm mb-1" style="color:var(--gold)">
            Leader note: ${unit.leaderNote}
          </div>`
        : ""}
      ${seatSetup}
      <div>${seats}</div>
    </div>`;
  }

  // ── Composition groups ─────────────────────────────────────────────
  const CATEGORIES = [
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
  ];

  const groupsSection = html` <div class="section">
    <div
      class="section-title"
      style="display:flex;align-items:center;justify-content:space-between"
    >
      <span>Composition</span>
      ${canManage
        ? html`<button class="btn btn-sm" onclick="toggleForm('add-group-form')">
            + Add Group
          </button>`
        : ""}
    </div>
    ${canManage
      ? html` <div id="add-group-form" hidden style="margin-bottom:1rem">
          <form
            method="post"
            action="${bp}/api/ops/${op.id}/groups"
            style="display:flex;gap:0.5rem;align-items:flex-end;flex-wrap:wrap"
          >
            <input type="hidden" name="_csrf" value="${csrf}" />
            <div class="form-group" style="margin:0;flex:1;min-width:14rem">
              <label>Group Name</label>
              <input
                type="text"
                name="name"
                placeholder="e.g. Strike Wing, Mining Fleet"
                required
              />
            </div>
            <button type="submit" class="btn btn-sm">Add Group</button>
            <button
              type="button"
              class="btn btn-sm btn-ghost"
              onclick="toggleForm('add-group-form')"
            >
              Cancel
            </button>
          </form>
        </div>`
      : ""}
    ${op.groups.length
      ? op.groups.map(
          (g) =>
            html` <div class="card mb-1">
              <div class="card-header">
                <span class="card-title">${g.name}</span>
                ${canManage
                  ? html` <button
                        class="btn btn-sm btn-ghost"
                        onclick="toggleForm('req-form-${g.id}')"
                      >
                        + Requirement
                      </button>
                      <form
                        method="post"
                        action="${bp}/api/ops/${op.id}/groups/${g.id}/delete"
                        class="inline"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <button
                          type="submit"
                          class="btn btn-sm btn-danger"
                          onclick="return confirm('Delete group and all requirements?')"
                        >
                          ✕ Group
                        </button>
                      </form>`
                  : ""}
              </div>
              ${canManage
                ? html` <div
                    id="req-form-${g.id}"
                    hidden
                    style="padding:0.75rem;background:var(--bg3);margin-bottom:1rem"
                  >
                    <form method="post" action="${bp}/api/ops/${op.id}/groups/${g.id}/requirements">
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <div
                        style="display:grid;grid-template-columns:2fr 1fr 4rem 3fr auto;gap:0.5rem;align-items:flex-end"
                      >
                        <div class="form-group" style="margin:0">
                          <label>Label</label>
                          <input
                            type="text"
                            name="label"
                            placeholder="e.g. Orion, Fighter Wing"
                            required
                          />
                        </div>
                        <div class="form-group" style="margin:0">
                          <label>Category</label>
                          <select name="category">
                            ${CATEGORIES.map((c) => html`<option value="${c}">${c}</option>`)}
                          </select>
                        </div>
                        <div class="form-group" style="margin:0">
                          <label>Count</label>
                          <input type="number" name="count" value="1" min="1" max="20" />
                        </div>
                        <div class="form-group" style="margin:0">
                          <label>Note (optional)</label>
                          <input type="text" name="note" placeholder="Ship type, notes…" />
                        </div>
                        <div>
                          <label style="visibility:hidden">x</label
                          ><button type="submit" class="btn btn-sm">Add</button>
                        </div>
                      </div>
                    </form>
                  </div>`
                : ""}
              ${g.requirements.length
                ? g.requirements.map(
                    (req) =>
                      html` <div style="margin-bottom:1rem">
                        <div
                          class="flex gap-1"
                          style="align-items:center;margin-bottom:0.5rem;flex-wrap:wrap"
                        >
                          <span class="tag tag-gold">${req.count}× ${req.label}</span>
                          <span class="tag tag-dim">${req.category}</span>
                          <span class="text-dim text-sm"
                            >${req.fleetUnits.filter((fu) => fu.status !== "rejected")
                              .length}/${req.count}
                            filled</span
                          >
                          ${req.note
                            ? html`<span class="text-dim text-sm">— ${req.note}</span>`
                            : ""}
                          ${canManage
                            ? html` <form
                                method="post"
                                action="${bp}/api/ops/${op.id}/requirements/${req.id}/delete"
                                class="inline"
                              >
                                <input type="hidden" name="_csrf" value="${csrf}" />
                                <button
                                  type="submit"
                                  class="btn btn-sm btn-ghost"
                                  onclick="return confirm('Delete requirement?')"
                                >
                                  ✕
                                </button>
                              </form>`
                            : ""}
                        </div>
                        ${req.fleetUnits.length
                          ? html`<div class="unit-grid">
                              ${req.fleetUnits.map((unit) => unitCard(unit as UnitFull))}
                            </div>`
                          : html`<p class="text-dim text-sm" style="padding:0 0.5rem">
                              — No units registered for this slot yet —
                            </p>`}
                      </div>`,
                  )
                : html`<p class="text-dim text-sm">
                    No requirements yet.${canManage ? ' Click "+ Requirement" to add one.' : ""}
                  </p>`}
            </div>`,
        )
      : html`<p class="text-dim text-sm">
          No composition
          defined.${canManage ? html` Click <b>+ Add Group</b> to structure the fleet.` : ""}
        </p>`}
  </div>`;

  // ── Register unit form ─────────────────────────────────────────────
  const canRegister = u && (op.status === "open" || op.status === "draft");
  const myCrewRequest = u ? op.crewRequests.find((request) => request.user.id === u.id) : null;

  // Available composition slots (not yet fully filled by non-rejected units)
  const availableSlots = op.groups.flatMap((g) =>
    g.requirements
      .filter((r) => r.fleetUnits.filter((fu) => fu.status !== "rejected").length < r.count)
      .map((r) => {
        const filled = r.fleetUnits.filter((fu) => fu.status !== "rejected").length;
        return { id: r.id, label: `${g.name}: ${r.label} (${filled}/${r.count})` };
      }),
  );

  const registerForm = canRegister
    ? html` <div class="section">
        <button class="btn btn-sm" onclick="toggleRegister(this)" type="button">
          + Register a Unit
        </button>
        <div class="collapse-body" id="register-body">
          <div class="type-tabs mb-1">
            <button type="button" class="type-tab active" onclick="switchTab(this,'ship')">
              Ship
            </button>
            <button type="button" class="type-tab" onclick="switchTab(this,'squad')">
              FPS Squad
            </button>
          </div>

          <form method="post" action="${bp}/api/ops/${op.id}/units" id="register-form">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="unitType" id="unit-type-field" value="ship" />

            <div id="ship-section">
              ${opts.ownedShips.length
                ? html` <div class="form-group">
                    <label>Owned Ship (optional)</label>
                    <select name="ownedShipId" id="owned-ship-select">
                      <option value="">-- Search another ship below --</option>
                      ${opts.ownedShips.map(
                        (ship) => html`
                          <option value="${ship.id}">
                            ${ship.name}${ship.manufacturer ? ` // ${ship.manufacturer}` : ""}
                          </option>
                        `,
                      )}
                    </select>
                  </div>`
                : ""}
              <div class="form-group">
                <label>Search Ship</label>
                <input
                  type="search"
                  id="ship-search"
                  placeholder="Type ship name..."
                  autocomplete="off"
                />
                <div id="ship-results" class="ship-results"></div>
                <input type="hidden" name="shipId" id="ship-id-field" />
              </div>
              <label
                class="text-sm text-dim"
                style="display:flex;align-items:center;gap:.4rem;margin-top:-.5rem;margin-bottom:1rem"
              >
                <input type="checkbox" name="storeOwnedShip" value="1" />
                Store this ship in my profile
              </label>
              <p class="text-dim text-sm" style="margin-top:-0.5rem;margin-bottom:1rem">
                Profile ships can also be managed at <a href="${bp}/profile">/profile</a>.
              </p>
            </div>

            <div id="squad-section" hidden>
              <div class="form-row">
                <div class="form-group">
                  <label>Squad Name</label>
                  <input type="text" name="squadName" placeholder="Alpha Squad" />
                </div>
                <div class="form-group">
                  <label>Squad Size (incl. you)</label>
                  <input type="number" name="squadSize" min="2" max="8" value="4" />
                </div>
              </div>
            </div>

            ${availableSlots.length
              ? html` <div class="form-group">
                  <label>Fill Composition Slot (optional)</label>
                  <select name="requirementId">
                    <option value="">-- Unslotted --</option>
                    ${availableSlots.map(
                      (slot) => html`<option value="${slot.id}">${slot.label}</option>`,
                    )}
                  </select>
                </div>`
              : ""}

            <div class="form-group">
              <label>Note for leaders (optional)</label>
              <input
                type="text"
                name="captainNote"
                placeholder="Any information for the fleet operator"
              />
            </div>

            <div class="form-actions">
              <button type="submit" class="btn">Register Unit</button>
            </div>
          </form>
        </div>
      </div>`
    : "";
  const crewRequestPanel = canRegister
    ? html` <div class="section">
        <div class="section-title">Crewmember Assignment</div>
        ${myCrewRequest
          ? html` <div class="flex gap-1" style="align-items:center;flex-wrap:wrap">
              <span class="tag tag-green">Need assignment</span>
              ${myCrewRequest.note
                ? html`<span class="text-dim text-sm">${myCrewRequest.note}</span>`
                : ""}
              <form
                method="post"
                action="${bp}/api/ops/${op.id}/crew-requests/remove"
                class="inline"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <button type="submit" class="btn btn-sm btn-ghost">Cancel</button>
              </form>
            </div>`
          : html` <form
              method="post"
              action="${bp}/api/ops/${op.id}/crew-requests"
              class="flex gap-1"
              style="align-items:flex-end;flex-wrap:wrap"
            >
              <input type="hidden" name="_csrf" value="${csrf}" />
              <div class="form-group" style="margin:0;min-width:18rem;flex:1">
                <label>Need assignment note</label>
                <input
                  type="text"
                  name="note"
                  maxlength="240"
                  placeholder="Any seat, prefer FPS / medic / gunner..."
                />
              </div>
              <button type="submit" class="btn btn-sm">Anmelden als Crewmember</button>
            </form>`}
      </div>`
    : "";
  // ── Status controls ────────────────────────────────────────────────
  const statusControls = canManage
    ? html` <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
        ${["draft", "open", "locked", "in_progress", "completed", "cancelled"].map((s) =>
          s !== op.status
            ? html` <form method="post" action="${bp}/api/ops/${op.id}/status" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="status" value="${s}" />
                <button type="submit" class="btn btn-sm btn-ghost">${s.replace("_", " ")}</button>
              </form>`
            : "",
        )}
      </div>`
    : "";

  const missionVoiceSection =
    canManage && opts.voiceEnabled
      ? html` <div class="section">
          <div class="section-title">Mission Voice Rooms</div>
          ${opts.missionVoice?.globalVoiceRoom
            ? html` <div class="fleet-row" style="flex-direction:column;gap:.25rem">
                  <div class="text-sm text-dim">
                    Global Channel <span class="tag tag-green">LIVE</span>
                  </div>
                  <div class="text-mono text-sm">${opts.missionVoice.globalVoiceRoom}</div>
                  <div class="text-sm text-dim">
                    Commander Channel <span class="tag tag-green">LIVE</span>
                  </div>
                  <div class="text-mono text-sm">
                    ${opts.missionVoice.commanderVoiceRoom ?? "—"}
                  </div>
                </div>
                ${opts.fleetVoiceLinks?.length
                  ? html` <div style="margin-top:1rem">
                      <div class="text-sm text-dim" style="margin-bottom:.5rem">
                        Fleet Voice Links — copy and send to each commander:
                      </div>
                      <div style="display:flex;flex-direction:column;gap:.4rem">
                        ${opts.fleetVoiceLinks.map(
                          (l) =>
                            html` <div style="display:flex;gap:.5rem;align-items:center">
                              <span class="text-sm" style="min-width:8rem">${l.username}</span>
                              <input
                                type="text"
                                readonly
                                value="${l.link}"
                                class="text-mono text-sm"
                                style="flex:1;padding:.2rem .4rem;font-size:.7rem"
                                onclick="this.select()"
                              />
                            </div>`,
                        )}
                      </div>
                    </div>`
                  : safe("")}`
            : html` <p class="text-dim text-sm">
                No active voice session. Rooms are created automatically when the operation is set
                to <strong>open</strong> or <strong>in progress</strong>.
              </p>`}
        </div>`
      : safe("");

  const voiceChannelsSection =
    canManage && opts.voiceEnabled
      ? html` <div class="section">
          <div
            class="section-title"
            style="display:flex;align-items:center;justify-content:space-between;gap:1rem"
          >
            <span>Voice Channels</span>
            ${opts.availableVoiceBotCount > 0
              ? html` <form
                  method="post"
                  action="${bp}/api/ops/${op.id}/voice-channels/launch"
                  class="inline"
                >
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <button type="submit" class="btn btn-sm btn-cyan">Launch Voice Channels</button>
                </form>`
              : safe("")}
          </div>
          ${op.voiceChannels.length
            ? html` <div class="fleet-list">
                ${op.voiceChannels.map((channel) => {
                  const unitName =
                    channel.unit.unitType === "ship"
                      ? (channel.unit.ship?.name ?? "Unknown Ship")
                      : (channel.unit.squadName ?? "Squad");
                  const channelName = channel.channelName || unitName;
                  return html` <div class="fleet-row">
                    <div>
                      <div class="fleet-name">${channelName}</div>
                      <div class="text-dim text-sm">Captain: ${channel.unit.captain.username}</div>
                    </div>
                    <div class="fleet-meta">
                      <span class="tag tag-cyan">${channel.channelId}</span>
                      ${channel.voiceBot
                        ? html`<span class="tag tag-gold">${channel.voiceBot.label}</span>`
                        : html`<span class="tag tag-dim">no bot assigned</span>`}
                      <form
                        method="post"
                        action="${bp}/api/ops/${op.id}/voice-channels/${channel.id}/rename"
                        class="inline"
                        style="display:flex;gap:.35rem;align-items:center"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <input
                          type="text"
                          name="name"
                          value="${channelName}"
                          maxlength="100"
                          style="width:14rem;padding:.25rem .4rem;font-size:.75rem"
                          required
                        />
                        <button type="submit" class="btn btn-sm btn-ghost">Rename</button>
                      </form>
                      <form
                        method="post"
                        action="${bp}/api/ops/${op.id}/voice-channels/${channel.id}/delete"
                        class="inline"
                      >
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <button
                          type="submit"
                          class="btn btn-sm btn-danger"
                          onclick="return confirm('Delete this Discord voice channel?')"
                        >
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>`;
                })}
              </div>`
            : html`<p class="text-dim text-sm">No generated voice channels yet.</p>`}
        </div>`
      : "";

  // ── Option B: live Discord voice control, per unit ──────────────────
  const locationTag = (loc: "here" | "elsewhere" | "offline"): SafeHtml =>
    loc === "here"
      ? html`<span class="tag tag-green">in channel</span>`
      : loc === "elsewhere"
        ? html`<span class="tag tag-gold">in voice</span>`
        : html`<span class="tag tag-dim">offline</span>`;

  const voiceControlSection =
    canManage && opts.voiceEnabled && opts.voiceControl && opts.voiceControl.length
      ? html` <div class="section">
          <div class="section-title">Voice Control</div>
          <p class="text-dim text-sm" style="margin:-.5rem 0 1rem">
            Pull assigned crew into their unit's Discord voice channel. Members must already be in
            <em>some</em> voice channel — Discord can't move someone who isn't connected.
          </p>
          <div class="fleet-list">
            ${opts.voiceControl.map(
              (unit) =>
                html` <div class="card" style="padding:1rem;margin-bottom:.75rem">
                  <div
                    style="display:flex;align-items:center;justify-content:space-between;gap:1rem;flex-wrap:wrap"
                  >
                    <div class="fleet-name">${unit.channelName}</div>
                    <form
                      method="post"
                      action="${bp}/ops/${op.id}/voice/move-unit/${unit.unitId}"
                      class="inline"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <button type="submit" class="btn btn-sm btn-cyan">Pull all crew here</button>
                    </form>
                  </div>
                  <div style="margin-top:.6rem;display:flex;flex-direction:column;gap:.35rem">
                    ${unit.crew.length
                      ? unit.crew.map(
                          (m) =>
                            html` <div
                              style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap"
                            >
                              <span style="min-width:9rem">${m.username}</span>
                              ${m.discordId
                                ? locationTag(m.location)
                                : html`<span class="tag tag-red">no discord link</span>`}
                              ${m.discordId && m.location === "elsewhere"
                                ? html` <form
                                    method="post"
                                    action="${bp}/ops/${op.id}/voice/move-member/${unit.unitId}/${m.userId}"
                                    class="inline"
                                  >
                                    <input type="hidden" name="_csrf" value="${csrf}" />
                                    <button type="submit" class="btn btn-sm btn-ghost">
                                      Move here
                                    </button>
                                  </form>`
                                : safe("")}
                            </div>`,
                        )
                      : html`<span class="text-dim text-sm">No assigned crew.</span>`}
                  </div>
                </div>`,
            )}
          </div>
          <p style="margin-top:.25rem">
            <a href="${bp}/ops/${op.id}">↻ Refresh voice state</a>
          </p>
        </div>`
      : "";

  const activeUnits = op.units.filter((unit) => unit.status !== "rejected");
  const fleetOverview = html` <aside class="op-side op-fleet">
    <div class="section-title">Aktuelle Flotte (${activeUnits.length})</div>
    ${activeUnits.length
      ? html` <div class="fleet-list">
          ${activeUnits.map((unit) => {
            const assigned = unit.seats.filter((seat) => seat.active && seat.userId).length;
            const total = unit.seats.filter((seat) => seat.active).length;
            const name =
              unit.unitType === "ship"
                ? (unit.ship?.name ?? "Unknown Ship")
                : (unit.squadName ?? "Squad");
            return html` <div class="fleet-row">
              <div>
                <div class="fleet-name">${name}</div>
                <div class="text-dim text-sm">${unit.captain.username}</div>
              </div>
              <div class="fleet-meta">
                ${statusTag(unit.status)}
                <span class="text-mono">${assigned}/${total}</span>
              </div>
            </div>`;
          })}
        </div>`
      : html`<p class="text-dim text-sm">Noch keine Einheiten registriert.</p>`}
  </aside>`;

  const raidLead =
    op.leaders.find((leader) => leader.leaderRole === "raid_leader") ??
    op.leaders.find((leader) => leader.leaderRole === "fleet_commander") ??
    op.leaders.find((leader) => leader.leaderRole === "event_leader");
  const raidLeadUser = raidLead?.user ?? op.createdBy;
  const raidLeadAvatar = discordAvatarUrl(raidLeadUser);
  const meetingSystem = op.meetingSystem ?? "stanton";
  const actionDetails = html` <aside class="op-side op-details">
    <div class="section-title">Aktionsdetails</div>
    <div class="system-map system-${meetingSystem}">
      <div class="system-orbit orbit-a"></div>
      <div class="system-orbit orbit-b"></div>
      <div class="system-core"></div>
      <div class="system-node node-a"></div>
      <div class="system-node node-b"></div>
      <div class="system-label">${systemLabel(meetingSystem)}</div>
    </div>
    <div class="detail-row">
      <span>Status</span>
      <strong>${eventStatusLabel(op.status)}</strong>
    </div>
    <div class="detail-row">
      <span>Treffpunkt</span>
      <strong>${op.meetingLocation || systemLabel(meetingSystem)}</strong>
    </div>
    <div class="detail-row">
      <span>Zeit</span>
      <strong>${fmtDate(op.scheduledAt, gtz)}</strong>
    </div>
    <div class="raidlead">
      ${raidLeadAvatar
        ? html`<img src="${raidLeadAvatar}" alt="" />`
        : html`<div class="raidlead-fallback">
            ${raidLeadUser.username.slice(0, 2).toUpperCase()}
          </div>`}
      <div>
        <span class="text-dim text-sm">Aktueller Raidlead</span>
        <strong>${raidLeadUser.username}</strong>
      </div>
    </div>
    ${op.description
      ? html` <div class="action-brief">
          <span class="text-dim text-sm">Briefing</span>
          <p>${op.description}</p>
        </div>`
      : ""}
    ${isLeader
      ? html` <div class="crew-pool">
          <div class="section-title">Need Assignment (${op.crewRequests.length})</div>
          ${op.crewRequests.length
            ? op.crewRequests.map(
                (request) =>
                  html` <div class="crew-request-row">
                    <div>
                      <strong>${request.user.username}</strong>
                      ${request.note
                        ? html`<div class="text-dim text-sm">${request.note}</div>`
                        : ""}
                    </div>
                    <form
                      method="post"
                      action="${bp}/api/ops/${op.id}/crew-requests/remove"
                      class="inline"
                    >
                      <input type="hidden" name="_csrf" value="${csrf}" />
                      <input type="hidden" name="userId" value="${request.user.id}" />
                      <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
                    </form>
                  </div>`,
              )
            : html`<p class="text-dim text-sm">No unassigned crewmembers.</p>`}
        </div>`
      : ""}
  </aside>`;

  const body = html` <div class="page-header">
      <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
        <h1 class="page-title">${op.title}</h1>
        ${opTypeTag(op.opType)} ${statusTag(op.status)}
        ${canManage
          ? html`<a href="${bp}/ops/${op.id}/edit" class="btn btn-sm btn-ghost">Edit</a>`
          : ""}
        ${canManage
          ? html` <form method="post" action="${bp}/ops/${op.id}/delete" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button
                type="submit"
                class="btn btn-sm btn-danger"
                onclick="return confirm('Delete this operation?')"
              >
                Delete
              </button>
            </form>`
          : ""}
      </div>
      <p class="page-subtitle">${fmtDate(op.scheduledAt, gtz)}</p>
      ${op.description ? html`<p class="text-sm mt-1">${op.description}</p>` : ""} ${statusControls}
      ${canRealManage
        ? html` <form
            method="get"
            action="${bp}/ops/${op.id}"
            class="flex gap-1 mt-2"
            style="align-items:center;flex-wrap:wrap"
          >
            <span class="text-dim text-sm">View as Role</span>
            <select
              name="viewAs"
              onchange="this.form.submit()"
              style="width:auto;min-width:9rem;padding:.3rem .5rem"
            >
              <option value="">Actual Role</option>
              ${previewRoles.map(
                (role) =>
                  html`<option value="${role}" ${viewAsRole === role ? safe("selected") : ""}>
                    ${role}
                  </option>`,
              )}
            </select>
          </form>`
        : ""}
    </div>

    <div class="op-dashboard">
      ${fleetOverview}
      <div class="op-control">
        ${registerForm} ${crewRequestPanel} ${voiceChannelsSection} ${voiceControlSection}
        <div class="section">
          <div class="section-title">Leaders</div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            ${op.leaders.length
              ? op.leaders.map(
                  (l) => html`
                    <span class="tag tag-gold"
                      >${l.user.username} (${roleLabel(l.leaderRole)})</span
                    >
                    ${canManage
                      ? html` <form
                          method="post"
                          action="${bp}/api/ops/${op.id}/leaders/remove"
                          class="inline"
                        >
                          <input type="hidden" name="_csrf" value="${csrf}" />
                          <input type="hidden" name="userId" value="${l.user.id}" />
                          <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
                        </form>`
                      : ""}
                  `,
                )
              : html`<span class="text-dim text-sm">No leaders assigned</span>`}
          </div>
          ${canManage
            ? html` <form
                method="post"
                action="${bp}/api/ops/${op.id}/leaders"
                class="flex gap-1 mt-2"
                style="align-items:flex-end;flex-wrap:wrap"
              >
                <input type="hidden" name="_csrf" value="${csrf}" />
                <div class="form-group" style="margin:0;min-width:14rem">
                  <label>Assign Leader</label>
                  <select name="userId" required>
                    <option value="">Select user...</option>
                    ${opts.assignableUsers.map(
                      (user) => html`
                        <option value="${user.id}">${user.username} (${user.role})</option>
                      `,
                    )}
                  </select>
                </div>
                <div class="form-group" style="margin:0;min-width:12rem">
                  <label>Role</label>
                  <select name="leaderRole">
                    <option value="event_leader">Event Leader</option>
                    <option value="fleet_commander">Fleet Commander</option>
                    <option value="raid_leader">Raid Leader</option>
                    <option value="wing_commander">Wing Commander</option>
                  </select>
                </div>
                <button type="submit" class="btn btn-sm">Assign</button>
              </form>`
            : ""}
        </div>

        ${groupsSection}
      </div>
      ${actionDetails}
    </div>

    <div class="section">
      <div class="section-title">Registered Units (${op.units.length})</div>
      ${op.units.length
        ? html`<div class="unit-grid">${unslottedUnits.map((u) => unitCard(u))}</div>`
        : html`<p class="text-dim text-sm">No units registered yet.</p>`}
    </div>

    <script>
      function toggleForm(id) {
        const el = document.getElementById(id);
        if (el) el.hidden = !el.hidden;
      }
      function toggleRegister(btn) {
        const body = document.getElementById("register-body");
        const open = body.classList.toggle("open");
        btn.textContent = open ? "- Hide Registration" : "+ Register a Unit";
      }
      function switchTab(btn, type) {
        document.querySelectorAll(".type-tab").forEach((t) => t.classList.remove("active"));
        btn.classList.add("active");
        document.getElementById("unit-type-field").value = type;
        document.getElementById("ship-section").hidden = type !== "ship";
        document.getElementById("squad-section").hidden = type !== "squad";
      }
      const shipSearch = document.getElementById("ship-search");
      const shipResults = document.getElementById("ship-results");
      const shipIdField = document.getElementById("ship-id-field");
      const ownedShipSelect = document.getElementById("owned-ship-select");
      let searchTimer;
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
                  escHtml(s.id) +
                  '" data-name="' +
                  escHtml(s.name) +
                  '" onclick="selectShip(this)">' +
                  "<strong>" +
                  escHtml(s.name) +
                  "</strong><span>" +
                  escHtml(s.manufacturer || "") +
                  " // " +
                  escHtml(s.size || "") +
                  "</span></button>",
              )
              .join("");
          }, 180);
        });
      }
      function selectShip(el) {
        document.querySelectorAll(".ship-row").forEach((row) => row.classList.remove("selected"));
        el.classList.add("selected");
        if (shipIdField) shipIdField.value = el.dataset.id || "";
        if (shipSearch) shipSearch.value = el.dataset.name || "";
        if (ownedShipSelect) ownedShipSelect.value = "";
      }
      function escHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }
    </script>`;

  return layout({
    title: op.title,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    navSlot: opUiSwitch(bp, op.id, "classic"),
    body,
  });
}

// ── Operation form (create / edit) ──────────────────────────────────

// New operation detail flow behind ?ui=new.
export function opDetailPageV2(opts: OpDetailPageOptions & { tab?: string }): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const gtz = opts.guildTimezone ?? DEFAULT_TIMEZONE;
  const csrf = opts.csrfToken ?? "";
  const user = opts.currentUser;
  const canManage = !!user && (user.role === "superadmin" || user.role === "fleetoperator");
  const isLeader = !!user && (canManage || op.leaders.some((leader) => leader.user.id === user.id));
  const activeUnits = op.units.filter((unit) => unit.status !== "rejected");
  const pendingUnits = op.units.filter((unit) => unit.status === "pending");
  const acceptedUnits = op.units.filter((unit) => unit.status === "accepted");
  const activeSeats = activeUnits.flatMap((unit) => unit.seats.filter((seat) => seat.active));
  const assignedSeats = activeSeats.filter((seat) => seat.userId);
  const crewWaiting = op.crewRequests.length;
  const tabNames = ["overview", "fleet", "crew", "voice", "admin"];
  const activeTab = tabNames.includes(opts.tab ?? "") ? opts.tab! : "overview";
  const tabUrl = (tab: string) => `${bp}/ops/${op.id}?ui=new&tab=${tab}`;
  const classicUrl = `${bp}/ops/${op.id}`;

  const shellLink = (tab: string, label: string) =>
    html`<a class="opv2-tab ${activeTab === tab ? "active" : ""}" href="${tabUrl(tab)}"
      >${label}</a
    >`;

  const metric = (label: string, value: string | number, tone = "") =>
    html`<div class="opv2-metric ${tone}">
      <span>${label}</span>
      <strong>${value}</strong>
    </div>`;

  const unitName = (unit: UnitFull) =>
    unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");

  const unitRows = activeUnits.length
    ? activeUnits.map((unit) => {
        const seats = unit.seats.filter((seat) => seat.active);
        const assigned = seats.filter((seat) => seat.userId).length;
        return html`<div class="opv2-row">
          <div>
            <strong>${unitName(unit)}</strong>
            <span>Captain: ${unit.captain.username}</span>
          </div>
          <div class="opv2-row-meta">
            ${statusTag(unit.status)}
            <span class="text-mono">${assigned}/${seats.length} seats</span>
          </div>
        </div>`;
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
                    <span>${requirement.label}</span>
                    <span class="tag tag-dim">${requirement.category}</span>
                    <strong>${filled}/${requirement.count}</strong>
                  </div>`;
                })
              : html`<p class="text-dim text-sm">No requirements.</p>`}
          </div>`,
      )
    : [html`<p class="text-dim text-sm">No composition has been defined yet.</p>`];

  const statusControls = canManage
    ? html`<div class="opv2-actions">
        ${["draft", "open", "locked", "in_progress", "completed", "cancelled"].map((status) =>
          status !== op.status
            ? html`<form method="post" action="${bp}/api/ops/${op.id}/status" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="status" value="${status}" />
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
                  <strong>${request.user.username}</strong>
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

  const voicePanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Mission Voice</div>
      ${opts.voiceEnabled
        ? opts.missionVoice?.globalVoiceRoom
          ? html`<div class="opv2-stack">
              <div class="detail-row">
                <span>Global</span>
                <strong>${opts.missionVoice.globalVoiceRoom}</strong>
              </div>
              <div class="detail-row">
                <span>Commander</span>
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
                <span>Captain: ${channel.unit.captain.username}</span>
              </div>
              <span class="tag tag-cyan">${channel.voiceBot?.label ?? "Discord"}</span>
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
            <button type="submit" class="btn btn-sm btn-cyan">Launch Voice Channels</button>
          </form>`
        : safe("")}
    </section>
  </div>`;

  const overviewPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Briefing</div>
      ${op.description
        ? html`<p>${op.description}</p>`
        : html`<p class="text-dim text-sm">No briefing text has been added.</p>`}
      ${statusControls}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Action Details</div>
      <div class="detail-row">
        <span>When</span>
        <strong>${fmtDate(op.scheduledAt, gtz)}</strong>
      </div>
      <div class="detail-row">
        <span>System</span>
        <strong>${systemLabel(op.meetingSystem ?? "stanton")}</strong>
      </div>
      <div class="detail-row">
        <span>Rendezvous</span>
        <strong>${op.meetingLocation || "Not set"}</strong>
      </div>
      <div class="detail-row">
        <span>Leaders</span>
        <strong>${op.leaders.length || "None"}</strong>
      </div>
    </section>
  </div>`;

  const fleetPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Fleet Units</div>
      <div class="opv2-stack">${unitRows}</div>
      <a href="${classicUrl}" class="btn btn-sm btn-ghost mt-1"
        >Register or edit units in Classic UI</a
      >
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Composition</div>
      <div class="opv2-stack">${compositionRows}</div>
    </section>
  </div>`;

  const adminPanel = html`<div class="opv2-grid">
    <section class="opv2-panel">
      <div class="opv2-panel-title">Operation Control</div>
      <div class="opv2-actions">
        ${canManage
          ? html`<a href="${bp}/ops/${op.id}/edit" class="btn btn-sm">Edit Operation</a>`
          : ""}
        <a href="${classicUrl}" class="btn btn-sm btn-ghost">Classic Full Controls</a>
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
      ${statusControls}
    </section>
    <section class="opv2-panel">
      <div class="opv2-panel-title">Leaders</div>
      ${op.leaders.length
        ? op.leaders.map(
            (leader) =>
              html`<div class="opv2-row">
                <div>
                  <strong>${leader.user.username}</strong>
                  <span>${roleLabel(leader.leaderRole)}</span>
                </div>
              </div>`,
          )
        : html`<p class="text-dim text-sm">No leaders assigned.</p>`}
    </section>
  </div>`;

  const activePanel =
    activeTab === "fleet"
      ? fleetPanel
      : activeTab === "crew"
        ? crewPanel
        : activeTab === "voice"
          ? voicePanel
          : activeTab === "admin"
            ? adminPanel
            : overviewPanel;

  const body = html`<div class="opv2-shell">
    <header class="opv2-hero">
      <div>
        <div class="opv2-eyebrow">${opTypeTag(op.opType)} ${statusTag(op.status)}</div>
        <h1>${op.title}</h1>
        <p>
          ${fmtDate(op.scheduledAt, gtz)} at
          ${op.meetingLocation || systemLabel(op.meetingSystem ?? "stanton")}
        </p>
      </div>
      <div class="opv2-switch">
        <a href="${classicUrl}" class="btn btn-sm btn-ghost">Classic UI</a>
        <a href="${tabUrl(activeTab)}" class="btn btn-sm">New UI</a>
      </div>
    </header>

    <div class="opv2-metrics">
      ${metric("Accepted Units", acceptedUnits.length, "good")}
      ${metric("Pending Review", pendingUnits.length, pendingUnits.length ? "warn" : "")}
      ${metric("Crew Seats", `${assignedSeats.length}/${activeSeats.length}`)}
      ${metric("Need Assignment", crewWaiting, crewWaiting ? "warn" : "")}
    </div>

    <nav class="opv2-tabs">
      ${shellLink("overview", "Overview")} ${shellLink("fleet", "Fleet")}
      ${shellLink("crew", "Crew")} ${shellLink("voice", "Voice")} ${shellLink("admin", "Admin")}
    </nav>

    ${activePanel}
  </div>`;

  return layout({
    title: op.title,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    navSlot: opUiSwitch(bp, op.id, "new", activeTab),
    body,
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

  const opTypes = ["combat", "pve", "training", "mixed", "exploration"];
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
      <form method="post" action="${action}">
        <input type="hidden" name="_csrf" value="${csrf}" />
        ${!op && opts.operatorGuilds && opts.operatorGuilds.length > 0
          ? html` <div class="form-group">
              <label>Server</label>
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
          <label>Operation Title</label>
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
            <label>Scheduled Date/Time (${gtz})</label>
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

type UserRow = Pick<User, "id" | "username" | "role" | "active" | "joinedAt" | "lastSeenAt">;

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
    (u) =>
      html` <tr>
        <td class="text-mono" style="font-size:0.72rem;color:var(--dim)">${u.id}</td>
        <td>${u.username}</td>
        <td>
          ${isSuperAdmin
            ? html` <form method="post" action="${bp}/admin/users/${u.id}/role" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <select name="role" onchange="this.form.submit()" class="user-table">
                  ${["superadmin", "fleetoperator", "captain", "crew"].map(
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
      </tr>`,
  );

  const body = html` <div class="page-header">
      <h1 class="page-title">ADMIN PANEL</h1>
    </div>
    ${syncPanel} ${locationSyncPanel} ${isFleetOp ? feedbackPanel : ""}
    <div class="section">
      <div class="section-title">Users (${opts.users.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead>
            <tr>
              <th>Discord ID</th>
              <th>Username</th>
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
}): SafeHtml {
  const bp = opts.basePath;

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
  offline?: boolean;
  error?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const channelName = new Map(opts.channels.map((c) => [c.id, c.name]));

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
        Server-rendered snapshot — reload the page to refresh. Live drag-drop stays in the bridge
        admin UI.
      </p>
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

// ── Public info pages ────────────────────────────────────────────────

export function howToPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
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
      </div>
    </div>

    <div class="section">
      <div class="section-title">Roles</div>
      <div class="card" style="padding:1rem;max-width:52rem">
        <table class="user-table" style="width:100%">
          <thead>
            <tr>
              <th>Role</th>
              <th>What they can do</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><span class="tag tag-role">Admiral</span></td>
              <td>
                Add the bot to a Discord server, create &amp; manage operations, accept/reject
                units, assign leaders, manage composition, post Discord scheduled events.
              </td>
            </tr>
            <tr>
              <td><span class="tag tag-role">Captain</span></td>
              <td>Register a ship or squad for an operation, manage their unit's seats.</td>
            </tr>
            <tr>
              <td><span class="tag tag-role">Crew</span></td>
              <td>Claim open seats on accepted units, submit crew assignment requests.</td>
            </tr>
          </tbody>
        </table>
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
            Discord-role mapping (auto-assigns Admiral/Captain roles on login).
          </li>
          <li>
            Click <strong>+ New Operation</strong>, fill in title, date, meeting location, and op
            type. Save as draft.
          </li>
          <li>Add a <strong>Composition</strong> to define which ship types you need.</li>
          <li>
            Set status to <strong>Open</strong> — a Discord scheduled event is posted automatically
            to your server.
          </li>
          <li>
            Accept incoming unit registrations from Captains. Accepted units get their seats opened
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
      <div class="section-title">Getting started — for Captains &amp; Crew</div>
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
          Roles can be auto-assigned from Discord roles — set Admiral Role ID and Captain Role ID in
          the server settings.
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
    </div>`;

  return layout({
    title: "How to",
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
    captain: "Captain",
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
    eventChannelId: string | null;
    voiceChannelCategoryId: string | null;
    admiralRoleId: string | null;
    captainRoleId: string | null;
    globalVoiceRoleId: string | null;
    commanderVoiceRoleId: string | null;
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
  memberships: Array<{ userId: string; role: string; user: { username: string }; createdAt: Date }>;
  activeGuildId: string;
  activeGuildName: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const g = opts.guild;
  const relayBotInvitePermissions = "282574843809040";

  const memberRows = opts.memberships.map(
    (m) =>
      html` <tr>
        <td>${m.user.username}</td>
        <td class="text-mono text-sm text-dim">${m.userId}</td>
        <td>
          <form method="post" action="${bp}/guilds/members/${m.userId}/role" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <select name="role" onchange="this.form.submit()" class="user-table">
              ${["fleetoperator", "captain", "crew"].map(
                (r) =>
                  html`<option value="${r}" ${m.role === r ? safe("selected") : ""}>${r}</option>`,
              )}
            </select>
          </form>
        </td>
        <td class="text-dim text-sm">${fmtDate(m.createdAt)}</td>
      </tr>`,
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
        <a href="${bp}/guilds/diagnostics" class="btn btn-cyan btn-sm">Run Install Tests</a>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Discord integration</div>
      <form method="post" action="${bp}/guilds/settings" class="card" style="padding:1rem;display:flex;flex-direction:column;gap:.75rem;max-width:30rem">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim">Event voice channel ID (optional — empty = external event)
          <input type="text" name="eventChannelId" value="${g.eventChannelId ?? ""}" placeholder="123456789012345678" />
        </label>
        <label class="text-sm text-dim">Operation voice category ID
          <input type="text" name="voiceChannelCategoryId" value="${g.voiceChannelCategoryId ?? ""}" placeholder="1507879660724162770" />
        </label>
        <label class="text-sm text-dim">Admiral role ID (Discord role → fleetoperator)
          <input type="text" name="admiralRoleId" value="${g.admiralRoleId ?? ""}" placeholder="optional" />
        </label>
        <label class="text-sm text-dim">Captain role ID (Discord role → captain)
          <input type="text" name="captainRoleId" value="${g.captainRoleId ?? ""}" placeholder="optional" />
        </label>
        <label class="text-sm text-dim">Global Voice role ID <span style="opacity:.65">(Discord role → granted to all crew when mission opens)</span>
          <input type="text" name="globalVoiceRoleId" value="${g.globalVoiceRoleId ?? ""}" placeholder="optional" />
        </label>
        <label class="text-sm text-dim">Commander Voice role ID <span style="opacity:.65">(Discord role → granted to fleetoperators + captains when mission opens)</span>
          <input type="text" name="commanderVoiceRoleId" value="${g.commanderVoiceRoleId ?? ""}" placeholder="optional" />
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
            <div class="section-title">Voice relay bots (${opts.voiceBots.length}/6)</div>
          </div>`
        : html` <div class="section" style="opacity:.45;pointer-events:none">
            <div class="section-title">
              Voice relay bots <span class="tag tag-dim">RDOC Voice Permission required</span>
            </div>
          </div>`
    }
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
    </div>

    <div class="section">
      <div class="section-title">Members (${opts.memberships.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead><tr><th>User</th><th>ID</th><th>Role (this server)</th><th>Joined</th></tr></thead>
          <tbody>${memberRows}</tbody>
        </table>
      </div>
    </div>
    <script>
    function toggleBotEdit(id) {
      var row = document.getElementById('bot-edit-' + id);
      if (row) row.style.display = row.style.display === 'none' ? '' : 'none';
    }
    </script>`;

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
          >Invite / Fix Permissions</a
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
        <div style="display:flex;gap:.5rem;align-items:center;flex-wrap:wrap">
          ${check.ok ? safe("") : action}
        </div>
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
