import { escape } from "node:querystring";
import { getEnv, type BridgeEnv } from "../config/env.js";

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

let adminUiModeOverride: BridgeEnv["BRIDGE_ADMIN_UI_MODE"] | undefined;

export function setAdminViewsUiMode(mode: BridgeEnv["BRIDGE_ADMIN_UI_MODE"] | undefined): void {
  adminUiModeOverride = mode;
}

function adminUiMode(): BridgeEnv["BRIDGE_ADMIN_UI_MODE"] {
  return adminUiModeOverride ?? getEnv().BRIDGE_ADMIN_UI_MODE;
}

type LayoutOpts = {
  title: string;
  body: string;
  staticBase: string; // public path to /admin/static
  bodyClass?: string;
  scripts?: string;
};

function layout({ title, body, staticBase, bodyClass = "", scripts = "" }: LayoutOpts): string {
  const legacyBanner =
    adminUiMode() === "legacy" && bodyClass !== "login-body"
      ? html`
  <div class="legacy-admin-banner">
    Bridge Admin ist Legacy. Nutze Fleetplanner fuer normale Mission-Voice- und Operations-Steuerung.
  </div>`
      : "";
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(title)} · DCCC Admin</title>
  <link rel="stylesheet" href="${staticBase}/colors_and_type.css">
  <link rel="stylesheet" href="${staticBase}/admin.css">
  <link rel="stylesheet" href="${staticBase}/admin.mobile.css" media="(max-width: 1024px), (pointer: coarse)">
  <link rel="manifest" href="${staticBase}/manifest.webmanifest">
  <link rel="icon" type="image/png" sizes="32x32" href="${staticBase}/pwa-icons/icon-32.png">
  <link rel="apple-touch-icon" sizes="180x180" href="${staticBase}/pwa-icons/icon-180.png">
  <meta name="theme-color" content="#00d4ff">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="Squad Cmd">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="format-detection" content="telephone=no">
</head>
<body class="${esc(bodyClass)}">
  <div class="scanlines"></div>
  ${legacyBanner}
  ${body}
  ${scripts}
  <script>if("serviceWorker" in navigator){navigator.serviceWorker.register("${staticBase}/sw.js").catch(function(){});}</script>
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

// renderDashboard, renderRaidPlaner and renderConfig were removed 2026-06-02
// with the native Bridge Admin operation pages. Those surfaces now live in
// Fleetplanner (bridge dashboard page, Discord Voice panel, guild config page).

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

export type SessionsPageData = {
  guildId: string;
  sessions: Array<{
    id: string;
    label: string;
    createdBy: string;
    createdAt: Date;
    status: string;
    inviteCount?: number;
  }>;
};

export function renderSessions(opts: {
  staticBase: string;
  navBase: string;
  data: SessionsPageData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
  created?: string; // label of freshly created session, for toast
}): string {
  const titleText = opts.currentGuild?.name ?? opts.data.guildId;

  const sessionRows = opts.data.sessions.length
    ? opts.data.sessions
        .map(
          (s) => html`
    <li class="admin-row">
      <span class="a-name">${esc(s.label)}</span>
      <span class="a-meta">${dateFmt(s.createdAt)} · ${esc(s.inviteCount ?? 0)} Invite(s)</span>
      <span class="row-actions">
        <a class="btn btn-sm btn-cyan" href="${esc(opts.navBase)}/sessions/${esc(s.id)}">DETAILS</a>
        <form method="post" action="${esc(opts.navBase)}/sessions/${esc(s.id)}/end" style="display:inline" onsubmit="return confirm('Session \'${esc(s.label)}\' wirklich beenden?')">
          <button type="submit" class="btn btn-sm btn-red">BEENDEN</button>
        </form>
      </span>
    </li>`,
        )
        .join("")
    : html`<li class="empty">— keine aktiven Sessions —</li>`;

  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "sessions",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">SESSIONS<span class="sep"> // </span><em>${esc(titleText)}</em></h1>
      </header>

      ${opts.created ? html`<div class="toast toast-ok">Session "${esc(opts.created)}" gestartet.</div>` : ""}

      <div class="dash-grid">
        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">AKTIVE SESSIONS <span class="card-meta">${opts.data.sessions.length}</span></h2>
          <ul class="admin-list">${sessionRows}</ul>
        </section>

        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">NEUE SESSION</h2>
          <form class="invite-form" method="post" action="${esc(opts.navBase)}/sessions">
            <input type="hidden" name="guildId" value="${esc(opts.data.guildId)}">
            <div class="field">
              <label for="session-label">Bezeichnung</label>
              <input type="text" id="session-label" name="label" placeholder="z.B. Op Alpha" required maxlength="80">
            </div>
            <button type="submit" class="btn btn-cyan btn-full">SESSION STARTEN</button>
          </form>
        </section>
      </div>
    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: "Sessions", body, staticBase: opts.staticBase, scripts });
}

export type SessionDetailData = {
  session: {
    id: string;
    label: string;
    guildId: string;
    createdBy: string;
    createdAt: Date;
    status: string;
    livekitRoom: string;
  };
  invites: Array<{
    id: string;
    label: string;
    createdAt: Date;
    expiresAt: Date;
    usedBy: string | null;
    usedAt: Date | null;
  }>;
  freshInvite?: { plaintext: string; label: string; expiresAt: Date };
};

export function renderSessionDetail(opts: {
  staticBase: string;
  navBase: string;
  data: SessionDetailData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const { session, invites } = opts.data;
  const isEnded = session.status !== "active";

  const inviteRows = invites.length
    ? invites
        .map((i) => {
          const used = !!i.usedAt;
          const expired = !used && i.expiresAt < new Date();
          const stateLabel = used
            ? `VERWENDET ${dateFmt(i.usedAt)} von ${esc(i.usedBy ?? "?")}`
            : expired
              ? `ABGELAUFEN ${dateFmt(i.expiresAt)}`
              : `OFFEN bis ${dateFmt(i.expiresAt)}`;
          const revokeBtn =
            !used && !expired && !isEnded
              ? html`<form method="post" action="${esc(opts.navBase)}/sessions/${esc(session.id)}/invites/${esc(i.id)}/revoke" style="display:inline">
                  <button type="submit" class="btn btn-sm btn-red">WIDERRUFEN</button>
                </form>`
              : "";
          return html`
    <li class="invite-row ${used ? "used" : expired ? "used" : "live"}">
      <span class="i-label">${esc(i.label)}</span>
      <span class="i-state">${stateLabel}</span>
      ${revokeBtn}
    </li>`;
        })
        .join("")
    : html`<li class="empty">— noch keine Invites —</li>`;

  const fresh = opts.data.freshInvite
    ? html`
    <div class="fresh-invite card">
      <span class="card-tick"></span>
      <h3>NEUER INVITE — ${esc(opts.data.freshInvite.label)}</h3>
      <p>Einmal sichtbar — jetzt kopieren + an den Commander weitergeben. Gültig bis ${dateFmt(opts.data.freshInvite.expiresAt)}.</p>
      <input type="text" readonly value="${esc(opts.data.freshInvite.plaintext)}" id="fresh-url" class="invite-url">
      <button class="btn btn-cyan btn-sm" id="copy-fresh">COPY</button>
    </div>`
    : "";

  const mintForm = !isEnded
    ? html`
    <form class="invite-form" method="post" action="${esc(opts.navBase)}/sessions/${esc(session.id)}/invites">
      <div class="field">
        <label for="invite-label">Label (Commander-Name)</label>
        <input type="text" id="invite-label" name="label" placeholder="z.B. Alice" required maxlength="80">
      </div>
      <div class="field">
        <label for="invite-ttl">Gültig für (Stunden)</label>
        <input type="number" id="invite-ttl" name="ttlHours" value="24" min="1" max="168">
      </div>
      <button type="submit" class="btn btn-cyan btn-full">INVITE ERZEUGEN</button>
    </form>`
    : html`<p class="hint">Session beendet — keine neuen Invites möglich.</p>`;

  const endBtn = !isEnded
    ? html`
    <form method="post" action="${esc(opts.navBase)}/sessions/${esc(session.id)}/end" style="margin-top:12px" onsubmit="return confirm('Session \'${esc(session.label)}\' wirklich beenden?')">
      <button type="submit" class="btn btn-red btn-full">SESSION BEENDEN</button>
    </form>`
    : html`<div class="toast" style="margin-top:12px">SESSION BEENDET</div>`;

  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "sessions",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">SESSION<span class="sep"> // </span><em>${esc(session.label)}</em></h1>
        <div class="header-right">
          <span class="badge ${isEnded ? "off" : "on"}">${isEnded ? "BEENDET" : "AKTIV"}</span>
        </div>
      </header>

      <p class="hint">LiveKit Room: <code>${esc(session.livekitRoom)}</code> · Erstellt ${dateFmt(session.createdAt)}</p>

      ${fresh}

      <div class="dash-grid">
        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">INVITES <span class="card-meta">${invites.length}</span></h2>
          <ul class="invite-list">${inviteRows}</ul>
        </section>

        <section class="card">
          <span class="card-tick"></span>
          <h2 class="card-title">INVITE ERZEUGEN</h2>
          ${mintForm}
          ${endBtn}
          <div style="margin-top:16px">
            <a class="btn btn-sm" href="${esc(opts.navBase)}/sessions">← ZURÜCK ZU SESSIONS</a>
          </div>
        </section>
      </div>
    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: `Session // ${session.label}`, body, staticBase: opts.staticBase, scripts });
}

export type RelayBotsPageData = {
  config: {
    livekitUrl: string;
    livekitApiKey: string;
    livekitApiSecret: string;
    roomName: string;
    guildId: string;
    bots: Array<{ name: string; token: string; channelId: string }>;
  };
  canSeeTokens: boolean; // admiral: true; vice_admiral: false (tokens shown as •••)
};

export function renderRelayBots(opts: {
  staticBase: string;
  navBase: string;
  data: RelayBotsPageData;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
  saved?: boolean;
}): string {
  const { config } = opts.data;

  const botRows = config.bots.length
    ? config.bots
        .map(
          (b, i) => html`
    <div class="bot-row" data-bot-index="${i}">
      <div class="field field-inline">
        <label>Name</label>
        <input type="text" class="bot-name" value="${esc(b.name)}" maxlength="100">
      </div>
      <div class="field field-inline">
        <label>Channel ID</label>
        <input type="text" class="bot-channel" value="${esc(b.channelId)}">
      </div>
      <div class="field field-inline field-grow">
        <label>Token</label>
        <input type="password" class="bot-token" value="${esc(b.token)}" ${opts.data.canSeeTokens ? "" : "disabled title=\"Nur Admirale können Bot-Tokens sehen\""}>
      </div>
      <button type="button" class="btn btn-sm btn-red btn-remove-bot" data-index="${i}">ENTFERNEN</button>
    </div>`,
        )
        .join("")
    : "";

  const body = html`
    ${renderNav({
      navBase: opts.navBase,
      active: "relay-bots",
      currentGuild: opts.currentGuild,
      otherGuilds: opts.otherGuilds,
    })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">RELAY BOTS</h1>
      </header>

      ${opts.saved ? html`<div class="toast toast-ok">Konfiguration gespeichert und Relay neu gestartet.</div>` : ""}

      <div class="dash-grid">
        <section class="card" id="relay-config-card" data-can-see-tokens="${opts.data.canSeeTokens ? "1" : "0"}">
          <span class="card-tick"></span>
          <h2 class="card-title">KONFIGURATION</h2>

          <h3 class="card-subtitle">LIVEKIT</h3>
          <div class="field">
            <label for="relay-lk-url">LiveKit URL</label>
            <input type="text" id="relay-lk-url" value="${esc(config.livekitUrl)}" placeholder="wss://voice.raumdock.org">
          </div>
          <div class="field">
            <label for="relay-lk-room">Relay Room Name</label>
            <input type="text" id="relay-lk-room" value="${esc(config.roomName)}" placeholder="voice-relay">
          </div>
          <div class="field">
            <label for="relay-lk-key">API Key</label>
            <input type="text" id="relay-lk-key" value="${esc(config.livekitApiKey)}">
          </div>
          <div class="field">
            <label for="relay-lk-secret">API Secret</label>
            <input type="password" id="relay-lk-secret" value="${esc(config.livekitApiSecret)}">
          </div>

          <h3 class="card-subtitle">DISCORD</h3>
          <div class="field">
            <label for="relay-guild-id">Guild ID</label>
            <input type="text" id="relay-guild-id" value="${esc(config.guildId)}" placeholder="Snowflake">
          </div>

          <h3 class="card-subtitle">BOTS <span class="card-meta" id="relay-bot-count">${config.bots.length}</span></h3>
          <div id="relay-bot-rows">${botRows}</div>
          <button type="button" class="btn btn-sm" id="relay-add-bot" style="margin-top:8px">+ BOT HINZUFÜGEN</button>

          <div class="actions" style="margin-top:16px">
            <button type="button" class="btn btn-sm" id="relay-restart">RELAY NEUSTARTEN</button>
            <button type="button" class="btn btn-cyan" id="relay-save">SPEICHERN &amp; ANWENDEN</button>
          </div>
          <div class="hint" id="relay-save-error" style="color:#f87171;display:none"></div>
        </section>

        <section class="card" id="relay-metrics-card">
          <span class="card-tick"></span>
          <h2 class="card-title">LIVE METRICS <span class="card-meta" style="font-size:11px;color:#475569">· alle 3 s</span></h2>
          <div id="relay-metrics-global" class="health-bar" style="margin-bottom:8px">— lädt —</div>
          <div id="relay-metrics-bots"></div>
        </section>
      </div>
    </main>`;

  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: "Relay Bots", body, staticBase: opts.staticBase, scripts });
}

function renderNav(opts: {
  navBase: string;
  active: "dashboard" | "raid-planer" | "config" | "admins" | "sessions" | "relay-bots" | "monitoring" | "audit" | "discord-voice";
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
        ${item("sessions", "SESSIONS", `${opts.navBase}/sessions`)}
        <!-- RELAY BOTS + DISCORD VOICE nav items disabled while voice is reworked (routes stay live). -->
        ${item("monitoring", "MONITORING", `${opts.navBase}/monitoring`)}
        ${item("audit", "AUDIT", `${opts.navBase}/audit`)}
        ${item("admins", "ADMINS", `${opts.navBase}/admins`)}
      </div>
      <a class="cc-nav-item" href="${esc(opts.navBase)}/logout">SIGN OUT</a>
    </nav>`;
}

// ── Monitoring page ───────────────────────────────────────────────────────────

export function renderMonitoring(opts: {
  staticBase: string;
  navBase: string;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const body = html`
    ${renderNav({ navBase: opts.navBase, active: "monitoring", currentGuild: opts.currentGuild, otherGuilds: opts.otherGuilds })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">MONITORING</h1>
        <div class="header-right">
          <button class="btn btn-sm" onclick="monLoad()">REFRESH</button>
          <span id="mon-status" style="font-size:12px;color:var(--muted);margin-left:10px"></span>
        </div>
      </header>
      <div id="mon-content"></div>
    </main>
    <script>
      const NAV = ${JSON.stringify(opts.navBase)};
      function fmtBytes(n) {
        if (n === null || n === undefined) return '—';
        if (n >= 1e9) return (n/1e9).toFixed(2)+' GB';
        if (n >= 1e6) return (n/1e6).toFixed(1)+' MB';
        if (n >= 1e3) return (n/1e3).toFixed(1)+' KB';
        return n+' B';
      }
      function fmtBps(n) {
        if (n === null || n === undefined) return '—';
        if (n >= 1e6) return (n/1e6).toFixed(2)+' Mbps';
        if (n >= 1e3) return (n/1e3).toFixed(1)+' kbps';
        return n+' bps';
      }
      function fmtUptime(s) {
        const h = Math.floor(s/3600), m = Math.floor((s%3600)/60), sec = s%60;
        return h > 0 ? h+'h '+m+'m' : m > 0 ? m+'m '+sec+'s' : sec+'s';
      }
      function bar(used, total, color) {
        const pct = total > 0 ? Math.min(100,(used/total)*100) : 0;
        return '<div style="background:var(--panel-2);border:1px solid var(--border);border-radius:4px;height:10px;overflow:hidden">'
          +'<div style="height:100%;background:'+color+';width:'+pct.toFixed(1)+'%;transition:width .3s"></div></div>';
      }
      function escH(v) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

      function monRender(d) {
        const bw = d.bandwidth, sys = d.system, mem = sys.memory;
        const cpuLabel = sys.cpuPercent !== null ? sys.cpuPercent.toFixed(1)+'%' : '—';
        const roomsHtml = (d.rooms||[]).map(room => {
          const rows = (room.commanders||[]).map(c =>
            '<tr><td>'+escH(c.displayName||c.userId)+'</td>'
            +'<td>'+(c.speaking ? '<span style="color:#4caf78">TALKING</span>' : '<span style="color:var(--muted)">IDLE</span>')+'</td></tr>'
          ).join('') || '<tr><td colspan="2" style="color:var(--muted)">— leer —</td></tr>';
          return '<div class="card" style="margin-bottom:12px">'
            +'<span class="card-tick"></span>'
            +'<h2 class="card-title">'+escH(room.roomId)+' <span class="card-meta">'+room.activeCommanders+' verbunden</span></h2>'
            +'<table><thead><tr><th>Commander</th><th>Status</th></tr></thead><tbody>'+rows+'</tbody></table>'
            +'</div>';
        }).join('') || '<p style="color:var(--muted);margin:0">Keine aktiven Räume.</p>';

        document.getElementById('mon-content').innerHTML =
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">'
          +'<div class="card"><span class="card-tick"></span><h2 class="card-title">ÜBERBLICK</h2>'
          +'<table><tbody>'
          +'<tr><td style="color:var(--muted)">Uptime</td><td>'+fmtUptime(d.uptimeSeconds)+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Aktive Räume</td><td>'+d.activeRooms+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Verbundene Commander</td><td>'+d.activeCommanders+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Sprechen gerade</td><td>'+d.speakingCommanders+'</td></tr>'
          +'</tbody></table></div>'
          +'<div class="card"><span class="card-tick"></span><h2 class="card-title">SYSTEM</h2>'
          +'<table><tbody>'
          +'<tr><td style="color:var(--muted)">CPU (Prozess)</td><td>'+cpuLabel+'</td></tr>'
          +'<tr><td style="color:var(--muted);padding-bottom:4px">Heap</td>'
          +'<td>'+fmtBytes(mem.processHeapUsedBytes)+' / '+fmtBytes(mem.processHeapTotalBytes)+'</td></tr>'
          +'<tr><td colspan="2" style="padding-top:0;padding-bottom:8px">'+bar(mem.processHeapUsedBytes,mem.processHeapTotalBytes,'var(--accent)')+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Process RSS</td><td>'+fmtBytes(mem.processRssBytes)+'</td></tr>'
          +'<tr><td style="color:var(--muted);padding-bottom:4px">System RAM</td>'
          +'<td>'+fmtBytes(mem.systemUsedBytes)+' / '+fmtBytes(mem.systemTotalBytes)+'</td></tr>'
          +'<tr><td colspan="2" style="padding-top:0">'+bar(mem.systemUsedBytes,mem.systemTotalBytes,'#4caf78')+'</td></tr>'
          +'</tbody></table></div>'
          +'<div class="card"><span class="card-tick"></span><h2 class="card-title">LIVEKIT BANDWIDTH <span class="card-meta" style="font-size:11px;font-weight:400">'+escH(bw.source)+'</span></h2>'
          +(bw.error ? '<p style="color:var(--muted);margin:0 0 8px;font-size:12px">'+escH(bw.error)+'</p>' : '')
          +'<table><tbody>'
          +'<tr><td style="color:var(--muted)">Bitrate in</td><td>'+fmtBps(bw.bitrateIn)+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Bitrate out</td><td>'+fmtBps(bw.bitrateOut)+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Total received</td><td>'+fmtBytes(bw.totalBytesIn)+'</td></tr>'
          +'<tr><td style="color:var(--muted)">Total sent</td><td>'+fmtBytes(bw.totalBytesOut)+'</td></tr>'
          +'</tbody></table></div>'
          +'</div>'
          +'<section class="card"><span class="card-tick"></span><h2 class="card-title">AKTIVE RÄUME</h2>'
          +roomsHtml+'</section>';
      }

      async function monLoad() {
        document.getElementById('mon-status').textContent = 'Lädt…';
        try {
          const r = await fetch(NAV+'/monitoring/snapshot');
          if (!r.ok) throw new Error(await r.text());
          monRender(await r.json());
          document.getElementById('mon-status').textContent = 'Stand: '+new Date().toLocaleTimeString();
        } catch(e) {
          document.getElementById('mon-status').textContent = 'Fehler: '+e.message;
        }
      }
      monLoad();
      setInterval(monLoad, 30000);
    </script>`;
  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: "Monitoring", body, staticBase: opts.staticBase, scripts });
}

// ── Audit log page ────────────────────────────────────────────────────────────

export type AuditEntry = {
  id: string;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  target: string | null;
  metadata: string;
  createdAt: Date;
};

export function renderAudit(opts: {
  staticBase: string;
  navBase: string;
  entries: AuditEntry[];
  total: number;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const rows = opts.entries.length
    ? opts.entries.map((e) => {
        let meta = "";
        try {
          meta = JSON.stringify(JSON.parse(e.metadata));
        } catch {
          meta = e.metadata;
        }
        return html`<tr>
          <td style="color:var(--muted);white-space:nowrap;font-size:12px">${esc(e.createdAt.toISOString().replace("T", " ").slice(0, 19))}</td>
          <td>${esc(e.actorLabel ?? e.actorUserId ?? "—")}</td>
          <td><code style="font-size:12px">${esc(e.action)}</code></td>
          <td style="color:var(--muted)">${esc(e.target ?? "—")}</td>
          <td style="color:var(--muted);font-size:11px"><code>${esc(meta)}</code></td>
        </tr>`;
      }).join("")
    : html`<tr><td colspan="5" style="color:var(--muted);text-align:center">Keine Einträge.</td></tr>`;

  const body = html`
    ${renderNav({ navBase: opts.navBase, active: "audit", currentGuild: opts.currentGuild, otherGuilds: opts.otherGuilds })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">AUDIT LOG <span class="card-meta">${opts.total} Einträge gesamt</span></h1>
      </header>
      <section class="card">
        <span class="card-tick"></span>
        <table>
          <thead><tr><th>ZEITPUNKT</th><th>ACTOR</th><th>ACTION</th><th>TARGET</th><th>METADATA</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>
    </main>`;
  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: "Audit Log", body, staticBase: opts.staticBase, scripts });
}

// ── Discord Voice page ────────────────────────────────────────────────────────

export function renderDiscordVoice(opts: {
  staticBase: string;
  navBase: string;
  currentGuild?: NavGuild;
  otherGuilds?: NavGuild[];
}): string {
  const body = html`
    ${renderNav({ navBase: opts.navBase, active: "discord-voice", currentGuild: opts.currentGuild, otherGuilds: opts.otherGuilds })}
    <main class="page">
      <header class="page-header">
        <h1 class="page-title">DISCORD VOICE</h1>
        <div class="header-right">
          <button class="btn btn-sm" onclick="dvLoad()">REFRESH</button>
          <span id="dv-status" style="font-size:12px;color:var(--muted);margin-left:10px"></span>
        </div>
      </header>

      <section class="card">
        <span class="card-tick"></span>
        <h2 class="card-title">VOICE CHANNELS</h2>
        <div id="dv-channels"><p style="color:var(--muted)">Lädt…</p></div>
      </section>

      <section class="card" style="margin-top:16px">
        <span class="card-tick"></span>
        <h2 class="card-title">ROLLEN-MANAGEMENT</h2>
        <p style="color:var(--muted);font-size:13px">Bot braucht <strong>Manage Roles</strong>-Berechtigung; Bot-Rolle muss über der Zielrolle stehen.</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;margin-top:10px">
          <label style="display:grid;gap:4px;color:var(--muted);font-size:13px">USER ID
            <input id="dv-userId" type="text" placeholder="Discord Snowflake" style="min-width:200px" />
          </label>
          <label style="display:grid;gap:4px;color:var(--muted);font-size:13px">ROLLE
            <select id="dv-roleSelect" style="min-width:200px"><option value="">— lädt —</option></select>
          </label>
          <button class="btn" onclick="dvAddRole()">ROLLE GEBEN</button>
          <button class="btn btn-red" onclick="dvRemoveRole()">ROLLE ENTZIEHEN</button>
        </div>
        <div id="dv-role-status" style="color:var(--muted);font-size:13px;margin-top:8px"></div>
      </section>
    </main>
    <script>
      const NAV = ${JSON.stringify(opts.navBase)};
      function escH(v) { return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

      function dvRender(data) {
        const ch = data.channels || [];
        const vs = data.voiceStates || [];
        const el = document.getElementById('dv-channels');
        if (data.offline || !ch.length) {
          el.innerHTML = '<p style="color:var(--muted)">'+(data.offline ? 'Keine Daten verfügbar.' : 'Keine Voice-Channels gefunden.')+'</p>';
          return;
        }
        const byChannel = {};
        for (const s of vs) {
          if (!s.channelId) continue;
          (byChannel[s.channelId] = byChannel[s.channelId]||[]).push(s);
        }
        el.innerHTML = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">'
          + ch.map(c => {
              const members = byChannel[c.id]||[];
              const mHtml = members.map(m =>
                '<div style="display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:1px solid var(--border)">'
                +'<span style="flex:1;font-size:13px">'+escH(m.displayName||m.userId)+'</span>'
                +'<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="dvSetUser(\''+escH(m.userId)+'\')">+ ROLLE</button>'
                +'<button class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="dvMoveUser(\''+escH(m.userId)+'\')">MOVE</button>'
                +'</div>'
              ).join('') || '<p style="color:var(--muted);margin:4px 0;font-size:13px">Leer</p>';
              return '<div style="background:var(--panel-2);border:1px solid var(--border);border-radius:6px;padding:12px">'
                +'<div style="font-weight:600;margin-bottom:6px;font-size:13px"># '+escH(c.name)+'</div>'
                +mHtml+'</div>';
            }).join('')
          +'</div>';
      }

      function dvSetUser(userId) {
        document.getElementById('dv-userId').value = userId;
        document.querySelector('.card:last-of-type').scrollIntoView({behavior:'smooth'});
      }

      async function dvMoveUser(userId) {
        const ch = prompt('Ziel-Channel-ID (leer = trennen):');
        if (ch === null) return;
        const r = await fetch(NAV+'/discord/members/'+encodeURIComponent(userId)+'/channel', {
          method:'PATCH', headers:{'content-type':'application/json'},
          body: JSON.stringify({channelId: ch||null}),
        });
        document.getElementById('dv-status').textContent = r.ok ? '✓ Verschoben' : 'Fehler: '+await r.text();
        setTimeout(dvLoad, 800);
      }

      async function dvAddRole() {
        const userId = document.getElementById('dv-userId').value.trim();
        const roleId = document.getElementById('dv-roleSelect').value;
        if (!userId || !roleId) return;
        const r = await fetch(NAV+'/discord/members/'+encodeURIComponent(userId)+'/roles/'+encodeURIComponent(roleId), {method:'PUT'});
        document.getElementById('dv-role-status').textContent = r.ok ? '✓ Rolle vergeben' : 'Fehler: '+await r.text();
      }

      async function dvRemoveRole() {
        const userId = document.getElementById('dv-userId').value.trim();
        const roleId = document.getElementById('dv-roleSelect').value;
        if (!userId || !roleId) return;
        const r = await fetch(NAV+'/discord/members/'+encodeURIComponent(userId)+'/roles/'+encodeURIComponent(roleId), {method:'DELETE'});
        document.getElementById('dv-role-status').textContent = r.ok ? '✓ Rolle entzogen' : 'Fehler: '+await r.text();
      }

      async function dvLoadRoles() {
        try {
          const r = await fetch(NAV+'/discord/roles');
          if (!r.ok) return;
          const data = await r.json();
          const sel = document.getElementById('dv-roleSelect');
          sel.innerHTML = (data.roles||[]).map(role =>
            '<option value="'+escH(role.id)+'">'+escH(role.name)+'</option>'
          ).join('');
        } catch { /* ignore */ }
      }

      async function dvLoad() {
        document.getElementById('dv-status').textContent = 'Lädt…';
        try {
          const r = await fetch(NAV+'/discord/voice-states');
          if (!r.ok) throw new Error(await r.text());
          dvRender(await r.json());
          document.getElementById('dv-status').textContent = 'Stand: '+new Date().toLocaleTimeString();
        } catch(e) {
          dvRender({offline: true});
          document.getElementById('dv-status').textContent = 'Fehler: '+e.message;
        }
      }

      dvLoad();
      dvLoadRoles();
      setInterval(dvLoad, 15000);
    </script>`;
  const scripts = html`<script>window.__DCCC_NAV_BASE__=${JSON.stringify(opts.navBase)};</script><script src="${opts.staticBase}/admin.js"></script>`;
  return layout({ title: "Discord Voice", body, staticBase: opts.staticBase, scripts });
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
