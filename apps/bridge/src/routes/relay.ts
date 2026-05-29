import type { FastifyInstance } from "fastify";
import { z } from "zod";
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
  // Auth: companion bearer JWT (same session token as all companion API calls).
  //       role=publisher requires a Discord role check when RELAY_REQUIRED_ROLE_ID is set.
  //       role=subscriber skips the role check (bot service uses a shared secret instead).
  app.get("/relay/token", async (request, reply) => {
    const rawToken = extractBearer(request.headers.authorization);
    if (!rawToken) {
      return reply.code(401).send({ error: "missing_bearer" });
    }
    const verified = await verifySessionToken(getEnv().SESSION_SECRET, rawToken);
    if (!verified.ok) {
      return reply.code(401).send({ error: verified.reason });
    }
    const userId = verified.payload.sub;

    const rawRole = (request.query as Record<string, string>).role ?? "publisher";
    const roleParsed = roleSchema.safeParse(rawRole);
    if (!roleParsed.success) {
      return reply.code(400).send({ error: "invalid_role", valid: ["publisher", "subscriber"] });
    }

    const env = getEnv();
    const config = await getRelayBotsConfig();

    // guildId: from query param, then config, then env
    const queryGuildId = (request.query as Record<string, string>).guildId;
    const guildId = queryGuildId || config.guildId || env.RELAY_GUILD_ID;
    const requiredRoleId = env.RELAY_REQUIRED_ROLE_ID;
    const botToken = env.RELAY_DISCORD_BOT_TOKEN ?? config.bots[0]?.token;

    // publisher role check: if RELAY_REQUIRED_ROLE_ID is set, the user must
    // hold that Discord role in the guild. Subscriber (relay bots service) skips.
    if (roleParsed.data === "publisher" && requiredRoleId) {
      if (!guildId || !botToken) {
        return reply.code(503).send({ error: "relay_not_configured" });
      }
      const allowed = await hasRelayRole(botToken, guildId, userId, requiredRoleId);
      if (!allowed) {
        return reply.code(403).send({ error: "missing_relay_role" });
      }
    }

    const { token, roomName, url } = await issueRelayToken({
      userId,
      role: roleParsed.data,
    });

    return reply.send({ token, roomName, url });
  });
}
