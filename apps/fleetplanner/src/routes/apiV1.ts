// FR-P2 Phase 2 — /api/v1: JSON-only read slice.
//
// Rules (FR-P2 §Architekturregeln + §API-Sicherheit):
// - JSON only; never HTML, never a redirect to a login page (401 JSON instead).
// - No imports from web/* — presenters live in src/api/presenters.ts.
// - Object-level authorization on every id param; private ops 401/404 without leaks.
// - Stable error envelope { error: { code, message, requestId } }.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import { optionalAuth, type AuthContext } from "../auth/middleware.js";
import { effectiveOpRole, listUserGuilds } from "../services/guilds.js";
import {
  getOperation,
  listAllUserOperations,
  listPartnerOperations,
  listPublicOperations,
  logAudit,
} from "../services/operations.js";
import { assignSeat, claimSeat, deleteUnit, registerUnit, setUnitStatus, unclaimSeat } from "../services/units.js";
import { listSharedHangars } from "../services/hangarShare.js";
import { sendSeatAssignmentDm } from "../services/discord.js";
import { createSignup as createCqbSignup, withdrawSignup as withdrawCqbSignup } from "../services/cqb.js";
import { setHangarShare } from "../services/hangarShare.js";
import { addResourceLink, removeResourceLink } from "../services/resourceLinks.js";
import { sendDiscordDm } from "../services/discord.js";
import { searchLocalShips } from "../services/scwiki.js";
import { assertRequirementFitsUnit, assertUniqueSquadName, canApproveUnits } from "./api.js";
import {
  AnswerQuestionRequestSchema,
  AssignSeatRequestSchema,
  CqbSignupRequestSchema,
  HangarShareRequestSchema,
  IdParamSchema,
  LinkParamSchema,
  OperationListQuerySchema,
  PatchUnitRequestSchema,
  QuestionParamSchema,
  RegisterUnitRequestSchema,
  ResourceLinkRequestSchema,
  SeatParamSchema,
  ShipSearchQuerySchema,
  UnitDecisionRequestSchema,
  UnitParamSchema,
  type ApiError,
  type OperatorView,
} from "../api/contracts/index.js";
import {
  presentGuild,
  presentOperationDetail,
  presentOperationSummary,
  presentSession,
  presentShip,
} from "../api/presenters.js";
import { openApiDocument } from "../api/openapi.js";
import { mutationLimiter, searchLimiter } from "../api/rateLimit.js";

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
  // ── rate limits (FR-P2 §Abuse-Schutz) ───────────────────────────────
  // Plugin-scoped: applies to every /api/v1 route, SSR untouched. Key is the
  // session cookie when present (no DB hit needed for bucketing), else the
  // client IP (trustProxy is on; Caddy fronts the app).
  app.addHook("preHandler", async (req, reply) => {
    const isSearch = req.method === "GET" && req.url.includes("/ships/search");
    const isMutation = req.method !== "GET" && req.method !== "HEAD";
    if (!isSearch && !isMutation) return;
    const key =
      ((req.cookies as Record<string, string | undefined>)?.fp_sid ?? req.ip) +
      (isMutation ? ":m" : ":s");
    const retry = (isMutation ? mutationLimiter : searchLimiter).hit(key);
    if (retry !== null) {
      const body: ApiError = {
        error: { code: "rate_limited", message: "Too many requests.", requestId: req.id },
      };
      return reply.code(429).header("retry-after", String(retry)).type("application/json").send(body);
    }
  });

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

  // Interactive API docs for external developers. Swagger UI from the unpkg
  // CDN renders the live openapi.json — the page itself contains no data, so
  // there is nothing to leak (the OpenAPI hygiene tests guard the document).
  app.get("/api/v1/docs", async (_req, reply) => {
    const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>RDOC Fleetplanner API v1 — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body{margin:0;background:#fafafa}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.ui = SwaggerUIBundle({
      url: "openapi.json",
      dom_id: "#swagger-ui",
      deepLinking: true,
      tryItOutEnabled: true,
      requestInterceptor: (req) => req, // cookie session is sent same-origin automatically
    });
  </script>
</body>
</html>`;
    return reply.type("text/html; charset=utf-8").send(html);
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
    // Viewer flags for the SPA's "Mitmachen" controls — both relations are
    // already loaded by getOperation(), so this is a pure in-memory check.
    const myId = ctx?.user.id;
    const cqbSignedUp =
      !!myId &&
      ((op as { cqbSignups?: Array<{ userId: string }> }).cqbSignups ?? []).some((s) => s.userId === myId);
    const hangarShared =
      !!myId &&
      ((op as { hangarShares?: Array<{ userId: string }> }).hangarShares ?? []).some((h) => h.userId === myId);
    const row = { ...op, guild } as unknown as Parameters<typeof presentOperationDetail>[0];
    return reply.type("application/json").send(
      presentOperationDetail(row, { role: viewerRole, canManage, signupState, cqbSignedUp, hangarShared }),
    );
  });

  // ── guilds ──────────────────────────────────────────────────────────
  app.get("/api/v1/guilds", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const memberships = await listUserGuilds(ctx.user.id);
    return reply.type("application/json").send({ guilds: memberships.map(presentGuild) });
  });

  // ── mutations (Phase 5, slice 1) ────────────────────────────────────
  // JSON-only: cookie session (401 envelope) + x-csrf-token header checked
  // against the session token (403). Curated service error messages map to
  // 404/409 — never internals. SSR form-POST routes stay untouched.

  async function requireSessionJson(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthContext | null> {
    const ctx = await optionalAuth(req);
    if (!ctx) {
      await sendError(reply, req, 401, "unauthenticated", "Sign in required.");
      return null;
    }
    const token = req.headers["x-csrf-token"];
    if (typeof token !== "string" || token !== ctx.csrfToken) {
      await sendError(reply, req, 403, "forbidden", "Invalid CSRF token.");
      return null;
    }
    return ctx;
  }

  /** Map curated service errors to the envelope: "not found" → 404, rest 409. */
  function mutationError(reply: FastifyReply, req: FastifyRequest, err: unknown) {
    const msg = err instanceof Error ? err.message : "Conflict.";
    if (/not found/i.test(msg)) return sendError(reply, req, 404, "not_found", msg);
    if (/forbidden/i.test(msg)) return sendError(reply, req, 403, "forbidden", msg);
    return sendError(reply, req, 409, "conflict", msg);
  }

  app.post<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/claim",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      // Object-level: the seat must belong to THIS operation.
      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      // Tenant gate — same rule as the SSR claim route.
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");

      try {
        const result = await claimSeat(p.data.seatId, ctx.user.id);
        if (result.vacatedCaptainSeat) {
          await logAudit(p.data.id, ctx.user.id, ctx.user.username, "captain_left_pilot_seat", result.unitName);
          try {
            const leaders = await prisma.operationLeader.findMany({
              where: { operationId: p.data.id },
              select: { userId: true },
            });
            const msg = `⚠️ ${ctx.user.username} left the captain (pilot) seat of "${result.unitName}" — this ship may need a new captain.`;
            await Promise.all(leaders.map((l) => sendDiscordDm(l.userId, msg).catch(() => {})));
          } catch {
            /* best-effort */
          }
        }
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:claim", "");
        return reply.type("application/json").send({ ok: true as const, seatId: p.data.seatId });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/claim",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      try {
        await unclaimSeat(p.data.seatId, ctx.user.id, ctx.user.role);
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:unclaim", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb/signup",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = CqbSignupRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const op = await prisma.operation.findUnique({
        where: { id: p.data.id },
        select: { id: true, status: true },
      });
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");
      if (op.status !== "open" && op.status !== "draft")
        return sendError(reply, req, 409, "conflict", "Operation is not open for registration.");

      await createCqbSignup(p.data.id, ctx.user.id, body.data.note?.trim() || null);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb:signup", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/operations/:id/cqb/signup",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      await withdrawCqbSignup(p.data.id, ctx.user.id);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb:withdraw", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/hangar-share",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = HangarShareRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");

      await setHangarShare(p.data.id, ctx.user.id, {
        allow: body.data.allow,
        note: body.data.note ?? null,
      });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "hangar:share", body.data.allow ? "allow" : "deny");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── mutations (Phase 5, slice 2): units + resource-links ───────────

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/units",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = RegisterUnitRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const op = await prisma.operation.findUnique({
        where: { id: p.data.id },
        select: { id: true, status: true },
      });
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");
      if (op.status !== "open" && op.status !== "draft")
        return sendError(reply, req, 409, "conflict", "Operation is not open for registration.");

      const d = body.data;
      try {
        // Same validation chain as the SSR /api/ops/:id/units route.
        const isShipLike = d.unitType === "ship" || d.unitType === "vehicle";
        const selectedShipId = isShipLike ? (d.shipId ?? d.ownedShipId) : undefined;
        if (isShipLike && !selectedShipId)
          throw new Error(d.unitType === "vehicle" ? "Select a vehicle" : "Select or search a ship");
        if (d.unitType === "vehicle" && !d.carrierUnitId)
          throw new Error("A vehicle must be carried by a ship");
        if (d.unitType === "squad") {
          if (!d.squadSize) throw new Error("Squad size must be between 2 and 8");
          if (!d.squadName) throw new Error("Squad name required");
          await assertUniqueSquadName(p.data.id, d.squadName);
        }
        await assertRequirementFitsUnit(p.data.id, d.requirementId, d.unitType, selectedShipId);
        if (isShipLike && selectedShipId && d.storeOwnedShip) {
          await prisma.userShip.upsert({
            where: { userId_shipId: { userId: ctx.user.id, shipId: selectedShipId } },
            create: { userId: ctx.user.id, shipId: selectedShipId },
            update: {},
          });
        }
        const unit = await registerUnit(p.data.id, ctx.user.id, {
          unitType: d.unitType,
          shipId: selectedShipId,
          squadName: d.squadName,
          squadSize: d.squadSize,
          requirementId: d.requirementId,
          captainNote: d.captainNote,
          carrierUnitId: d.unitType === "vehicle" ? d.carrierUnitId : undefined,
        });
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:register", d.unitType);
        return reply
          .type("application/json")
          .send({ ok: true as const, unitId: (unit as { id: string }).id });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.patch<{ Params: { id: string; unitId: string }; Body: unknown }>(
    "/api/v1/operations/:id/units/:unitId",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = PatchUnitRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: p.data.unitId, operationId: p.data.id },
        include: { operation: { select: { status: true, leaders: { select: { userId: true } } } } },
      });
      if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");
      if (unit.operation.status === "completed" || unit.operation.status === "cancelled")
        return sendError(reply, req, 409, "conflict", "Closed operations cannot be edited.");

      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      const canEdit =
        unit.captainId === ctx.user.id ||
        role === "fleetoperator" ||
        unit.operation.leaders.some((l) => l.userId === ctx.user.id);
      if (!canEdit) return sendError(reply, req, 403, "forbidden", "Forbidden.");

      try {
        if (body.data.squadName !== undefined && body.data.squadName !== unit.squadName) {
          if (unit.unitType !== "squad")
            return sendError(reply, req, 409, "conflict", "Only squads can be renamed here.");
          await assertUniqueSquadName(p.data.id, body.data.squadName);
        }
        await prisma.fleetUnit.update({
          where: { id: p.data.unitId },
          data: {
            ...(body.data.captainNote !== undefined
              ? { captainNote: body.data.captainNote?.trim() || null }
              : {}),
            ...(body.data.squadName !== undefined ? { squadName: body.data.squadName } : {}),
          },
        });
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:edit", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; unitId: string } }>(
    "/api/v1/operations/:id/units/:unitId",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: p.data.unitId, operationId: p.data.id },
        select: { id: true },
      });
      if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");

      try {
        await deleteUnit(p.data.unitId, ctx.user.id, ctx.user.role);
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:delete", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/resource-links",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = ResourceLinkRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      // Operator-only (parity with the SSR route's requireOpRole fleetoperator).
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Operator role required.");

      const link = await addResourceLink(p.data.id, ctx.user.id, {
        url: body.data.url,
        title: body.data.title ?? null,
        kind: body.data.kind ?? null,
      });
      if (!link)
        return sendError(reply, req, 409, "conflict", "Invalid URL or link limit reached.");
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "resource_link:add", link.url);
      return reply.type("application/json").send({
        ok: true as const,
        link: { id: link.id, title: link.title, url: link.url, kind: link.kind, sortOrder: link.sortOrder },
      });
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>(
    "/api/v1/operations/:id/resource-links/:linkId",
    async (req, reply) => {
      const p = LinkParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Operator role required.");
      await removeResourceLink(p.data.id, p.data.linkId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "resource_link:remove", p.data.linkId);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── operator (read model + mutations; canManage-gated) ─────────────

  async function requireOperator(
    req: FastifyRequest,
    reply: FastifyReply,
    opId: string,
  ): Promise<AuthContext | null> {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return null;
    if (!(await canApproveUnits(ctx.user.id, ctx.user.role, opId))) {
      await sendError(reply, req, 403, "forbidden", "Operator role required.");
      return null;
    }
    return ctx;
  }

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/operator", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (!(await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id)))
      return sendError(reply, req, 403, "forbidden", "Operator role required.");

    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    const shares = await listSharedHangars(p.data.id);
    const o = op as {
      crewRequests: Array<{ user: { id: string; username: string }; note: string | null; createdAt: Date }>;
      questions: Array<{ id: string; asker: string; body: string; answer: string | null; answeredBy: string | null; createdAt: Date }>;
      auditLogs: Array<{ actor: string; action: string; detail: string; createdAt: Date }>;
    };
    const view: OperatorView = {
      crewRequests: o.crewRequests.map((r) => ({
        userId: r.user.id,
        username: r.user.username,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      questions: o.questions.map((q) => ({
        id: q.id,
        asker: q.asker,
        body: q.body,
        answer: q.answer,
        answeredBy: q.answeredBy,
        createdAt: q.createdAt.toISOString(),
      })),
      hangarShares: shares.map((s) => ({
        userId: s.userId,
        username: s.username,
        note: s.note,
        ships: s.ships,
      })),
      auditLogs: o.auditLogs.map((a) => ({
        actor: a.actor,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt.toISOString(),
      })),
    };
    return reply.type("application/json").send(view);
  });

  for (const decision of ["accept", "reject"] as const) {
    app.post<{ Params: { id: string; unitId: string }; Body: unknown }>(
      `/api/v1/operations/:id/units/:unitId/${decision}`,
      async (req, reply) => {
        const p = UnitParamSchema.safeParse(req.params);
        if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
        const body = UnitDecisionRequestSchema.safeParse(req.body ?? {});
        if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
        const ctx = await requireOperator(req, reply, p.data.id);
        if (!ctx) return;

        const unit = await prisma.fleetUnit.findFirst({
          where: { id: p.data.unitId, operationId: p.data.id },
          select: { id: true, unitType: true, shipId: true },
        });
        if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");

        try {
          await setUnitStatus(p.data.unitId, decision === "accept" ? "accepted" : "rejected", body.data.note);
          // Accept-into-slot parity with the SSR route: a full/mismatched slot
          // is skipped, the unit stays accepted but unslotted.
          if (decision === "accept" && body.data.requirementId) {
            try {
              await assertRequirementFitsUnit(p.data.id, body.data.requirementId, unit.unitType, unit.shipId ?? undefined, unit.id);
              await prisma.fleetUnit.update({
                where: { id: unit.id },
                data: { requirementId: body.data.requirementId },
              });
            } catch {
              /* accept unslotted */
            }
          }
          await logAudit(p.data.id, ctx.user.id, ctx.user.username, `unit:${decision}`, "");
          return reply.type("application/json").send({ ok: true as const });
        } catch (err) {
          return mutationError(reply, req, err);
        }
      },
    );
  }

  app.put<{ Params: { id: string; seatId: string }; Body: unknown }>(
    "/api/v1/operations/:id/seats/:seatId/assignment",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignSeatRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      try {
        await assignSeat(p.data.seatId, body.data.userId);
        // Parity with the SSR assign route: clear the flexible request and
        // notify the player via DM (best-effort).
        await prisma.crewAssignmentRequest.deleteMany({
          where: { operationId: p.data.id, userId: body.data.userId },
        });
        const assigned = await prisma.seatAssignment.findUnique({
          where: { id: p.data.seatId },
          include: { fleetUnit: { include: { ship: true, captain: true, operation: { select: { id: true, title: true } } } } },
        });
        if (assigned) {
          const env = getEnv();
          const unitName =
            assigned.fleetUnit.unitType === "ship"
              ? (assigned.fleetUnit.ship?.name ?? "Unknown Ship")
              : (assigned.fleetUnit.squadName ?? "Squad");
          sendSeatAssignmentDm(body.data.userId, {
            operationTitle: assigned.fleetUnit.operation.title,
            operationUrl: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${assigned.fleetUnit.operation.id}`,
            unitName,
            captainName: assigned.fleetUnit.captain.username,
            seatLabel: assigned.label,
          }).catch((err) => req.log.warn(err, "Seat assignment DM failed"));
        }
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:assign", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/assignment",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { order: true, fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");
      // The captain seat (order 0) can't be vacated — that would orphan the unit.
      if (seat.order === 0)
        return sendError(reply, req, 409, "conflict", "Cannot free the captain seat.");

      await prisma.seatAssignment.update({ where: { id: p.data.seatId }, data: { userId: null } });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:unassign", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.post<{ Params: { id: string; qid: string }; Body: unknown }>(
    "/api/v1/operations/:id/questions/:qid/answer",
    async (req, reply) => {
      const p = QuestionParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AnswerQuestionRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const result = await prisma.opQuestion.updateMany({
        where: { id: p.data.qid, operationId: p.data.id },
        data: { answer: body.data.answer.trim(), answeredBy: ctx.user.username, answeredAt: new Date() },
      });
      if (result.count === 0) return sendError(reply, req, 404, "not_found", "Question not found.");
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "answer", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── hangar ──────────────────────────────────────────────────────────
  // The caller's own ships (UserShip → Ship), for the "offer own ship" flow.
  app.get("/api/v1/hangar", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const rows = await prisma.userShip.findMany({
      where: { userId: ctx.user.id },
      include: { ship: true },
      orderBy: { ship: { name: "asc" } },
    });
    return reply
      .type("application/json")
      .send({ ships: rows.map((r) => presentShip(r.ship)) });
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
    // Framework 4xx (body parse, payload too large, …) keep their status as a
    // bad_request envelope; everything else is an opaque 500.
    const sc = (err as { statusCode?: unknown }).statusCode;
    const status = typeof sc === "number" && sc >= 400 && sc < 500 ? sc : 500;
    const body: ApiError = {
      error: {
        code: status === 500 ? "internal" : "bad_request",
        message: status === 500 ? "Internal error." : "Invalid request.",
        requestId: req.id,
      },
    };
    reply.code(status).type("application/json").send(body);
  });
}
