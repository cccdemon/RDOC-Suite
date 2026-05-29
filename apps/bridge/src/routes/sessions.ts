import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { isAdmin } from "../services/admins.js";
import { logger } from "../services/logger.js";
import { issueSessionLivekitToken, deleteSessionRoom } from "../services/livekit.js";
import {
  createSession,
  endSession,
  getSession,
  listActiveSessions,
  mintSessionInvite,
  consumeSessionInvite,
  listSessionInvites,
  revokeSessionInvite,
} from "../services/sessions.js";

const snowflake = z.string().regex(/^[0-9]{17,20}$/);

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, DELETE, OPTIONS",
  "access-control-allow-headers": "authorization, content-type",
} as const;

function setCors(reply: { header: (k: string, v: string) => unknown }): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) reply.header(k, v);
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const [scheme, token] = header.split(/\s+/, 2);
  if (scheme?.toLowerCase() !== "bearer" || !token) return null;
  return token;
}

/** Verify JWT and check AdminUser membership for the given guildId.
 *  Returns { userId, guildId } on success or sends an error response. */
async function requireAdmin(
  request: { headers: { authorization?: string } },
  reply: { code: (n: number) => { send: (b: unknown) => void } },
  guildId: string,
): Promise<{ userId: string } | null> {
  const token = extractBearer(request.headers.authorization);
  if (!token) {
    reply.code(401).send({ error: "missing_bearer" });
    return null;
  }
  const verified = await verifySessionToken(getEnv().SESSION_SECRET, token);
  if (!verified.ok) {
    reply.code(401).send({ error: verified.reason });
    return null;
  }
  const userId = verified.payload.sub;
  if (!(await isAdmin({ guildId, userId }))) {
    reply.code(403).send({ error: "not_admin" });
    return null;
  }
  return { userId };
}

/** Verify JWT only (no admin check) — used for the Commander join endpoint. */
async function requireAuth(
  request: { headers: { authorization?: string } },
  reply: { code: (n: number) => { send: (b: unknown) => void } },
): Promise<{ userId: string } | null> {
  const token = extractBearer(request.headers.authorization);
  if (!token) {
    reply.code(401).send({ error: "missing_bearer" });
    return null;
  }
  const verified = await verifySessionToken(getEnv().SESSION_SECRET, token);
  if (!verified.ok) {
    reply.code(401).send({ error: verified.reason });
    return null;
  }
  return { userId: verified.payload.sub };
}

const createSessionBody = z.object({
  guildId: snowflake,
  label: z.string().min(1).max(80),
});

const mintInviteBody = z.object({
  guildId: snowflake,
  label: z.string().min(1).max(80),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

const endSessionBody = z.object({
  guildId: snowflake,
});

const joinBody = z.object({
  inviteToken: z.string().min(1),
});

export async function registerSessionRoutes(app: FastifyInstance): Promise<void> {
  // OPTIONS preflight for all /sessions/* routes
  app.options("/sessions", async (_req, reply) => {
    setCors(reply);
    reply.code(204).send();
  });
  app.options("/sessions/*", async (_req, reply) => {
    setCors(reply);
    reply.code(204).send();
  });

  // POST /sessions — Admiral creates a new ops session
  app.post("/sessions", async (request, reply) => {
    setCors(reply);
    const parsed = createSessionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { guildId, label } = parsed.data;

    const caller = await requireAdmin(request, reply, guildId);
    if (!caller) return;

    const session = await createSession({ guildId, label, createdBy: caller.userId });
    return reply.code(201).send(session);
  });

  // GET /sessions?guildId=... — Admiral lists active sessions
  app.get("/sessions", async (request, reply) => {
    setCors(reply);
    const guildId = snowflake.safeParse((request.query as Record<string, unknown>).guildId);
    if (!guildId.success) return reply.code(400).send({ error: "missing_guildId" });

    const caller = await requireAdmin(request, reply, guildId.data);
    if (!caller) return;

    return reply.send(await listActiveSessions(guildId.data));
  });

  // GET /sessions/:id?guildId=... — Admiral fetches one session
  app.get("/sessions/:id", async (request, reply) => {
    setCors(reply);
    const { id } = request.params as { id: string };
    const guildId = snowflake.safeParse((request.query as Record<string, unknown>).guildId);
    if (!guildId.success) return reply.code(400).send({ error: "missing_guildId" });

    const caller = await requireAdmin(request, reply, guildId.data);
    if (!caller) return;

    const session = await getSession({ sessionId: id, guildId: guildId.data });
    if (!session) return reply.code(404).send({ error: "not_found" });
    return reply.send(session);
  });

  // DELETE /sessions/:id — Admiral ends a session
  app.delete("/sessions/:id", async (request, reply) => {
    setCors(reply);
    const { id } = request.params as { id: string };
    const parsed = endSessionBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { guildId } = parsed.data;

    const caller = await requireAdmin(request, reply, guildId);
    if (!caller) return;

    const result = await endSession({ sessionId: id, guildId });
    if (!result.ok) {
      const code = result.reason === "not_found" ? 404 : 409;
      return reply.code(code).send({ error: result.reason });
    }

    // Best-effort: eject all LiveKit participants. Never fails the response.
    deleteSessionRoom(result.livekitRoom).catch((err) =>
      logger.warn({ err, sessionId: id }, "endSession: deleteRoom error"),
    );

    return reply.send({ ok: true });
  });

  // POST /sessions/:id/invites — Admiral mints a Commander invite token
  app.post("/sessions/:id/invites", async (request, reply) => {
    setCors(reply);
    const { id } = request.params as { id: string };
    const parsed = mintInviteBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });
    const { guildId, label, ttlHours } = parsed.data;

    const caller = await requireAdmin(request, reply, guildId);
    if (!caller) return;

    const invite = await mintSessionInvite({
      sessionId: id,
      guildId,
      label,
      createdBy: caller.userId,
      ttlHours,
    });
    if (!invite) return reply.code(404).send({ error: "session_not_found_or_ended" });
    return reply.code(201).send(invite);
  });

  // GET /sessions/:id/invites?guildId=... — Admiral lists invites for a session
  app.get("/sessions/:id/invites", async (request, reply) => {
    setCors(reply);
    const { id } = request.params as { id: string };
    const guildId = snowflake.safeParse((request.query as Record<string, unknown>).guildId);
    if (!guildId.success) return reply.code(400).send({ error: "missing_guildId" });

    const caller = await requireAdmin(request, reply, guildId.data);
    if (!caller) return;

    const invites = await listSessionInvites({ sessionId: id, guildId: guildId.data });
    if (!invites) return reply.code(404).send({ error: "not_found" });
    return reply.send(invites);
  });

  // DELETE /sessions/:id/invites/:inviteId?guildId=... — Admiral revokes unused invite
  app.delete("/sessions/:id/invites/:inviteId", async (request, reply) => {
    setCors(reply);
    const { id, inviteId } = request.params as { id: string; inviteId: string };
    const guildId = snowflake.safeParse((request.query as Record<string, unknown>).guildId);
    if (!guildId.success) return reply.code(400).send({ error: "missing_guildId" });

    const caller = await requireAdmin(request, reply, guildId.data);
    if (!caller) return;

    const revoked = await revokeSessionInvite({
      inviteId,
      sessionId: id,
      guildId: guildId.data,
    });
    if (!revoked) return reply.code(404).send({ error: "not_found_or_already_used" });
    return reply.send({ ok: true });
  });

  // POST /sessions/join — Commander redeems an invite token → gets LiveKit credentials
  app.post("/sessions/join", async (request, reply) => {
    setCors(reply);
    const parsed = joinBody.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_body" });

    const caller = await requireAuth(request, reply);
    if (!caller) return;

    const result = await consumeSessionInvite({
      rawToken: parsed.data.inviteToken,
      userId: caller.userId,
    });
    if (!result.ok) {
      const code = result.reason === "invalid_token" ? 404 : 409;
      return reply.code(code).send({ error: result.reason });
    }

    let livekitToken: string;
    try {
      livekitToken = await issueSessionLivekitToken({
        userId: caller.userId,
        livekitRoom: result.livekitRoom,
      });
    } catch (err) {
      logger.error({ err, userId: caller.userId }, "sessions/join: livekit token mint failed");
      return reply.code(502).send({ error: "livekit_token_failed" });
    }

    return reply.send({
      sessionId: result.sessionId,
      sessionLabel: result.sessionLabel,
      livekitUrl: getEnv().LIVEKIT_URL,
      livekitToken,
    });
  });
}
