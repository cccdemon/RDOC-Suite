import { html, safe, rawHtml, layout, type SafeHtml, type LayoutOptions } from "./render.js";
import type { User, Operation, Ship, Location } from "@prisma/client";

// ── Re-export layout for routes ─────────────────────────────────────
export { layout, rawHtml } from "./render.js";

// ── Types returned by getOperation() includes ───────────────────────
type OpFull = Awaited<ReturnType<typeof import("../services/operations.js").getOperation>>;
type UnitFull = NonNullable<OpFull>["units"][number];

// ── Shared helpers ───────────────────────────────────────────────────

function fmtDate(d: Date): string {
  return d.toISOString().replace("T", " ").substring(0, 16) + " UTC";
}

function fmtDateLocal(d: Date): string {
  // datetime-local input format YYYY-MM-DDTHH:MM
  return d.toISOString().substring(0, 16);
}

function statusTag(status: string): SafeHtml {
  const map: Record<string, string> = {
    draft: "tag-dim", open: "tag-cyan", locked: "tag-gold",
    in_progress: "tag-green", completed: "tag", cancelled: "tag-red",
    pending: "tag-gold", accepted: "tag-green", rejected: "tag-red",
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
  return user.avatarHash ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatarHash}.webp?size=80` : null;
}

const SYSTEMS = ["stanton", "pyro", "nyx"] as const;

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
  id: string; title: string; opType: string; scheduledAt: Date; status: string;
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
}): SafeHtml {
  const bp = opts.basePath;
  const canCreate = opts.currentUser &&
    (opts.currentUser.role === "superadmin" || opts.currentUser.role === "fleetoperator");

  const rows = opts.ops.length
    ? html`
      <div class="op-list">
        ${opts.ops.map((op) => {
          const accepted = op.units.filter((u) => u.status === "accepted").length;
          const total = op.units.length;
          return html`
            <a href="${bp}/ops/${op.id}" class="op-row" style="color:inherit;text-decoration:none;">
              <span class="op-time">${fmtDate(op.scheduledAt)}</span>
              <span class="op-title">${op.title}</span>
              ${opTypeTag(op.opType)}
              ${statusTag(op.status)}
              <span class="op-count">${accepted}/${total} units</span>
            </a>`;
        })}
      </div>`
    : html`<p class="text-dim text-sm">No operations scheduled. ${canCreate ? html`<a href="${bp}/ops/new">Create one?</a>` : ""}</p>`;

  const body = html`
    <div class="page-header">
      <h1 class="page-title">FLEET OPERATIONS</h1>
      <p class="page-subtitle">Star Citizen – RDOC operation calendar</p>
    </div>
    <div class="flex gap-2 mb-1">
      ${canCreate ? html`<a href="${bp}/ops/new" class="btn btn-sm">+ New Operation</a>` : ""}
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

export function opDetailPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op: NonNullable<OpFull>;
  ownedShips: Ship[];
  assignableUsers: Pick<User, "id" | "username" | "role">[];
  viewAsRole?: string;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const realUser = opts.currentUser;
  const previewRoles = ["guest", "crew", "captain", "fleetoperator", "superadmin"];
  const canPreview = !!realUser && (realUser.role === "superadmin" || realUser.role === "fleetoperator");
  const viewAsRole = canPreview && opts.viewAsRole && previewRoles.includes(opts.viewAsRole) ? opts.viewAsRole : "";
  const u = viewAsRole === "guest"
    ? null
    : viewAsRole && realUser
      ? { ...realUser, role: viewAsRole }
      : realUser;
  const csrf = opts.csrfToken ?? "";

  const currentUserId = u?.id;
  const isLeader = !!u && (
    u.role === "superadmin" || u.role === "fleetoperator" ||
    op.leaders.some((l) => l.user.id === currentUserId)
  );
  const canManage = u && (u.role === "superadmin" || u.role === "fleetoperator");
  const canRealManage = realUser && (realUser.role === "superadmin" || realUser.role === "fleetoperator");

  // Separate unslotted units (no requirementId) from slotted ones
  const unslottedUnits = op.units.filter((unit) => !unit.requirementId);

  // ── Unit card ──────────────────────────────────────────────────────
  function unitCard(unit: UnitFull): SafeHtml {
    const isCaptain = u && unit.captainId === u.id;
    const unitName = unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
    const canConfigureSeats = !!(isCaptain || canManage);

    const seats = unit.seats.map((seat) => {
      const claimed = !!seat.userId;
      const isMe = u && seat.userId === u.id;
      const canClaim = u && seat.active && seat.order !== 0 && !claimed && unit.status === "accepted";
      const canAssign = isLeader && seat.active && seat.order !== 0 && !claimed && unit.status === "accepted";
      const canUnclaim = claimed && (isMe || isLeader);

      return html`
        <div class="seat-row ${seat.active ? "" : "seat-disabled"}">
          <span class="seat-label">${seat.label}</span>
          <span class="seat-type text-mono" style="font-size:0.65rem;color:var(--dim)">${seat.seatType}</span>
          <span class="seat-user ${claimed ? "" : "empty"}">${claimed ? seat.user?.username ?? "?" : "— open —"}</span>
          ${!seat.active ? html`<span class="tag tag-dim">disabled</span>` : ""}
          ${canClaim ? html`
            <form method="post" action="${bp}/api/seats/${seat.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-green">Claim</button>
            </form>` : ""}
          ${canAssign ? html`
            <form method="post" action="${bp}/api/seats/${seat.id}/assign" class="inline" style="display:flex;gap:.35rem;align-items:center;flex-wrap:wrap">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <select name="userId" required style="width:auto;min-width:10rem;padding:.25rem .4rem;font-size:.75rem">
                <option value="">Assign user...</option>
                ${opts.assignableUsers.map((user) => html`
                  <option value="${user.id}">${user.username} (${user.role})</option>
                `)}
              </select>
              <button type="submit" class="btn btn-sm">Add</button>
            </form>` : ""}
          ${canUnclaim && !(seat.order === 0 && !canManage) ? html`
            <form method="post" action="${bp}/api/seats/${seat.id}/unclaim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-ghost">Release</button>
            </form>` : ""}
        </div>`;
    });

    const seatSetup = canConfigureSeats ? html`
      <details class="seat-setup">
        <summary>Seat Setup</summary>
        <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/seats">
          <input type="hidden" name="_csrf" value="${csrf}" />
          ${unit.seats.map((seat) => {
            const placeholder = seat.seatType === "fps"
              ? "Boomtuber, Railgunner, Medic, Soldier, Sniper"
              : "Turret top, Turret bottom, Engineer, Scanner";
            return html`
              <div class="seat-setup-row">
                <input type="text" name="label_${seat.id}" value="${seat.label}" maxlength="40" placeholder="${placeholder}" />
                <span class="tag tag-dim">${seat.seatType}</span>
                <label class="seat-toggle">
                  <input type="checkbox" name="active_${seat.id}" value="1" ${seat.active ? safe("checked") : ""} ${seat.order === 0 ? safe("checked disabled") : ""} />
                  Active
                </label>
              </div>`;
          })}
          <button type="submit" class="btn btn-sm">Save Seats</button>
        </form>
      </details>` : "";

    return html`
      <div class="unit-card status-${unit.status}">
        <div class="unit-card-header">
          <span class="unit-name">${unitName}</span>
          ${unit.unitType === "squad" ? html`<span class="tag">FPS</span>` : ""}
          ${statusTag(unit.status)}
          ${canManage && unit.status === "accepted" ? html`
            <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/discord-role" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="role" value="commander" />
              <button type="submit" class="btn btn-sm btn-gold">Commander</button>
            </form>
            <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/discord-role" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="role" value="admiral" />
              <button type="submit" class="btn btn-sm btn-gold">Admiral</button>
            </form>` : ""}
          ${isLeader && unit.status === "pending" ? html`
            <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/accept" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-green">Accept</button>
            </form>
            <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/reject" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-danger">Reject</button>
            </form>` : ""}
          ${(isCaptain || canManage) ? html`
            <form method="post" action="${bp}/api/ops/${op.id}/units/${unit.id}/delete" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-ghost" onclick="return confirm('Delete this unit?')">✕</button>
            </form>` : ""}
        </div>
        <div class="unit-captain">Captain: ${unit.captain.username}</div>
        ${unit.captainNote ? html`<div class="text-dim text-sm mb-1">Note: ${unit.captainNote}</div>` : ""}
        ${unit.leaderNote ? html`<div class="text-dim text-sm mb-1" style="color:var(--gold)">Leader note: ${unit.leaderNote}</div>` : ""}
        ${seatSetup}
        <div>${seats}</div>
      </div>`;
  }

  // ── Composition groups ─────────────────────────────────────────────
  const CATEGORIES = ["capital","subcapital","fighter","support","ground","transport","mining","salvage","exploration","any"];

  const groupsSection = html`
    <div class="section">
      <div class="section-title" style="display:flex;align-items:center;justify-content:space-between">
        <span>Composition</span>
        ${canManage ? html`<button class="btn btn-sm" onclick="toggleForm('add-group-form')">+ Add Group</button>` : ""}
      </div>
      ${canManage ? html`
        <div id="add-group-form" hidden style="margin-bottom:1rem">
          <form method="post" action="${bp}/api/ops/${op.id}/groups" style="display:flex;gap:0.5rem;align-items:flex-end;flex-wrap:wrap">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <div class="form-group" style="margin:0;flex:1;min-width:14rem">
              <label>Group Name</label>
              <input type="text" name="name" placeholder="e.g. Strike Wing, Mining Fleet" required />
            </div>
            <button type="submit" class="btn btn-sm">Add Group</button>
            <button type="button" class="btn btn-sm btn-ghost" onclick="toggleForm('add-group-form')">Cancel</button>
          </form>
        </div>` : ""}
      ${op.groups.length
        ? op.groups.map((g) => html`
          <div class="card mb-1">
            <div class="card-header">
              <span class="card-title">${g.name}</span>
              ${canManage ? html`
                <button class="btn btn-sm btn-ghost" onclick="toggleForm('req-form-${g.id}')">+ Requirement</button>
                <form method="post" action="${bp}/api/ops/${op.id}/groups/${g.id}/delete" class="inline">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Delete group and all requirements?')">✕ Group</button>
                </form>` : ""}
            </div>
            ${canManage ? html`
              <div id="req-form-${g.id}" hidden style="padding:0.75rem;background:var(--bg3);margin-bottom:1rem">
                <form method="post" action="${bp}/api/ops/${op.id}/groups/${g.id}/requirements">
                  <input type="hidden" name="_csrf" value="${csrf}" />
                  <div style="display:grid;grid-template-columns:2fr 1fr 4rem 3fr auto;gap:0.5rem;align-items:flex-end">
                    <div class="form-group" style="margin:0">
                      <label>Label</label>
                      <input type="text" name="label" placeholder="e.g. Orion, Fighter Wing" required />
                    </div>
                    <div class="form-group" style="margin:0">
                      <label>Category</label>
                      <select name="category">${CATEGORIES.map((c) => html`<option value="${c}">${c}</option>`)}</select>
                    </div>
                    <div class="form-group" style="margin:0">
                      <label>Count</label>
                      <input type="number" name="count" value="1" min="1" max="20" />
                    </div>
                    <div class="form-group" style="margin:0">
                      <label>Note (optional)</label>
                      <input type="text" name="note" placeholder="Ship type, notes…" />
                    </div>
                    <div><label style="visibility:hidden">x</label><button type="submit" class="btn btn-sm">Add</button></div>
                  </div>
                </form>
              </div>` : ""}
            ${g.requirements.length
              ? g.requirements.map((req) => html`
                <div style="margin-bottom:1rem">
                  <div class="flex gap-1" style="align-items:center;margin-bottom:0.5rem;flex-wrap:wrap">
                    <span class="tag tag-gold">${req.count}× ${req.label}</span>
                    <span class="tag tag-dim">${req.category}</span>
                    <span class="text-dim text-sm">${req.fleetUnits.filter((fu) => fu.status !== "rejected").length}/${req.count} filled</span>
                    ${req.note ? html`<span class="text-dim text-sm">— ${req.note}</span>` : ""}
                    ${canManage ? html`
                      <form method="post" action="${bp}/api/ops/${op.id}/requirements/${req.id}/delete" class="inline">
                        <input type="hidden" name="_csrf" value="${csrf}" />
                        <button type="submit" class="btn btn-sm btn-ghost" onclick="return confirm('Delete requirement?')">✕</button>
                      </form>` : ""}
                  </div>
                  ${req.fleetUnits.length
                    ? html`<div class="unit-grid">${req.fleetUnits.map((unit) => unitCard(unit as UnitFull))}</div>`
                    : html`<p class="text-dim text-sm" style="padding:0 0.5rem">— No units registered for this slot yet —</p>`}
                </div>`)
              : html`<p class="text-dim text-sm">No requirements yet.${canManage ? " Click \"+ Requirement\" to add one." : ""}</p>`}
          </div>`)
        : html`<p class="text-dim text-sm">No composition defined.${canManage ? html` Click <b>+ Add Group</b> to structure the fleet.` : ""}</p>`}
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
      })
  );

  const registerForm = canRegister ? html`
    <div class="section">
      <button class="btn btn-sm" onclick="toggleRegister(this)" type="button">
        + Register a Unit
      </button>
      <div class="collapse-body" id="register-body">
        <div class="type-tabs mb-1">
          <button type="button" class="type-tab active" onclick="switchTab(this,'ship')">Ship</button>
          <button type="button" class="type-tab" onclick="switchTab(this,'squad')">FPS Squad</button>
        </div>

        <form method="post" action="${bp}/api/ops/${op.id}/units" id="register-form">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="unitType" id="unit-type-field" value="ship" />

          <div id="ship-section">
            ${opts.ownedShips.length ? html`
              <div class="form-group">
                <label>Owned Ship (optional)</label>
                <select name="ownedShipId" id="owned-ship-select">
                  <option value="">-- Search another ship below --</option>
                  ${opts.ownedShips.map((ship) => html`
                    <option value="${ship.id}">${ship.name}${ship.manufacturer ? ` // ${ship.manufacturer}` : ""}</option>
                  `)}
                </select>
              </div>` : ""}
            <div class="form-group">
              <label>Search Ship</label>
              <input type="search" id="ship-search" placeholder="Type ship name..." autocomplete="off" />
              <div id="ship-results" class="ship-results"></div>
              <input type="hidden" name="shipId" id="ship-id-field" />
            </div>
            <label class="text-sm text-dim" style="display:flex;align-items:center;gap:.4rem;margin-top:-.5rem;margin-bottom:1rem">
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

          ${availableSlots.length ? html`
            <div class="form-group">
              <label>Fill Composition Slot (optional)</label>
              <select name="requirementId">
                <option value="">-- Unslotted --</option>
                ${availableSlots.map((slot) => html`<option value="${slot.id}">${slot.label}</option>`)}
              </select>
            </div>` : ""}

          <div class="form-group">
            <label>Note for leaders (optional)</label>
            <input type="text" name="captainNote" placeholder="Any information for the fleet operator" />
          </div>

          <div class="form-actions">
            <button type="submit" class="btn">Register Unit</button>
          </div>
        </form>
      </div>
    </div>` : "";
  const crewRequestPanel = canRegister ? html`
    <div class="section">
      <div class="section-title">Crewmember Assignment</div>
      ${myCrewRequest ? html`
        <div class="flex gap-1" style="align-items:center;flex-wrap:wrap">
          <span class="tag tag-green">Need assignment</span>
          ${myCrewRequest.note ? html`<span class="text-dim text-sm">${myCrewRequest.note}</span>` : ""}
          <form method="post" action="${bp}/api/ops/${op.id}/crew-requests/remove" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <button type="submit" class="btn btn-sm btn-ghost">Cancel</button>
          </form>
        </div>`
      : html`
        <form method="post" action="${bp}/api/ops/${op.id}/crew-requests" class="flex gap-1" style="align-items:flex-end;flex-wrap:wrap">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <div class="form-group" style="margin:0;min-width:18rem;flex:1">
            <label>Need assignment note</label>
            <input type="text" name="note" maxlength="240" placeholder="Any seat, prefer FPS / medic / gunner..." />
          </div>
          <button type="submit" class="btn btn-sm">Anmelden als Crewmember</button>
        </form>`}
    </div>` : "";
  // ── Status controls ────────────────────────────────────────────────
  const statusControls = canManage ? html`
    <div class="flex gap-1 mt-2" style="flex-wrap:wrap">
      ${["draft","open","locked","in_progress","completed","cancelled"].map((s) =>
        s !== op.status ? html`
          <form method="post" action="${bp}/api/ops/${op.id}/status" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <input type="hidden" name="status" value="${s}" />
            <button type="submit" class="btn btn-sm btn-ghost">${s.replace("_"," ")}</button>
          </form>` : "")}
    </div>` : "";

  const activeUnits = op.units.filter((unit) => unit.status !== "rejected");
  const fleetOverview = html`
    <aside class="op-side op-fleet">
      <div class="section-title">Aktuelle Flotte (${activeUnits.length})</div>
      ${activeUnits.length ? html`
        <div class="fleet-list">
          ${activeUnits.map((unit) => {
            const assigned = unit.seats.filter((seat) => seat.active && seat.userId).length;
            const total = unit.seats.filter((seat) => seat.active).length;
            const name = unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
            return html`
              <div class="fleet-row">
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

  const raidLead = op.leaders.find((leader) => leader.leaderRole === "raid_leader")
    ?? op.leaders.find((leader) => leader.leaderRole === "fleet_commander")
    ?? op.leaders.find((leader) => leader.leaderRole === "event_leader");
  const raidLeadUser = raidLead?.user ?? op.createdBy;
  const raidLeadAvatar = discordAvatarUrl(raidLeadUser);
  const meetingSystem = op.meetingSystem ?? "stanton";
  const actionDetails = html`
    <aside class="op-side op-details">
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
        <strong>${fmtDate(op.scheduledAt)}</strong>
      </div>
      <div class="raidlead">
        ${raidLeadAvatar
          ? html`<img src="${raidLeadAvatar}" alt="" />`
          : html`<div class="raidlead-fallback">${raidLeadUser.username.slice(0, 2).toUpperCase()}</div>`}
        <div>
          <span class="text-dim text-sm">Aktueller Raidlead</span>
          <strong>${raidLeadUser.username}</strong>
        </div>
      </div>
      ${op.description ? html`
        <div class="action-brief">
          <span class="text-dim text-sm">Briefing</span>
          <p>${op.description}</p>
        </div>` : ""}
      ${isLeader ? html`
        <div class="crew-pool">
          <div class="section-title">Need Assignment (${op.crewRequests.length})</div>
          ${op.crewRequests.length ? op.crewRequests.map((request) => html`
            <div class="crew-request-row">
              <div>
                <strong>${request.user.username}</strong>
                ${request.note ? html`<div class="text-dim text-sm">${request.note}</div>` : ""}
              </div>
              <form method="post" action="${bp}/api/ops/${op.id}/crew-requests/remove" class="inline">
                <input type="hidden" name="_csrf" value="${csrf}" />
                <input type="hidden" name="userId" value="${request.user.id}" />
                <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
              </form>
            </div>`) : html`<p class="text-dim text-sm">No unassigned crewmembers.</p>`}
        </div>` : ""}
    </aside>`;

  const body = html`
    <div class="page-header">
      <div class="flex gap-2" style="align-items:center;flex-wrap:wrap">
        <h1 class="page-title">${op.title}</h1>
        ${opTypeTag(op.opType)}
        ${statusTag(op.status)}
        ${canManage ? html`<a href="${bp}/ops/${op.id}/edit" class="btn btn-sm btn-ghost">Edit</a>` : ""}
        ${canManage ? html`
          <form method="post" action="${bp}/ops/${op.id}/delete" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Delete this operation?')">Delete</button>
          </form>` : ""}
      </div>
      <p class="page-subtitle">${fmtDate(op.scheduledAt)}</p>
      ${op.description ? html`<p class="text-sm mt-1">${op.description}</p>` : ""}
      ${statusControls}
      ${canRealManage ? html`
        <form method="get" action="${bp}/ops/${op.id}" class="flex gap-1 mt-2" style="align-items:center;flex-wrap:wrap">
          <span class="text-dim text-sm">View as Role</span>
          <select name="viewAs" onchange="this.form.submit()" style="width:auto;min-width:9rem;padding:.3rem .5rem">
            <option value="">Actual Role</option>
            ${previewRoles.map((role) => html`<option value="${role}" ${viewAsRole === role ? safe("selected") : ""}>${role}</option>`)}
          </select>
        </form>` : ""}
    </div>

    <div class="op-dashboard">
      ${fleetOverview}
      <div class="op-control">
        ${registerForm}
        ${crewRequestPanel}
        <div class="section">
          <div class="section-title">Leaders</div>
          <div class="flex gap-1" style="flex-wrap:wrap">
            ${op.leaders.length
              ? op.leaders.map((l) => html`
                <span class="tag tag-gold">${l.user.username} (${roleLabel(l.leaderRole)})</span>
                ${canManage ? html`
                  <form method="post" action="${bp}/api/ops/${op.id}/leaders/remove" class="inline">
                    <input type="hidden" name="_csrf" value="${csrf}" />
                    <input type="hidden" name="userId" value="${l.user.id}" />
                    <button type="submit" class="btn btn-sm btn-ghost">Remove</button>
                  </form>` : ""}
              `)
              : html`<span class="text-dim text-sm">No leaders assigned</span>`}
          </div>
          ${canManage ? html`
            <form method="post" action="${bp}/api/ops/${op.id}/leaders" class="flex gap-1 mt-2" style="align-items:flex-end;flex-wrap:wrap">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <div class="form-group" style="margin:0;min-width:14rem">
                <label>Assign Leader</label>
                <select name="userId" required>
                  <option value="">Select user...</option>
                  ${opts.assignableUsers.map((user) => html`
                    <option value="${user.id}">${user.username} (${user.role})</option>
                  `)}
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
            </form>` : ""}
        </div>

        ${groupsSection}

        <div class="section">
          <div class="section-title">Registered Units (${op.units.length})</div>
          ${op.units.length
            ? html`<div class="unit-grid">${unslottedUnits.map((u) => unitCard(u))}</div>`
            : html`<p class="text-dim text-sm">No units registered yet.</p>`}
        </div>
      </div>
      ${actionDetails}
    </div>

    <script>
    function toggleForm(id) {
      const el = document.getElementById(id);
      if (el) el.hidden = !el.hidden;
    }
    function toggleRegister(btn) {
      const body = document.getElementById('register-body');
      const open = body.classList.toggle('open');
      btn.textContent = open ? '- Hide Registration' : '+ Register a Unit';
    }
    function switchTab(btn, type) {
      document.querySelectorAll('.type-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('unit-type-field').value = type;
      document.getElementById('ship-section').hidden = type !== 'ship';
      document.getElementById('squad-section').hidden = type !== 'squad';
    }
    const shipSearch = document.getElementById('ship-search');
    const shipResults = document.getElementById('ship-results');
    const shipIdField = document.getElementById('ship-id-field');
    const ownedShipSelect = document.getElementById('owned-ship-select');
    let searchTimer;
    if (ownedShipSelect && shipIdField) {
      ownedShipSelect.addEventListener('change', () => {
        if (ownedShipSelect.value) {
          shipIdField.value = '';
          if (shipSearch) shipSearch.value = '';
          if (shipResults) shipResults.innerHTML = '';
        }
      });
    }
    if (shipSearch && shipResults && shipIdField) {
      shipSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = shipSearch.value.trim();
        shipIdField.value = '';
        if (ownedShipSelect) ownedShipSelect.value = '';
        if (q.length < 2) {
          shipResults.innerHTML = '';
          return;
        }
        searchTimer = setTimeout(async () => {
          const res = await fetch('${bp}/api/ships?q=' + encodeURIComponent(q));
          const ships = await res.json();
          shipResults.innerHTML = ships.map(s =>
            '<button type="button" class="ship-row" data-id="' + escHtml(s.id) + '" data-name="' + escHtml(s.name) + '" onclick="selectShip(this)">' +
            '<strong>' + escHtml(s.name) + '</strong><span>' + escHtml(s.manufacturer || '') + ' // ' + escHtml(s.size || '') + '</span></button>'
          ).join('');
        }, 180);
      });
    }
    function selectShip(el) {
      document.querySelectorAll('.ship-row').forEach(row => row.classList.remove('selected'));
      el.classList.add('selected');
      if (shipIdField) shipIdField.value = el.dataset.id || '';
      if (shipSearch) shipSearch.value = el.dataset.name || '';
      if (ownedShipSelect) ownedShipSelect.value = '';
    }
    function escHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    </script>`;

  return layout({
    title: op.title,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}

// ── Operation form (create / edit) ──────────────────────────────────


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

  const ownedRows = opts.ownedShips.map((owned) => html`
    <tr>
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
          <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Remove this ship from your profile?')">Remove</button>
        </form>
      </td>
    </tr>`);

  const resultRows = opts.searchResults.map((ship) => {
    const alreadyOwned = opts.ownedShips.some((owned) => owned.ship.id === ship.id);
    return html`
      <tr>
        <td class="text-mono" style="color:var(--cyan)">${ship.name}</td>
        <td class="text-dim">${ship.manufacturer}</td>
        <td>${shipSizeLabel(ship)}</td>
        <td>${ship.career}</td>
        <td>${ship.role}</td>
        <td class="text-mono text-right">${ship.minCrew}-${ship.maxCrew}</td>
        <td class="text-right">
          ${alreadyOwned ? html`<span class="tag tag-green">Owned</span>` : html`
            <form method="post" action="${bp}/profile/ships" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <input type="hidden" name="shipId" value="${ship.id}" />
              <button type="submit" class="btn btn-sm">Add</button>
            </form>`}
        </td>
      </tr>`;
  });

  const body = html`
    <div class="page-header">
      <h1 class="page-title">PROFILE</h1>
      <p class="page-subtitle">${opts.currentUser.username} // ${opts.currentUser.role}</p>
    </div>

    <div class="section">
      <div class="section-title">Owned Ships (${opts.ownedShips.length})</div>
      ${opts.ownedShips.length ? html`
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Ship</th><th>Nickname</th><th>Manufacturer</th><th>Size</th>
                <th>Career</th><th>Role</th><th class="text-right">Crew</th><th></th>
              </tr>
            </thead>
            <tbody>${ownedRows}</tbody>
          </table>
        </div>`
      : html`<p class="text-dim text-sm">No ships added yet. Search the ship database below and add the ships you own.</p>`}
    </div>

    <div class="section">
      <div class="section-title">Add Ship</div>
      <form method="get" action="${bp}/profile" class="flex gap-1 mb-2" style="flex-wrap:wrap">
        <input type="search" name="q" value="${opts.query}" placeholder="Search ship name..." style="max-width:24rem" />
        <button type="submit" class="btn btn-sm">Search</button>
        ${opts.query ? html`<a href="${bp}/profile" class="btn btn-sm btn-ghost">Clear</a>` : ""}
      </form>
      ${opts.query
        ? opts.searchResults.length
          ? html`
            <div style="overflow-x:auto">
              <table>
                <thead>
                  <tr>
                    <th>Ship</th><th>Manufacturer</th><th>Size</th><th>Career</th>
                    <th>Role</th><th class="text-right">Crew</th><th></th>
                  </tr>
                </thead>
                <tbody>${resultRows}</tbody>
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
  op?: Pick<Operation, "id" | "title" | "description" | "opType" | "meetingSystem" | "meetingLocation" | "scheduledAt"> | null;
  locations: Pick<Location, "slug" | "name" | "system" | "systemSlug" | "parentName" | "classification">[];
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const action = op ? `${bp}/ops/${op.id}/edit` : `${bp}/ops/new`;
  const csrf = opts.csrfToken ?? "";

  const opTypes = ["combat", "pve", "training", "mixed", "exploration"];
  const meetingSystem = op?.meetingSystem ?? "stanton";
  const locationOptions = opts.locations
    .filter((location) => SYSTEMS.includes(location.systemSlug as (typeof SYSTEMS)[number]))
    .map((location) => ({
    slug: location.slug,
    value: `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`,
    system: location.systemSlug,
    label: `${location.name} // ${location.system}${location.classification ? ` // ${location.classification}` : ""}`,
  }));
  const selectedLocation = locationOptions.find((location) => location.value === op?.meetingLocation)
    ?? locationOptions.find((location) => location.value.startsWith(`${op?.meetingLocation ?? ""} (`));

  const body = html`
    <div class="page-header">
      <h1 class="page-title">${op ? "EDIT OPERATION" : "NEW OPERATION"}</h1>
    </div>
    <div class="card">
      <form method="post" action="${action}">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <div class="form-group">
          <label>Operation Title</label>
          <input type="text" name="title" value="${op?.title ?? ""}" required placeholder="Operation Darkstar" />
        </div>
        <div class="form-row">
          <div class="form-group">
            <label>Scheduled Date/Time (UTC)</label>
            <input type="datetime-local" name="scheduledAt"
              value="${op ? fmtDateLocal(op.scheduledAt) : ""}" required />
          </div>
          <div class="form-group">
            <label>Operation Type</label>
            <select name="opType">
              ${opTypes.map((t) =>
                html`<option value="${t}" ${op?.opType === t ? safe(' selected') : ""}>${t}</option>`)}
            </select>
          </div>
          <div class="form-group">
            <label>Meeting System</label>
            <select name="meetingSystem" id="meeting-system-select">
              ${SYSTEMS.map((s) => html`<option value="${s}" ${meetingSystem === s ? safe("selected") : ""}>${systemLabel(s)}</option>`)}
            </select>
          </div>
          <div class="form-group">
            <label>Meeting Location</label>
            <select name="meetingLocationSlug" id="meeting-location-select">
              <option value="" data-system="">-- Select location --</option>
              ${locationOptions.map((location) => html`
                <option value="${location.slug}" data-system="${location.system}" data-label="${location.value}" ${selectedLocation?.slug === location.slug ? safe("selected") : ""}>
                  ${location.label}
                </option>`)}
            </select>
            <input type="hidden" name="meetingLocation" id="meeting-location-label" value="${op?.meetingLocation ?? ""}" />
          </div>
        </div>
        <div class="form-group">
          <label>Description</label>
          <textarea name="description" placeholder="Briefing, objectives, notes…">${op?.description ?? ""}</textarea>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn">${op ? "Save Changes" : "Create Operation"}</button>
          <a href="${op ? `${bp}/ops/${op.id}` : `${bp}/`}" class="btn btn-ghost">Cancel</a>
        </div>
      </form>
    </div>
    <script>
    const meetingLocationSelect = document.getElementById('meeting-location-select');
    const meetingSystemSelect = document.getElementById('meeting-system-select');
    const meetingLocationLabel = document.getElementById('meeting-location-label');
    function syncMeetingSystemFromLocation() {
      if (!meetingLocationSelect || !meetingSystemSelect || !meetingLocationLabel) return;
      const opt = meetingLocationSelect.selectedOptions[0];
      meetingLocationLabel.value = opt?.dataset.label || '';
      if (opt?.dataset.system) meetingSystemSelect.value = opt.dataset.system;
    }
    meetingLocationSelect?.addEventListener('change', syncMeetingSystemFromLocation);
    syncMeetingSystemFromLocation();
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

  const rows = opts.ships.map((s) => html`
    <tr>
      <td class="text-mono" style="color:var(--cyan)">${s.name}</td>
      <td class="text-dim">${s.manufacturer}</td>
      <td>${shipSizeLabel(s)}</td>
      <td>${s.career}</td>
      <td>${s.role}</td>
      <td class="text-mono text-right">${s.minCrew}–${s.maxCrew}</td>
      <td class="text-mono text-right">${s.weaponCrew}</td>
      <td class="text-mono text-right">${s.operationCrew}</td>
    </tr>`);

  const body = html`
    <div class="page-header">
      <h1 class="page-title">SHIP DATABASE</h1>
      <p class="page-subtitle">Sourced from star-citizen.wiki</p>
    </div>
    <form method="get" action="${bp}/ships" class="flex gap-1 mb-2">
      <input type="search" name="q" value="${opts.query}" placeholder="Search ship name…" style="max-width:24rem" />
      <button type="submit" class="btn btn-sm">Search</button>
      ${opts.query ? html`<a href="${bp}/ships" class="btn btn-sm btn-ghost">Clear</a>` : ""}
    </form>
    ${opts.ships.length
      ? html`
        <div style="overflow-x:auto">
          <table>
            <thead>
              <tr>
                <th>Name</th><th>Manufacturer</th><th>Size</th>
                <th>Career</th><th>Role</th>
                <th class="text-right">Crew</th>
                <th class="text-right">Gunners</th>
                <th class="text-right">Engineers</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>`
      : html`<p class="text-dim text-sm">${opts.query ? "No ships found." : "Search for a ship above."}</p>`}`;

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
  const body = html`
    <div class="page-header">
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
          <textarea name="message" maxlength="1800" required placeholder="What happened? What should happen instead?"></textarea>
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
  const isFleetOp = opts.currentUser?.role === "superadmin" || opts.currentUser?.role === "fleetoperator";
  const s = opts.sync;
  const ls = opts.locationSync;

  const syncPanel = html`
    <div class="section">
      <div class="section-title">Ship Catalog</div>
      <div class="ship-sync card" style="padding:1rem">
        <div class="ship-sync-stats" style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-bottom:.75rem">
          <div><span class="text-dim text-sm">Ships cached</span><br><strong class="text-mono">${String(s.shipCount)}</strong></div>
          <div><span class="text-dim text-sm">Auto-refresh</span><br><strong>${s.enabled ? safe(`every ${s.intervalDays} day(s)`) : safe("disabled")}</strong></div>
          <div><span class="text-dim text-sm">Last run</span><br><strong>${s.lastRunAt ? fmtDate(s.lastRunAt) : safe("never")}</strong></div>
          <div><span class="text-dim text-sm">Status</span><br><strong>${s.running ? safe("⟳ running…") : safe("idle")}</strong></div>
        </div>
        ${s.lastResult ? html`<p class="text-dim text-sm" style="margin:0 0 .75rem">${s.lastResult}</p>` : safe("")}
        ${isFleetOp ? html`
          <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end">
            <form method="post" action="${bp}/admin/ships/sync" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-cyan" ${s.running ? safe("disabled") : safe("")}>
                ${s.running ? safe("Syncing…") : safe("Sync now")}
              </button>
            </form>
            <form method="post" action="${bp}/admin/ships/config" class="inline" style="display:flex;gap:.5rem;align-items:flex-end">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label class="text-sm text-dim">Interval (days)
                <input type="number" name="intervalDays" min="1" max="90" value="${String(s.intervalDays)}" style="width:5rem" />
              </label>
              <label class="text-sm text-dim" style="display:flex;align-items:center;gap:.35rem">
                <input type="checkbox" name="enabled" value="1" ${s.enabled ? safe("checked") : safe("")} /> auto-refresh
              </label>
              <button type="submit" class="btn btn-ghost btn-sm">Save</button>
            </form>
          </div>
          <p class="text-dim text-sm" style="margin:.5rem 0 0">A full sync pulls every ship from the Star&nbsp;Citizen wiki — it can take a couple of minutes.</p>
        ` : safe("")}
      </div>
    </div>`;

  const feedbackPanel = html`
    <div class="section">
      <div class="section-title">Feedback</div>
      <div class="card" style="padding:1rem">
        <form method="post" action="${bp}/admin/feedback/config" class="inline" style="display:flex;gap:.5rem;align-items:flex-end;flex-wrap:wrap">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <label class="text-sm text-dim">Discord Channel ID
            <input type="text" name="channelId" value="${opts.feedbackChannelId}" placeholder="123456789012345678" style="min-width:18rem" />
          </label>
          <button type="submit" class="btn btn-ghost btn-sm">Save</button>
        </form>
        <p class="text-dim text-sm" style="margin:.5rem 0 0">Feedback tickets are posted to this Discord channel by the configured bot.</p>
      </div>
    </div>`;

  const locationSyncPanel = html`
    <div class="section">
      <div class="section-title">Location Catalog</div>
      <div class="ship-sync card" style="padding:1rem">
        <div class="ship-sync-stats" style="display:flex;flex-wrap:wrap;gap:1.25rem;margin-bottom:.75rem">
          <div><span class="text-dim text-sm">Locations cached</span><br><strong class="text-mono">${String(ls.locationCount)}</strong></div>
          <div><span class="text-dim text-sm">Auto-refresh</span><br><strong>${ls.enabled ? safe(`every ${ls.intervalDays} day(s)`) : safe("disabled")}</strong></div>
          <div><span class="text-dim text-sm">Last run</span><br><strong>${ls.lastRunAt ? fmtDate(ls.lastRunAt) : safe("never")}</strong></div>
          <div><span class="text-dim text-sm">Status</span><br><strong>${ls.running ? safe("running...") : safe("idle")}</strong></div>
        </div>
        ${ls.lastResult ? html`<p class="text-dim text-sm" style="margin:0 0 .75rem">${ls.lastResult}</p>` : safe("")}
        ${isFleetOp ? html`
          <div style="display:flex;flex-wrap:wrap;gap:.75rem;align-items:flex-end">
            <form method="post" action="${bp}/admin/locations/sync" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-cyan" ${ls.running ? safe("disabled") : safe("")}>
                ${ls.running ? safe("Syncing...") : safe("Sync now")}
              </button>
            </form>
            <form method="post" action="${bp}/admin/locations/config" class="inline" style="display:flex;gap:.5rem;align-items:flex-end">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <label class="text-sm text-dim">Interval (days)
                <input type="number" name="intervalDays" min="1" max="90" value="${String(ls.intervalDays)}" style="width:5rem" />
              </label>
              <label class="text-sm text-dim" style="display:flex;align-items:center;gap:.35rem">
                <input type="checkbox" name="enabled" value="1" ${ls.enabled ? safe("checked") : safe("")} /> auto-refresh
              </label>
              <button type="submit" class="btn btn-ghost btn-sm">Save</button>
            </form>
          </div>
          <p class="text-dim text-sm" style="margin:.5rem 0 0">A full sync pulls locations from the Star Citizen wiki location API.</p>
        ` : safe("")}
      </div>
    </div>`;

  const rows = opts.users.map((u) => html`
    <tr>
      <td class="text-mono" style="font-size:0.72rem;color:var(--dim)">${u.id}</td>
      <td>${u.username}</td>
      <td>
        ${isSuperAdmin ? html`
          <form method="post" action="${bp}/admin/users/${u.id}/role" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <select name="role" onchange="this.form.submit()" class="user-table">
              ${["superadmin","fleetoperator","captain","crew"].map((r) =>
                html`<option value="${r}" ${u.role === r ? safe("selected") : ""}>${r}</option>`)}
            </select>
          </form>` : html`<span class="tag tag-role">${u.role}</span>`}
      </td>
      <td>
        ${isSuperAdmin ? html`
          <form method="post" action="${bp}/admin/users/${u.id}/active" class="inline">
            <input type="hidden" name="_csrf" value="${csrf}" />
            <button type="submit" class="btn btn-sm ${u.active ? "btn-ghost" : "btn-gold"}">
              ${u.active ? "Active" : "Disabled"}
            </button>
          </form>` : html`<span class="${u.active ? "tag-green" : "tag-red"} tag">${u.active ? "Active" : "Disabled"}</span>`}
      </td>
      <td class="text-dim text-sm">${fmtDate(u.lastSeenAt)}</td>
    </tr>`);

  const body = html`
    <div class="page-header">
      <h1 class="page-title">ADMIN PANEL</h1>
    </div>
    ${syncPanel}
    ${locationSyncPanel}
    ${isFleetOp ? feedbackPanel : ""}
    <div class="section">
      <div class="section-title">Users (${opts.users.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead>
            <tr><th>Discord ID</th><th>Username</th><th>Role</th><th>Status</th><th>Last Seen</th></tr>
          </thead>
          <tbody>${rows}</tbody>
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
    opts.discord && html`<a href="${bp}/auth/discord/start" class="btn btn-login btn-discord" style="display:flex;align-items:center;gap:.6rem;justify-content:center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
      Login with Discord
    </a>`,
    opts.github && html`<a href="${bp}/auth/github/start" class="btn btn-login btn-github" style="display:flex;align-items:center;gap:.6rem;justify-content:center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12"/></svg>
      Login with GitHub
    </a>`,
    opts.google && html`<a href="${bp}/auth/google/start" class="btn btn-login btn-google" style="display:flex;align-items:center;gap:.6rem;justify-content:center">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/><path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/><path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/><path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/></svg>
      Login with Google
    </a>`,
  ].filter(Boolean);

  const body = html`
    <div style="max-width:22rem;margin:4rem auto;text-align:center">
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
  identities: Array<{ provider: string; username: string | null; email: string | null; createdAt: Date }>;
  discord: boolean;
}): SafeHtml {
  const bp = opts.basePath;
  const providerLabel: Record<string, string> = { discord: "Discord", github: "GitHub", google: "Google" };
  const hasDiscord = opts.identities.some((i) => i.provider === "discord");

  const rows = opts.identities.map((i) => html`
    <div class="identity-row" style="display:flex;align-items:center;gap:1rem;padding:.6rem 0;border-bottom:1px solid var(--bg3)">
      <span class="tag" style="min-width:5rem;text-align:center">${providerLabel[i.provider] ?? i.provider}</span>
      <span>${i.username ?? "—"}</span>
      ${i.email ? html`<span class="text-dim text-sm">${i.email}</span>` : safe("")}
      <span class="text-dim text-sm" style="margin-left:auto">since ${fmtDate(i.createdAt)}</span>
    </div>`);

  const linkDiscordBtn = (!hasDiscord && opts.discord)
    ? html`<a href="${bp}/auth/discord/link/start" class="btn btn-cyan" style="margin-top:1rem">Link Discord account</a>`
    : safe("");

  const body = html`
    <div class="page-header"><h1 class="page-title">MY ACCOUNT</h1></div>
    <div class="section">
      <div class="section-title">Linked accounts</div>
      <div class="card" style="padding:1rem">
        ${rows}
        ${linkDiscordBtn}
      </div>
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
  const body = html`
    <div style="max-width:32rem;margin:4rem auto;text-align:center">
      <div class="page-title" style="font-size:3rem;color:var(--red);margin-bottom:0.5rem">${opts.status}</div>
      <p class="text-dim">${opts.message}</p>
      <a href="${opts.basePath}/" class="btn btn-sm mt-2" style="margin-top:1.5rem">← Back to Operations</a>
    </div>`;

  return layout({
    title: `Error ${opts.status}`,
    basePath: opts.basePath,
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
  const body = html`
    <div style="max-width:32rem;margin:4rem auto;text-align:center">
      <h1 class="page-title" style="font-size:1.6rem;margin-bottom:1rem">No Discord server yet</h1>
      <p class="text-dim" style="margin-bottom:1.5rem">
        Fleetplanner is organised per Discord server. To start planning, add the
        bot to a Discord you manage — or log in with a Discord account that is a
        member of a server where the bot is already installed.
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
  const roleLabel: Record<string, string> = { fleetoperator: "Admiral", captain: "Captain", crew: "Crew" };

  const rows = opts.guilds.map((g) => {
    const isActive = g.guildId === opts.activeGuildId;
    return html`
    <div class="card" style="display:flex;align-items:center;gap:1rem;padding:.75rem 1rem;margin-bottom:.5rem">
      <strong style="flex:1">${g.guildName} ${isActive ? safe('<span class="tag tag-green">active</span>') : safe("")}</strong>
      <span class="tag tag-role">${roleLabel[g.role] ?? g.role}</span>
      ${g.role === "fleetoperator" ? html`<a href="${bp}/guilds/settings" class="btn btn-ghost btn-sm">Settings</a>` : safe("")}
      ${isActive ? safe("") : html`
        <form method="post" action="${bp}/guilds/switch" class="inline">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <input type="hidden" name="guildId" value="${g.guildId}" />
          <button type="submit" class="btn btn-cyan btn-sm">Switch to this server</button>
        </form>`}
    </div>`;
  });

  const body = html`
    <div class="page-header"><h1 class="page-title">SERVERS</h1></div>
    <div class="section">
      ${opts.guilds.length
        ? html`<div>${rows}</div>`
        : html`<p class="text-dim">You're not a member of any server yet.</p>`}
      <a href="${bp}/guilds/add" class="btn btn-cyan" style="margin-top:1rem">+ Add Fleetplanner bot to a Discord</a>
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
  guild: { id: string; name: string; eventChannelId: string | null; admiralRoleId: string | null; captainRoleId: string | null };
  memberships: Array<{ userId: string; role: string; user: { username: string }; createdAt: Date }>;
  activeGuildId: string;
  activeGuildName: string;
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const g = opts.guild;

  const memberRows = opts.memberships.map((m) => html`
    <tr>
      <td>${m.user.username}</td>
      <td class="text-mono text-sm text-dim">${m.userId}</td>
      <td>
        <form method="post" action="${bp}/guilds/members/${m.userId}/role" class="inline">
          <input type="hidden" name="_csrf" value="${csrf}" />
          <select name="role" onchange="this.form.submit()" class="user-table">
            ${["fleetoperator", "captain", "crew"].map((r) =>
              html`<option value="${r}" ${m.role === r ? safe("selected") : ""}>${r}</option>`)}
          </select>
        </form>
      </td>
      <td class="text-dim text-sm">${fmtDate(m.createdAt)}</td>
    </tr>`);

  const body = html`
    <div class="page-header">
      <h1 class="page-title">SERVER SETTINGS<span class="sep"> // </span><em>${g.name}</em></h1>
    </div>

    <div class="section">
      <div class="section-title">Discord integration</div>
      <form method="post" action="${bp}/guilds/settings" class="card" style="padding:1rem;display:flex;flex-direction:column;gap:.75rem;max-width:30rem">
        <input type="hidden" name="_csrf" value="${csrf}" />
        <label class="text-sm text-dim">Event voice channel ID (optional — empty = external event)
          <input type="text" name="eventChannelId" value="${g.eventChannelId ?? ""}" placeholder="123456789012345678" />
        </label>
        <label class="text-sm text-dim">Admiral role ID (Discord role → fleetoperator)
          <input type="text" name="admiralRoleId" value="${g.admiralRoleId ?? ""}" placeholder="optional" />
        </label>
        <label class="text-sm text-dim">Captain role ID (Discord role → captain)
          <input type="text" name="captainRoleId" value="${g.captainRoleId ?? ""}" placeholder="optional" />
        </label>
        <button type="submit" class="btn btn-cyan btn-sm" style="align-self:flex-start">Save</button>
      </form>
      <p class="text-dim text-sm" style="margin-top:.5rem">
        Scheduled events for this server's operations are posted to this Discord.
        Role IDs are optional — set them to auto-map Discord roles to fleet roles on login.
      </p>
    </div>

    <div class="section">
      <div class="section-title">Members (${opts.memberships.length})</div>
      <div style="overflow-x:auto">
        <table class="user-table">
          <thead><tr><th>User</th><th>ID</th><th>Role (this server)</th><th>Joined</th></tr></thead>
          <tbody>${memberRows}</tbody>
        </table>
      </div>
    </div>`;

  return layout({
    title: `Settings — ${g.name}`,
    basePath: bp,
    currentUser: opts.currentUser,
    csrfToken: opts.csrfToken,
    flash: flashFromQuery(opts.flash),
    body,
  });
}
