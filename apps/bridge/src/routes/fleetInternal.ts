import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { getPrisma } from "@rdoc-suite/db";
import { getEnv, getOAuthEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import { readGuildConfig, saveGuildConfig } from "../services/guildConfig.js";
import { addAdmin, listAdmins } from "../services/admins.js";
import { monitoringSnapshot } from "../services/monitoring.js";
import { listRecentAudit, countAudit } from "../services/audit.js";
import { fleetDashboard, stripCommanderRoles, setAdminRoleSystem } from "../services/fleetAdmin.js";
import {
  mintAdminInviteLink,
  listInviteLinks,
  revokeInviteLink,
} from "../services/adminInviteLinks.js";
import {
  createSession,
  endSession,
  getSession,
  listActiveSessions,
  mintSessionInvite,
  listSessionInvites,
  revokeSessionInvite,
} from "../services/sessions.js";
import {
  getRelayBotsConfig,
  setRelayBotsConfig,
  notifyRelayBotsReload,
} from "../services/relayBotsConfig.js";
import { getCachedChannels, getCachedRoles } from "../services/discordMetaCache.js";
import {
  moveGuildMember,
  addGuildMemberRole,
  removeGuildMemberRole,
} from "../auth/discord.js";

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

const createSessionBodySchema = z.object({ label: z.string().min(1).max(80) });
const mintInviteBodySchema = z.object({
  label: z.string().min(1).max(80),
  ttlHours: z.coerce.number().int().min(1).max(168).optional(),
});

const botEntrySchema = z.object({
  name: z.string().min(1).max(100),
  token: z.string().min(1),
  channelId: z.string().min(1),
});
const relayConfigSchema = z.object({
  livekitUrl: z.string().url(),
  livekitApiKey: z.string(),
  livekitApiSecret: z.string(),
  roomName: z.string().min(1).max(100),
  guildId: z.string(),
  bots: z.array(botEntrySchema),
});

const moveChannelBodySchema = z.object({
  channelId: z.string().regex(SNOWFLAKE).nullable(),
});

const memberRoleParamsSchema = z.object({
  guildId: z.string().regex(SNOWFLAKE),
  userId: z.string().regex(SNOWFLAKE),
  roleId: z.string().regex(SNOWFLAKE),
});

const setRoleBodySchema = z.object({ role: z.enum(["admiral", "vice_admiral"]) });
const inviteCreateBodySchema = z.object({
  label: z.string().min(1).max(120),
  role: z.enum(["admiral", "vice_admiral"]),
  ttlDays: z.coerce.number().int().min(1).max(90).optional(),
});

/** Absolute bridge URL where an admin invite link is consumed. */
function adminInviteUrl(token: string): string {
  const origin = (() => {
    const oauth = getOAuthEnv();
    if (!oauth) return "";
    try {
      return new URL(oauth.OAUTH_REDIRECT_URI).origin;
    } catch {
      return "";
    }
  })();
  return `${origin}${getEnv().PUBLIC_BASE_PATH}/admin/invite/${token}`;
}

function mapDiscordError(status: number, missingPermissionCode: string): { code: string; status: number } {
  if (status === 403) return { code: missingPermissionCode, status: 403 };
  if (status === 404) return { code: "discord_not_found", status: 404 };
  if (status === 400) return { code: "discord_bad_request", status: 400 };
  if (status === 429) return { code: "discord_rate_limited", status: 429 };
  return { code: "discord_api_error", status: 502 };
}

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

  // Change an admin's role (promote/demote). Guards protected target +
  // last-admiral, no caller-admiral check (system call).
  app.post<{ Params: { guildId: string; userId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/admins/:userId/role",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = adminParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = setRoleBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const result = await setAdminRoleSystem(params.data.guildId, params.data.userId, body.data.role);
      if (!result.ok) {
        const status =
          result.reason === "target_not_found" ? 404 :
          result.reason === "target_protected" ? 409 :
          result.reason === "would_remove_last_admiral" ? 409 : 400;
        return reply.code(status).send({ error: result.reason });
      }
      logger.info({ guildId: params.data.guildId, userId: params.data.userId, role: body.data.role }, "fleet api: set admin role");
      return reply.code(200).send({ ok: true });
    },
  );

  // ── Admin invite links ───────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/invites",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const invites = await listInviteLinks(params.data.guildId);
      return reply.code(200).send(invites);
    },
  );

  app.post<{ Params: { guildId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/invites",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = inviteCreateBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const invite = await mintAdminInviteLink({
        guildId: params.data.guildId,
        label: body.data.label,
        role: body.data.role,
        createdBy: "fleetplanner",
        ttlDays: body.data.ttlDays,
      });
      logger.info({ guildId: params.data.guildId, role: invite.role }, "fleet api: minted admin invite link");
      return reply.code(200).send({
        id: invite.id,
        label: invite.label,
        role: invite.role,
        expiresAt: invite.expiresAt,
        url: adminInviteUrl(invite.plaintext),
      });
    },
  );

  app.delete<{ Params: { guildId: string; id: string } }>(
    "/internal/fleet/guilds/:guildId/invites/:id",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const id = (request.params as { id: string }).id;
      const ok = await revokeInviteLink({ id, guildId: params.data.guildId });
      return reply.code(200).send({ ok });
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

  // ── Dashboard ────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/dashboard",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      return reply.code(200).send(await fleetDashboard(params.data.guildId));
    },
  );

  // Strip all configured commander roles from a user (manage roster).
  app.delete<{ Params: { guildId: string; userId: string } }>(
    "/internal/fleet/guilds/:guildId/commander-roles/:userId",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = adminParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const result = await stripCommanderRoles(params.data.guildId, params.data.userId);
      if (!result.ok) {
        const status =
          result.reason === "user_not_in_guild" ? 404 :
          result.reason === "oauth_not_configured" ? 503 :
          result.reason === "no_commander_roles_configured" ? 409 :
          result.reason === "partial_failure" ? 502 : 400;
        return reply.code(status).send({ error: result.reason, removed: result.removed, failed: result.failed });
      }
      logger.info({ guildId: params.data.guildId, userId: params.data.userId, removed: result.removed }, "fleet api: stripped commander roles");
      return reply.code(200).send({ ok: true, removed: result.removed });
    },
  );

  // ── Sessions ─────────────────────────────────────────────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/sessions",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const { guildId } = params.data;
      const sessions = await listActiveSessions(guildId);
      const inviteCounts = await Promise.all(
        sessions.map((s) =>
          listSessionInvites({ sessionId: s.id, guildId }).then((invs) => invs?.length ?? 0),
        ),
      );
      return reply.code(200).send({
        sessions: sessions.map((s, i) => ({ ...s, inviteCount: inviteCounts[i] })),
      });
    },
  );

  app.post<{ Params: { guildId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/sessions",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = createSessionBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const created = await createSession({
        guildId: params.data.guildId,
        label: body.data.label,
        createdBy: "fleetplanner",
      });
      return reply.code(200).send(created);
    },
  );

  app.get<{ Params: { guildId: string; sessionId: string } }>(
    "/internal/fleet/guilds/:guildId/sessions/:sessionId",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const guildId = params.data.guildId;
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const [session, invites] = await Promise.all([
        getSession({ sessionId, guildId }),
        listSessionInvites({ sessionId, guildId }),
      ]);
      if (!session || !invites) return reply.code(404).send({ error: "session_not_found" });
      return reply.code(200).send({ session, invites });
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string } }>(
    "/internal/fleet/guilds/:guildId/sessions/:sessionId/end",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const result = await endSession({ sessionId, guildId: params.data.guildId });
      if (!result.ok && result.reason === "not_found") {
        return reply.code(404).send({ error: "session_not_found" });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/sessions/:sessionId/invites",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = mintInviteBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const sessionId = (request.params as { sessionId: string }).sessionId;
      const invite = await mintSessionInvite({
        sessionId,
        guildId: params.data.guildId,
        label: body.data.label,
        createdBy: "fleetplanner",
        ttlHours: body.data.ttlHours,
      });
      if (!invite) return reply.code(404).send({ error: "session_not_found_or_ended" });
      return reply.code(200).send(invite);
    },
  );

  app.post<{ Params: { guildId: string; sessionId: string; inviteId: string } }>(
    "/internal/fleet/guilds/:guildId/sessions/:sessionId/invites/:inviteId/revoke",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const p = request.params as { sessionId: string; inviteId: string };
      const ok = await revokeSessionInvite({
        inviteId: p.inviteId,
        sessionId: p.sessionId,
        guildId: params.data.guildId,
      });
      return reply.code(200).send({ ok });
    },
  );

  // ── Relay bots (singleton config, not guild-scoped) ──────────────
  app.get("/internal/fleet/relay-bots/config", async (request, reply) => {
    if (!authorize(request, reply)) return;
    return reply.code(200).send(await getRelayBotsConfig());
  });

  app.post<{ Body: unknown }>("/internal/fleet/relay-bots/config", async (request, reply) => {
    if (!authorize(request, reply)) return;
    const body = relayConfigSchema.safeParse(request.body);
    if (!body.success) return badRequest(reply, body.error);
    await setRelayBotsConfig(body.data, "fleetplanner");
    await notifyRelayBotsReload();
    logger.info("fleet api: saved relay-bots config");
    return reply.code(200).send({ ok: true });
  });

  app.get("/internal/fleet/relay-bots/metrics", async (request, reply) => {
    if (!authorize(request, reply)) return;
    const env = getEnv();
    if (!env.RELAY_BOTS_ADMIN_URL) return reply.code(200).send({ offline: true });
    try {
      const headers: Record<string, string> = {};
      if (env.RELAY_BOTS_ADMIN_SECRET) {
        headers.authorization = `Basic ${Buffer.from(`admin:${env.RELAY_BOTS_ADMIN_SECRET}`).toString("base64")}`;
      }
      const res = await fetch(`${env.RELAY_BOTS_ADMIN_URL}/api/metrics`, {
        headers,
        signal: AbortSignal.timeout(3000),
      });
      if (!res.ok) return reply.code(200).send({ offline: true, error: `bots service returned ${res.status}` });
      return reply.code(200).send(await res.json() as unknown);
    } catch (err) {
      return reply.code(200).send({ offline: true, error: String(err) });
    }
  });

  app.post("/internal/fleet/relay-bots/restart", async (request, reply) => {
    if (!authorize(request, reply)) return;
    const env = getEnv();
    if (!env.RELAY_BOTS_ADMIN_URL) return reply.code(503).send({ error: "relay_bots_not_configured" });
    try {
      const headers: Record<string, string> = {};
      if (env.RELAY_BOTS_ADMIN_SECRET) {
        headers.authorization = `Basic ${Buffer.from(`admin:${env.RELAY_BOTS_ADMIN_SECRET}`).toString("base64")}`;
      }
      const res = await fetch(`${env.RELAY_BOTS_ADMIN_URL}/api/restart`, {
        method: "POST",
        headers,
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) return reply.code(502).send({ error: `bots service returned ${res.status}` });
      return reply.code(200).send({ ok: true });
    } catch (err) {
      return reply.code(502).send({ error: String(err) });
    }
  });

  // ── Discord voice (live role / channel management) ───────────────
  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/discord/voice-states",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const { guildId } = params.data;
      const oauth = getOAuthEnv();
      if (!oauth) return reply.code(200).send({ offline: true, channels: [], voiceStates: [] });
      const [channels, voiceRows] = await Promise.all([
        getCachedChannels(guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN),
        getPrisma().userVoiceState.findMany({ where: { guildId, channelId: { not: null } } }),
      ]);
      const voiceChannels = channels.filter((c) => c.type === 2);
      return reply.code(200).send({
        channels: voiceChannels.map((c) => ({ id: c.id, name: c.name })),
        voiceStates: voiceRows.map((r) => ({ userId: r.userId, displayName: r.userId, channelId: r.channelId })),
      });
    },
  );

  app.get<{ Params: { guildId: string } }>(
    "/internal/fleet/guilds/:guildId/discord/roles",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = guildParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const oauth = getOAuthEnv();
      if (!oauth) return reply.code(200).send({ roles: [] });
      const roles = await getCachedRoles(params.data.guildId, oauth.DISCORD_RDOCRTC_BOT_TOKEN);
      return reply.code(200).send({ roles: roles.map((r) => ({ id: r.id, name: r.name })) });
    },
  );

  app.patch<{ Params: { guildId: string; userId: string }; Body: unknown }>(
    "/internal/fleet/guilds/:guildId/discord/members/:userId/channel",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = adminParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const body = moveChannelBodySchema.safeParse(request.body);
      if (!body.success) return badRequest(reply, body.error);
      const oauth = getOAuthEnv();
      if (!oauth) return reply.code(503).send({ error: "discord_not_configured" });
      const res = await moveGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: params.data.guildId,
        userId: params.data.userId,
        channelId: body.data.channelId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_move_members");
        return reply.code(status).send({ error: code });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.put<{ Params: { guildId: string; userId: string; roleId: string } }>(
    "/internal/fleet/guilds/:guildId/discord/members/:userId/roles/:roleId",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = memberRoleParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const oauth = getOAuthEnv();
      if (!oauth) return reply.code(503).send({ error: "discord_not_configured" });
      const res = await addGuildMemberRole({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: params.data.guildId,
        userId: params.data.userId,
        roleId: params.data.roleId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_manage_roles");
        return reply.code(status).send({ error: code });
      }
      return reply.code(200).send({ ok: true });
    },
  );

  app.delete<{ Params: { guildId: string; userId: string; roleId: string } }>(
    "/internal/fleet/guilds/:guildId/discord/members/:userId/roles/:roleId",
    async (request, reply) => {
      if (!authorize(request, reply)) return;
      const params = memberRoleParamsSchema.safeParse(request.params);
      if (!params.success) return badRequest(reply, params.error);
      const oauth = getOAuthEnv();
      if (!oauth) return reply.code(503).send({ error: "discord_not_configured" });
      const res = await removeGuildMemberRole({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: params.data.guildId,
        userId: params.data.userId,
        roleId: params.data.roleId,
      });
      if (!res.ok) {
        const { code, status } = mapDiscordError(res.error.status, "missing_manage_roles");
        return reply.code(status).send({ error: code });
      }
      return reply.code(200).send({ ok: true });
    },
  );
}
