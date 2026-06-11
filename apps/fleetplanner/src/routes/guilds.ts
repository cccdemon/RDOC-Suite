import type { FastifyInstance, FastifyReply } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import { requireAuth, requireGuildRole } from "../auth/middleware.js";
import { installGuild, getMembership, listUserGuilds, deactivateGuild } from "../services/guilds.js";
import { runDiscordInstallDiagnostics } from "../services/discordDiagnostics.js";
import { countIncomingDistributions } from "../services/eventDistribution.js";
import { prisma } from "../db.js";
import { rawHtml, noGuildPage, guildSettingsPage, guildsListPage, guildDiagnosticsPage } from "../web/pages.js";

// Discord bot permissions bitfield:
// MANAGE_CHANNELS(4) | VIEW_CHANNEL(10) | SEND_MESSAGES(11) | READ_MESSAGE_HISTORY(16) |
// CONNECT(20) | MOVE_MEMBERS(24) | MANAGE_ROLES(28) | MANAGE_EVENTS(33) | ADD_EVENTS(44)
const BOT_PERMISSIONS =
  (1n << 4n) | (1n << 10n) | (1n << 11n) | (1n << 16n) |
  (1n << 20n) | (1n << 24n) | (1n << 28n) | (1n << 33n) |
  (1n << 44n);
const ACTIVE_GUILD_COOKIE = "fp_guild";

function setActiveGuild(reply: FastifyReply, guildId: string): void {
  reply.setCookie(ACTIVE_GUILD_COOKIE, guildId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

function htmlReply(reply: FastifyReply, page: import("../web/render.js").SafeHtml) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
}

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

export async function guildRoutes(app: FastifyInstance) {
  const env = getEnv();
  const botClientId = env.DISCORD_FLEETPLANNER_CLIENT_ID || env.DISCORD_CLIENT_ID;

  // ── Add bot to a Discord (self-service) ────────────────────────────
  app.get("/guilds/add", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    if (!botClientId) {
      return reply.redirect(basePath("/?flash=error:Bot+client+id+not+configured."), 302);
    }
    const redirectUri = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/guilds/added`;
    const p = new URLSearchParams({
      client_id: botClientId,
      scope: "bot applications.commands",
      permissions: BOT_PERMISSIONS.toString(),
      redirect_uri: redirectUri,
      response_type: "code",
    });
    return reply.redirect(`https://discord.com/oauth2/authorize?${p}`, 302);
  });

  // ── Bot-added callback (Discord redirects with ?guild_id=) ─────────
  app.get<{ Querystring: { guild_id?: string; error?: string } }>(
    "/guilds/added",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      const guildId = req.query.guild_id;
      if (req.query.error || !guildId) {
        return reply.redirect(basePath("/?flash=error:Bot+install+cancelled."), 302);
      }
      const installed = await installGuild(guildId, ctx.user.id);
      if (!installed.ok) {
        const msg =
          installed.reason === "banned"
            ? "This+Discord+is+banned+from+Fleetplanner."
            : "Could+not+read+guild+(is+the+bot+in+it?).";
        return reply.redirect(basePath(`/?flash=error:${msg}`), 302);
      }
      setActiveGuild(reply, installed.id);
      return reply.redirect(basePath(`/guilds/settings?flash=ok:${encodeURIComponent(installed.name)}+added.`), 302);
    }
  );

  // ── Servers list (switch / settings / add) ────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/guilds",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      const memberships = await listUserGuilds(ctx.user.id);
      htmlReply(reply, guildsListPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        guilds: memberships.map((m) => ({ guildId: m.guildId, role: m.role, guildName: m.guild.name })),
        activeGuildId: (req.cookies as Record<string, string | undefined>)[ACTIVE_GUILD_COOKIE] ?? null,
      }));
    }
  );

  // ── Switch active guild ─────────────────────────────────────────────
  app.post<{ Body: Record<string, string> }>(
    "/guilds/switch",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const guildId = req.body.guildId;
      const membership = guildId ? await getMembership(ctx.user.id, guildId) : null;
      if (!membership) {
        return reply.redirect(basePath("/?flash=error:Not+a+member+of+that+guild."), 302);
      }
      setActiveGuild(reply, guildId);
      if (req.body.next === "/guilds/settings") {
        return reply.redirect(basePath("/guilds/settings"), 302);
      }
      return reply.redirect(basePath("/?flash=ok:Switched+server."), 302);
    }
  );

  // ── "No guild yet" landing ──────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/guilds/none",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      // If they actually have a guild now, bounce home.
      const guilds = await listUserGuilds(ctx.user.id);
      if (guilds.length > 0) return reply.redirect(basePath("/"), 302);
      htmlReply(reply, noGuildPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
      }));
    }
  );

  // ── Guild settings (admiral of the active guild) ───────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/guilds/settings",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      const [guild, memberships, incomingShared] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma.guild.findUnique as any)({ where: { id: gctx.guildId }, select: {
          id: true, name: true, orgName: true, ownerUserId: true,
          admiralRoleId: true, discordInviteUrl: true, timezone: true,
        } }) as Promise<{ id: string; name: string; orgName: string | null; ownerUserId: string | null; admiralRoleId: string | null; discordInviteUrl: string | null; timezone: string } | null>,
        prisma.guildMembership.findMany({
          where: { guildId: gctx.guildId },
          include: {
            user: {
              include: {
                identities: {
                  where: { provider: "discord" },
                  select: { providerId: true, username: true },
                  take: 1,
                },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        }),
        countIncomingDistributions(gctx.guildId),
      ]);
      if (!guild) return reply.redirect(basePath("/guilds/none"), 302);
      const canRemove = guild.ownerUserId === gctx.user.id || gctx.user.role === "superadmin";
      htmlReply(reply, guildSettingsPage({
        basePath: basePath(),
        currentUser: gctx.user,
        csrfToken: gctx.csrfToken,
        flash: req.query.flash,
        guild,
        incomingShared,
        memberships,
        activeGuildId: gctx.guildId,
        activeGuildName: gctx.guildName,
        canRemove,
        superadminContact: env.SUPERADMIN_CONTACT,
      }));
    }
  );

  app.get<{ Querystring: { flash?: string } }>(
    "/guilds/diagnostics",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      const diagnostics = await runDiscordInstallDiagnostics(gctx.guildId);
      htmlReply(reply, guildDiagnosticsPage({
        basePath: basePath(),
        currentUser: gctx.user,
        csrfToken: gctx.csrfToken,
        flash: req.query.flash,
        diagnostics,
        activeGuildId: gctx.guildId,
        activeGuildName: gctx.guildName,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/guilds/settings",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const snowflake = (v: string | undefined) => (v && /^\d{16,25}$/.test(v.trim()) ? v.trim() : null);
      // Permanent Discord invite link: accept only real discord invite URLs,
      // otherwise clear it (empty input removes the link).
      const inviteUrl = (v: string | undefined): string | null => {
        const t = (v ?? "").trim();
        if (!t) return null;
        return /^https:\/\/(discord\.gg|(www\.)?discord(app)?\.com\/invite)\/[A-Za-z0-9-]+$/.test(t)
          ? t
          : null;
      };
      const { isValidTimezone, DEFAULT_TIMEZONE } = await import("../lib/timezone.js");
      const tz = req.body.timezone?.trim() ?? "";
      const validatedTz = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.guild.update as any)({
        where: { id: gctx.guildId },
        data: {
          admiralRoleId: snowflake(req.body.admiralRoleId),
          discordInviteUrl: inviteUrl(req.body.discordInviteUrl),
          orgName: ((v) => (v ? v.slice(0, 80) : null))((req.body.orgName ?? "").trim()),
          timezone: validatedTz,
        },
      });
      return reply.redirect(basePath("/guilds/settings?flash=ok:Server+settings+saved."), 302);
    }
  );

  // ── Remove (soft-deactivate) a server from Fleetplanner ─────────────
  // Owner of the guild or instance superadmin only. Data is retained
  // (active=false); re-adding the bot reactivates it unless banned.
  app.post<{ Body: Record<string, string> }>(
    "/guilds/remove",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const guildId = req.body.guildId?.trim();
      if (!guildId) return reply.redirect(basePath("/guilds/settings?flash=error:Missing+guild+id"), 302);
      const guild = await prisma.guild.findUnique({
        where: { id: guildId },
        select: { ownerUserId: true, name: true },
      });
      if (!guild) return reply.redirect(basePath("/guilds?flash=error:Server+not+found."), 302);
      const allowed = guild.ownerUserId === ctx.user.id || ctx.user.role === "superadmin";
      if (!allowed) return reply.code(403).send({ error: "forbidden" });
      await deactivateGuild(guildId);
      // Drop the active-guild cookie if it pointed at the removed server.
      if ((req.cookies as Record<string, string | undefined>)[ACTIVE_GUILD_COOKIE] === guildId) {
        reply.clearCookie(ACTIVE_GUILD_COOKIE, { path: "/" });
      }
      return reply.redirect(
        basePath(`/guilds?flash=ok:${encodeURIComponent(`${guild.name} removed.`)}`),
        302,
      );
    },
  );

  // ── Set a member's role within the active guild ─────────────────────
  app.post<{ Params: { userId: string }; Body: Record<string, string> }>(
    "/guilds/members/:userId/role",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const valid = ["fleetoperator", "crew"];
      const role = req.body.role;
      if (!valid.includes(role)) return reply.code(400).send("Invalid role");
      await prisma.guildMembership.updateMany({
        where: { guildId: gctx.guildId, userId: req.params.userId },
        data: { role },
      });
      return reply.redirect(basePath("/guilds/settings?flash=ok:Member+role+updated."), 302);
    }
  );
}
