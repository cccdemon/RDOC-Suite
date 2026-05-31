import type { FastifyInstance, FastifyReply } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import { requireAuth, requireGuildRole } from "../auth/middleware.js";
import { installGuild, getMembership, listUserGuilds } from "../services/guilds.js";
import { addGuildVoiceBot, deleteGuildVoiceBot, updateGuildVoiceBot } from "../services/voiceBots.js";
import { runDiscordInstallDiagnostics } from "../services/discordDiagnostics.js";
import { prisma } from "../db.js";
import { rawHtml, noGuildPage, guildSettingsPage, guildsListPage, guildDiagnosticsPage } from "../web/pages.js";

// Discord bot permissions bitfield:
// MANAGE_CHANNELS(4) | VIEW_CHANNEL(10) | SEND_MESSAGES(11) | READ_MESSAGE_HISTORY(16) |
// CONNECT(20) | MOVE_MEMBERS(24) | MANAGE_ROLES(28) | MANAGE_EVENTS(33)
const BOT_PERMISSIONS =
  (1n << 4n) | (1n << 10n) | (1n << 11n) | (1n << 16n) |
  (1n << 20n) | (1n << 24n) | (1n << 28n) | (1n << 33n);
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
      if (!installed) {
        return reply.redirect(basePath("/?flash=error:Could+not+read+guild+(is+the+bot+in+it?)."), 302);
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
      const [guild, memberships, voiceBots] = await Promise.all([
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (prisma.guild.findUnique as any)({ where: { id: gctx.guildId }, select: {
          id: true, name: true, eventChannelId: true, voiceChannelCategoryId: true,
          admiralRoleId: true, captainRoleId: true, globalVoiceRoleId: true,
          commanderVoiceRoleId: true, voiceEnabled: true,
        } }) as Promise<{ id: string; name: string; eventChannelId: string | null; voiceChannelCategoryId: string | null; admiralRoleId: string | null; captainRoleId: string | null; globalVoiceRoleId: string | null; commanderVoiceRoleId: string | null; voiceEnabled: boolean } | null>,
        prisma.guildMembership.findMany({
          where: { guildId: gctx.guildId },
          include: { user: true },
          orderBy: { createdAt: "asc" },
        }),
        prisma.guildVoiceBot.findMany({
          where: { guildId: gctx.guildId },
          select: {
            id: true,
            label: true,
            botUserId: true,
            assignedChannelId: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);
      if (!guild) return reply.redirect(basePath("/guilds/none"), 302);
      htmlReply(reply, guildSettingsPage({
        basePath: basePath(),
        currentUser: gctx.user,
        csrfToken: gctx.csrfToken,
        flash: req.query.flash,
        guild,
        memberships,
        voiceBots,
        activeGuildId: gctx.guildId,
        activeGuildName: gctx.guildName,
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.guild.update as any)({
        where: { id: gctx.guildId },
        data: {
          eventChannelId: snowflake(req.body.eventChannelId),
          voiceChannelCategoryId: snowflake(req.body.voiceChannelCategoryId),
          admiralRoleId: snowflake(req.body.admiralRoleId),
          captainRoleId: snowflake(req.body.captainRoleId),
          globalVoiceRoleId: snowflake(req.body.globalVoiceRoleId),
          commanderVoiceRoleId: snowflake(req.body.commanderVoiceRoleId),
        },
      });
      return reply.redirect(basePath("/guilds/settings?flash=ok:Server+settings+saved."), 302);
    }
  );

  // SuperAdmin-only: grant or revoke RDOC Voice Permission for the active guild
  app.post<{ Body: Record<string, string> }>(
    "/guilds/settings/voice-permission",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (ctx.user.role !== "superadmin") return reply.code(403).send({ error: "superadmin only" });
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const guildId = req.body.guildId?.trim();
      if (!guildId) return reply.redirect(basePath("/guilds/settings?flash=error:Missing+guild+id"), 302);
      const enabled = req.body.voiceEnabled === "1";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.guild.update as any)({ where: { id: guildId }, data: { voiceEnabled: enabled } });
      const msg = enabled ? "RDOC+Voice+Permission+granted." : "RDOC+Voice+Permission+revoked.";
      return reply.redirect(basePath(`/guilds/settings?flash=ok:${msg}`), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/guilds/voice-bots",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      try {
        await addGuildVoiceBot({
          guildId: gctx.guildId,
          label: req.body.label ?? "",
          botUserId: req.body.botUserId ?? "",
          token: req.body.botToken ?? "",
        });
        return reply.redirect(basePath("/guilds/settings?flash=ok:Voice+bot+saved."), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save voice bot";
        return reply.redirect(basePath(`/guilds/settings?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/guilds/voice-bots/:id/edit",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      try {
        await updateGuildVoiceBot(gctx.guildId, req.params.id, {
          label: req.body.label,
          token: req.body.botToken,
        });
        return reply.redirect(basePath("/guilds/settings?flash=ok:Voice+bot+updated."), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to update voice bot";
        return reply.redirect(basePath(`/guilds/settings?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/guilds/voice-bots/:id/delete",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      await deleteGuildVoiceBot(gctx.guildId, req.params.id);
      return reply.redirect(basePath("/guilds/settings?flash=ok:Voice+bot+removed."), 302);
    }
  );

  // ── Set a member's role within the active guild ─────────────────────
  app.post<{ Params: { userId: string }; Body: Record<string, string> }>(
    "/guilds/members/:userId/role",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const valid = ["fleetoperator", "captain", "crew"];
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
