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
  type AdminRole,
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
}
