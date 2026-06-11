// FR-P2 Phase 2 — /api/v1: JSON-only read slice.
//
// Rules (FR-P2 §Architekturregeln + §API-Sicherheit):
// - JSON only; never HTML, never a redirect to a login page (401 JSON instead).
// - No imports from web/* — presenters live in src/api/presenters.ts.
// - Object-level authorization on every id param; private ops 401/404 without leaks.
// - Stable error envelope { error: { code, message, requestId } }.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole, listUserGuilds } from "../services/guilds.js";
import {
  getOperation,
  listAllUserOperations,
  listPartnerOperations,
  listPublicOperations,
} from "../services/operations.js";
import { searchLocalShips } from "../services/scwiki.js";
import {
  IdParamSchema,
  OperationListQuerySchema,
  ShipSearchQuerySchema,
  type ApiError,
} from "../api/contracts/index.js";
import {
  presentGuild,
  presentOperationDetail,
  presentOperationSummary,
  presentSession,
  presentShip,
} from "../api/presenters.js";
import { openApiDocument } from "../api/openapi.js";

const VERSION = process.env.npm_package_version ?? "0.0.0";

function sendError(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: ApiError["error"]["code"],
  message: string,
) {
  const body: ApiError = { error: { code, message, requestId: req.id } };
  return reply.code(status).type("application/json").send(body);
}

/** Per-op signup state of one user — same rule as the SSR home page:
 *  committed seat/CQB signup wins over pending crew request / ship offer. */
async function signupStateFor(
  userId: string,
  operationId: string,
): Promise<"joined" | "waitlist" | null> {
  const [seat, cqb, req, pendingShip] = await Promise.all([
    prisma.seatAssignment.findFirst({
      where: { userId, active: true, fleetUnit: { operationId } },
      select: { id: true },
    }),
    prisma.cqbSignup.findFirst({
      where: { userId, operationId, status: { not: "rejected" } },
      select: { id: true },
    }),
    prisma.crewAssignmentRequest.findFirst({
      where: { userId, operationId },
      select: { id: true },
    }),
    prisma.fleetUnit.findFirst({
      where: { captainId: userId, operationId, status: "pending" },
      select: { id: true },
    }),
  ]);
  if (seat || cqb) return "joined";
  if (req || pendingShip) return "waitlist";
  return null;
}

export async function apiV1Routes(app: FastifyInstance) {
  // ── meta ────────────────────────────────────────────────────────────
  app.get("/api/v1/health", async (_req, reply) => {
    return reply.type("application/json").send({
      status: "ok" as const,
      service: "fleetplanner-api" as const,
      version: VERSION,
      time: new Date().toISOString(),
    });
  });

  app.get("/api/v1/openapi.json", async (_req, reply) => {
    return reply.type("application/json").send(openApiDocument);
  });

  // ── session ─────────────────────────────────────────────────────────
  app.get("/api/v1/session", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const memberships = ctx ? await listUserGuilds(ctx.user.id) : [];
    return reply.type("application/json").send(presentSession(ctx, memberships));
  });

  // ── operations ──────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>("/api/v1/operations", async (req, reply) => {
    const q = OperationListQuerySchema.safeParse(req.query);
    if (!q.success) return sendError(reply, req, 400, "bad_request", "Invalid query.");
    const includePast = q.data.past;

    const ctx = await optionalAuth(req);
    if (!ctx) {
      const ops = await listPublicOperations(includePast);
      return reply
        .type("application/json")
        .send({ operations: ops.map((op: Parameters<typeof presentOperationSummary>[0]) => presentOperationSummary(op)) });
    }

    const memberships = await listUserGuilds(ctx.user.id);
    const guildIds = memberships.map((m) => m.guildId);
    const [ownOps, partnerOpLists, publicOps] = await Promise.all([
      guildIds.length ? listAllUserOperations(guildIds, includePast) : Promise.resolve([]),
      Promise.all(guildIds.map((gid) => listPartnerOperations(gid, includePast))),
      listPublicOperations(includePast),
    ]);
    type Row = Parameters<typeof presentOperationSummary>[0] & { scheduledAt: Date };
    const opById = new Map<string, Row>();
    for (const op of [...partnerOpLists.flat(), ...publicOps] as Row[]) opById.set(op.id, op);
    for (const op of ownOps as Row[]) opById.set(op.id, op);
    const ops = [...opById.values()].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
    );

    // Same signup-state rule as the SSR home page (joined wins over waitlist).
    const [signedSeats, signedReqs, cqbSignups, pendingShips] = await Promise.all([
      prisma.seatAssignment.findMany({
        where: { userId: ctx.user.id, active: true },
        select: { fleetUnit: { select: { operationId: true } } },
      }),
      prisma.crewAssignmentRequest.findMany({
        where: { userId: ctx.user.id },
        select: { operationId: true },
      }),
      prisma.cqbSignup.findMany({
        where: { userId: ctx.user.id, status: { not: "rejected" } },
        select: { operationId: true },
      }),
      prisma.fleetUnit.findMany({
        where: { captainId: ctx.user.id, status: "pending" },
        select: { operationId: true },
      }),
    ]);
    const state = new Map<string, "joined" | "waitlist">();
    for (const r of signedReqs) state.set(r.operationId, "waitlist");
    for (const u of pendingShips) state.set(u.operationId, "waitlist");
    for (const s of signedSeats)
      if (s.fleetUnit?.operationId) state.set(s.fleetUnit.operationId, "joined");
    for (const c of cqbSignups) state.set(c.operationId, "joined");

    return reply.type("application/json").send({
      operations: ops.map((op) => presentOperationSummary(op, state.get(op.id) ?? null)),
    });
  });

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");

    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");

    const ctx = await optionalAuth(req);
    const visibility = (op as { visibility?: string }).visibility;

    // Object-level AuthZ — mirror the SSR /ops/:id gate:
    // anonymous only for public ops; authenticated users need an effective role.
    let viewerRole: string | null = null;
    let canManage = false;
    if (!ctx) {
      if (visibility !== "public")
        return sendError(reply, req, 401, "unauthenticated", "Sign in to view this operation.");
    } else {
      viewerRole = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      // Same as SSR: no role → pretend the op does not exist (no leak).
      if (!viewerRole) return sendError(reply, req, 404, "not_found", "Operation not found.");
      canManage =
        viewerRole === "fleetoperator" ||
        op.leaders.some((l: { user: { id: string } }) => l.user.id === ctx.user.id);
    }

    // getOperation() doesn't include the guild relation (SSR loads it
    // separately) — fetch the public guild fields here.
    const guild = await prisma.guild.findUnique({
      where: { id: (op as { guildId: string }).guildId },
      select: { id: true, name: true, iconHash: true, timezone: true },
    });
    if (!guild) return sendError(reply, req, 404, "not_found", "Operation not found.");

    const signupState = ctx ? await signupStateFor(ctx.user.id, op.id) : null;
    const row = { ...op, guild } as unknown as Parameters<typeof presentOperationDetail>[0];
    return reply.type("application/json").send(
      presentOperationDetail(row, { role: viewerRole, canManage, signupState }),
    );
  });

  // ── guilds ──────────────────────────────────────────────────────────
  app.get("/api/v1/guilds", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const memberships = await listUserGuilds(ctx.user.id);
    return reply.type("application/json").send({ guilds: memberships.map(presentGuild) });
  });

  // ── ships ───────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>("/api/v1/ships/search", async (req, reply) => {
    const q = ShipSearchQuerySchema.safeParse(req.query);
    if (!q.success) return sendError(reply, req, 400, "bad_request", "Invalid query.");
    const ships = await searchLocalShips(q.data.q, q.data.limit);
    return reply.type("application/json").send({ ships: ships.map(presentShip) });
  });

  // ── JSON error envelope for unhandled errors inside /api/v1 ────────
  // Plugin-scoped: applies only to routes registered in this plugin, the SSR
  // error pages elsewhere stay untouched. No stack traces / prisma details
  // ever reach the client (FR-P2 §Fehler).
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, requestId: req.id }, "api v1 error");
    const body: ApiError = {
      error: { code: "internal", message: "Internal error.", requestId: req.id },
    };
    reply.code(500).type("application/json").send(body);
  });
}
