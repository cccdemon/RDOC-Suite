import { html, safe, layout, type SafeHtml, type LayoutOptions } from "./render.js";
import type { User, Operation, Ship } from "@prisma/client";

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

function flashFromQuery(msg: string | undefined): LayoutOptions["flash"] {
  if (!msg) return null;
  const [kind, ...rest] = msg.split(":");
  const text = rest.join(":") || msg;
  if (kind === "ok" || kind === "warn" || kind === "error") return { kind, text };
  return { kind: "ok", text: msg };
}

// ── Home / Calendar ──────────────────────────────────────────────────

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
  ships: Ship[];  // for register form
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const u = opts.currentUser;
  const csrf = opts.csrfToken ?? "";

  const currentUserId = u?.id;
  const isLeader = !!u && (
    u.role === "superadmin" || u.role === "fleetoperator" ||
    op.leaders.some((l) => l.user.id === currentUserId)
  );
  const canManage = u && (u.role === "superadmin" || u.role === "fleetoperator");

  // Separate unslotted units (no requirementId) from slotted ones
  const unslottedUnits = op.units.filter((unit) => !unit.requirementId);

  // ── Unit card ──────────────────────────────────────────────────────
  function unitCard(unit: UnitFull): SafeHtml {
    const isCaptain = u && unit.captainId === u.id;
    const unitName = unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");

    const seats = unit.seats.map((seat) => {
      const claimed = !!seat.userId;
      const isMe = u && seat.userId === u.id;
      const canClaim = u && !claimed && unit.status === "accepted";
      const canUnclaim = claimed && (isMe || isLeader);

      return html`
        <div class="seat-row">
          <span class="seat-label">${seat.label}</span>
          <span class="seat-type text-mono" style="font-size:0.65rem;color:var(--dim)">${seat.seatType}</span>
          <span class="seat-user ${claimed ? "" : "empty"}">${claimed ? seat.user?.username ?? "?" : "— open —"}</span>
          ${canClaim ? html`
            <form method="post" action="${bp}/api/seats/${seat.id}/claim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-green">Claim</button>
            </form>` : ""}
          ${canUnclaim && !(seat.order === 0 && !canManage) ? html`
            <form method="post" action="${bp}/api/seats/${seat.id}/unclaim" class="inline">
              <input type="hidden" name="_csrf" value="${csrf}" />
              <button type="submit" class="btn btn-sm btn-ghost">Release</button>
            </form>` : ""}
        </div>`;
    });

    return html`
      <div class="unit-card status-${unit.status}">
        <div class="unit-card-header">
          <span class="unit-name">${unitName}</span>
          ${unit.unitType === "squad" ? html`<span class="tag">FPS</span>` : ""}
          ${statusTag(unit.status)}
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
  const alreadyCaptain = u && op.units.some((unit) => unit.captainId === currentUserId);

  // Available composition slots (not yet fully filled by non-rejected units)
  const availableSlots = op.groups.flatMap((g) =>
    g.requirements
      .filter((r) => r.fleetUnits.filter((fu) => fu.status !== "rejected").length < r.count)
      .map((r) => {
        const filled = r.fleetUnits.filter((fu) => fu.status !== "rejected").length;
        return { id: r.id, label: `${g.name}: ${r.label} (${filled}/${r.count})` };
      })
  );

  const registerForm = canRegister && !alreadyCaptain ? html`
    <div class="section">
      <button class="collapse-toggle" onclick="toggleRegister(this)">
        <span>▶</span> + REGISTER A UNIT
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
            <div class="form-group">
              <label>Search Ship</label>
              <input type="search" id="ship-search" placeholder="Type ship name…" autocomplete="off" />
              <div id="ship-results" class="ship-results"></div>
              <input type="hidden" name="shipId" id="ship-id-field" />
            </div>
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
                <option value="">— Unslotted —</option>
                ${availableSlots.map((s) => html`<option value="${s.id}">${s.label}</option>`)}
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
    </div>

    <div class="section">
      <div class="section-title">Leaders</div>
      <div class="flex gap-1" style="flex-wrap:wrap">
        ${op.leaders.length
          ? op.leaders.map((l) => html`<span class="tag tag-gold">${l.user.username} (${l.leaderRole.replace("_"," ")})</span>`)
          : html`<span class="text-dim text-sm">No leaders assigned</span>`}
      </div>
    </div>

    ${groupsSection}

    <div class="section">
      <div class="section-title">Registered Units (${op.units.length})</div>
      ${op.units.length
        ? html`<div class="unit-grid">${unslottedUnits.map((u) => unitCard(u))}</div>`
        : html`<p class="text-dim text-sm">No units registered yet.</p>`}
    </div>

    ${registerForm}

    <script>
    function toggleForm(id) {
      const el = document.getElementById(id);
      if (el) el.hidden = !el.hidden;
    }
    function toggleRegister(btn) {
      const body = document.getElementById('register-body');
      const open = body.classList.toggle('open');
      btn.querySelector('span').textContent = open ? '▼' : '▶';
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
    let searchTimer;
    if (shipSearch) {
      shipSearch.addEventListener('input', () => {
        clearTimeout(searchTimer);
        const q = shipSearch.value.trim();
        if (!q) { shipResults.innerHTML = ''; return; }
        searchTimer = setTimeout(() => {
          fetch('${bp}/api/ships?q=' + encodeURIComponent(q))
            .then(r => r.json())
            .then(ships => {
              shipResults.innerHTML = ships.slice(0,10).map(s =>
                '<div class="ship-row" data-id="' + escHtml(s.id) + '" data-name="' + escHtml(s.name) + '" onclick="selectShip(this)">' +
                '<span class="ship-name">' + escHtml(s.name) + '</span>' +
                '<span class="ship-mfr">' + escHtml(s.manufacturer || '') + '</span>' +
                '<span class="ship-stat">' + escHtml(s.size || '') + '</span>' +
                '<span class="ship-stat">crew ' + s.minCrew + '–' + s.maxCrew + '</span>' +
                '</div>'
              ).join('');
            });
        }, 250);
      });
    }
    function selectShip(el) {
      document.querySelectorAll('.ship-row').forEach(r => r.classList.remove('selected'));
      el.classList.add('selected');
      shipIdField.value = el.dataset.id;
      shipSearch.value = el.dataset.name;
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

export function opFormPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  op?: Pick<Operation, "id" | "title" | "description" | "opType" | "scheduledAt"> | null;
}): SafeHtml {
  const bp = opts.basePath;
  const op = opts.op;
  const action = op ? `${bp}/ops/${op.id}/edit` : `${bp}/ops/new`;
  const csrf = opts.csrfToken ?? "";

  const opTypes = ["combat", "pve", "training", "mixed", "exploration"];

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
    </div>`;

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
      <td>${s.size}</td>
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

type UserRow = Pick<User, "id" | "username" | "role" | "active" | "joinedAt" | "lastSeenAt">;

export function adminPage(opts: {
  basePath: string;
  currentUser: LayoutOptions["currentUser"];
  csrfToken?: string;
  flash?: string;
  users: UserRow[];
}): SafeHtml {
  const bp = opts.basePath;
  const csrf = opts.csrfToken ?? "";
  const isSuperAdmin = opts.currentUser?.role === "superadmin";

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
}): SafeHtml {
  const bp = opts.basePath;
  const body = html`
    <div style="max-width:28rem;margin:4rem auto;text-align:center">
      <h1 class="page-title" style="font-size:2rem;margin-bottom:1rem">RDOC FLEETPLANNER</h1>
      <p class="text-dim text-sm" style="margin-bottom:2rem">
        Star Citizen fleet operations — calendar, unit registration, seat assignment.
      </p>
      <a href="${bp}/auth/start" class="btn" style="font-size:1rem;padding:.75rem 2rem">
        Login via Discord
      </a>
      <p class="text-dim text-sm" style="margin-top:1.5rem">
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
