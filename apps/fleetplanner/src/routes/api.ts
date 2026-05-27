import type { FastifyInstance } from "fastify";
import { requireAuth, requireRole } from "../auth/middleware.js";
import { basePath } from "../config/env.js";
import { searchShips } from "../services/scwiki.js";
import { registerUnit, deleteUnit, setUnitStatus, claimSeat, unclaimSeat } from "../services/units.js";
import { setStatus, addLeader, removeLeader, getOperation } from "../services/operations.js";
import { createScheduledEvent } from "../services/discord.js";
import { prisma } from "../db.js";

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

export async function apiRoutes(app: FastifyInstance) {

  // ── Ship search ──────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>(
    "/api/ships",
    async (req, reply) => {
      const q = req.query.q?.trim() ?? "";
      if (!q) return reply.send([]);
      const ships = await searchShips(q, 20);
      return reply.send(ships.map((s) => ({
        id: s.id, slug: s.slug, name: s.name,
        manufacturer: s.manufacturer, size: s.size, career: s.career,
        minCrew: s.minCrew, maxCrew: s.maxCrew,
        weaponCrew: s.weaponCrew, operationCrew: s.operationCrew,
      })));
    }
  );

  // ── Register fleet unit ──────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const { unitType, shipId, squadName, squadSize, requirementId, captainNote } = req.body;

      // Verify operation exists and is open
      const op = await prisma.operation.findUnique({ where: { id: req.params.id } });
      if (!op) return reply.code(404).send({ error: "Operation not found" });
      if (op.status !== "open" && op.status !== "draft") {
        return reply.code(409).send({ error: "Operation is not open for registration" });
      }

      // One unit per user per operation
      const existing = await prisma.fleetUnit.findFirst({
        where: { operationId: req.params.id, captainId: ctx.user.id },
      });
      if (existing) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:You+already+have+a+unit+in+this+operation`), 302);
      }

      try {
        await registerUnit(req.params.id, ctx.user.id, {
          unitType: unitType as "ship" | "squad",
          shipId: shipId || undefined,
          squadName: squadName || undefined,
          squadSize: squadSize ? parseInt(squadSize, 10) : undefined,
          requirementId: requirementId || undefined,
          captainNote: captainNote || undefined,
        });
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Unit+registered.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to register unit";
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  // ── Delete fleet unit ────────────────────────────────────────────────
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/delete",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      try {
        await deleteUnit(req.params.unitId, ctx.user.id, ctx.user.role);
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Unit+removed.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  // ── Accept / reject unit ─────────────────────────────────────────────
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/accept",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await setUnitStatus(req.params.unitId, "accepted");
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Unit+accepted.`), 302);
    }
  );

  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/reject",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await setUnitStatus(req.params.unitId, "rejected", req.body.note);
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=warn:Unit+rejected.`), 302);
    }
  );

  // ── Operation status change ──────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/status",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const valid = ["draft", "open", "locked", "in_progress", "completed", "cancelled"];
      const newStatus = req.body.status;
      if (!valid.includes(newStatus)) return reply.code(400).send({ error: "Invalid status" });
      await setStatus(req.params.id, newStatus);
      // Create Discord scheduled event when op is opened
      if (newStatus === "open") {
        const op = await getOperation(req.params.id);
        if (op) {
          createScheduledEvent(op).catch((err) =>
            app.log.warn(err, "Discord event creation failed (non-fatal)")
          );
        }
      }
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Status+updated.`), 302);
    }
  );

  // ── Claim / unclaim seat ─────────────────────────────────────────────
  app.post<{ Params: { seatId: string }; Body: Record<string, string> }>(
    "/api/seats/:seatId/claim",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      // Find the operation so we can redirect back
      const seat = await prisma.seatAssignment.findUnique({
        where: { id: req.params.seatId },
        include: { fleetUnit: { select: { operationId: true } } },
      });
      const opId = seat?.fleetUnit.operationId;

      try {
        await claimSeat(req.params.seatId, ctx.user.id);
        return reply.redirect(basePath(`/ops/${opId}?flash=ok:Seat+claimed.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(basePath(`/ops/${opId}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { seatId: string }; Body: Record<string, string> }>(
    "/api/seats/:seatId/unclaim",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: req.params.seatId },
        include: { fleetUnit: { select: { operationId: true } } },
      });
      const opId = seat?.fleetUnit.operationId;

      try {
        await unclaimSeat(req.params.seatId, ctx.user.id, ctx.user.role);
        return reply.redirect(basePath(`/ops/${opId}?flash=ok:Seat+released.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(basePath(`/ops/${opId}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  // ── Leader management ────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/leaders",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { userId, leaderRole } = req.body;
      if (!userId) return reply.code(400).send({ error: "userId required" });
      await addLeader(req.params.id, userId, leaderRole ?? "raid_leader");
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Leader+added.`), 302);
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/leaders/remove",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { userId } = req.body;
      if (!userId) return reply.code(400).send({ error: "userId required" });
      await removeLeader(req.params.id, userId);
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Leader+removed.`), 302);
    }
  );

  // ── Composition groups ───────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/groups",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const name = req.body.name?.trim();
      if (!name) return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Group+name+required`), 302);
      const last = await prisma.compositionGroup.aggregate({
        where: { operationId: req.params.id }, _max: { order: true },
      });
      await prisma.compositionGroup.create({
        data: { operationId: req.params.id, name, order: (last._max.order ?? -1) + 1 },
      });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Group+added.`), 302);
    }
  );

  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/groups/:groupId/delete",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await prisma.compositionGroup.delete({ where: { id: req.params.groupId } });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Group+deleted.`), 302);
    }
  );

  // ── Composition requirements ─────────────────────────────────────────
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/groups/:groupId/requirements",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { label, category, count, note } = req.body;
      if (!label?.trim() || !category) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Label+and+category+required`), 302);
      }
      const last = await prisma.compositionRequirement.aggregate({
        where: { groupId: req.params.groupId }, _max: { order: true },
      });
      await prisma.compositionRequirement.create({
        data: {
          groupId: req.params.groupId,
          label: label.trim(),
          category,
          count: Math.max(1, parseInt(count ?? "1", 10)),
          note: note?.trim() || null,
          order: (last._max.order ?? -1) + 1,
        },
      });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Requirement+added.`), 302);
    }
  );

  app.post<{ Params: { id: string; reqId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/requirements/:reqId/delete",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await prisma.compositionRequirement.delete({ where: { id: req.params.reqId } });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Requirement+deleted.`), 302);
    }
  );
}
