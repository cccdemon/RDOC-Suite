import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { basePath } from "../config/env.js";
import { prisma } from "../db.js";
import { rawHtml } from "../web/render.js";
import {
  bridgeAdminOverviewPage,
  bridgeGuildConfigPage,
  bridgeMonitoringPage,
  bridgeAuditPage,
  bridgeDashboardPage,
  bridgeSessionsPage,
  bridgeSessionDetailPage,
  bridgeRelayBotsPage,
  bridgeDiscordVoicePage,
} from "../web/pages.js";
import {
  bridgeConfigured,
  getBridgeGuildConfig,
  saveBridgeGuildConfig,
  listBridgeAdmins,
  addBridgeAdmin,
  removeBridgeAdmin,
  getBridgeMonitoring,
  getBridgeAudit,
  getBridgeDashboard,
  stripBridgeCommanderRoles,
  listBridgeSessions,
  createBridgeSession,
  getBridgeSession,
  endBridgeSession,
  mintBridgeSessionInvite,
  revokeBridgeSessionInvite,
  getBridgeRelayConfig,
  saveBridgeRelayConfig,
  restartBridgeRelayBots,
  getBridgeVoiceStates,
  getBridgeDiscordRoles,
  moveBridgeMember,
  addBridgeMemberRole,
  removeBridgeMemberRole,
  type AdminRole,
  type RelayBotEntry,
} from "../services/bridge.js";

const SNOWFLAKE = /^[0-9]{17,20}$/;

function htmlReply(reply: import("fastify").FastifyReply, page: import("../web/render.js").SafeHtml) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
}

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

/** Parse a textarea of IDs (newline or comma separated) → unique snowflakes. */
function parseIdList(raw: string | undefined): string[] {
  if (!raw) return [];
  const ids = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter((s) => SNOWFLAKE.test(s));
  return [...new Set(ids)];
}

async function guildName(guildId: string): Promise<string> {
  const g = await prisma.guild.findUnique({ where: { id: guildId } });
  return g?.name ?? guildId;
}

/**
 * Fleetplanner superadmin section for managing the voice-bridge guild
 * config + admins via the bridge internal API (BRIDGE_FLEET_SECRET).
 * All routes are superadmin-gated; they 404 when the bridge is not
 * configured so the surface stays hidden in single-service deployments.
 */
export async function bridgeAdminRoutes(app: FastifyInstance): Promise<void> {
  // Block the whole section unless the bridge integration is configured.
  // Routes are registered WITHOUT the PUBLIC_BASE_PATH prefix (Traefik
  // strips /fleetplanner before forwarding), so match the raw path.
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/admin/bridge") && !bridgeConfigured()) {
      reply.code(404).send({ error: "bridge_not_configured" });
    }
  });

  // ── Overview ─────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>("/admin/bridge", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    const guilds = await prisma.guild.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    const rows = await Promise.all(
      guilds.map(async (g) => {
        try {
          const cfg = await getBridgeGuildConfig(g.id);
          return { guildId: g.id, name: g.name, enabled: cfg?.enabled ?? false };
        } catch (err) {
          return { guildId: g.id, name: g.name, enabled: null, error: String(err instanceof Error ? err.message : err) };
        }
      }),
    );
    htmlReply(reply, bridgeAdminOverviewPage({
      basePath: basePath(),
      currentUser: ctx.user,
      csrfToken: ctx.csrfToken,
      flash: req.query.flash,
      guilds: rows,
    }));
  });

  // ── Guild detail ─────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string } }>(
    "/admin/bridge/:guildId",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      try {
        const [cfg, admins, name] = await Promise.all([
          getBridgeGuildConfig(guildId),
          listBridgeAdmins(guildId),
          guildName(guildId),
        ]);
        htmlReply(reply, bridgeGuildConfigPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          flash: req.query.flash,
          guildId,
          guildName: name,
          config: {
            enabled: cfg?.enabled ?? false,
            commanderRoleIds: cfg?.commanderRoleIds ?? [],
            allowedVoiceChannelIds: cfg?.allowedVoiceChannelIds ?? [],
            bridgeMode: cfg?.bridgeMode ?? "external_voice",
          },
          admins: admins.map((a) => ({
            userId: a.userId,
            role: a.role,
            protected: a.protected,
            addedBy: a.addedBy,
          })),
        }));
      } catch (err) {
        app.log.error(err, "bridge guild detail failed");
        return reply.redirect(basePath(`/admin/bridge?flash=error:Bridge+unreachable`), 302);
      }
    },
  );

  // ── Save config ──────────────────────────────────────────────────
  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      try {
        await saveBridgeGuildConfig(guildId, {
          enabled: req.body.enabled === "1",
          commanderRoleIds: parseIdList(req.body.commanderRoleIds),
          allowedVoiceChannelIds: parseIdList(req.body.allowedVoiceChannelIds),
        });
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=ok:Config+saved.`), 302);
      } catch (err) {
        app.log.error(err, "bridge save config failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Save+failed+(bridge+unreachable).`), 302);
      }
    },
  );

  // ── Add admin ────────────────────────────────────────────────────
  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/admins",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const userId = req.body.userId?.trim() ?? "";
      const role: AdminRole = req.body.role === "admiral" ? "admiral" : "vice_admiral";
      if (!SNOWFLAKE.test(userId)) {
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Invalid+Discord+user+ID.`), 302);
      }
      try {
        await addBridgeAdmin(guildId, userId, role);
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=ok:Admin+added.`), 302);
      } catch (err) {
        app.log.error(err, "bridge add admin failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Add+failed+(bridge+unreachable).`), 302);
      }
    },
  );

  // ── Remove admin ─────────────────────────────────────────────────
  app.post<{ Params: { guildId: string; userId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/admins/:userId/delete",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, userId } = req.params;
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) {
        return reply.code(400).send("Invalid ID");
      }
      try {
        await removeBridgeAdmin(guildId, userId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=ok:Admin+removed.`), 302);
      } catch (err) {
        app.log.error(err, "bridge remove admin failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Remove+failed+(bridge+unreachable).`), 302);
      }
    },
  );

  // ── Monitoring ───────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/admin/bridge/:guildId/monitoring",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const snapshot = await getBridgeMonitoring(guildId);
        htmlReply(reply, bridgeMonitoringPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          guildId,
          guildName: name,
          snapshot,
        }));
      } catch (err) {
        htmlReply(reply, bridgeMonitoringPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          guildId,
          guildName: name,
          snapshot: null,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
  );

  // ── Audit ────────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { limit?: string; offset?: string } }>(
    "/admin/bridge/:guildId/audit",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      const limit = Math.min(Math.max(Number.parseInt(req.query.limit ?? "100", 10) || 100, 1), 500);
      const offset = Math.max(Number.parseInt(req.query.offset ?? "0", 10) || 0, 0);
      try {
        const { entries, total } = await getBridgeAudit(guildId, { limit, offset });
        htmlReply(reply, bridgeAuditPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          guildId,
          guildName: name,
          entries: entries.map((e) => ({
            id: e.id,
            actorLabel: e.actorLabel,
            actorUserId: e.actorUserId,
            action: e.action,
            target: e.target,
            createdAt: e.createdAt,
          })),
          total,
          limit,
          offset,
        }));
      } catch (err) {
        htmlReply(reply, bridgeAuditPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          guildId,
          guildName: name,
          entries: [],
          total: 0,
          limit,
          offset,
          error: String(err instanceof Error ? err.message : err),
        }));
      }
    },
  );

  // ── Dashboard ────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string } }>(
    "/admin/bridge/:guildId/dashboard",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const dashboard = await getBridgeDashboard(guildId);
        htmlReply(reply, bridgeDashboardPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, dashboard,
        }));
      } catch (err) {
        htmlReply(reply, bridgeDashboardPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, dashboard: null,
          error: errMsg(err),
        }));
      }
    },
  );

  app.post<{ Params: { guildId: string; userId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/commander-roles/:userId/strip",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, userId } = req.params;
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return reply.code(400).send("Invalid ID");
      try {
        await stripBridgeCommanderRoles(guildId, userId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/dashboard?flash=ok:Commander+roles+stripped.`), 302);
      } catch (err) {
        app.log.error(err, "bridge strip commander roles failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/dashboard?flash=error:Strip+failed.`), 302);
      }
    },
  );

  // ── Sessions ─────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string } }>(
    "/admin/bridge/:guildId/sessions",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const sessions = await listBridgeSessions(guildId);
        htmlReply(reply, bridgeSessionsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          sessions: sessions.map((s) => ({ id: s.id, label: s.label, status: s.status, createdAt: s.createdAt, inviteCount: s.inviteCount })),
        }));
      } catch (err) {
        htmlReply(reply, bridgeSessionsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, sessions: [], error: errMsg(err),
        }));
      }
    },
  );

  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/sessions",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const label = req.body.label?.trim().slice(0, 80) ?? "";
      if (!label) return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=error:Label+required.`), 302);
      try {
        await createBridgeSession(guildId, label);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=ok:Session+created.`), 302);
      } catch (err) {
        app.log.error(err, "bridge create session failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=error:Create+failed.`), 302);
      }
    },
  );

  app.get<{ Params: { guildId: string; sessionId: string }; Querystring: { flash?: string; fresh_token?: string; fresh_label?: string } }>(
    "/admin/bridge/:guildId/sessions/:sessionId",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId, sessionId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      try {
        const result = await getBridgeSession(guildId, sessionId);
        if (!result) return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=error:Session+not+found.`), 302);
        const fresh = req.query.fresh_token && req.query.fresh_label
          ? { plaintext: req.query.fresh_token, label: decodeURIComponent(req.query.fresh_label) }
          : undefined;
        htmlReply(reply, bridgeSessionDetailPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken, flash: req.query.flash,
          guildId, guildName: await guildName(guildId),
          session: { id: result.session.id, label: result.session.label, status: result.session.status, createdAt: result.session.createdAt, livekitRoom: result.session.livekitRoom },
          invites: result.invites,
          freshInvite: fresh,
        }));
      } catch (err) {
        app.log.error(err, "bridge session detail failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=error:Bridge+unreachable.`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/sessions/:sessionId/end",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, sessionId } = req.params;
      try {
        await endBridgeSession(guildId, sessionId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=ok:Session+ended.`), 302);
      } catch (err) {
        app.log.error(err, "bridge end session failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions?flash=error:End+failed.`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/sessions/:sessionId/invites",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, sessionId } = req.params;
      const label = req.body.label?.trim().slice(0, 80) ?? "";
      const ttlHours = req.body.ttlHours ? Number.parseInt(req.body.ttlHours, 10) : undefined;
      if (!label) return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions/${sessionId}?flash=error:Label+required.`), 302);
      try {
        const invite = await mintBridgeSessionInvite(guildId, sessionId, label, ttlHours && ttlHours > 0 ? ttlHours : undefined);
        return reply.redirect(
          basePath(`/admin/bridge/${guildId}/sessions/${sessionId}?fresh_token=${encodeURIComponent(invite.plaintext)}&fresh_label=${encodeURIComponent(invite.label)}`),
          302,
        );
      } catch (err) {
        app.log.error(err, "bridge mint invite failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions/${sessionId}?flash=error:Mint+failed.`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string; inviteId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/sessions/:sessionId/invites/:inviteId/revoke",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, sessionId, inviteId } = req.params;
      try {
        await revokeBridgeSessionInvite(guildId, sessionId, inviteId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions/${sessionId}?flash=ok:Invite+revoked.`), 302);
      } catch (err) {
        app.log.error(err, "bridge revoke invite failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/sessions/${sessionId}?flash=error:Revoke+failed.`), 302);
      }
    },
  );

  // ── Relay bots ───────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string } }>(
    "/admin/bridge/:guildId/relay-bots",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const config = await getBridgeRelayConfig();
        htmlReply(reply, bridgeRelayBotsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, config,
        }));
      } catch (err) {
        htmlReply(reply, bridgeRelayBotsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, config: null, error: errMsg(err),
        }));
      }
    },
  );

  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/relay-bots/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      let bots: RelayBotEntry[];
      try {
        const parsed: unknown = JSON.parse(req.body.botsJson || "[]");
        if (!Array.isArray(parsed)) throw new Error("bots must be an array");
        bots = parsed.map((b) => {
          const o = b as Record<string, unknown>;
          if (typeof o.name !== "string" || typeof o.token !== "string" || typeof o.channelId !== "string") {
            throw new Error("each bot needs name, token, channelId");
          }
          return { name: o.name, token: o.token, channelId: o.channelId };
        });
      } catch (e) {
        return reply.redirect(basePath(`/admin/bridge/${guildId}/relay-bots?flash=error:Invalid+bots+JSON.`), 302);
      }
      try {
        await saveBridgeRelayConfig({
          livekitUrl: req.body.livekitUrl?.trim() ?? "",
          livekitApiKey: req.body.livekitApiKey?.trim() ?? "",
          livekitApiSecret: req.body.livekitApiSecret?.trim() ?? "",
          roomName: req.body.roomName?.trim() || "voice-relay",
          guildId: req.body.guildId?.trim() ?? "",
          bots,
        });
        return reply.redirect(basePath(`/admin/bridge/${guildId}/relay-bots?flash=ok:Relay+config+saved.`), 302);
      } catch (err) {
        app.log.error(err, "bridge save relay config failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/relay-bots?flash=error:Save+failed+(check+LiveKit+URL).`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/relay-bots/restart",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      try {
        await restartBridgeRelayBots();
        return reply.redirect(basePath(`/admin/bridge/${guildId}/relay-bots?flash=ok:Restart+requested.`), 302);
      } catch (err) {
        app.log.error(err, "bridge relay restart failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/relay-bots?flash=error:Restart+failed.`), 302);
      }
    },
  );

  // ── Discord voice ────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string } }>(
    "/admin/bridge/:guildId/discord-voice",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const [voice, roles] = await Promise.all([
          getBridgeVoiceStates(guildId),
          getBridgeDiscordRoles(guildId),
        ]);
        htmlReply(reply, bridgeDiscordVoicePage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          channels: voice.channels, roles, members: voice.voiceStates, offline: voice.offline,
        }));
      } catch (err) {
        htmlReply(reply, bridgeDiscordVoicePage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          channels: [], roles: [], members: [], error: errMsg(err),
        }));
      }
    },
  );

  app.post<{ Params: { guildId: string; userId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/discord-voice/move/:userId",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, userId } = req.params;
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return reply.code(400).send("Invalid ID");
      const channelId = req.body.channelId?.trim() || null;
      try {
        await moveBridgeMember(guildId, userId, channelId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/discord-voice?flash=ok:Member+moved.`), 302);
      } catch (err) {
        app.log.error(err, "bridge move member failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/discord-voice?flash=error:Move+failed.`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; userId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/discord-voice/role/:userId",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, userId } = req.params;
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return reply.code(400).send("Invalid ID");
      const roleId = req.body.roleId?.trim() ?? "";
      const action = req.body.action === "remove" ? "remove" : "add";
      if (!SNOWFLAKE.test(roleId)) return reply.redirect(basePath(`/admin/bridge/${guildId}/discord-voice?flash=error:Invalid+role.`), 302);
      try {
        if (action === "add") await addBridgeMemberRole(guildId, userId, roleId);
        else await removeBridgeMemberRole(guildId, userId, roleId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/discord-voice?flash=ok:Role+${action === "add" ? "added" : "removed"}.`), 302);
      } catch (err) {
        app.log.error(err, "bridge role change failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/discord-voice?flash=error:Role+change+failed.`), 302);
      }
    },
  );
}

function errMsg(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}
