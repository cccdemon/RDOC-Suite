import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { FastifyInstance, FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { getEnv, getOAuthEnv } from "../config/env.js";
import {
  addGuildMemberRole,
  buildAuthorizeUrl,
  bulkModifyChannelPositions,
  exchangeCodeForToken,
  fetchCurrentUser,
  fetchGuildMember,
  modifyChannel,
  moveGuildMember,
  removeGuildMemberRole,
  sendDirectMessage,
} from "../auth/discord.js";
import {
  getCachedChannels,
  getCachedRoles,
  invalidateChannels,
} from "../services/discordMetaCache.js";
import { logger } from "../services/logger.js";
import {
  ADMIN_ROLES,
  type AdminRole,
  isAdmin,
  isAdminRole,
  listAdmins,
  removeAdmin,
  setAdminRole,
} from "../services/admins.js";
import { readGuildConfig, saveGuildConfig } from "../services/guildConfig.js";
import {
  consumeInviteLink,
  listInviteLinks,
  mintAdminInviteLink,
  revokeInviteLink,
} from "../services/adminInviteLinks.js";
import {
  listDownloadTokens,
  mintDownloadToken,
  revokeDownloadToken,
} from "../services/companionDownloads.js";
import { fetchLatestCompanionRelease } from "../services/githubReleases.js";
import { getPrisma } from "@rdoc-suite/db";
import { rooms } from "../services/rooms.js";
import { bridgeRoomName } from "../services/livekit.js";
import { getGuildInfo, getGuildInfos } from "../services/guildInfo.js";
import {
  ADMIN_SESSION_COOKIE,
  adminCookieOptions,
  issueAdminSessionCookie,
} from "./cookie.js";
import { requireAdminSession } from "./middleware.js";
import {
  renderAdmins,
  renderConfig,
  renderDashboard,
  renderError,
  renderLogin,
  renderRaidPlaner,
  renderRelayBots,
  renderSessionDetail,
  renderSessions,
  type DashboardData,
} from "./views.js";
import { getRelayBotsConfig } from "../services/relayBotsConfig.js";
import { bridgeEvents } from "../services/bridgeEvents.js";
import { createStrategyChannel } from "../services/strategyChannels.js";
import { appendAudit, listRecentAudit, countAudit } from "../services/audit.js";
import { monitoringSnapshot } from "../services/monitoring.js";
import { renderAudit, renderDiscordVoice, renderMonitoring } from "./views.js";
import {
  createSession,
  endSession,
  getSession,
  listActiveSessions,
  mintSessionInvite,
  listSessionInvites,
  revokeSessionInvite,
} from "../services/sessions.js";

const STATE_COOKIE_LOGIN = "dccc_admin_oauth_state";
const STATE_COOKIE_INVITE = "dccc_admin_invite_state";
const STATE_COOKIE_TTL_SECONDS = 10 * 60;

const ROUTE_PREFIX = "/admin";
const STATIC_PREFIX = "/admin/static";

function publicBase(): string {
  return getEnv().PUBLIC_BASE_PATH;
}
function navBase(): string {
  return `${publicBase()}${ROUTE_PREFIX}`;
}
function staticBase(): string {
  return `${publicBase()}${STATIC_PREFIX}`;
}

function encodeState(payload: Record<string, string>): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}
function decodeState(raw: string | undefined): Record<string, string> | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (parsed && typeof parsed === "object") {
      return parsed as Record<string, string>;
    }
  } catch {
    // fall through
  }
  return null;
}

function setLoginStateCookie(reply: FastifyReply, value: string): void {
  reply.setCookie(STATE_COOKIE_LOGIN, value, {
    path: `${publicBase()}${ROUTE_PREFIX}/oauth`,
    httpOnly: true,
    sameSite: "lax",
    secure: getOAuthEnv()?.OAUTH_REDIRECT_URI.startsWith("https://") ?? false,
    maxAge: STATE_COOKIE_TTL_SECONDS,
  });
}
function setInviteStateCookie(reply: FastifyReply, value: string): void {
  reply.setCookie(STATE_COOKIE_INVITE, value, {
    path: `${publicBase()}${ROUTE_PREFIX}/invite`,
    httpOnly: true,
    sameSite: "lax",
    secure: getOAuthEnv()?.OAUTH_REDIRECT_URI.startsWith("https://") ?? false,
    maxAge: STATE_COOKIE_TTL_SECONDS,
  });
}

function clearStateCookies(reply: FastifyReply): void {
  reply.clearCookie(STATE_COOKIE_LOGIN, { path: `${publicBase()}${ROUTE_PREFIX}/oauth` });
  reply.clearCookie(STATE_COOKIE_INVITE, { path: `${publicBase()}${ROUTE_PREFIX}/invite` });
}

function adminSecret(): string {
  return getEnv().ADMIN_SESSION_SECRET ?? getEnv().SESSION_SECRET;
}

/**
 * Origin (scheme + host) for absolute URLs we hand to humans (e.g.
 * invite links). Derived from OAUTH_REDIRECT_URI so we don't need to
 * read the Host header (which can be spoofed behind a reverse proxy).
 */
function publicOrigin(): string {
  const env = getOAuthEnv();
  if (!env) return "";
  try {
    return new URL(env.OAUTH_REDIRECT_URI).origin;
  } catch {
    return "";
  }
}

/**
 * For the multi-guild switcher in the nav: list the guilds where
 * the current admin user has an AdminUser row, with Discord-fetched
 * names. The current guild is separated out so the renderer can show
 * it as a label/button while the others go in the dropdown.
 */
async function getAdminNavGuilds(
  userId: string,
  currentGuildId: string,
): Promise<{
  currentGuild: { id: string; name: string; botPresent: boolean } | undefined;
  otherGuilds: { id: string; name: string; botPresent: boolean }[];
}> {
  const rows = await getPrisma().adminUser.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  if (rows.length === 0) {
    return { currentGuild: undefined, otherGuilds: [] };
  }
  const infos = await getGuildInfos(rows.map((r) => r.guildId));
  // If the bot isn't a member of a guild any more, Discord returns 404
  // on guild info. We still show the entry in the switcher — hiding it
  // silently is worse (admin doesn't understand why their other guild
  // is gone). Instead we annotate it as "Bot fehlt" so it's obvious
  // that switching there is pointless until they re-invite the bot.
  const all = rows.map((r) => {
    const info = infos.get(r.guildId);
    return {
      id: r.guildId,
      name: info?.name ?? r.guildId,
      botPresent: !!info,
    };
  });
  const currentGuild = all.find((g) => g.id === currentGuildId);
  const otherGuilds = all
    .filter((g) => g.id !== currentGuildId)
    .map(({ id, name, botPresent }) => ({ id, name, botPresent }));
  return {
    currentGuild: currentGuild
      ? { id: currentGuild.id, name: currentGuild.name, botPresent: currentGuild.botPresent }
      : undefined,
    otherGuilds,
  };
}

/**
 * Look up Discord display names for a small list of user IDs in a
 * single guild. Used for the admins page where we want "HEADWiG"
 * instead of "754081980630696160". Each lookup is a separate REST
 * call (no GUILD_MEMBERS intent required), so keep the user count
 * small — fine for the admins list (rarely > a handful per guild).
 *
 * Missing members (left the guild, etc.) just fall back to userId
 * at render time.
 */
async function getAdminDisplayNames(
  guildId: string,
  userIds: string[],
): Promise<Map<string, string>> {
  const oauth = getOAuthEnv();
  const out = new Map<string, string>();
  if (!oauth || userIds.length === 0) return out;
  await Promise.all(
    userIds.map(async (userId) => {
      const res = await fetchGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId,
        userId,
      });
      if (!res.ok || !res.value.present) return;
      const m = res.value.member;
      const display = m.nick || m.user?.global_name || m.user?.username || null;
      if (display) out.set(userId, display);
    }),
  );
  return out;
}

function deriveOAuthRedirectUri(suffix: "/oauth/callback" | "/invite/callback"): string {
  // OAUTH_REDIRECT_URI in .env points at the Commander OAuth flow's
  // /auth/callback. We synthesise the admin variants from the same
  // origin + PUBLIC_BASE_PATH so deployers don't have to register two
  // separate redirect URIs in the Discord Portal — they can use a
  // wildcard or register both.
  const env = getOAuthEnv();
  if (!env) throw new Error("oauth not configured");
  const url = new URL(env.OAUTH_REDIRECT_URI);
  const base = `${url.origin}${publicBase()}${ROUTE_PREFIX}`;
  return `${base}${suffix}`;
}

export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  // URL-encoded body parser for native HTML form POSTs (sessions pages).
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      const params = new URLSearchParams(body as string);
      const obj: Record<string, string> = {};
      for (const [k, v] of params) obj[k] = v;
      done(null, obj);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Static assets: /admin/static/* → admin/static/ folder
  // ──────────────────────────────────────────────────────────────
  const here = path.dirname(fileURLToPath(import.meta.url));
  await app.register(fastifyStatic, {
    root: path.join(here, "static"),
    prefix: STATIC_PREFIX + "/",
    decorateReply: false,
  });

  // ──────────────────────────────────────────────────────────────
  // Public: login page
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { error?: string; return_to?: string } }>(
    `${ROUTE_PREFIX}/login`,
    async (request, reply) => {
      const oauthStartUrl =
        request.query.return_to
          ? `${navBase()}/oauth/start?return_to=${encodeURIComponent(request.query.return_to)}`
          : `${navBase()}/oauth/start`;
      reply.type("text/html").send(
        renderLogin({
          staticBase: staticBase(),
          oauthStartUrl,
          error: request.query.error ?? null,
        }),
      );
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Public: start admin Discord OAuth
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { return_to?: string } }>(
    `${ROUTE_PREFIX}/oauth/start`,
    async (request, reply) => {
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).type("text/html").send(
          renderError({
            staticBase: staticBase(),
            title: "OAuth nicht konfiguriert",
            message:
              "Die Bridge hat keine Discord-OAuth-Credentials in .env — Admin-Login geht nicht.",
          }),
        );
        return;
      }
      const state = randomBytes(32).toString("hex");
      const returnTo = request.query.return_to ?? `${navBase()}/`;
      setLoginStateCookie(reply, encodeState({ state, return_to: returnTo }));
      const redirectUri = deriveOAuthRedirectUri("/oauth/callback");
      const url = buildAuthorizeUrl({
        clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
        redirectUri,
        state,
        scope: "identify",
      });
      reply.redirect(url);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Public: admin OAuth callback
  // ──────────────────────────────────────────────────────────────
  const cbSchema = z.object({
    code: z.string().min(1),
    state: z.string().min(1),
  });
  app.get(`${ROUTE_PREFIX}/oauth/callback`, async (request, reply) => {
    const oauth = getOAuthEnv();
    if (!oauth) {
      reply.code(503).send({ error: "oauth_not_configured" });
      return;
    }
    const parsed = cbSchema.safeParse(request.query);
    if (!parsed.success) {
      reply.redirect(`${navBase()}/login?error=${encodeURIComponent("invalid_callback")}`);
      return;
    }
    const stateCookie = decodeState(request.cookies[STATE_COOKIE_LOGIN]);
    if (!stateCookie || stateCookie.state !== parsed.data.state) {
      reply.redirect(`${navBase()}/login?error=${encodeURIComponent("state_mismatch")}`);
      return;
    }
    const redirectUri = deriveOAuthRedirectUri("/oauth/callback");
    const tokenRes = await exchangeCodeForToken({
      clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
      clientSecret: oauth.DISCORD_CLIENT_SECRET,
      redirectUri,
      code: parsed.data.code,
    });
    if (!tokenRes.ok) {
      logger.warn({ err: tokenRes.error }, "admin oauth token exchange failed");
      reply.redirect(`${navBase()}/login?error=${encodeURIComponent("discord_error")}`);
      return;
    }
    const userRes = await fetchCurrentUser(tokenRes.value.access_token);
    if (!userRes.ok) {
      reply.redirect(`${navBase()}/login?error=${encodeURIComponent("discord_user_lookup_failed")}`);
      return;
    }
    const discordUserId = userRes.value.id;
    // Find any guild this user is admin of. For multi-guild bridges
    // we just pick the first; future enhancement: present a picker.
    const adminRows = await getPrisma().adminUser.findMany({
      where: { userId: discordUserId },
      orderBy: { createdAt: "asc" },
      take: 1,
    });
    if (adminRows.length === 0) {
      reply.redirect(
        `${navBase()}/login?error=${encodeURIComponent("Your Discord account is not on the admin list. Ask an existing admin to send you an invite link.")}`,
      );
      return;
    }
    const guildId = adminRows[0]!.guildId;
    const jwt = await issueAdminSessionCookie(adminSecret(), {
      sub: discordUserId,
      guildId,
    });
    reply.setCookie(
      ADMIN_SESSION_COOKIE,
      jwt,
      adminCookieOptions({
        publicBasePath: publicBase(),
        secure: oauth.OAUTH_REDIRECT_URI.startsWith("https://"),
      }),
    );
    clearStateCookies(reply);
    reply.redirect(stateCookie.return_to ?? `${navBase()}/`);
  });

  // ──────────────────────────────────────────────────────────────
  // Public: invite-link entry → starts Discord OAuth for invitee
  // ──────────────────────────────────────────────────────────────
  app.get<{ Params: { token: string } }>(
    `${ROUTE_PREFIX}/invite/:token`,
    async (request, reply) => {
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "oauth_not_configured" });
        return;
      }
      const state = randomBytes(32).toString("hex");
      setInviteStateCookie(reply, encodeState({ state, token: request.params.token }));
      const redirectUri = deriveOAuthRedirectUri("/invite/callback");
      const url = buildAuthorizeUrl({
        clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
        redirectUri,
        state,
        scope: "identify",
      });
      reply.redirect(url);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Public: invite-link OAuth callback → consume invite + sign in
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/invite/callback`, async (request, reply) => {
    const oauth = getOAuthEnv();
    if (!oauth) {
      reply.code(503).send({ error: "oauth_not_configured" });
      return;
    }
    const parsed = cbSchema.safeParse(request.query);
    if (!parsed.success) {
      reply.type("text/html").send(
        renderError({
          staticBase: staticBase(),
          title: "Ungültiger Callback",
          message: "Der Discord-Callback enthält keine gültigen Parameter.",
        }),
      );
      return;
    }
    const stateCookie = decodeState(request.cookies[STATE_COOKIE_INVITE]);
    if (!stateCookie || stateCookie.state !== parsed.data.state || !stateCookie.token) {
      reply.type("text/html").send(
        renderError({
          staticBase: staticBase(),
          title: "State-Cookie-Mismatch",
          message: "Bitte den Invite-Link erneut öffnen.",
        }),
      );
      return;
    }
    const redirectUri = deriveOAuthRedirectUri("/invite/callback");
    const tokenRes = await exchangeCodeForToken({
      clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
      clientSecret: oauth.DISCORD_CLIENT_SECRET,
      redirectUri,
      code: parsed.data.code,
    });
    if (!tokenRes.ok) {
      logger.warn({ err: tokenRes.error }, "invite-link oauth token exchange failed");
      reply.type("text/html").send(
        renderError({
          staticBase: staticBase(),
          title: "Discord-Fehler",
          message: "Token-Exchange mit Discord ist fehlgeschlagen. Bitte später erneut versuchen.",
        }),
      );
      return;
    }
    const userRes = await fetchCurrentUser(tokenRes.value.access_token);
    if (!userRes.ok) {
      reply.type("text/html").send(
        renderError({
          staticBase: staticBase(),
          title: "Discord-Fehler",
          message: "Konnte deinen Discord-Account nicht abfragen.",
        }),
      );
      return;
    }
    const consumed = await consumeInviteLink({
      rawToken: stateCookie.token,
      discordUserId: userRes.value.id,
    });
    if (!consumed.ok) {
      reply.type("text/html").send(
        renderError({
          staticBase: staticBase(),
          title: "Invite ungültig",
          message:
            consumed.reason === "already_used"
              ? "Dieser Invite-Link wurde bereits benutzt. Bitte einen neuen anfordern."
              : consumed.reason === "expired"
                ? "Dieser Invite-Link ist abgelaufen."
                : "Invite-Link unbekannt oder bereits invalidiert.",
          showLogin: true,
          loginUrl: `${navBase()}/login`,
        }),
      );
      return;
    }
    const jwt = await issueAdminSessionCookie(adminSecret(), {
      sub: userRes.value.id,
      guildId: consumed.guildId,
    });
    reply.setCookie(
      ADMIN_SESSION_COOKIE,
      jwt,
      adminCookieOptions({
        publicBasePath: publicBase(),
        secure: oauth.OAUTH_REDIRECT_URI.startsWith("https://"),
      }),
    );
    clearStateCookies(reply);
    reply.redirect(`${navBase()}/`);
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: logout
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/logout`, async (_request, reply) => {
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: `${publicBase()}${ROUTE_PREFIX}` });
    reply.redirect(`${navBase()}/login`);
  });

  // Trailing-slash redirect: /admin -> /admin/ so users who type the
  // URL without the trailing slash don't hit a 404.
  app.get(ROUTE_PREFIX, async (_request, reply) => {
    reply.redirect(`${navBase()}/`);
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: dashboard
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const [data, nav] = await Promise.all([
      loadDashboardData(session.guildId),
      getAdminNavGuilds(session.sub, session.guildId),
    ]);
    if (nav.currentGuild) data.guildName = nav.currentGuild.name;
    reply.type("text/html").send(
      renderDashboard({
        staticBase: staticBase(),
        navBase: navBase(),
        data,
        currentGuild: nav.currentGuild,
        otherGuilds: nav.otherGuilds,
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: Raid-Planer (channel mirror with rename / move / role /
  // DM-link). Uses the same /admin/api/live polling as the dashboard
  // — both pages share the JSON, the page just renders a different
  // subset of it.
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/raid-planer`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const [data, nav] = await Promise.all([
      loadDashboardData(session.guildId),
      getAdminNavGuilds(session.sub, session.guildId),
    ]);
    if (nav.currentGuild) data.guildName = nav.currentGuild.name;
    reply.type("text/html").send(
      renderRaidPlaner({
        staticBase: staticBase(),
        navBase: navBase(),
        data,
        currentGuild: nav.currentGuild,
        otherGuilds: nav.otherGuilds,
      }),
    );
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: switch active guild (multi-guild admins only)
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { id?: string } }>(
    `${ROUTE_PREFIX}/switch-guild`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const targetGuildId = request.query.id;
      if (!targetGuildId || !/^[0-9]{17,20}$/.test(targetGuildId)) {
        reply.code(400).send({ error: "invalid_guild_id" });
        return;
      }
      const isAdminOfTarget = await isAdmin({
        guildId: targetGuildId,
        userId: session.sub,
      });
      if (!isAdminOfTarget) {
        reply.code(403).send({ error: "not_admin_of_this_guild" });
        return;
      }
      const jwt = await issueAdminSessionCookie(adminSecret(), {
        sub: session.sub,
        guildId: targetGuildId,
      });
      reply.setCookie(
        ADMIN_SESSION_COOKIE,
        jwt,
        adminCookieOptions({
          publicBasePath: publicBase(),
          secure: getOAuthEnv()?.OAUTH_REDIRECT_URI.startsWith("https://") ?? false,
        }),
      );
      reply.redirect(`${navBase()}/`);
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: live JSON for dashboard polling
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/api/live`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const [data, info] = await Promise.all([
      loadDashboardData(session.guildId),
      getGuildInfo(session.guildId),
    ]);
    if (info) data.guildName = info.name;
    reply.send(data);
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: config page + save endpoint
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { saved?: string } }>(
    `${ROUTE_PREFIX}/config`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const [cfg, nav] = await Promise.all([
        readGuildConfig(session.guildId),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      reply.type("text/html").send(
        renderConfig({
          staticBase: staticBase(),
          navBase: navBase(),
          saved: request.query.saved === "1",
          data: {
            guildId: session.guildId,
            enabled: cfg?.enabled ?? false,
            bridgeMode: cfg?.bridgeMode ?? "external_voice",
            commanderRoleIds: cfg?.commanderRoleIds ?? [],
            allowedVoiceChannelIds: cfg?.allowedVoiceChannelIds ?? [],
          },
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
        }),
      );
    },
  );

  const configBodySchema = z.object({
    enabled: z.boolean(),
    commanderRoleIds: z.array(z.string().regex(/^[0-9]{17,20}$/)),
    allowedVoiceChannelIds: z.array(z.string().regex(/^[0-9]{17,20}$/)),
  });
  app.post(`${ROUTE_PREFIX}/api/config`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const parsed = configBodySchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      });
      return;
    }
    await saveGuildConfig(session.guildId, parsed.data);
    reply.send({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────
  // Protected: admins page + invite-link mint + revoke
  // ──────────────────────────────────────────────────────────────
  app.get<{
    Querystring: { fresh?: string; fresh_exp?: string; fresh_role?: string };
  }>(
    `${ROUTE_PREFIX}/admins`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const [admins, invites, nav] = await Promise.all([
        listAdmins(session.guildId),
        listInviteLinks(session.guildId),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      // Look up display names for the admin list + the "added by"
      // attribution; the union is usually <10 IDs total.
      const userIds = new Set<string>();
      for (const a of admins) {
        userIds.add(a.userId);
        if (a.addedBy) userIds.add(a.addedBy);
      }
      const names = await getAdminDisplayNames(session.guildId, [...userIds]);
      const adminsWithNames = admins.map((a) => ({
        ...a,
        displayName: names.get(a.userId),
        addedByName: a.addedBy ? names.get(a.addedBy) : undefined,
      }));
      let freshInvite: { url: string; expiresAt: Date; role: AdminRole } | undefined;
      if (request.query.fresh && request.query.fresh_exp) {
        const role: AdminRole =
          request.query.fresh_role && isAdminRole(request.query.fresh_role)
            ? request.query.fresh_role
            : "vice_admiral";
        freshInvite = {
          // Absolute URL so the admin can copy + paste it directly.
          url: `${publicOrigin()}${publicBase()}${ROUTE_PREFIX}/invite/${request.query.fresh}`,
          expiresAt: new Date(Number(request.query.fresh_exp) * 1000),
          role,
        };
      }
      reply.type("text/html").send(
        renderAdmins({
          staticBase: staticBase(),
          navBase: navBase(),
          data: {
            guildId: session.guildId,
            admins: adminsWithNames,
            invites,
            freshInvite,
            // Tell the view what the *current* user can do, so it can
            // hide buttons rather than showing them and erroring out.
            viewerRole: session.role,
            viewerUserId: session.sub,
          },
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
        }),
      );
    },
  );

  const inviteCreateSchema = z.object({
    label: z.string().min(1).max(120),
    role: z.enum(ADMIN_ROLES),
  });
  app.post(`${ROUTE_PREFIX}/api/invites`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    // Only admirals can mint invite links (whether for admiral or
    // vice-admiral role). Vice-admirals can do everything else but not
    // promote other admins.
    if (session.role !== "admiral") {
      reply.code(403).send({ error: "admiral_only" });
      return;
    }
    const parsed = inviteCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      });
      return;
    }
    const invite = await mintAdminInviteLink({
      guildId: session.guildId,
      label: parsed.data.label,
      role: parsed.data.role,
      createdBy: session.sub,
    });
    reply.send({
      ok: true,
      token: invite.plaintext, // raw, shown once
      role: invite.role,
      expiresAt: invite.expiresAt.toISOString(),
      url: `${publicOrigin()}${publicBase()}${ROUTE_PREFIX}/invite/${invite.plaintext}`,
    });
  });

  app.delete<{ Params: { id: string } }>(
    `${ROUTE_PREFIX}/api/invites/:id`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      if (session.role !== "admiral") {
        reply.code(403).send({ error: "admiral_only" });
        return;
      }
      const ok = await revokeInviteLink({ id: request.params.id, guildId: session.guildId });
      if (ok) {
        void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "invite_link.revoke", target: request.params.id });
      }
      reply.send({ ok });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: remove an admin (admiral-only, non-protected target,
  // never the last admiral)
  // ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/admins/:userId`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      if (session.role !== "admiral") {
        reply.code(403).send({ error: "admiral_only" });
        return;
      }
      const result = await removeAdmin({
        guildId: session.guildId,
        byUserId: session.sub,
        targetUserId: request.params.userId,
      });
      if (!result.ok) {
        const status =
          result.reason === "target_not_found"
            ? 404
            : result.reason === "target_protected"
              ? 409
              : 400;
        reply.code(status).send({ error: result.reason });
        return;
      }
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "admin.remove", target: request.params.userId });
      reply.send({ ok: true });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: strip ALL configured commander roles from a user
  // (admin tier — either admiral or vice-admiral can do this; this
  // is "manage the commander roster", not "manage admins")
  // ──────────────────────────────────────────────────────────────
  app.delete<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/commander-roles/:userId`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      if (!/^[0-9]{17,20}$/.test(request.params.userId)) {
        reply.code(400).send({ error: "invalid_user_id" });
        return;
      }
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "oauth_not_configured" });
        return;
      }
      const cfg = await readGuildConfig(session.guildId);
      if (!cfg || cfg.commanderRoleIds.length === 0) {
        reply.code(409).send({ error: "no_commander_roles_configured" });
        return;
      }
      // Only try to strip roles the user actually has, so we don't
      // generate noise in the Discord audit log for roles they never
      // held in the first place.
      const memberRes = await fetchGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
      });
      if (!memberRes.ok) {
        reply.code(502).send({ error: "discord_api_error" });
        return;
      }
      if (!memberRes.value.present) {
        reply.code(404).send({ error: memberRes.value.reason });
        return;
      }
      const currentRoles = new Set(memberRes.value.member.roles);
      const toStrip = cfg.commanderRoleIds.filter((r) => currentRoles.has(r));
      if (toStrip.length === 0) {
        reply.send({ ok: true, removed: [] });
        return;
      }
      const results = await Promise.all(
        toStrip.map((roleId) =>
          removeGuildMemberRole({
            botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
            guildId: session.guildId,
            userId: request.params.userId,
            roleId,
          }),
        ),
      );
      const failures = results
        .map((r, i) => ({ r, roleId: toStrip[i]! }))
        .filter((x) => !x.r.ok);
      if (failures.length > 0) {
        logger.warn(
          {
            guildId: session.guildId,
            targetUserId: request.params.userId,
            failures: failures.map((f) => ({
              roleId: f.roleId,
              status: f.r.ok ? null : f.r.error.status,
            })),
          },
          "commander-role strip: some role removals failed",
        );
        reply.code(502).send({
          error: "partial_failure",
          removed: toStrip.filter((_, i) => results[i]!.ok),
          failed: failures.map((f) => f.roleId),
        });
        return;
      }
      reply.send({ ok: true, removed: toStrip });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: change an admin's role (admiral-only, non-protected
  // target, never demote the last admiral)
  // ──────────────────────────────────────────────────────────────
  const roleChangeSchema = z.object({ role: z.enum(ADMIN_ROLES) });
  app.patch<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/admins/:userId/role`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      if (session.role !== "admiral") {
        reply.code(403).send({ error: "admiral_only" });
        return;
      }
      const parsed = roleChangeSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      const result = await setAdminRole({
        guildId: session.guildId,
        byUserId: session.sub,
        targetUserId: request.params.userId,
        newRole: parsed.data.role as AdminRole,
      });
      if (!result.ok) {
        const status =
          result.reason === "target_not_found"
            ? 404
            : result.reason === "target_protected"
              ? 409
              : 400;
        reply.code(status).send({ error: result.reason });
        return;
      }
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "admin.set_role", target: request.params.userId, metadata: { role: parsed.data.role } });
      reply.send({ ok: true });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: companion-download token management. Any admin can
  // mint/revoke (it's roster-management, not admin-management).
  // ──────────────────────────────────────────────────────────────
  const downloadCreateSchema = z.object({
    label: z.string().min(1).max(120),
  });
  app.post(`${ROUTE_PREFIX}/api/companion-downloads`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const env = getEnv();
    if (!env.GITHUB_REPO) {
      reply.code(503).send({
        error: "downloads_not_configured",
        detail:
          "GITHUB_REPO ist nicht gesetzt — Bridge kann keine Companion-EXE liefern.",
      });
      return;
    }
    const parsed = downloadCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`),
      });
      return;
    }
    const token = await mintDownloadToken({
      label: parsed.data.label,
      createdBy: session.sub,
    });
    reply.send({
      ok: true,
      id: token.id,
      token: token.plaintext, // raw, shown once
      expiresAt: token.expiresAt.toISOString(),
      url: `${publicOrigin()}${publicBase()}/download/companion/${token.plaintext}`,
    });
  });

  app.get(`${ROUTE_PREFIX}/api/companion-downloads`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const rows = await listDownloadTokens();
    reply.send({ tokens: rows });
  });

  app.delete<{ Params: { id: string } }>(
    `${ROUTE_PREFIX}/api/companion-downloads/:id`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const ok = await revokeDownloadToken(request.params.id);
      reply.send({ ok });
    },
  );

  // Diagnostic: which GitHub release does the bridge currently see?
  // Lets the admin verify GITHUB_REPO / GITHUB_TOKEN / asset pattern
  // are wired correctly without burning a download token.
  app.get(`${ROUTE_PREFIX}/api/companion-release`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const env = getEnv();
    if (!env.GITHUB_REPO) {
      reply.send({ configured: false });
      return;
    }
    const info = await fetchLatestCompanionRelease();
    if (!info) {
      reply.send({
        configured: true,
        repo: env.GITHUB_REPO,
        release: null,
        error: "fetch_failed_or_no_release",
      });
      return;
    }
    reply.send({
      configured: true,
      repo: env.GITHUB_REPO,
      release: {
        tagName: info.tagName,
        name: info.name,
        publishedAt: info.publishedAt,
        asset: info.asset
          ? {
              name: info.asset.name,
              size: info.asset.size,
            }
          : null,
      },
    });
  });

  // ──────────────────────────────────────────────────────────────
  // Etappe 4: Channel-Mirror mutation endpoints. Each one needs the
  // bot to have the corresponding Discord permission on the server
  // (Manage Channels / Move Members / Manage Roles). If missing,
  // Discord returns 403 and we surface that to the admin UI.
  // ──────────────────────────────────────────────────────────────

  const renameSchema = z.object({ name: z.string().min(1).max(100) });
  app.post<{ Params: { channelId: string } }>(
    `${ROUTE_PREFIX}/api/channels/:channelId/rename`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "discord_not_configured" });
        return;
      }
      const parsed = renameSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      // Scope: channel must be in this admin's guild's allowed list,
      // so an admin of guild A can't rename channels in guild B by
      // poking IDs into the URL.
      const cfg = await readGuildConfig(session.guildId);
      const allowed = new Set(cfg?.allowedVoiceChannelIds ?? []);
      if (!allowed.has(request.params.channelId)) {
        reply.code(403).send({ error: "channel_not_in_guild_allowlist" });
        return;
      }
      const result = await modifyChannel({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        channelId: request.params.channelId,
        body: { name: parsed.data.name },
      });
      if (!result.ok) {
        // Log the FULL discord response so the operator can see exactly
        // why; surface a specific error code to the admin UI so the
        // user gets something more useful than "discord_api_error".
        logger.warn(
          {
            guildId: session.guildId,
            channelId: request.params.channelId,
            status: result.error.status,
            body: result.error.message,
          },
          "channel rename failed",
        );
        const { code: errorCode, status: httpStatus } = mapDiscordError(
          result.error.status,
          "missing_manage_channels",
        );
        reply.code(httpStatus).send({ error: errorCode, detail: result.error.message });
        return;
      }
      // Drop the channels cache so the next /admin/api/live tick
      // shows the new name immediately (otherwise it'd be visible
      // only after the 60s TTL window).
      invalidateChannels(session.guildId);
      reply.send({ ok: true });
    },
  );

  const roleActionSchema = z.object({
    roleId: z.string().regex(/^[0-9]{17,20}$/),
    action: z.enum(["add", "remove"]),
  });
  app.post<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/members/:userId/role`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "discord_not_configured" });
        return;
      }
      const parsed = roleActionSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      // Whitelist-Check: only roles listed in GuildConfig.commanderRoleIds
      // can be granted or revoked through this endpoint. Stops the
      // Raid-Planer from doubling as a generic role-management tool
      // even if someone hand-crafts a request with arbitrary roleIds.
      const cfg = await readGuildConfig(session.guildId);
      const allowedRoles = new Set(cfg?.commanderRoleIds ?? []);
      if (!allowedRoles.has(parsed.data.roleId)) {
        reply.code(403).send({ error: "role_not_in_commander_whitelist" });
        return;
      }
      const fn = parsed.data.action === "add" ? addGuildMemberRole : removeGuildMemberRole;
      const result = await fn({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
        roleId: parsed.data.roleId,
      });
      if (!result.ok) {
        logger.warn(
          {
            guildId: session.guildId,
            targetUserId: request.params.userId,
            roleId: parsed.data.roleId,
            action: parsed.data.action,
            status: result.error.status,
            body: result.error.message,
          },
          "role mutation failed",
        );
        const { code: errorCode, status: httpStatus } = mapDiscordError(
          result.error.status,
          "missing_manage_roles",
        );
        reply.code(httpStatus).send({ error: errorCode, detail: result.error.message });
        return;
      }
      reply.send({ ok: true });
    },
  );

  const moveSchema = z.object({
    channelId: z.string().regex(/^[0-9]{17,20}$/),
  });
  app.post<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/members/:userId/move`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "discord_not_configured" });
        return;
      }
      const parsed = moveSchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      const result = await moveGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
        channelId: parsed.data.channelId,
      });
      if (!result.ok) {
        logger.warn(
          {
            guildId: session.guildId,
            targetUserId: request.params.userId,
            targetChannelId: parsed.data.channelId,
            status: result.error.status,
            body: result.error.message,
          },
          "member move failed",
        );
        // 400 from move usually means "user not in voice" — surface
        // a friendlier specific code for that case.
        if (result.error.status === 400) {
          reply.code(400).send({
            error: "user_not_in_voice",
            detail: result.error.message,
          });
          return;
        }
        const { code: errorCode, status: httpStatus } = mapDiscordError(
          result.error.status,
          "missing_move_members",
        );
        reply.code(httpStatus).send({ error: errorCode, detail: result.error.message });
        return;
      }
      reply.send({ ok: true });
    },
  );

  const dmLinkSchema = z.object({ label: z.string().min(1).max(120).optional() });
  // ──────────────────────────────────────────────────────────────
  // Protected: relay bots admin page (step 7)
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { saved?: string } }>(
    `${ROUTE_PREFIX}/relay-bots`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const [config, nav] = await Promise.all([
        getRelayBotsConfig(),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      reply.type("text/html").send(
        renderRelayBots({
          staticBase: staticBase(),
          navBase: navBase(),
          data: {
            config,
            canSeeTokens: session.role === "admiral",
          },
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
          saved: request.query.saved === "1",
        }),
      );
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Protected: sessions pages (step 4 — admin web UI for ops sessions)
  // ──────────────────────────────────────────────────────────────

  const createSessionBodySchema = z.object({
    guildId: z.string().regex(/^[0-9]{17,20}$/),
    label: z.string().min(1).max(80),
  });

  app.get<{ Querystring: { created?: string } }>(
    `${ROUTE_PREFIX}/sessions`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const [sessions, nav] = await Promise.all([
        listActiveSessions(session.guildId),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      const inviteCounts = await Promise.all(
        sessions.map((s) =>
          listSessionInvites({ sessionId: s.id, guildId: session.guildId }).then(
            (invs) => invs?.length ?? 0,
          ),
        ),
      );
      reply.type("text/html").send(
        renderSessions({
          staticBase: staticBase(),
          navBase: navBase(),
          data: {
            guildId: session.guildId,
            sessions: sessions.map((s, i) => ({ ...s, inviteCount: inviteCounts[i] })),
          },
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
          created: request.query.created,
        }),
      );
    },
  );

  app.post(
    `${ROUTE_PREFIX}/sessions`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const parsed = createSessionBodySchema.safeParse(request.body);
      if (!parsed.success || parsed.data.guildId !== session.guildId) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      const created = await createSession({
        guildId: session.guildId,
        label: parsed.data.label,
        createdBy: session.sub,
      });
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "session.create", target: created.id, metadata: { label: created.label } });
      reply.redirect(`${navBase()}/sessions?created=${encodeURIComponent(created.label)}`);
    },
  );

  const mintInviteBodySchema = z.object({
    label: z.string().min(1).max(80),
    ttlHours: z.coerce.number().int().min(1).max(168).optional(),
  });

  app.get<{
    Params: { id: string };
    Querystring: { fresh_token?: string; fresh_label?: string; fresh_exp?: string };
  }>(
    `${ROUTE_PREFIX}/sessions/:id`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const { id } = request.params;
      const [sessionData, invites, nav] = await Promise.all([
        getSession({ sessionId: id, guildId: session.guildId }),
        listSessionInvites({ sessionId: id, guildId: session.guildId }),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      if (!sessionData || !invites) {
        reply.code(404).type("text/html").send(
          renderError({
            staticBase: staticBase(),
            title: "Session nicht gefunden",
            message: "Diese Session existiert nicht oder gehört nicht zu deinem Server.",
          }),
        );
        return;
      }
      let freshInvite: { plaintext: string; label: string; expiresAt: Date } | undefined;
      if (request.query.fresh_token && request.query.fresh_label && request.query.fresh_exp) {
        freshInvite = {
          plaintext: request.query.fresh_token,
          label: decodeURIComponent(request.query.fresh_label),
          expiresAt: new Date(Number(request.query.fresh_exp) * 1000),
        };
      }
      reply.type("text/html").send(
        renderSessionDetail({
          staticBase: staticBase(),
          navBase: navBase(),
          data: { session: sessionData, invites, freshInvite },
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
        }),
      );
    },
  );

  app.post<{ Params: { id: string } }>(
    `${ROUTE_PREFIX}/sessions/:id/end`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const result = await endSession({ sessionId: request.params.id, guildId: session.guildId });
      if (result.ok) {
        void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "session.end", target: request.params.id });
      }
      if (!result.ok && result.reason === "not_found") {
        reply.code(404).type("text/html").send(
          renderError({
            staticBase: staticBase(),
            title: "Session nicht gefunden",
            message: "Diese Session existiert nicht oder gehört nicht zu deinem Server.",
          }),
        );
        return;
      }
      // already_ended is fine — just redirect back to sessions list
      reply.redirect(`${navBase()}/sessions`);
    },
  );

  app.post<{ Params: { id: string } }>(
    `${ROUTE_PREFIX}/sessions/:id/invites`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const parsed = mintInviteBodySchema.safeParse(request.body);
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      const invite = await mintSessionInvite({
        sessionId: request.params.id,
        guildId: session.guildId,
        label: parsed.data.label,
        createdBy: session.sub,
        ttlHours: parsed.data.ttlHours,
      });
      if (!invite) {
        reply.code(404).type("text/html").send(
          renderError({
            staticBase: staticBase(),
            title: "Session nicht gefunden",
            message: "Die Session wurde nicht gefunden oder ist bereits beendet.",
          }),
        );
        return;
      }
      const exp = Math.floor(invite.expiresAt.getTime() / 1000);
      reply.redirect(
        `${navBase()}/sessions/${request.params.id}` +
          `?fresh_token=${encodeURIComponent(invite.plaintext)}` +
          `&fresh_label=${encodeURIComponent(invite.label)}` +
          `&fresh_exp=${exp}`,
      );
    },
  );

  app.post<{ Params: { id: string; inviteId: string } }>(
    `${ROUTE_PREFIX}/sessions/:id/invites/:inviteId/revoke`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      await revokeSessionInvite({
        inviteId: request.params.inviteId,
        sessionId: request.params.id,
        guildId: session.guildId,
      });
      reply.redirect(`${navBase()}/sessions/${request.params.id}`);
    },
  );

  app.post<{ Params: { userId: string } }>(
    `${ROUTE_PREFIX}/api/members/:userId/dm-download-link`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) {
        reply.code(503).send({ error: "discord_not_configured" });
        return;
      }
      const parsed = dmLinkSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        reply.code(400).send({ error: "invalid_body" });
        return;
      }
      // Mint a single-use token labelled with the recipient + sender
      // so the admin audit list stays self-explanatory.
      const minted = await mintDownloadToken({
        label:
          parsed.data.label ??
          `[dm] to ${request.params.userId} by ${session.sub}`,
        createdBy: session.sub,
      });
      // Build the absolute landing URL from the inbound request so
      // we don't need a PUBLIC_HOST env. Honours x-forwarded-* set
      // by Traefik in production.
      const proto =
        (request.headers["x-forwarded-proto"] as string | undefined) ?? "https";
      const host =
        (request.headers["x-forwarded-host"] as string | undefined) ??
        request.headers.host ??
        "localhost";
      const basePath = getEnv().PUBLIC_BASE_PATH;
      const landingUrl = `${proto}://${host}${basePath}/download/companion/${minted.plaintext}`;
      const content =
        `Hey! Hier dein Companion-Download für RDOC Squad Link:\n${landingUrl}\n\n` +
        `Der Link ist einmalig gültig (7 Tage). Falls er nicht funktioniert, melde dich bei einem Admin.`;
      const sent = await sendDirectMessage({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        userId: request.params.userId,
        content,
      });
      if (!sent.ok) {
        logger.warn(
          {
            guildId: session.guildId,
            targetUserId: request.params.userId,
            status: sent.error.status,
            body: sent.error.message,
          },
          "dm download link send failed",
        );
        // 403 from a DM-create / DM-send is specifically "recipient
        // has DMs from server members disabled" — surface that.
        const { code: errorCode, status: httpStatus } = mapDiscordError(
          sent.error.status,
          "dm_closed_by_user",
        );
        reply.code(httpStatus).send({ error: errorCode, detail: sent.error.message });
        return;
      }
      reply.send({ ok: true, tokenId: minted.id });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Monitoring page + snapshot endpoint
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/monitoring`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const nav = await getAdminNavGuilds(session.sub, session.guildId);
    reply.type("text/html").send(
      renderMonitoring({
        staticBase: staticBase(),
        navBase: navBase(),
        currentGuild: nav.currentGuild,
        otherGuilds: nav.otherGuilds,
      }),
    );
  });

  app.get(`${ROUTE_PREFIX}/monitoring/snapshot`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    reply.send(await monitoringSnapshot());
  });

  // ──────────────────────────────────────────────────────────────
  // Audit log page (admiral-only)
  // ──────────────────────────────────────────────────────────────
  app.get<{ Querystring: { limit?: string; offset?: string } }>(
    `${ROUTE_PREFIX}/audit`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      if (session.role !== "admiral") {
        reply.code(403).type("text/html").send(
          renderError({
            staticBase: staticBase(),
            title: "Kein Zugriff",
            message: "Das Audit-Log ist nur für Admirals zugänglich.",
          }),
        );
        return;
      }
      const limit = Math.min(parseInt(request.query.limit ?? "100", 10) || 100, 500);
      const offset = Math.max(parseInt(request.query.offset ?? "0", 10) || 0, 0);
      const [entries, total, nav] = await Promise.all([
        listRecentAudit(session.guildId, limit, offset),
        countAudit(session.guildId),
        getAdminNavGuilds(session.sub, session.guildId),
      ]);
      reply.type("text/html").send(
        renderAudit({
          staticBase: staticBase(),
          navBase: navBase(),
          entries,
          total,
          currentGuild: nav.currentGuild,
          otherGuilds: nav.otherGuilds,
        }),
      );
    },
  );

  // ──────────────────────────────────────────────────────────────
  // Discord Voice page + supporting JSON endpoints
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/discord-voice`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const nav = await getAdminNavGuilds(session.sub, session.guildId);
    reply.type("text/html").send(
      renderDiscordVoice({
        staticBase: staticBase(),
        navBase: navBase(),
        currentGuild: nav.currentGuild,
        otherGuilds: nav.otherGuilds,
      }),
    );
  });

  app.get(`${ROUTE_PREFIX}/discord/voice-states`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const oauth = getOAuthEnv();
    if (!oauth) {
      reply.send({ offline: true, channels: [], voiceStates: [] });
      return;
    }
    const [channels, voiceRows] = await Promise.all([
      getCachedChannels(session.guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN),
      getPrisma().userVoiceState.findMany({
        where: { guildId: session.guildId, channelId: { not: null } },
      }),
    ]);
    const voiceChannels = channels.filter((c) => c.type === 2);
    reply.send({
      channels: voiceChannels.map((c) => ({ id: c.id, name: c.name })),
      voiceStates: voiceRows.map((r) => ({
        userId: r.userId,
        displayName: r.userId,
        channelId: r.channelId,
      })),
    });
  });

  app.get(`${ROUTE_PREFIX}/discord/roles`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const oauth = getOAuthEnv();
    if (!oauth) {
      reply.send({ roles: [] });
      return;
    }
    const roles = await getCachedRoles(session.guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN);
    reply.send({ roles: roles.map((r) => ({ id: r.id, name: r.name })) });
  });

  app.patch<{ Params: { userId: string }; Body: { channelId: string | null } }>(
    `${ROUTE_PREFIX}/discord/members/:userId/channel`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) { reply.code(503).send({ error: "discord_not_configured" }); return; }
      if (!/^[0-9]{17,20}$/.test(request.params.userId)) {
        reply.code(400).send({ error: "invalid_user_id" }); return;
      }
      const channelId = (request.body as { channelId?: string | null })?.channelId ?? null;
      const res = await moveGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
        channelId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_move_members");
        reply.code(status).send({ error: code }); return;
      }
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "discord.move_member", target: request.params.userId, metadata: { channelId } });
      reply.send({ ok: true });
    },
  );

  app.put<{ Params: { userId: string; roleId: string } }>(
    `${ROUTE_PREFIX}/discord/members/:userId/roles/:roleId`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) { reply.code(503).send({ error: "discord_not_configured" }); return; }
      const res = await addGuildMemberRole({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
        roleId: request.params.roleId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_manage_roles");
        reply.code(status).send({ error: code }); return;
      }
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "discord.add_role", target: request.params.userId, metadata: { roleId: request.params.roleId } });
      reply.send({ ok: true });
    },
  );

  app.delete<{ Params: { userId: string; roleId: string } }>(
    `${ROUTE_PREFIX}/discord/members/:userId/roles/:roleId`,
    async (request, reply) => {
      const session = await requireAdminSession(request, reply);
      if (!session) return;
      const oauth = getOAuthEnv();
      if (!oauth) { reply.code(503).send({ error: "discord_not_configured" }); return; }
      const res = await removeGuildMemberRole({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: session.guildId,
        userId: request.params.userId,
        roleId: request.params.roleId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_manage_roles");
        reply.code(status).send({ error: code }); return;
      }
      void appendAudit({ guildId: session.guildId, actorUserId: session.sub, action: "discord.remove_role", target: request.params.userId, metadata: { roleId: request.params.roleId } });
      reply.send({ ok: true });
    },
  );

  // ──────────────────────────────────────────────────────────────
  // SSE live-stream: /admin/api/live-stream
  // Pushes the same payload as /api/live on every guild-state-changed
  // event from the bridgeEvents bus (debounced 100 ms per guild).
  // 25 s heartbeat comment-frame keeps idle proxies from closing.
  // Frontend falls back to /api/live polling if EventSource errors.
  // ──────────────────────────────────────────────────────────────
  app.get(`${ROUTE_PREFIX}/api/live-stream`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;

    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });

    let closed = false;
    let inFlight = false;
    let pendingAfterFlight = false;

    const sendFrame = async (): Promise<void> => {
      if (closed) return;
      if (inFlight) { pendingAfterFlight = true; return; }
      inFlight = true;
      try {
        const [data, info] = await Promise.all([
          loadDashboardData(session.guildId),
          (await import("../services/guildInfo.js")).getGuildInfo(session.guildId),
        ]);
        if (info) data.guildName = info.name;
        if (closed) return;
        raw.write(`data: ${JSON.stringify(data)}\n\n`);
      } catch (err) {
        logger.warn({ err, guildId: session.guildId }, "live-stream sendFrame failed");
      } finally {
        inFlight = false;
        if (pendingAfterFlight && !closed) {
          pendingAfterFlight = false;
          void sendFrame();
        }
      }
    };

    await sendFrame();

    const unsubscribe = bridgeEvents.onGuildStateChanged((gid) => {
      if (gid === session.guildId) void sendFrame();
    });

    const heartbeat = setInterval(() => {
      if (closed) return;
      try { raw.write(":\n\n"); } catch { /* peer gone */ }
    }, 25_000);
    heartbeat.unref?.();

    const onClose = (): void => {
      if (closed) return;
      closed = true;
      clearInterval(heartbeat);
      unsubscribe();
    };
    request.raw.on("close", onClose);
    raw.on("close", onClose);
  });

  // ──────────────────────────────────────────────────────────────
  // Channel reorder: POST /admin/api/channels/reorder
  // Body: { ordered: string[] } — IDs of allowed voice channels in
  // the requested display order. Bridge calculates the minimal set of
  // Discord position PATCH calls needed.
  // ──────────────────────────────────────────────────────────────
  const reorderSchema = z.object({
    ordered: z.array(z.string().regex(/^[0-9]{17,20}$/)).min(2).max(50),
  });
  app.post(`${ROUTE_PREFIX}/api/channels/reorder`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const oauth = getOAuthEnv();
    if (!oauth) { reply.code(503).send({ error: "discord_not_configured" }); return; }
    const parsed = reorderSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body", issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) });
      return;
    }
    const cfg = await (await import("../services/guildConfig.js")).readGuildConfig(session.guildId);
    const allowed = new Set(cfg?.allowedVoiceChannelIds ?? []);
    if (parsed.data.ordered.some((id) => !allowed.has(id))) {
      reply.code(403).send({ error: "channel_not_in_allowed_list" });
      return;
    }
    const channels = await getCachedChannels(session.guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN);
    const positions = channels
      .filter((c) => allowed.has(c.id))
      .map((c) => ({ id: c.id, position: c.position ?? 0 }))
      .sort((a, b) => a.position - b.position);
    const slots = positions.map((p) => p.position);
    const items = parsed.data.ordered.map((id, i) => ({ id, position: slots[i] ?? i }));
    const result = await bulkModifyChannelPositions({
      botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
      guildId: session.guildId,
      items,
    });
    if (!result.ok) {
      const { code, status } = mapDiscordError(result.error.status, "missing_manage_channels");
      reply.code(status).send({ error: code });
      return;
    }
    invalidateChannels(session.guildId);
    bridgeEvents.emitGuildStateChanged(session.guildId);
    reply.send({ ok: true });
  });

  // ──────────────────────────────────────────────────────────────
  // Strategy channel: POST /admin/api/strategy-channel
  // Body: { name: string; userIds: string[] }
  // Creates a temporary Discord voice channel and moves the selected
  // commanders into it. GC'd after 15 min idle.
  // ──────────────────────────────────────────────────────────────
  const strategyChannelSchema = z.object({
    name: z.string().min(1).max(100),
    userIds: z.array(z.string().regex(/^[0-9]{17,20}$/)).min(1).max(50),
  });
  app.post(`${ROUTE_PREFIX}/api/strategy-channel`, async (request, reply) => {
    const session = await requireAdminSession(request, reply);
    if (!session) return;
    const parsed = strategyChannelSchema.safeParse(request.body);
    if (!parsed.success) {
      reply.code(400).send({ error: "invalid_body" });
      return;
    }
    const result = await createStrategyChannel({
      guildId: session.guildId,
      name: parsed.data.name,
      userIds: parsed.data.userIds,
      createdBy: session.sub,
    });
    if (!result.ok) {
      if (result.reason === "no_oauth") { reply.code(503).send({ error: "discord_not_configured" }); return; }
      const { code, status } = mapDiscordError(result.status, "missing_manage_channels");
      reply.code(status).send({ error: code, message: result.message });
      return;
    }
    reply.send({ ok: true, channelId: result.channelId, name: result.name, moved: result.moved, moveFailures: result.moveFailures });
  });
}

// ────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────

/**
 * Translate a Discord REST status into a specific error code + HTTP
 * status for the admin UI. 403 → caller-supplied "missing_*" hint;
 * 400 → bad_request (most common: trying to move a user not in voice,
 * or rename to an invalid name); 404 → not_found; 429 → rate_limited;
 * anything else → discord_api_error so the UI knows it's not a code
 * bug on our end.
 */
function mapDiscordError(
  discordStatus: number,
  missingPermissionCode: string,
): { code: string; status: number } {
  if (discordStatus === 403) return { code: missingPermissionCode, status: 403 };
  if (discordStatus === 404) return { code: "discord_not_found", status: 404 };
  if (discordStatus === 400) return { code: "discord_bad_request", status: 400 };
  if (discordStatus === 429) return { code: "discord_rate_limited", status: 429 };
  if (discordStatus === 401) return { code: "discord_unauthorized", status: 502 };
  return { code: "discord_api_error", status: 502 };
}

/**
 * One-shot health check against the LiveKit server. We hit the
 * HTTP variant of `LIVEKIT_URL` (the `wss://` URL converted to
 * `https://`) — LiveKit responds on `/` even without auth, so any
 * 2xx/4xx response counts as "the server is alive". Timeout 1500ms
 * to keep dashboard render snappy if LiveKit is wedged.
 */
async function checkLivekitHealth(): Promise<boolean> {
  const wsUrl = getEnv().LIVEKIT_URL;
  if (!wsUrl) return false;
  const httpUrl = wsUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(httpUrl, { signal: ctl.signal, redirect: "manual" });
    // LiveKit returns 200 with "OK" body for `/`. We accept anything
    // < 500 — even a 404 means the server is up and answering.
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

async function loadDashboardData(guildId: string): Promise<
  Awaited<ReturnType<typeof import("./views.js").renderDashboard>> extends string
    ? import("./views.js").DashboardData
    : never
> {
  const cfg = await readGuildConfig(guildId);
  const roomId = bridgeRoomName(guildId);
  const snapshot = rooms.snapshot(roomId);

  // Fetch members with Commander role from Discord REST (no GUILD_MEMBERS
  // intent needed). We keep BOTH a filtered commander-only list AND a
  // full id → {name, roles, isBot} lookup so the Raid-Planer page can
  // render display-names + role hints for any channel member (incl.
  // non-commanders + bots like funkrelais).
  const commanderRoleMembers: Array<{
    userId: string;
    displayName: string;
    inVoice: boolean;
    inAllowedChannel: boolean;
  }> = [];
  const memberInfo = new Map<
    string,
    { displayName: string; roleIds: Set<string>; isBot: boolean }
  >();
  const oauth = getOAuthEnv();
  const commanderRoleIds = new Set(cfg?.commanderRoleIds ?? []);
  const allowedIds = new Set(cfg?.allowedVoiceChannelIds ?? []);
  if (oauth) {
    try {
      const url = `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`;
      const res = await fetch(url, {
        headers: { authorization: `Bot ${oauth.DISCORD_RDOCRTC_BOT_TOKEN}` },
      });
      if (res.ok) {
        const raw: unknown = await res.json();
        if (Array.isArray(raw)) {
          const voiceRows = await getPrisma().userVoiceState.findMany({
            where: { guildId },
          });
          const voiceByUserId = new Map(voiceRows.map((r) => [r.userId, r.channelId]));
          for (const m of raw) {
            const obj = m as Record<string, unknown>;
            const user = obj.user as Record<string, unknown> | undefined;
            const roles = obj.roles as string[] | undefined;
            if (!user || typeof user.id !== "string" || !roles) continue;
            const display =
              (typeof obj.nick === "string" && obj.nick) ||
              (typeof user.global_name === "string" && user.global_name) ||
              (typeof user.username === "string" && user.username) ||
              user.id;
            // Discord marks bots with user.bot=true; we ALSO match by
            // name for "funkrelais" so the relay bots we expect get
            // collapsed even if a future Discord change drops the
            // bot flag from the member-list payload.
            const isBotFlag = user.bot === true;
            const isBotByName = display.toLowerCase().includes("funkrelais");
            memberInfo.set(user.id, {
              displayName: display,
              roleIds: new Set(roles),
              isBot: isBotFlag || isBotByName,
            });
            if (commanderRoleIds.size > 0 && roles.some((r) => commanderRoleIds.has(r))) {
              const ch = voiceByUserId.get(user.id) ?? null;
              commanderRoleMembers.push({
                userId: user.id,
                displayName: display,
                inVoice: ch !== null,
                inAllowedChannel: ch !== null && allowedIds.has(ch),
              });
            }
          }
        }
      }
    } catch (err) {
      logger.warn({ err, guildId }, "dashboard: discord members fetch failed");
    }
  }

  // Enrich active commanders with display names from the member list
  // (where we have them). Falls back to userId when the GuildMembers
  // intent is off, the member is missing the commander role for some
  // reason, or the REST call failed — the UI shows `displayName ?? userId`.
  const nameByUserId = new Map(commanderRoleMembers.map((m) => [m.userId, m.displayName]));

  // Health truthiness: BRIDGE is always true (we're rendering, ergo
  // we live). BOT = bot is a member of this guild (the guildInfo
  // lookup is the cheapest signal we have and it's exactly what the
  // user cares about per-page). LIVEKIT = real http probe.
  const [guildInfo, livekitOk] = await Promise.all([
    getGuildInfo(guildId),
    checkLivekitHealth(),
  ]);

  // ── Channel-Mirror (Etappe 4 / Raid-Planer) ───────────────
  // Channels + roles come from the in-process TTL cache so we don't
  // beat Discord with three REST calls every 5-second polling tick.
  // On a Discord hiccup the cache serves last-known-good, which keeps
  // the Raid-Planer card visible instead of going blank.
  let channelMirror: DashboardData["channelMirror"] = [];
  let allVoiceChannels: DashboardData["allVoiceChannels"] = [];
  let commanderRoles: DashboardData["commanderRoles"] = [];
  if (oauth) {
    const [channels, roles, voiceRows] = await Promise.all([
      getCachedChannels(guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN),
      getCachedRoles(guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN),
      getPrisma().userVoiceState.findMany({ where: { guildId } }),
    ]);
    if (channels.length > 0) {
      // Voice channels only (type 2). Stage channels (13) excluded —
      // moving members into a Stage channel has extra speaker/audience
      // semantics we don't surface.
      const voiceChannels = channels.filter((c) => c.type === 2);
      allVoiceChannels = voiceChannels.map((c) => ({
        channelId: c.id,
        channelName: c.name,
      }));
      const allowedSet = new Set(cfg?.allowedVoiceChannelIds ?? []);
      const allowedVoice = voiceChannels.filter((c) => allowedSet.has(c.id));
      const membersByChannel = new Map<
        string,
        DashboardData["channelMirror"][number]["members"]
      >();
      for (const ch of allowedVoice) {
        membersByChannel.set(ch.id, []);
      }
      for (const row of voiceRows) {
        if (!row.channelId) continue;
        const bucket = membersByChannel.get(row.channelId);
        if (!bucket) continue; // not an allowed channel
        const info = memberInfo.get(row.userId);
        bucket.push({
          userId: row.userId,
          displayName: info?.displayName ?? row.userId,
          // Only the role-ids that the Raid-Planer cares about, so the
          // client can render "remove RDOC-CC" buttons only when the
          // user actually has it.
          currentCommanderRoleIds: info
            ? Array.from(info.roleIds).filter((r) => commanderRoleIds.has(r))
            : [],
          isBot: info?.isBot ?? false,
        });
      }
      channelMirror = allowedVoice.map((c) => ({
        channelId: c.id,
        channelName: c.name,
        members: membersByChannel.get(c.id) ?? [],
      }));
    }
    if (roles.length > 0 && commanderRoleIds.size > 0) {
      // Whitelist: only the commander roles configured via /admin/config.
      // The Raid-Planer's role-assign menu shows ONLY these — adding
      // arbitrary other roles isn't a workflow we expose.
      commanderRoles = roles
        .filter((r) => commanderRoleIds.has(r.id))
        .map((r) => ({ roleId: r.id, roleName: r.name }));
    }
  }

  return {
    guildId,
    guildName: guildInfo?.name ?? null,
    bridgeOk: true,
    botOk: guildInfo !== null,
    livekitOk,
    activeCommanders: snapshot.map((c) => ({
      userId: c.userId,
      displayName: nameByUserId.get(c.userId),
      speaking: c.speaking,
    })),
    commanderRoleMembers,
    enabled: cfg?.enabled ?? false,
    channelMirror,
    allVoiceChannels,
    commanderRoles,
    // Indicator role for the green/red name colour in Raid-Planer.
    // First entry in commanderRoleIds wins; admins re-order the
    // textarea in Konfig to pick which role lights up the names.
    ...(cfg?.commanderRoleIds[0]
      ? { primaryCommanderRoleId: cfg.commanderRoleIds[0] }
      : {}),
  };
}
