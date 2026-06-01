import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getPrisma } from "@rdoc-suite/db";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import { readGuildConfig, saveGuildConfig } from "../services/guildConfig.js";
import { addAdmin, listAdmins } from "../services/admins.js";
import { monitoringSnapshot } from "../services/monitoring.js";
import { listRecentAudit, countAudit } from "../services/audit.js";

const SNOWFLAKE = /^[0-9]{17,20}$/;

const guildParamsSchema = z.object({
  guildId: z.string().regex(SNOWFLAKE, "guildId must be a Discord snowflake"),
});

const configBodySchema = z.object({
  enabled: z.boolean().optional(),
  commanderRoleIds: z.array(z.string().regex(SNOWFLAKE)).optional(),
  allowedVoiceChannelIds: z.array(z.string().regex(SNOWFLAKE)).optional(),
});

const addAdminBodySchema = z.object({
  userId: z.string().regex(SNOWFLAKE, "userId must be a Discord snowflake"),
  role: z.enum(["admiral", "vice_admiral"]),
});

const adminParamsSchema = z.object({
  guildId: z.string().regex(SNOWFLAKE, "guildId must be a Discord snowflake"),
  userId: z.string().regex(SNOWFLAKE, "userId must be a Discord snowflake"),
});

const auditQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
  offset: z.coerce.number().int().nonnegative().default(0),
});

function badRequest(reply: FastifyReply, error: z.ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    issues: error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  });
}

/**
 * Fleetplanner → Bridge internal API. Lets the fleetplanner superadmin
 * read/write bridge guild config + admin users over the internal Docker
 * network, so operators manage everything from the fleetplanner UI instead
 * of a second login on the bridge admin web UI.
 *
 * Auth: `Authorization: Bearer <BRIDGE_FLEET_SECRET>` on every request.
 * When the secret is unset the endpoints 503 (feature disabled); wrong
 * secret 401s. Separate from INTERNAL_BRIDGE_SECRET (bot voice-state push).
 */
export async function registerFleetInternalRoutes(app: FastifyInstance): Promise<void> {
  // Guard every /internal/fleet/* request with the shared bearer secret.
  function authorize(request: FastifyRequest, reply: FastifyReply): boolean {
    const secret = getEnv().BRIDGE_FLEET_SECRET;
    if (!secret) {
      reply.code(503).send({ error: "fleet_endpoint_disabled" });
      return false;
    }
    const header = request.headers["authorization"];
    if (typeof header !== "string" || header !== `Bearer ${secret}`) {
      reply.code(401).send({ error: "unauthorized" });
      return false;
    }
    return true;
  }

  // ── Guild config ─────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/config",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const { guildId } = params.data;
      const cfg = await readGuildConfig(guildId);
      if (cfg) return reply.code(200).send(cfg);
      // No row yet — return a default shape so the fleetplanner UI can
      // render an "enable this guild" form without a 404 special-case.
      return reply.code(200).send({
        guildId,
        enabled: false,
        commanderRoleIds: [],
        allowedVoiceChannelIds: [],
        bridgeMode: "external_voice",
      });
    },
  );

  app.post<{ Params: { guildId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/config",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = configBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const { guildId } = params.data;
      await saveGuildConfig(guildId, body.data);
      logger.info({ guildId, patch: body.data }, "fleet api: saved guild config");
      return reply.code(200).send({ ok: true });
    },
  );

  // ── Admins ───────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/admins",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const admins = await listAdmins(params.data.guildId);
      return reply.code(200).send(admins);
    },
  );

  app.post<{ Params: { guildId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/admins",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = addAdminBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const { guildId } = params.data;
      await addAdmin({
        guildId,
        userId: body.data.userId,
        role: body.data.role,
        addedBy: "fleetplanner",
      });
      logger.info({ guildId, userId: body.data.userId, role: body.data.role }, "fleet api: added admin");
      return reply.code(200).send({ ok: true });
    },
  );

  app.delete<{ Params: { guildId: string; userId: string } }>(
    "/internal/fleet/guilds/:guildId/admins/:userId",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = adminParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const { guildId, userId } = params.data;
      // System-level remove: bypass the "caller must be admiral" check that
      // the web UI enforces (fleetplanner has no bridge AdminUser identity).
      // Guard `protected: false` so the env-seeded admiral can never be
      // removed via this path — prevents lockout of the bridge-native UI.
      const result = await getPrisma().adminUser.deleteMany({
        where: { guildId, userId, protected: false },
      });
      logger.info({ guildId, userId, removed: result.count }, "fleet api: removed admin");
      return reply.code(200).send({ ok: true, removed: result.count });
    },
  );

  // ── Monitoring ───────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/monitoring",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      // monitoringSnapshot is process-global (not guild-scoped); guildId in
      // the path keeps the URL shape consistent with the other endpoints.
      const snapshot = await monitoringSnapshot();
      return reply.code(200).send(snapshot);
    },
  );

  // ── Audit log ────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string }; Querystring: { limit?: string; offset?: string } }>(
    "/internal/fleet/guilds/:guildId/audit",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const query = auditQuerySchema.safeParse(request.query);
      if (!query.success) return badRequest(reply, query.error);
      const { guildId } = params.data;
      const { limit, offset } = query.data;
      const [entries, total] = await Promise.all([
        listRecentAudit(guildId, limit, offset),
        countAudit(guildId),
      ]);
      return reply.code(200).send({ entries, total });
    },
  );
}
