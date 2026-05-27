import type { FastifyInstance } from "fastify";
import { getEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";

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

    // Conservative default. Future merge steps will derive these from
    // guild-scoped admin rows, relay-role checks, and enabled modules.
    return {
      canManageSessions: false,
      canUseRelay: false,
      canUseFleetTools: false,
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
