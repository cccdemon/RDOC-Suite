import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { isAdmin } from "../services/admins.js";

const snowflake = z.string().regex(/^[0-9]{17,20}$/);

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

export async function registerSuiteRoutes(app: FastifyInstance): Promise<void> {
  app.get("/suite/capabilities", async (request, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, OPTIONS");
    reply.header("access-control-allow-headers", "authorization, content-type");

    const token = extractBearer(request.headers.authorization);
    if (!token) {
      reply.code(401);
      return { error: "missing_bearer" };
    }

    const verified = await verifySessionToken(getEnv().SESSION_SECRET, token);
    if (!verified.ok) {
      reply.code(401);
      return { error: verified.reason };
    }

    const userId = verified.payload.sub;

    // guildId: prefer query param (companion always sends ?guildId=),
    // fall back to the optional claim in the JWT itself.
    const queryGuildId = snowflake.safeParse(
      (request.query as Record<string, unknown>).guildId,
    );
    const guildId = queryGuildId.success
      ? queryGuildId.data
      : (verified.payload.guildId ?? null);

    const canManageSessions =
      guildId !== null && (await isAdmin({ guildId, userId }));

    return {
      canManageSessions,
      canUseRelay: false,       // decision pending
      canUseFleetTools: false,  // web-first, not companion feature
    };
  });

  app.options("/suite/capabilities", async (_request, reply) => {
    reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET, OPTIONS")
      .header("access-control-allow-headers", "authorization, content-type")
      .code(204)
      .send();
  });
}
