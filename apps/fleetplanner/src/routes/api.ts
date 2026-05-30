import type { FastifyInstance } from "fastify";
import { requireAuth, requireOpRole } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { searchLocalShips, shipCategory } from "../services/scwiki.js";
import { registerUnit, deleteUnit, setUnitStatus, claimSeat, assignSeat, unclaimSeat } from "../services/units.js";
import { setStatus, addLeader, removeLeader, getOperation } from "../services/operations.js";
import { assignCaptainDiscordRole, createScheduledEvent, deleteScheduledEvent, sendAcceptedCaptainVoiceDm, sendSeatAssignmentDm } from "../services/discord.js";
import { prisma } from "../db.js";
import type { Ship } from "@prisma/client";

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

const UNIT_TYPES = ["ship", "squad"] as const;
const REQUIREMENT_CATEGORIES = [
  "capital",
  "subcapital",
  "fighter",
  "support",
  "ground",
  "transport",
  "mining",
  "salvage",
  "exploration",
  "any",
] as const;

function parsePositiveInt(raw: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function shipSizeLabel(ship: Pick<Ship, "size" | "rawJson">): string {
  if (ship.size && ship.size !== "[object Object]") return ship.size;
  try {
    const raw = JSON.parse(ship.rawJson) as { size?: unknown };
    if (typeof raw.size === "string" || typeof raw.size === "number") return String(raw.size);
    if (raw.size && typeof raw.size === "object") {
      const size = raw.size as Record<string, unknown>;
      return String(size.en_EN ?? size.name ?? size.label ?? size.type ?? "");
    }
  } catch {
    // Ignore invalid legacy cache rows.
  }
  return "";
}

export async function apiRoutes(app: FastifyInstance) {

  // ── Ship search ──────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>(
    "/api/ships",
    async (req, reply) => {
      const q = req.query.q?.trim().slice(0, 80) ?? "";
      if (!q) return reply.send([]);
      const ships = await searchLocalShips(q, 20);
      return reply.send(ships.map((s) => ({
        id: s.id, slug: s.slug, name: s.name,
        manufacturer: s.manufacturer, size: shipSizeLabel(s), career: s.career,
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

      const { unitType, shipId, ownedShipId, storeOwnedShip, squadName, squadSize, requirementId, captainNote } = req.body;

      // Verify operation exists and is open
      const op = await prisma.operation.findUnique({ where: { id: req.params.id } });
      if (!op) return reply.code(404).send({ error: "Operation not found" });
      if (op.status !== "open" && op.status !== "draft") {
        return reply.code(409).send({ error: "Operation is not open for registration" });
      }

      try {
        if (!UNIT_TYPES.includes(unitType as (typeof UNIT_TYPES)[number])) {
          throw new Error("Invalid unit type");
        }
        const selectedShipId = unitType === "ship" ? (shipId || ownedShipId) : undefined;
        if (unitType === "ship") {
          if (!selectedShipId) throw new Error("Select or search a ship");
          const ship = await prisma.ship.findUnique({ where: { id: selectedShipId } });
          if (!ship) throw new Error("Ship not found");
        }
        const parsedSquadSize = squadSize ? parsePositiveInt(squadSize, 0) : undefined;
        if (unitType === "squad" && (!parsedSquadSize || parsedSquadSize < 2 || parsedSquadSize > 8)) {
          throw new Error("Squad size must be between 2 and 8");
        }
        if (requirementId) {
          const requirement = await prisma.compositionRequirement.findUnique({
            where: { id: requirementId },
            include: {
              group: { select: { operationId: true } },
              fleetUnits: { select: { status: true } },
            },
          });
          if (!requirement || requirement.group.operationId !== req.params.id) {
            throw new Error("Composition slot does not belong to this operation");
          }
          const filled = requirement.fleetUnits.filter((u) => u.status !== "rejected").length;
          if (filled >= requirement.count) {
            throw new Error("Composition slot is already full");
          }
          if (!REQUIREMENT_CATEGORIES.includes(requirement.category as (typeof REQUIREMENT_CATEGORIES)[number])) {
            throw new Error("Composition slot has an invalid category");
          }
          if (requirement.category !== "any") {
            if (unitType === "squad" && requirement.category !== "ground") {
              throw new Error("FPS squads can only fill ground or any slots");
            }
            if (unitType === "ship" && selectedShipId) {
              const ship = await prisma.ship.findUnique({ where: { id: selectedShipId } });
              if (!ship) throw new Error("Ship not found");
              const category = shipCategory(ship);
              if (category !== "any" && category !== requirement.category) {
                throw new Error(`Ship category ${category} does not match slot category ${requirement.category}`);
              }
            }
          }
        }
        if (unitType === "ship" && selectedShipId && storeOwnedShip === "1") {
          await prisma.userShip.upsert({
            where: { userId_shipId: { userId: ctx.user.id, shipId: selectedShipId } },
            create: { userId: ctx.user.id, shipId: selectedShipId },
            update: {},
          });
        }
        await registerUnit(req.params.id, ctx.user.id, {
          unitType: unitType as "ship" | "squad",
          shipId: selectedShipId,
          squadName: squadName || undefined,
          squadSize: parsedSquadSize,
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
        const unit = await prisma.fleetUnit.findFirst({
          where: { id: req.params.unitId, operationId: req.params.id },
          select: { id: true },
        });
        if (!unit) return reply.code(404).send({ error: "Unit not found" });
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
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        include: {
          ship: true,
          operation: { select: { id: true, title: true } },
        },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      await setUnitStatus(req.params.unitId, "accepted");
      const env = getEnv();
      const unitName = unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
      const operationUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${unit.operation.id}`;
      Promise.allSettled([
        assignCaptainDiscordRole(unit.captainId, "commander"),
        sendAcceptedCaptainVoiceDm(unit.captainId, {
          operationTitle: unit.operation.title,
          unitName,
          operationUrl,
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") app.log.warn(result.reason, "Accepted captain Discord follow-up failed");
        }
      });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Unit+accepted.`), 302);
    }
  );

  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/reject",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        select: { id: true },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      await setUnitStatus(req.params.unitId, "rejected", req.body.note);
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=warn:Unit+rejected.`), 302);
    }
  );

  // ── Operation status change ──────────────────────────────────────────
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/discord-role",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const role = req.body.role;
      if (role !== "commander" && role !== "admiral") {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Invalid+Discord+role`), 302);
      }

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        select: { status: true, captainId: true },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      if (unit.status !== "accepted") {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Only+accepted+captains+can+receive+Discord+roles`), 302);
      }

      try {
        await assignCaptainDiscordRole(unit.captainId, role);
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Discord+role+assigned.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to assign Discord role";
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/seats",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        include: { seats: { orderBy: { order: "asc" } } },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });

      const seatOpRole = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
      const canEditSeats =
        unit.captainId === ctx.user.id ||
        seatOpRole === "fleetoperator";
      if (!canEditSeats) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Forbidden`), 302);
      }

      try {
        await prisma.$transaction(unit.seats.map((seat) => {
          const rawLabel = req.body[`label_${seat.id}`]?.trim();
          const label = rawLabel ? rawLabel.slice(0, 40) : seat.label;
          const active = seat.order === 0 || req.body[`active_${seat.id}`] === "1";
          return prisma.seatAssignment.update({
            where: { id: seat.id },
            data: {
              label,
              active,
              ...(active ? {} : { userId: null }),
            },
          });
        }));
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Seat+setup+saved.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save seat setup";
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/status",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const valid = ["draft", "open", "locked", "in_progress", "completed", "cancelled"];
      const newStatus = req.body.status;
      if (!valid.includes(newStatus)) return reply.code(400).send({ error: "Invalid status" });
      const updated = await setStatus(req.params.id, newStatus);
      // Create Discord scheduled event when op is opened
      if (newStatus === "open" && !updated.discordEventId) {
        const op = await getOperation(req.params.id);
        if (op) {
          createScheduledEvent(op)
            .then((event) => {
              if (event?.id) {
                return prisma.operation.update({
                  where: { id: req.params.id },
                  data: { discordEventId: event.id },
                });
              }
              return null;
            })
            .catch((err) => app.log.warn(err, "Discord event creation failed (non-fatal)"));
        }
      }
      if (newStatus === "cancelled" && updated.discordEventId) {
        deleteScheduledEvent(updated.guildId, updated.discordEventId)
          .then(() =>
            prisma.operation.update({
              where: { id: req.params.id },
              data: { discordEventId: null },
            }),
          )
          .catch((err) => app.log.warn(err, "Discord event deletion failed (non-fatal)"));
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
      if (!opId) return reply.code(404).send({ error: "Seat not found" });

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
    "/api/seats/:seatId/assign",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: req.params.seatId },
        include: {
          fleetUnit: {
            select: {
              operationId: true,
              operation: { select: { leaders: { select: { userId: true } } } },
            },
          },
        },
      });
      const opId = seat?.fleetUnit.operationId;
      if (!opId) return reply.code(404).send({ error: "Seat not found" });

      const assignOpRole = await effectiveOpRole(ctx.user.id, ctx.user.role, opId);
      const canAssign =
        assignOpRole === "fleetoperator" ||
        seat.fleetUnit.operation.leaders.some((leader) => leader.userId === ctx.user.id);
      if (!canAssign) {
        return reply.redirect(basePath(`/ops/${opId}?flash=error:Forbidden`), 302);
      }

      const targetUserId = req.body.userId;
      if (!targetUserId) {
        return reply.redirect(basePath(`/ops/${opId}?flash=error:User+required`), 302);
      }

      try {
        await assignSeat(req.params.seatId, targetUserId);
        const env = getEnv();
        const assignedSeat = await prisma.seatAssignment.findUnique({
          where: { id: req.params.seatId },
          include: {
            fleetUnit: {
              include: {
                ship: true,
                captain: true,
                operation: { select: { id: true, title: true } },
              },
            },
          },
        });
        if (assignedSeat) {
          await prisma.crewAssignmentRequest.deleteMany({
            where: { operationId: assignedSeat.fleetUnit.operationId, userId: targetUserId },
          });
          const unitName = assignedSeat.fleetUnit.unitType === "ship"
            ? (assignedSeat.fleetUnit.ship?.name ?? "Unknown Ship")
            : (assignedSeat.fleetUnit.squadName ?? "Squad");
          sendSeatAssignmentDm(targetUserId, {
            operationTitle: assignedSeat.fleetUnit.operation.title,
            operationUrl: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${assignedSeat.fleetUnit.operation.id}`,
            unitName,
            captainName: assignedSeat.fleetUnit.captain.username,
            seatLabel: assignedSeat.label,
          }).catch((err) => app.log.warn(err, "Seat assignment DM failed"));
        }
        return reply.redirect(basePath(`/ops/${opId}?flash=ok:Seat+assigned.`), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(basePath(`/ops/${opId}?flash=error:${encodeURIComponent(msg)}`), 302);
      }
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/crew-requests",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const op = await prisma.operation.findUnique({ where: { id: req.params.id }, select: { id: true, status: true } });
      if (!op) return reply.code(404).send({ error: "Operation not found" });
      if (op.status !== "open" && op.status !== "draft") {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Operation+is+not+open+for+registration`), 302);
      }
      const note = req.body.note?.trim().slice(0, 240) || null;
      await prisma.crewAssignmentRequest.upsert({
        where: { operationId_userId: { operationId: req.params.id, userId: ctx.user.id } },
        create: { operationId: req.params.id, userId: ctx.user.id, note },
        update: { note },
      });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Crew+assignment+request+saved.`), 302);
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/crew-requests/remove",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const targetUserId = req.body.userId || ctx.user.id;
      const canRemoveOther = (await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id)) === "fleetoperator";
      if (targetUserId !== ctx.user.id && !canRemoveOther) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Forbidden`), 302);
      }
      await prisma.crewAssignmentRequest.deleteMany({ where: { operationId: req.params.id, userId: targetUserId } });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Crew+request+removed.`), 302);
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
      if (!opId) return reply.code(404).send({ error: "Seat not found" });

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
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { userId, leaderRole } = req.body;
      if (!userId) return reply.code(400).send({ error: "userId required" });
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, active: true } });
      if (!user || !user.active) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:User+account+not+found+or+inactive`), 302);
      }
      const validRoles = ["event_leader", "fleet_commander", "raid_leader", "wing_commander"];
      await addLeader(req.params.id, userId, validRoles.includes(leaderRole) ? leaderRole : "event_leader");
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Leader+added.`), 302);
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/leaders/remove",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
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
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
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
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const group = await prisma.compositionGroup.findFirst({
        where: { id: req.params.groupId, operationId: req.params.id },
        select: { id: true },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });
      await prisma.compositionGroup.delete({ where: { id: req.params.groupId } });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Group+deleted.`), 302);
    }
  );

  // ── Composition requirements ─────────────────────────────────────────
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/groups/:groupId/requirements",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { label, category, count, note } = req.body;
      if (!label?.trim() || !category) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Label+and+category+required`), 302);
      }
      if (!REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Invalid+category`), 302);
      }
      const group = await prisma.compositionGroup.findFirst({
        where: { id: req.params.groupId, operationId: req.params.id },
        select: { id: true },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });
      const last = await prisma.compositionRequirement.aggregate({
        where: { groupId: req.params.groupId }, _max: { order: true },
      });
      await prisma.compositionRequirement.create({
        data: {
          groupId: req.params.groupId,
          label: label.trim(),
          category,
          count: Math.min(20, Math.max(1, parsePositiveInt(count, 1))),
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
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const requirement = await prisma.compositionRequirement.findFirst({
        where: { id: req.params.reqId, group: { operationId: req.params.id } },
        select: { id: true },
      });
      if (!requirement) return reply.code(404).send({ error: "Requirement not found" });
      await prisma.compositionRequirement.delete({ where: { id: req.params.reqId } });
      return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Requirement+deleted.`), 302);
    }
  );
}
