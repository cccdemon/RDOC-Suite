import { escape } from "node:querystring";

/**
 * HTML page templates for the admin web UI. Plain template literals,
 * no view engine — the surface is tiny, server-side state is small,
 * and we want zero build-step on the bridge. Pages link to the static
 * chaos-crew CSS + a small admin.js for client interactions.
 *
 * Brand voice: all visible UI strings in German, ALL-CAPS + letter-
 * spacing for buttons/labels, Du-form. See the Chaos Crew Voice
 * Console design-system handoff for the visual rules.
 */

function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  let out = "";
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) {
      const v = values[i];
      out += v === undefined || v === null ? "" : String(v);
    }
  });
  return out;
}

function esc(s: string | number | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function _unused_escape_kept_to_signal_intent(s: string): string {
  return escape(s);
}

type LayoutOpts = {
  title: string;
  body: string;
  staticBase: string; // public path to /admin/static
  bodyClass?: string;
  scripts?: string;
};

function layout({ title, body, staticBase, bodyClass = "", scripts = "" }: LayoutOpts): string {
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} · DCCC Admin</title>
  <link rel="stylesheet" href="${staticBase}/colors_and_type.css">
  <link rel="stylesheet" href="${staticBase}/admin.css">
</head>
<body class="${esc(bodyClass)}">
  <div class="scanlines"></div>
  ${body}
  ${scripts}
</body>
</html>`;
}

export function renderLogin(opts: {
  staticBase: string;
  oauthStartUrl: string;
  error?: string | null;
}): string {
  const errorBanner = opts.error
    ? html`<div class="login-error">${esc(opts.error)}</div>`
    : "";
  const body = html`
    <main class="login-shell">
      <div class="login-card">
        <span class="card-tick"></span>
        <div class="login-brand">
          <span class="brand-cy">DCCC</span><span class="brand-sep"> // </span><span class="brand-gd">ADMIN</span>
        </div>
        <h1 class="login-title">SIGN IN</h1>
        <p class="login-sub">Channel Commander Admin-Console. Dein Discord-Konto muss von einem bestehenden Admin freigegeben sein.</p>
        ${errorBanner}
        <a class="btn btn-cyan btn-full" href="${esc(opts.oauthStartUrl)}">CONTINUE WITH DISCORD</a>
        <div class="login-footer">
          <span>CHAOS IS A PLAN&nbsp;&nbsp;//&nbsp;&nbsp;o7</span>
        </div>
      </div>
    </main>`;
  return layout({
    title: "Sign in",
    body,
    staticBase: opts.staticBase,
    bodyClass: "login-body",
  });
}

export type DashboardData = {
  guildId: string;
  guildName?: string | null;
  bridgeOk: boolean;
  botOk: boolean;
  livekitOk: boolean;
  activeCommanders: Array<{ userId: string; displayName?: string; speaking: boolean }>;
  commanderRoleMembers: Array<{
    userId: string;
    displayName: string;
    inVoice: boolean;
    inAllowedChannel: boolean;
  }>;
  enabled: boolean;
  /** Per-allowed-voice-channel snapshot of currently-connected members.
   *  Drives the Raid-Planer page (rename / move / role / DM). Each
   *  member is enriched with the role-ids they currently hold (only
   *  ids the admin UI cares about, i.e. those listed in
   *  GuildConfig.commanderRoleIds) and an `isBot` flag for relay-bots
   *  like funkrelais — those get a stripped-down render with no
   *  per-user actions. */
  channelMirror: Array<{
    channelId: string;
    channelName: string;
    members: Array<{
      userId: string;
      displayName: string;
      currentCommanderRoleIds: string[];
      isBot: boolean;
    }>;
  }>;
  /** All voice channels (type 2) in the guild — used as drop targets
   *  for the Move-Member drag-and-drop, including channels not in
   *  allowedVoiceChannelIds so an admin can also kick people out of
   *  the squad-link network. */
  allVoiceChannels: Array<{ channelId: string; channelName: string }>;
  /** Only the roles that are listed in GuildConfig.commanderRoleIds —
   *  these are the only ones the Raid-Planer UI lets an admin grant
   *  or revoke (typically RDOC-CC + RDCP.SQ-CC). To enable management
   *  of additional roles, add their snowflakes to commanderRoleIds. */
  commanderRoles: Array<{ roleId: string; roleName: string }>;
  /** First role-id in commanderRoleIds (if any). Used by the
   *  Raid-Planer name-colour indicator: green if the user has this
   *  specific role, red otherwise. Admins control which role is the
   *  indicator by listing it first in the Konfig commanderRoleIds. */
  primaryCommanderRoleId?: string;
};

export function renderDashboard(opts: {
  staticBase: string;
  navBase: string; // url prefix for nav links, e.g. /dccc/admin
  data: DashboardData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const { data } = opts;
  const titleText = opts.currentGuild?.name ?? data.guildName ?? data.guildId;
  const healthBadge = (label: string, ok: boolean): string =>
    html`<span class="health-svc ${ok ? "ok" : "error"}"><span class="health-dot"></span>${esc(label)}</span>`;

  const activeRows = data.activeCommanders.length
    ? data.activeCommanders
        .map(
          (c) => html`
        <li class="commander-row ${c.speaking ? "speaking" : ""}">
          <span class="cmd-name">${esc(c.displayName ?? c.userId)}</span>
          <span class="cmd-status">${c.speaking ? "TALKING" : "IDLE"}</span>
        </li>`,
        )
        .join("")
    : html`<li class="empty">— niemand verbunden —</li>`;

  const memberRows = data.commanderRoleMembers.length
    ? data.commanderRoleMembers
        .map(
          (m) => html`
        <li class="member-row" data-user-id="${esc(m.userId)}">
          <span class="m-name">${esc(m.displayName)}</span>
          <span class="m-state ${m.inAllowedChannel ? "ok" : m.inVoice ? "warn" : "off"}">
            ${m.inAllowedChannel ? "IN VOICE" : m.inVoice ? "OTHER CHANNEL" : "OFFLINE"}
          </span>
          <button class="btn btn-sm btn-red m-strip" data-strip-commander="${esc(m.userId)}" data-name="${esc(m.displayName)}" title="Commander-Rolle entziehen">ROLLE ENTZIEHEN</button>
        </li>`,
        )
        .join("")
    : html`<li class="empty">— noch keine Mitglieder mit Commander-Rolle bekannt —</li>`;

  // Channel-Mirror lives in its own page now ("Raid Planer") — see
  // renderRaidPlaner below. The dashboard stays focused on live state.

  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "dashboard",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">DASHBOARD<span class="sep"> // </span><em>${esc(titleText)}</em></h1>
        <div class="header-right">
          <span class="badge ${data.enabled ? "on" : "off"}">${data.enabled ? "SYSTEM ON" : "SYSTEM OFF"}</span>
        </div>
      </header>

      <section class="health-bar">
        ${healthBadge("BRIDGE", data.bridgeOk)}
        ${healthBadge("BOT", data.botOk)}
        ${healthBadge("LIVEKIT", data.livekitOk)}
      </section>

      <div class="dash-grid">
        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">VERBUNDENE COMMANDER <span class="card-meta" id="active-count">${data.activeCommanders.length}</span></h2>
          <ul class="commander-list" id="active-commanders">${activeRows}</ul>
        </section>

        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">MITGLIEDER MIT COMMANDER-ROLLE <span class="card-meta" id="member-count">${data.commanderRoleMembers.length}</span></h2>
          <ul class="member-list" id="commander-members">${memberRows}</ul>
        </section>
      </div>

    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({
    title: "Dashboard",
    body,
    staticBase: opts.staticBase,
    scripts,
  });
}

/**
 * Initial-render of the Raid-Planer page. Most of the per-tick work
 * (re-rendering tiles, wiring drag-drop, context menus) happens in
 * admin.js — this returns a near-empty shell that the polling tick
 * fills as soon as the first /admin/api/live response arrives.
 */
export function renderRaidPlaner(opts: {
  staticBase: string;
  navBase: string;
  data: DashboardData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const { data } = opts;
  const titleText = opts.currentGuild?.name ?? data.guildName ?? data.guildId;
  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "raid-planer",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">RAID PLANER<span class="sep"> // </span><em>${esc(titleText)}</em></h1>
      </header>
      <p class="hint">
        Jeder Tile = ein freigeschalteter Voice-Channel. Member <strong>per Drag-and-Drop</strong> zwischen Tiles ziehen, um sie in Discord zu verschieben. <strong>Rechtsklick</strong> auf einen Member öffnet das Rollen-Menü (nur die Commander-Rollen aus der Konfiguration). DM-Link via Button. Bots (Funkrelais) werden separiert dargestellt und sind nicht interaktiv.
      </p>
      <section class="card" style="margin-top: 12px;">
        <span class="card-tick"></span>
        <h2 class="card-title">CHANNEL MIRROR <span class="card-meta" id="channel-mirror-count">${data.channelMirror.length}</span></h2>
        <div class="cm-grid" id="channel-mirror"><div class="empty">— wird geladen —</div></div>
      </section>
      <div id="cm-ctx-menu" class="cm-ctx-menu" hidden></div>
    </main>`;
  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({
    title: "Raid Planer",
    body,
    staticBase: opts.staticBase,
    scripts,
  });
}

export type ConfigPageData = {
  guildId: string;
  enabled: boolean;
  bridgeMode: string;
  commanderRoleIds: string[];
  allowedVoiceChannelIds: string[];
};

export function renderConfig(opts: {
  staticBase: string;
  navBase: string;
  data: ConfigPageData;
  saved?: boolean;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const titleText = opts.currentGuild?.name ?? opts.data.guildId;
  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "config",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">SERVER-KONFIG<span class="sep"> // </span><em>${esc(titleText)}</em></h1>
      </header>

      ${opts.saved ? html`<div class="toast toast-ok">Gespeichert.</div>` : ""}

      <form class="card config-form" id="config-form">
        <span class="card-tick"></span>
        <h2 class="card-title">CHANNEL COMMANDER KONFIG</h2>

        <div class="field">
          <label for="enabled">System aktiviert</label>
          <input type="checkbox" id="enabled" name="enabled" ${opts.data.enabled ? "checked" : ""}>
          <span class="hint">Wenn aus, lehnt die Bridge neue WS-Verbindungen ab.</span>
        </div>

        <div class="field">
          <label for="commanderRoleIds">Commander-Rollen (eine pro Zeile, Discord Role-ID als Snowflake)</label>
          <textarea id="commanderRoleIds" name="commanderRoleIds" rows="4">${esc(opts.data.commanderRoleIds.join("\n"))}</textarea>
          <span class="hint">Rechtsklick auf die Rolle in Discord (Developer-Mode an) → „ID kopieren".</span>
        </div>

        <div class="field">
          <label for="allowedVoiceChannelIds">Erlaubte Voice-Channels (eine ID pro Zeile)</label>
          <textarea id="allowedVoiceChannelIds" name="allowedVoiceChannelIds" rows="6">${esc(opts.data.allowedVoiceChannelIds.join("\n"))}</textarea>
          <span class="hint">Leer = alle Voice-Channels erlaubt. Sonst: nur User in den gelisteten Channels dürfen sprechen.</span>
        </div>

        <div class="actions">
          <button type="submit" class="btn btn-cyan">SPEICHERN</button>
        </div>
      </form>
    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({
    title: "Server-Konfig",
    body,
    staticBase: opts.staticBase,
    scripts,
  });
}

export type AdminRoleLiteral = "admiral" | "vice_admiral";

export type AdminsPageData = {
  guildId: string;
  admins: Array<{
    userId: string;
    displayName?: string;
    role: AdminRoleLiteral;
    protected: boolean;
    addedBy: string | null;
    addedByName?: string;
    createdAt: Date;
  }>;
  invites: Array<{
    id: string;
    label: string;
    role: AdminRoleLiteral;
    expiresAt: Date;
    usedAt: Date | null;
    usedBy: string | null;
  }>;
  /** If a new invite was just created, its raw token + URL to show once. */
  freshInvite?: { url: string; expiresAt: Date; role: AdminRoleLiteral };
  /** Who's viewing this page — used to gate action buttons in the UI. */
  viewerRole: AdminRoleLiteral;
  viewerUserId: string;
};

function dateFmt(d: Date | null): string {
  if (!d) return "—";
  return d.toISOString().replace("T", " ").slice(0, 16) + " UTC";
}

export function renderAdmins(opts: {
  staticBase: string;
  navBase: string;
  data: AdminsPageData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const titleText = opts.currentGuild?.name ?? opts.data.guildId;
  const roleLabel = (r: AdminRoleLiteral): string =>
    r === "admiral" ? "ADMIRAL" : "VICE ADMIRAL";
  const roleBadge = (r: AdminRoleLiteral): string =>
    html`<span class="role-badge role-${r}">${esc(roleLabel(r))}</span>`;

  const canManageAdmins = opts.data.viewerRole === "admiral";

  const adminRows = opts.data.admins
    .map((a) => {
      const isSelf = a.userId === opts.data.viewerUserId;
      const canTouch = canManageAdmins && !a.protected && !isSelf;
      const otherRole: AdminRoleLiteral = a.role === "admiral" ? "vice_admiral" : "admiral";
      const actions = canTouch
        ? html`
        <span class="row-actions">
          <button class="btn btn-sm btn-cyan" data-set-role="${esc(a.userId)}" data-new-role="${esc(otherRole)}" title="Rolle ändern">→ ${esc(roleLabel(otherRole))}</button>
          <button class="btn btn-sm btn-red" data-remove-admin="${esc(a.userId)}" title="Admin entfernen">ENTFERNEN</button>
        </span>`
        : isSelf
          ? html`<span class="row-actions"><span class="row-tag">DU</span></span>`
          : a.protected
            ? html`<span class="row-actions"><span class="row-tag protected" title="Bootstrap-Admin — geschützt">GESCHÜTZT</span></span>`
            : "";
      const nameBlock = a.displayName
        ? html`<span class="a-name">${esc(a.displayName)}</span><span class="a-id dim">${esc(a.userId)}</span>`
        : html`<span class="a-id">${esc(a.userId)}</span>`;
      const addedBy = a.addedBy
        ? ` by ${esc(a.addedByName ?? a.addedBy)}`
        : "";
      return html`
    <li class="admin-row ${a.protected ? "is-protected" : ""}">
      ${nameBlock}
      ${roleBadge(a.role)}
      <span class="a-meta">added ${dateFmt(a.createdAt)}${addedBy}</span>
      ${actions}
    </li>`;
    })
    .join("");

  const inviteRows = opts.data.invites
    .map(
      (i) => html`
    <li class="invite-row ${i.usedAt ? "used" : "live"}">
      <span class="i-label">${esc(i.label)}</span>
      ${roleBadge(i.role)}
      <span class="i-state">${i.usedAt ? `USED ${dateFmt(i.usedAt)} by ${esc(i.usedBy ?? "?")}` : `EXPIRES ${dateFmt(i.expiresAt)}`}</span>
      ${i.usedAt || !canManageAdmins ? "" : html`<button class="btn btn-sm btn-red" data-revoke-invite="${esc(i.id)}">REVOKE</button>`}
    </li>`,
    )
    .join("");

  const fresh = opts.data.freshInvite
    ? html`
    <div class="fresh-invite card">
      <span class="card-tick"></span>
      <h3>NEUER INVITE-LINK — ${esc(roleLabel(opts.data.freshInvite.role))}</h3>
      <p>Einmal sichtbar — jetzt kopieren + an die Person schicken. Gültig bis ${dateFmt(opts.data.freshInvite.expiresAt)}.</p>
      <input type="text" readonly value="${esc(opts.data.freshInvite.url)}" id="fresh-url" class="invite-url">
      <button class="btn btn-cyan btn-sm" id="copy-fresh">COPY</button>
    </div>`
    : "";

  const inviteForm = canManageAdmins
    ? html`
          <form class="invite-form" id="invite-form">
            <div class="field">
              <label for="invite-label">Label (für deine Übersicht)</label>
              <input type="text" id="invite-label" name="label" placeholder="z.B. Alice" required>
            </div>
            <div class="field">
              <label>Rolle für die eingeladene Person</label>
              <div class="role-radios">
                <label class="role-radio">
                  <input type="radio" name="role" value="vice_admiral" checked>
                  <span class="role-radio-label">
                    <span class="role-radio-title">VICE ADMIRAL</span>
                    <span class="role-radio-hint">Dashboard + Konfig — kann keine anderen Admins managen</span>
                  </span>
                </label>
                <label class="role-radio">
                  <input type="radio" name="role" value="admiral">
                  <span class="role-radio-label">
                    <span class="role-radio-title">ADMIRAL</span>
                    <span class="role-radio-hint">Volle Rechte inkl. andere Admins einladen / entfernen / ihre Rolle ändern</span>
                  </span>
                </label>
              </div>
            </div>
            <button type="submit" class="btn btn-cyan btn-full">LINK GENERIEREN</button>
          </form>

          <h3 class="card-subtitle">OFFENE + VERGANGENE LINKS</h3>
          <ul class="invite-list">${inviteRows}</ul>`
    : html`<p class="hint">Nur Admirale können neue Admins einladen.</p>
          <h3 class="card-subtitle">VERGANGENE LINKS</h3>
          <ul class="invite-list">${inviteRows}</ul>`;

  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "admins",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">ADMINS<span class="sep"> // </span><em>${esc(titleText)}</em></h1>
      </header>

      ${fresh}

      <div class="dash-grid">
        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">AKTUELLE ADMINS <span class="card-meta">${opts.data.admins.length}</span></h2>
          <ul class="admin-list">${adminRows}</ul>
        </section>

        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">${canManageAdmins ? "NEUEN ADMIN EINLADEN" : "INVITE-LINKS"}</h2>
          ${inviteForm}
        </section>
      </div>

      <section class="card" id="downloads-card">
        <span class="card-tick"></span>
        <h2 class="card-title">COMPANION-DOWNLOAD-LINKS <span class="card-meta" id="release-meta">…</span></h2>
        <form class="invite-form" id="download-form">
          <div class="field">
            <label for="download-label">Label (für deine Übersicht)</label>
            <input type="text" id="download-label" name="label" placeholder="z.B. Alice — Erstinstallation" required>
          </div>
          <button type="submit" class="btn btn-cyan btn-full">DOWNLOAD-LINK ERZEUGEN</button>
        </form>

        <h3 class="card-subtitle">OFFENE + VERBRAUCHTE LINKS</h3>
        <ul class="invite-list" id="download-list"><li class="empty">— lädt —</li></ul>
      </section>
    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({
    title: "Admins",
    body,
    staticBase: opts.staticBase,
    scripts,
  });
}

export type NavGuild = { id: string; name: string; botPresent?: boolean };

function renderNav(opts: {
  navBase: string;
  active: "dashboard" | "raid-planer" | "config" | "admins";
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[]; // empty/undef if admin is on a single guild
}): string {
  const item = (key: typeof opts.active, label: string, href: string): string =>
    html`<a class="cc-nav-item ${opts.active === key ? "active" : ""}" href="${esc(href)}">${esc(label)}</a>`;
  const currentLabel =
    opts.currentGuild?.botPresent === false
      ? html`${esc(opts.currentGuild.name)} <span class="g-warn">(Bot fehlt)</span>`
      : esc(opts.currentGuild?.name ?? "—");
  const switcher =
    opts.otherGuilds && opts.otherGuilds.length > 0
      ? html`
        <div class="cc-nav-switcher">
          <button type="button" class="cc-switcher-btn" id="guild-switcher-btn" title="Server wechseln">
            <span class="g-name">${currentLabel}</span>
            <span class="g-chev">▾</span>
          </button>
          <div class="cc-switcher-menu" id="guild-switcher-menu" hidden>
            ${opts.otherGuilds
              .map((g) => {
                const inner =
                  g.botPresent === false
                    ? html`${esc(g.name)} <span class="g-warn">(Bot fehlt)</span>`
                    : esc(g.name);
                return html`<a class="cc-switcher-item ${g.botPresent === false ? "is-botless" : ""}" href="${esc(opts.navBase)}/switch-guild?id=${esc(g.id)}">${inner}</a>`;
              })
              .join("")}
          </div>
        </div>`
      : opts.currentGuild
        ? html`<span class="cc-nav-current">${currentLabel}</span>`
        : "";
  return html`
    <nav class="cc-nav">
      <a class="cc-nav-home" href="${esc(opts.navBase)}/">DCCC<span class="sep">//</span>ADMIN</a>
      ${switcher}
      <div class="cc-nav-items">
        ${item("dashboard", "DASHBOARD", `${opts.navBase}/`)}
        ${item("raid-planer", "RAID PLANER", `${opts.navBase}/raid-planer`)}
        ${item("config", "KONFIG", `${opts.navBase}/config`)}
        ${item("admins", "ADMINS", `${opts.navBase}/admins`)}
      </div>
      <a class="cc-nav-item" href="${esc(opts.navBase)}/logout">SIGN OUT</a>
    </nav>`;
}

export function renderError(opts: {
  staticBase: string;
  title: string;
  message: string;
  showLogin?: boolean;
  loginUrl?: string;
}): string {
  const body = html`
    <main class="login-shell">
      <div class="login-card">
        <span class="card-tick"></span>
        <h1 class="login-title">${esc(opts.title)}</h1>
        <p class="login-sub">${esc(opts.message)}</p>
        ${opts.showLogin && opts.loginUrl ? html`<a class="btn btn-cyan btn-full" href="${esc(opts.loginUrl)}">ZUR LOGIN-SEITE</a>` : ""}
      </div>
    </main>`;
  return layout({
    title: opts.title,
    body,
    staticBase: opts.staticBase,
    bodyClass: "login-body",
  });
}
