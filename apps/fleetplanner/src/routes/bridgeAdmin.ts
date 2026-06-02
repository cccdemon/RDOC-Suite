import type { FastifyInstance } from "fastify";
import { requireRole } from "../auth/middleware.js";
import { applyChannelReorder } from "../services/bridgeVoiceOrder.js";
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
  bridgeDownloadsPage,
} from "../web/pages.js";
import {
  bridgeConfigured,
  getBridgeGuildConfig,
  saveBridgeGuildConfig,
  listBridgeAdmins,
  addBridgeAdmin,
  removeBridgeAdmin,
  setBridgeAdminRole,
  listBridgeInvites,
  mintBridgeInvite,
  revokeBridgeInvite,
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
  getBridgeGlobalSettings,
  saveBridgeGlobalSettings,
  getBridgeRelayConfig,
  saveBridgeRelayConfig,
  restartBridgeRelayBots,
  getBridgeRelayMetrics,
  listCompanionDownloads,
  mintCompanionDownload,
  revokeCompanionDownload,
  getCompanionRelease,
  dmBridgeDownloadLink,
  getBridgeVoiceStates,
  getBridgeDiscordRoles,
  moveBridgeMember,
  addBridgeMemberRole,
  removeBridgeMemberRole,
  reorderBridgeChannels,
  createBridgeStrategyChannel,
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
    let globalSettings: Awaited<ReturnType<typeof getBridgeGlobalSettings>> | null = null;
    try {
      globalSettings = await getBridgeGlobalSettings();
    } catch {
      globalSettings = null; // bridge unreachable — hide the card
    }
    htmlReply(reply, bridgeAdminOverviewPage({
      basePath: basePath(),
      currentUser: ctx.user,
      csrfToken: ctx.csrfToken,
      flash: req.query.flash,
      guilds: rows,
      globalSettings,
    }));
  });

  // ── Raumdock global gates (save) ─────────────────────────────────
  app.post<{ Body: Record<string, string> }>("/admin/bridge/global-settings", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
    const pick = (v: string | undefined): string | null => {
      const t = (v ?? "").trim();
      return t === "" ? null : t;
    };
    // Validate snowflakes (empty allowed → clears the gate).
    for (const key of ["raumdockGuildId", "bridgeRequiredRoleId", "relayRequiredRoleId"] as const) {
      const v = pick(req.body[key]);
      if (v !== null && !SNOWFLAKE.test(v)) {
        return reply.redirect(basePath(`/admin/bridge?flash=error:Invalid+${key}.`), 302);
      }
    }
    try {
      await saveBridgeGlobalSettings(
        {
          raumdockGuildId: pick(req.body.raumdockGuildId),
          bridgeRequiredRoleId: pick(req.body.bridgeRequiredRoleId),
          relayRequiredRoleId: pick(req.body.relayRequiredRoleId),
        },
        ctx.user.id,
      );
      return reply.redirect(basePath(`/admin/bridge?flash=ok:Global+settings+saved.`), 302);
    } catch {
      return reply.redirect(
        basePath(`/admin/bridge?flash=error:Save+failed+(bridge+unreachable).`),
        302,
      );
    }
  });

  // ── Guild detail ─────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string; fresh_url?: string; fresh_role?: string } }>(
    "/admin/bridge/:guildId",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      try {
        const [cfg, admins, invites, name] = await Promise.all([
          getBridgeGuildConfig(guildId),
          listBridgeAdmins(guildId),
          listBridgeInvites(guildId),
          guildName(guildId),
        ]);
        const freshInvite = req.query.fresh_url
          ? { url: decodeURIComponent(req.query.fresh_url), role: req.query.fresh_role ?? "vice_admiral" }
          : undefined;
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
          invites: invites.map((inv) => ({
            id: inv.id,
            label: inv.label,
            role: inv.role,
            expiresAt: inv.expiresAt,
            usedAt: inv.usedAt,
            usedBy: inv.usedBy,
          })),
          freshInvite,
        }));
      } catch (err) {
        app.log.error(err, "bridge guild detail failed");
        return reply.redirect(basePath(`/admin/bridge?flash=error:Bridge+unreachable`), 302);
      }
    },
  );

  // ── Change admin role ────────────────────────────────────────────
  app.post<{ Params: { guildId: string; userId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/admins/:userId/role",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, userId } = req.params;
      if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return reply.code(400).send("Invalid ID");
      const role: AdminRole = req.body.role === "admiral" ? "admiral" : "vice_admiral";
      try {
        await setBridgeAdminRole(guildId, userId, role);
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=ok:Role+updated.`), 302);
      } catch (err) {
        app.log.error(err, "bridge set admin role failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Role+change+failed.`), 302);
      }
    },
  );

  // ── Admin invite links ───────────────────────────────────────────
  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/invites",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const label = req.body.label?.trim().slice(0, 120) ?? "";
      const role: AdminRole = req.body.role === "admiral" ? "admiral" : "vice_admiral";
      const ttlDays = req.body.ttlDays ? Number.parseInt(req.body.ttlDays, 10) : undefined;
      if (!label) return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Label+required.`), 302);
      try {
        const invite = await mintBridgeInvite(guildId, label, role, ttlDays && ttlDays > 0 ? ttlDays : undefined);
        return reply.redirect(
          basePath(`/admin/bridge/${guildId}?fresh_url=${encodeURIComponent(invite.url)}&fresh_role=${invite.role}`),
          302,
        );
      } catch (err) {
        app.log.error(err, "bridge mint invite failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Mint+failed.`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; id: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/invites/:id/revoke",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, id } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      try {
        await revokeBridgeInvite(guildId, id);
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=ok:Invite+revoked.`), 302);
      } catch (err) {
        app.log.error(err, "bridge revoke invite failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}?flash=error:Revoke+failed.`), 302);
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
        const config = await getBridgeRelayConfig(guildId);
        // Metrics are best-effort — never fail the page if the service is down.
        const metrics = await getBridgeRelayMetrics().catch(() => ({ offline: true }));
        htmlReply(reply, bridgeRelayBotsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name, config, metrics,
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
        await saveBridgeRelayConfig(guildId, {
          livekitUrl: req.body.livekitUrl?.trim() ?? "",
          livekitApiKey: req.body.livekitApiKey?.trim() ?? "",
          livekitApiSecret: req.body.livekitApiSecret?.trim() ?? "",
          roomName: req.body.roomName?.trim() || "voice-relay",
          guildId,
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
        const [voice, roles, cfg] = await Promise.all([
          getBridgeVoiceStates(guildId),
          getBridgeDiscordRoles(guildId),
          getBridgeGuildConfig(guildId).catch(() => null),
        ]);
        // Allowed voice channels in current Discord display order. voice.channels
        // comes back in position order from the bridge cache; intersect with the
        // guild's allowed list so reorder only touches managed channels.
        const allowedSet = new Set(cfg?.allowedVoiceChannelIds ?? []);
        const allowedChannels = voice.channels.filter((c) => allowedSet.has(c.id));
        htmlReply(reply, bridgeDiscordVoicePage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          channels: voice.channels, roles, members: voice.voiceStates, offline: voice.offline,
          allowedChannels,
        }));
      } catch (err) {
        htmlReply(reply, bridgeDiscordVoicePage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          channels: [], roles: [], members: [], allowedChannels: [], error: errMsg(err),
        }));
      }
    },
  );

  // Reorder allowed voice channels. The page submits the full current order
  // (CSV) plus a single ▲/▼ directive; we swap the target with its neighbour
  // and push the new order to the bridge.
  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/discord-voice/reorder",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const channelId = req.body.channelId?.trim() ?? "";
      const dir = req.body.dir === "up" ? "up" : "down";
      const back = `${basePath(`/admin/bridge/${guildId}/discord-voice`)}`;
      const order = applyChannelReorder(req.body.ordered ?? "", channelId, dir);
      if (!order) {
        return reply.redirect(`${back}?flash=error:Cannot+move+channel.`, 302);
      }
      try {
        await reorderBridgeChannels(guildId, order);
        return reply.redirect(`${back}?flash=ok:Channels+reordered.`, 302);
      } catch (err) {
        app.log.error(err, "bridge channel reorder failed");
        return reply.redirect(`${back}?flash=error:Reorder+failed.`, 302);
      }
    },
  );

  // Create a temporary strategy voice channel and pull the selected members in.
  app.post<{ Params: { guildId: string }; Body: Record<string, string | string[]> }>(
    "/admin/bridge/:guildId/discord-voice/strategy",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const back = `${basePath(`/admin/bridge/${guildId}/discord-voice`)}`;
      const name = (typeof req.body.name === "string" ? req.body.name : "").trim().slice(0, 100);
      const raw = req.body.userIds;
      const userIds = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((s) => SNOWFLAKE.test(s));
      if (!name) return reply.redirect(`${back}?flash=error:Channel+name+required.`, 302);
      if (userIds.length === 0) return reply.redirect(`${back}?flash=error:Select+at+least+one+member.`, 302);
      try {
        const result = await createBridgeStrategyChannel(guildId, name, userIds);
        const failed = result.moveFailures.length;
        const note = failed > 0 ? `+(${String(failed)}+move+failures)` : "";
        return reply.redirect(`${back}?flash=ok:Strategy+channel+%22${encodeURIComponent(result.name)}%22+created${note}.`, 302);
      } catch (err) {
        app.log.error(err, "bridge strategy channel failed");
        return reply.redirect(`${back}?flash=error:Strategy+channel+failed.`, 302);
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

  // ── Companion downloads ──────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { flash?: string; fresh_url?: string } }>(
    "/admin/bridge/:guildId/downloads",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const { guildId } = req.params;
      if (!SNOWFLAKE.test(guildId)) return reply.code(400).send("Invalid guild ID");
      const name = await guildName(guildId);
      try {
        const [{ tokens, configured }, release] = await Promise.all([
          listCompanionDownloads(guildId),
          getCompanionRelease().catch(() => ({ configured: false, release: null })),
        ]);
        htmlReply(reply, bridgeDownloadsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          configured, tokens, release: release.release,
          freshUrl: req.query.fresh_url ? decodeURIComponent(req.query.fresh_url) : undefined,
        }));
      } catch (err) {
        htmlReply(reply, bridgeDownloadsPage({
          basePath: basePath(), currentUser: ctx.user, csrfToken: ctx.csrfToken,
          flash: req.query.flash, guildId, guildName: name,
          configured: false, tokens: [], release: null, error: errMsg(err),
        }));
      }
    },
  );

  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/downloads",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      const label = req.body.label?.trim().slice(0, 120) ?? "";
      if (!label) return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=error:Label+required.`), 302);
      try {
        const minted = await mintCompanionDownload(guildId, label);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?fresh_url=${encodeURIComponent(minted.url)}`), 302);
      } catch (err) {
        app.log.error(err, "bridge mint download failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=error:Mint+failed+(GITHUB_REPO+set%3F).`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/downloads/dm",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId } = req.params;
      const userId = req.body.userId?.trim() ?? "";
      if (!SNOWFLAKE.test(userId)) return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=error:Invalid+user+ID.`), 302);
      try {
        await dmBridgeDownloadLink(guildId, userId);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=ok:Download+link+DMed.`), 302);
      } catch (err) {
        app.log.error(err, "bridge dm download failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=error:DM+failed+(user+DMs+closed%3F).`), 302);
      }
    },
  );

  app.post<{ Params: { guildId: string; id: string }; Body: Record<string, string> }>(
    "/admin/bridge/:guildId/downloads/:id/revoke",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { guildId, id } = req.params;
      try {
        await revokeCompanionDownload(guildId, id);
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=ok:Token+revoked.`), 302);
      } catch (err) {
        app.log.error(err, "bridge revoke download failed");
        return reply.redirect(basePath(`/admin/bridge/${guildId}/downloads?flash=error:Revoke+failed.`), 302);
      }
    },
  );
}

function errMsg(err: unknown): string {
  return String(err instanceof Error ? err.message : err);
}
