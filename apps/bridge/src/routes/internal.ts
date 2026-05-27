import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import { rooms } from "../services/rooms.js";
import { checkAllowedVoiceChannel } from "../services/permissions.js";
import { readGuildConfig } from "../services/guildConfig.js";
import { bridgeRoomName } from "../services/livekit.js";
import { pushAudioDisable, pushAudioEnable } from "../signaling/ws.js";

const bodySchema = z.object({
  guildId: z.string().regex(/^[0-9]{17,20}$/, "guildId must be a Discord snowflake"),
  userId: z.string().regex(/^[0-9]{17,20}$/, "userId must be a Discord snowflake"),
});

/**
 * Bot → Bridge real-time push for voice-state changes. The bot owns the
 * Discord gateway and emits this whenever a `voiceStateUpdate` event
 * affects a user that might be a commander. The bridge re-evaluates
 * `checkAllowedVoiceChannel` for the user's currently-open socket (if
 * any) and pushes audio:enable or audio:disable accordingly.
 *
 * Without this endpoint the system still works correctly — the 60s
 * permission-recheck loop in ws.ts catches voice-channel drift — but
 * gain/loss of audio takes up to 60s instead of being instantaneous.
 *
 * Auth: shared secret in the `X-Internal-Auth` header. Both bot and
 * bridge read INTERNAL_BRIDGE_SECRET from the same .env. When the secret
 * is unset the endpoint returns 503 so misconfigured deployments fail
 * loudly rather than silently letting random callers push audio events.
 */
export async function registerInternalRoutes(app: FastifyInstance): Promise<void> {
  app.post("/internal/voice-state-changed", async (request, reply) => {
    const env = getEnv();
    if (!env.INTERNAL_BRIDGE_SECRET) {
      return reply.code(503).send({ error: "internal_endpoint_disabled" });
    }
    const auth = request.headers["x-internal-auth"];
    if (typeof auth !== "string" || auth !== env.INTERNAL_BRIDGE_SECRET) {
      return reply.code(401).send({ error: "unauthorized" });
    }

    const parsed = bodySchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "invalid_body",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }

    const { guildId, userId } = parsed.data;
    const roomId = bridgeRoomName(guildId);
    const sockets = rooms.findByUserInRoom(roomId, userId);
    if (sockets.length === 0) {
      // User is not currently WS-connected to the bridge — nothing to
      // push. Still return 200; the bot fires this for every voice-state
      // event whether or not the user has a companion open.
      return reply.code(200).send({ ok: true, pushedTo: 0 });
    }

    const guildConfig = await readGuildConfig(guildId);
    const allowedIds = guildConfig?.allowedVoiceChannelIds ?? [];
    const verdict = await checkAllowedVoiceChannel({ userId, guildId, allowedIds });

    if (verdict.ok) {
      for (const sock of sockets) {
        await pushAudioEnable(sock, { userId, guildId, roomId });
      }
      logger.info(
        { userId, guildId, pushedTo: sockets.length },
        "voice-state-changed: pushed audio:enable",
      );
    } else {
      for (const sock of sockets) {
        pushAudioDisable(sock, verdict.reason);
      }
      logger.info(
        { userId, guildId, reason: verdict.reason, pushedTo: sockets.length },
        "voice-state-changed: pushed audio:disable",
      );
    }
    return reply.code(200).send({ ok: true, pushedTo: sockets.length });
  });
}
