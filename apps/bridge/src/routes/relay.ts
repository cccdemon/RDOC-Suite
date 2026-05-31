import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { timingSafeEqual } from "node:crypto";
import { getEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { issueRelayToken } from "../services/livekit.js";
import { getRelayBotsConfig } from "../services/relayBotsConfig.js";

const roleSchema = z.enum(["publisher", "subscriber"]);

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Constant-time string compare; false on any length mismatch. */
function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

async function hasRelayRole(
  botToken: string,
  guildId: string,
  discordUserId: string,
  requiredRoleId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      { headers: { authorization: `Bot ${botToken}` } },
    );
    if (!res.ok) return false;
    const member = (await res.json()) as { roles?: string[] };
    return Array.isArray(member.roles) && member.roles.includes(requiredRoleId);
  } catch {
    return false;
  }
}

export async function registerRelayRoute(app: FastifyInstance): Promise<void> {
  // GET /relay/token — Companion requests a LiveKit token to publish audio into
  // the relay room (Whisper to Channel / Voice-to-All). Also used by the relay
  // bots service to obtain a subscriber token (role=subscriber).
  //
  // Auth differs by role:
  //   role=publisher  — companion bearer JWT (same session token as all
  //                     companion API calls). Requires a Discord role check
  //                     when RELAY_REQUIRED_ROLE_ID is set.
  //   role=subscriber — the relay bots SERVICE, not a user. Requires the
  //                     RELAY_BOTS_SECRET shared secret as the bearer. A
  //                     companion JWT must NOT be able to obtain a subscriber
  //                     token (it would let any commander silently listen to
  //                     the whole Voice-to-All relay room).
  app.get("/relay/token", async (request, reply) => {
    const rawToken = extractBearer(request.headers.authorization);
    if (!rawToken) {
      return reply.code(401).send({ error: "missing_bearer" });
    }

    const rawRole = (request.query as Record<string, string>).role ?? "publisher";
    const roleParsed = roleSchema.safeParse(rawRole);
    if (!roleParsed.success) {
      return reply.code(400).send({ error: "invalid_role", valid: ["publisher", "subscriber"] });
    }

    const env = getEnv();

    if (roleParsed.data === "subscriber") {
      const expected = env.RELAY_BOTS_SECRET;
      if (!expected) {
        return reply.code(503).send({ error: "relay_subscriber_not_configured" });
      }
      if (!timingSafeEqualStr(rawToken, expected)) {
        return reply.code(401).send({ error: "invalid_service_secret" });
      }
      const { token, roomName, url } = await issueRelayToken({
        userId: "relay-bot-service",
        role: "subscriber",
      });
      return reply.send({ token, roomName, url });
    }

    // publisher path — companion JWT
    const verified = await verifySessionToken(env.SESSION_SECRET, rawToken);
    if (!verified.ok) {
      return reply.code(401).send({ error: verified.reason });
    }
    const userId = verified.payload.sub;

    const config = await getRelayBotsConfig();
    // guildId: from query param, then config, then env
    const queryGuildId = (request.query as Record<string, string>).guildId;
    const guildId = queryGuildId || config.guildId || env.RELAY_GUILD_ID;
    const requiredRoleId = env.RELAY_REQUIRED_ROLE_ID;
    const botToken = env.RELAY_DISCORD_RDOCRTC_BOT_TOKEN ?? config.bots[0]?.token;

    // If RELAY_REQUIRED_ROLE_ID is set, the user must hold that Discord role.
    if (requiredRoleId) {
      if (!guildId || !botToken) {
        return reply.code(503).send({ error: "relay_not_configured" });
      }
      const allowed = await hasRelayRole(botToken, guildId, userId, requiredRoleId);
      if (!allowed) {
        return reply.code(403).send({ error: "missing_relay_role" });
      }
    }

    const { token, roomName, url } = await issueRelayToken({ userId, role: "publisher" });
    return reply.send({ token, roomName, url });
  });
}
