import type { FastifyInstance } from "fastify";
import { requireAuth, requireOpRole } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { searchLocalShips, shipCategory } from "../services/scwiki.js";
import {
  registerUnit,
  deleteUnit,
  setUnitStatus,
  claimSeat,
  assignSeat,
  unclaimSeat,
} from "../services/units.js";
import { setStatus, addLeader, removeLeader, getOperation } from "../services/operations.js";
import {
  assignCaptainDiscordRole,
  createScheduledEvent,
  deleteScheduledEvent,
  removeCaptainDiscordRoles,
  sendAcceptedCaptainVoiceDm,
  sendSeatAssignmentDm,
} from "../services/discord.js";
import {
  cleanupOperationVoiceChannels,
  deleteOperationVoiceChannel,
  launchOperationVoiceChannels,
  moveOperationCrewToVoiceChannels,
  renameOperationVoiceChannel,
} from "../services/voiceBots.js";
import {
  closeMissionVoiceSession,
  hasVoicePermission,
  openMissionVoiceSession,
} from "../services/voiceSession.js";
import {
  issueUnitLivekitToken,
  issueGlobalVoiceToken,
  issueMissionVoiceToken,
} from "../services/livekit.js";
import {
  createCompanionSession,
  createMissionVoiceSession,
  loadCompanionSession,
  loadMissionVoiceSession,
} from "../auth/companionSession.js";
import { discordUserIdForFleetplannerUser, fetchGuildMemberRoles } from "../services/discord.js";
import { prisma } from "../db.js";
import type { Ship } from "@prisma/client";

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

function opReturnUrl(
  opId: string,
  body: Record<string, string>,
  flash: string,
  fallbackTab = "overview",
): string {
  const tab = body.tab?.trim() || fallbackTab;
  const ui = body.ui === "new" ? `?tab=${encodeURIComponent(tab)}&flash=${flash}` : `?flash=${flash}`;
  return basePath(`/ops/${opId}${ui}`);
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

async function captainsWhoseEventRolesCanBeRemoved(operationId: string): Promise<string[]> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      guildId: true,
      units: { where: { status: "accepted" }, select: { captainId: true } },
    },
  });
  if (!op) return [];

  const captainIds = Array.from(new Set(op.units.map((unit) => unit.captainId)));
  const removable: string[] = [];
  for (const captainId of captainIds) {
    const otherActiveUnit = await prisma.fleetUnit.findFirst({
      where: {
        captainId,
        status: "accepted",
        operationId: { not: operationId },
        operation: {
          guildId: op.guildId,
          status: { in: ["open", "locked", "in_progress"] },
        },
      },
      select: { id: true },
    });
    if (!otherActiveUnit) removable.push(captainId);
  }
  return removable;
}

export async function apiRoutes(app: FastifyInstance) {
  // ── Ship search ──────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string } }>("/api/ships", async (req, reply) => {
    const q = req.query.q?.trim().slice(0, 80) ?? "";
    if (!q) return reply.send([]);
    const ships = await searchLocalShips(q, 20);
    return reply.send(
      ships.map((s) => ({
        id: s.id,
        slug: s.slug,
        name: s.name,
        manufacturer: s.manufacturer,
        size: shipSizeLabel(s),
        career: s.career,
        minCrew: s.minCrew,
        maxCrew: s.maxCrew,
        weaponCrew: s.weaponCrew,
        operationCrew: s.operationCrew,
      })),
    );
  });

  // ── Register fleet unit ──────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const {
        unitType,
        shipId,
        ownedShipId,
        storeOwnedShip,
        squadName,
        squadSize,
        requirementId,
        captainNote,
      } = req.body;

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
        const selectedShipId = unitType === "ship" ? shipId || ownedShipId : undefined;
        if (unitType === "ship") {
          if (!selectedShipId) throw new Error("Select or search a ship");
          const ship = await prisma.ship.findUnique({ where: { id: selectedShipId } });
          if (!ship) throw new Error("Ship not found");
        }
        const parsedSquadSize = squadSize ? parsePositiveInt(squadSize, 0) : undefined;
        if (
          unitType === "squad" &&
          (!parsedSquadSize || parsedSquadSize < 2 || parsedSquadSize > 8)
        ) {
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
          if (
            !REQUIREMENT_CATEGORIES.includes(
              requirement.category as (typeof REQUIREMENT_CATEGORIES)[number],
            )
          ) {
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
                throw new Error(
                  `Ship category ${category} does not match slot category ${requirement.category}`,
                );
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
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Unit+registered.", "fleet"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to register unit";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Unit+removed.", "fleet"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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
          operation: { select: { id: true, title: true, guildId: true } },
        },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      await setUnitStatus(req.params.unitId, "accepted");
      const env = getEnv();
      const unitName =
        unit.unitType === "ship"
          ? (unit.ship?.name ?? "Unknown Ship")
          : (unit.squadName ?? "Squad");
      const operationUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${unit.operation.id}`;
      const companionToken = await createCompanionSession(unit.captainId);
      const companionConfigUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/companion/configure?token=${encodeURIComponent(companionToken)}`;
      Promise.allSettled([
        assignCaptainDiscordRole(unit.captainId, unit.operation.guildId, "commander"),
        sendAcceptedCaptainVoiceDm(unit.captainId, {
          operationTitle: unit.operation.title,
          unitName,
          operationUrl,
          companionConfigUrl,
        }),
      ]).then((results) => {
        for (const result of results) {
          if (result.status === "rejected")
            app.log.warn(result.reason, "Accepted captain Discord follow-up failed");
        }
      });
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Unit+accepted.", "fleet"),
        302,
      );
    },
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
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "warn:Unit+rejected.", "fleet"),
        302,
      );
    },
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
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Invalid+Discord+role", "fleet"),
          302,
        );
      }

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        select: { status: true, captainId: true, operation: { select: { guildId: true } } },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      if (unit.status !== "accepted") {
        return reply.redirect(
          opReturnUrl(
            req.params.id,
            req.body,
            "error:Only+accepted+captains+can+receive+Discord+roles",
            "fleet",
          ),
          302,
        );
      }

      try {
        await assignCaptainDiscordRole(unit.captainId, unit.operation.guildId, role);
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Discord+role+assigned.", "fleet"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to assign Discord role";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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
      const canEditSeats = unit.captainId === ctx.user.id || seatOpRole === "fleetoperator";
      if (!canEditSeats) {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Forbidden`), 302);
      }

      try {
        await prisma.$transaction(
          unit.seats.map((seat) => {
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
          }),
        );
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Seat+setup+saved.", "fleet"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to save seat setup";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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

      // Mission voice session: open/in_progress → create rooms + grant roles
      if (newStatus === "open" || newStatus === "in_progress") {
        if (await hasVoicePermission(updated.guildId)) {
          openMissionVoiceSession(req.params.id).catch((err) =>
            app.log.warn(err, "Mission voice session open failed (non-fatal)"),
          );
        }
      }
      // Mission voice session: completed/cancelled → close rooms + revoke roles
      if (newStatus === "completed" || newStatus === "cancelled") {
        closeMissionVoiceSession(req.params.id).catch((err) =>
          app.log.warn(err, "Mission voice session close failed (non-fatal)"),
        );
      }

      // Create Discord scheduled event when op is opened
      let discordEventCreationFlash: string | null = null;
      if (newStatus === "open" && !updated.discordEventId) {
        const op = await getOperation(req.params.id);
        if (op) {
          try {
            app.log.info(
              `Creating Discord scheduled event for guild ${op.guildId} op ${req.params.id}`,
            );
            const event = await createScheduledEvent(op);
            if (event?.id) {
              await prisma.operation.update({
                where: { id: req.params.id },
                data: { discordEventId: event.id },
              });
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : "Discord event creation failed";
            app.log.warn(err, `Discord event creation failed for guild ${op.guildId} (non-fatal)`);
            discordEventCreationFlash = `warn:Status+updated,+Discord+event+failed:+${encodeURIComponent(msg)}`;
          }
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
      if (newStatus === "in_progress") {
        try {
          const moved = await moveOperationCrewToVoiceChannels(req.params.id);
          const skipped = moved.skippedDiscordUsers
            ? `+${moved.skippedDiscordUsers}+users+had+no+Discord+identity.`
            : "";
          const notConnected = moved.notConnected
            ? `+${moved.notConnected}+users+were+not+connected+to+voice.`
            : "";
          return reply.redirect(
            opReturnUrl(
              req.params.id,
              req.body,
              `ok:Status+updated.+Moved+${moved.moved}+crew+into+${moved.channels}+voice+channels.${notConnected}${skipped}`,
              "overview",
            ),
            302,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Voice move failed";
          return reply.redirect(
            opReturnUrl(
              req.params.id,
              req.body,
              `error:Status+updated,+voice+move+failed:+${encodeURIComponent(msg)}`,
              "overview",
            ),
            302,
          );
        }
      }
      if (newStatus === "completed" || newStatus === "cancelled") {
        try {
          const cleanup = await cleanupOperationVoiceChannels(req.params.id);
          const removableCaptainIds = await captainsWhoseEventRolesCanBeRemoved(req.params.id);
          await Promise.allSettled(
            removableCaptainIds.map((userId) => removeCaptainDiscordRoles(userId, updated.guildId)),
          );
          const skipped = cleanup.skippedDiscordUsers
            ? `+${cleanup.skippedDiscordUsers}+users+had+no+Discord+identity.`
            : "";
          const occupied = cleanup.skippedOccupied
            ? `+${cleanup.skippedOccupied}+voice+channels+were+left+because+members+are+still+connected.`
            : "";
          const unknown = cleanup.skippedUnknown
            ? `+${cleanup.skippedUnknown}+voice+channels+were+left+because+voice+occupancy+could+not+be+verified.`
            : "";
          return reply.redirect(
            opReturnUrl(
              req.params.id,
              req.body,
              `ok:Status+updated.+Deleted+${cleanup.deleted}+empty+voice+channels,+removed+${removableCaptainIds.length}+captain+voice+roles.${occupied}${unknown}${skipped}`,
              "overview",
            ),
            302,
          );
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Voice cleanup failed";
          return reply.redirect(
            opReturnUrl(
              req.params.id,
              req.body,
              `error:Status+updated,+voice+cleanup+failed:+${encodeURIComponent(msg)}`,
              "overview",
            ),
            302,
          );
        }
      }
      const finalFlash = discordEventCreationFlash ?? "ok:Status+updated.";
      return reply.redirect(opReturnUrl(req.params.id, req.body, finalFlash, "overview"), 302);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-channels/launch",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      try {
        const result = await launchOperationVoiceChannels(req.params.id);
        const skipped = result.skippedDiscordUsers
          ? `+${result.skippedDiscordUsers}+users+had+no+Discord+identity.`
          : "";
        return reply.redirect(
          opReturnUrl(
            req.params.id,
            req.body,
            `ok:Created+${result.created}+voice+channels,+assigned+${result.botsAssigned}+bots.${skipped}`,
            "voice",
          ),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to launch voice channels";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "voice"),
          302,
        );
      }
    },
  );

  app.post<{ Params: { id: string; voiceChannelId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-channels/:voiceChannelId/rename",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      try {
        await renameOperationVoiceChannel({
          operationId: req.params.id,
          voiceChannelId: req.params.voiceChannelId,
          name: req.body.name ?? "",
        });
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Voice+channel+renamed.", "voice"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to rename voice channel";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "voice"),
          302,
        );
      }
    },
  );

  app.post<{ Params: { id: string; voiceChannelId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-channels/:voiceChannelId/delete",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      try {
        await deleteOperationVoiceChannel({
          operationId: req.params.id,
          voiceChannelId: req.params.voiceChannelId,
        });
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Voice+channel+deleted.", "voice"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to delete voice channel";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "voice"),
          302,
        );
      }
    },
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
        return reply.redirect(opReturnUrl(opId, req.body, "ok:Seat+claimed.", "fleet"), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(
          opReturnUrl(opId, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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
        return reply.redirect(opReturnUrl(opId, req.body, "error:Forbidden", "fleet"), 302);
      }

      const targetUserId = req.body.userId;
      if (!targetUserId) {
        return reply.redirect(opReturnUrl(opId, req.body, "error:User+required", "fleet"), 302);
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
          const unitName =
            assignedSeat.fleetUnit.unitType === "ship"
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
        return reply.redirect(opReturnUrl(opId, req.body, "ok:Seat+assigned.", "fleet"), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(
          opReturnUrl(opId, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/crew-requests",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const op = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true },
      });
      if (!op) return reply.code(404).send({ error: "Operation not found" });
      if (op.status !== "open" && op.status !== "draft") {
        return reply.redirect(
          basePath(`/ops/${req.params.id}?flash=error:Operation+is+not+open+for+registration`),
          302,
        );
      }
      const note = req.body.note?.trim().slice(0, 240) || null;
      await prisma.crewAssignmentRequest.upsert({
        where: { operationId_userId: { operationId: req.params.id, userId: ctx.user.id } },
        create: { operationId: req.params.id, userId: ctx.user.id, note },
        update: { note },
      });
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Crew+assignment+request+saved.", "crew"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/crew-requests/remove",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const targetUserId = req.body.userId || ctx.user.id;
      const canRemoveOther =
        (await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id)) === "fleetoperator";
      if (targetUserId !== ctx.user.id && !canRemoveOther) {
        return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Forbidden", "crew"), 302);
      }
      await prisma.crewAssignmentRequest.deleteMany({
        where: { operationId: req.params.id, userId: targetUserId },
      });
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Crew+request+removed.", "crew"),
        302,
      );
    },
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
        return reply.redirect(opReturnUrl(opId, req.body, "ok:Seat+released.", "fleet"), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed";
        return reply.redirect(
          opReturnUrl(opId, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
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
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, active: true },
      });
      if (!user || !user.active) {
        return reply.redirect(
          basePath(`/ops/${req.params.id}?flash=error:User+account+not+found+or+inactive`),
          302,
        );
      }
      const validRoles = ["event_leader", "fleet_commander", "raid_leader", "wing_commander"];
      await addLeader(
        req.params.id,
        userId,
        validRoles.includes(leaderRole) ? leaderRole : "event_leader",
      );
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Leader+added.", "admin"), 302);
    },
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
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Leader+removed.", "admin"),
        302,
      );
    },
  );

  // ── Composition groups ───────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/groups",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const name = req.body.name?.trim();
      if (!name)
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Group+name+required", "fleet"),
          302,
        );
      const last = await prisma.compositionGroup.aggregate({
        where: { operationId: req.params.id },
        _max: { order: true },
      });
      await prisma.compositionGroup.create({
        data: { operationId: req.params.id, name, order: (last._max.order ?? -1) + 1 },
      });
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Group+added.", "fleet"), 302);
    },
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
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Group+deleted.", "fleet"),
        302,
      );
    },
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
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Label+and+category+required", "fleet"),
          302,
        );
      }
      if (!REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Invalid+category", "fleet"),
          302,
        );
      }
      const group = await prisma.compositionGroup.findFirst({
        where: { id: req.params.groupId, operationId: req.params.id },
        select: { id: true },
      });
      if (!group) return reply.code(404).send({ error: "Group not found" });
      const last = await prisma.compositionRequirement.aggregate({
        where: { groupId: req.params.groupId },
        _max: { order: true },
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
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Requirement+added.", "fleet"),
        302,
      );
    },
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
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Requirement+deleted.", "fleet"),
        302,
      );
    },
  );

  // ── Fleet voice token ────────────────────────────────────────────────
  // Returns a LiveKit token for the caller's accepted unit in this operation.
  // captains: auto-resolved; crew: auto-resolved from seat; fleetoperators:
  // may pass ?unitId= to get a token for any accepted unit.
  app.get<{ Params: { id: string }; Querystring: { unitId?: string } }>(
    "/api/ops/:id/voice-token",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;

      const op = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { id: true, title: true, guildId: true, status: true },
      });
      if (!op) return reply.code(404).send({ error: "Operation not found" });

      const userId = ctx.user.id;
      let unitId = req.query.unitId;

      if (!unitId) {
        const asCaptain = await prisma.fleetUnit.findFirst({
          where: { operationId: op.id, captainId: userId, status: "accepted" },
          select: { id: true },
        });
        if (asCaptain) {
          unitId = asCaptain.id;
        } else {
          const asCrew = await prisma.seatAssignment.findFirst({
            where: { userId, active: true, fleetUnit: { operationId: op.id, status: "accepted" } },
            select: { unitId: true },
          });
          if (asCrew) unitId = asCrew.unitId;
        }
      }

      if (!unitId)
        return reply
          .code(403)
          .send({ error: "No accepted unit found for this user in this operation" });

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: unitId, operationId: op.id, status: "accepted" },
        select: { id: true },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found or not accepted" });

      const result = await issueUnitLivekitToken(userId, op.id, unit.id);
      if (!result)
        return reply.code(503).send({ error: "LiveKit is not configured on this server" });

      return reply.send({ ...result, opTitle: op.title });
    },
  );

  // ── Companion auto-voice endpoint ────────────────────────────────────
  // Used by the companion app's 20s polling loop. Bearer token issued
  // by /auth/discord/companion/callback. Returns the caller's active fleet
  // unit room token (if in an accepted unit in an active op) and, if they
  // hold the guild's globalVoiceRoleId Discord role, a global voice token.
  app.get("/api/companion/voice", async (req, reply) => {
    const authHeader = (req.headers as Record<string, string | undefined>).authorization;
    if (!authHeader?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
    const userId = await loadCompanionSession(authHeader.slice(7));
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const ACTIVE_STATUSES = ["open", "locked", "in_progress"] as const;

    // Find active accepted unit as captain
    let activeUnit = await prisma.fleetUnit.findFirst({
      where: {
        captainId: userId,
        status: "accepted",
        operation: { status: { in: [...ACTIVE_STATUSES] } },
      },
      include: { operation: { include: { guild: true } } },
      orderBy: { createdAt: "desc" },
    });

    // Fall back to crew seat
    if (!activeUnit) {
      const crewSeat = await prisma.seatAssignment.findFirst({
        where: {
          userId,
          active: true,
          fleetUnit: {
            status: "accepted",
            operation: { status: { in: [...ACTIVE_STATUSES] } },
          },
        },
        include: { fleetUnit: { include: { operation: { include: { guild: true } } } } },
      });
      if (crewSeat) activeUnit = crewSeat.fleetUnit;
    }

    let unitRoom: { livekitUrl: string; token: string; room: string; opTitle: string } | null =
      null;
    let globalVoice: { livekitUrl: string; token: string; room: string } | null = null;

    if (activeUnit) {
      const op = activeUnit.operation;
      const guild = op.guild;

      const ut = await issueUnitLivekitToken(userId, op.id, activeUnit.id);
      if (ut) unitRoom = { ...ut, opTitle: op.title };

      // Global voice: dedicated Globaltalk role if configured; otherwise
      // fall back to the Admiral mapping role for older guild settings.
      const globalVoiceRoleId = guild.globalVoiceRoleId ?? guild.admiralRoleId;
      if (globalVoiceRoleId) {
        try {
          const discordId = await discordUserIdForFleetplannerUser(userId);
          const roles = await fetchGuildMemberRoles(op.guildId, discordId);
          if (roles?.includes(globalVoiceRoleId)) {
            const gvt = await issueGlobalVoiceToken(userId, op.id);
            if (gvt) globalVoice = gvt;
          }
        } catch {
          // no Discord identity or role lookup failed → no global voice
        }
      }
    }

    return reply.send({ unitRoom, globalVoice });
  });

  // ── Mission Voice Session — companion polling endpoint ──────────────
  // Returns the two mission voice rooms (global + optional commander)
  // for the user's currently active operation.
  app.get("/api/companion/mission-voice", async (req, reply) => {
    const authHeader = (req.headers as Record<string, string | undefined>).authorization;
    if (!authHeader?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
    const userId = await loadMissionVoiceSession(authHeader.slice(7));
    if (!userId) return reply.code(401).send({ error: "unauthorized" });

    const ACTIVE_STATUSES = ["open", "locked", "in_progress"] as const;

    // Find op where user is accepted captain or has a claimed seat
    let activeOp: Awaited<ReturnType<typeof prisma.operation.findFirst>> | null = null;
    const captainUnit = await prisma.fleetUnit.findFirst({
      where: {
        captainId: userId,
        status: "accepted",
        operation: { status: { in: [...ACTIVE_STATUSES] } },
      },
      include: { operation: true },
      orderBy: { createdAt: "desc" },
    });
    if (captainUnit) activeOp = captainUnit.operation;

    if (!activeOp) {
      const crewSeat = await prisma.seatAssignment.findFirst({
        where: {
          userId,
          active: true,
          fleetUnit: { status: "accepted", operation: { status: { in: [...ACTIVE_STATUSES] } } },
        },
        include: { fleetUnit: { include: { operation: true } } },
      });
      if (crewSeat) activeOp = crewSeat.fleetUnit.operation;
    }

    // Fleetoperators without a specific unit also get access
    if (!activeOp) {
      const fpMembership = await prisma.guildMembership.findFirst({
        where: { userId, role: "fleetoperator" },
        select: { guildId: true },
      });
      if (fpMembership) {
        activeOp = await prisma.operation.findFirst({
          where: { guildId: fpMembership.guildId, status: { in: [...ACTIVE_STATUSES] } },
          orderBy: { updatedAt: "desc" },
        });
      }
    }

    if (!activeOp) return reply.send({ op: null });

    // Voice permission check
    if (
      !(await (async () => {
        const env = getEnv();
        if (env.RAUMDOCK_GUILD_ID && activeOp!.guildId === env.RAUMDOCK_GUILD_ID) return true;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const g = (await (prisma.guild.findUnique as any)({
          where: { id: activeOp!.guildId },
          select: { voiceEnabled: true },
        })) as { voiceEnabled: boolean } | null;
        return g?.voiceEnabled ?? false;
      })())
    )
      return reply.send({ op: null });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalRoom = (activeOp as any).globalVoiceRoom as string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commanderRoom = (activeOp as any).commanderVoiceRoom as string | null;
    if (!globalRoom) return reply.send({ op: null });

    const env = getEnv();
    const globalToken = await issueMissionVoiceToken(userId, globalRoom);
    if (!globalToken || !env.LIVEKIT_URL) return reply.send({ op: null });

    // Commander room eligibility: captains of accepted units OR fleetoperators
    const isCommander = !!(
      captainUnit ||
      (await prisma.guildMembership.findFirst({
        where: { userId, guildId: activeOp.guildId, role: "fleetoperator" },
        select: { id: true },
      }))
    );
    const commanderToken =
      isCommander && commanderRoom ? await issueMissionVoiceToken(userId, commanderRoom) : null;

    return reply.send({
      op: {
        opId: activeOp.id,
        opTitle: activeOp.title,
        livekitUrl: env.LIVEKIT_URL,
        globalRoom: { room: globalRoom, token: globalToken },
        commanderRoom:
          commanderToken && commanderRoom ? { room: commanderRoom, token: commanderToken } : null,
      },
    });
  });

  // ── Generate fleet voice links (fleetoperator → distribute to crew) ─
  app.post<{ Params: { opId: string } }>("/api/ops/:opId/voice-links", async (req, reply) => {
    const ctx = await requireOpRole(req, reply, req.params.opId, "fleetoperator");
    if (!ctx) return;

    const op = await getOperation(req.params.opId);
    if (!op) return reply.code(404).send({ error: "Not found" });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const globalRoom = (op as any).globalVoiceRoom as string | null;
    if (!globalRoom)
      return reply.code(400).send({ error: "No active voice session for this operation" });

    const env = getEnv();
    if (!env.LIVEKIT_URL) return reply.code(400).send({ error: "LiveKit not configured" });

    // Collect eligible users: accepted captains + guild fleetoperators
    const captainIds = new Set<string>(
      op.units.filter((u) => u.status === "accepted").map((u) => u.captainId),
    );
    const fleetopMembers = await prisma.guildMembership.findMany({
      where: { guildId: op.guildId, role: "fleetoperator" },
      include: { user: { select: { id: true, username: true } } },
    });
    const allUserIds = new Set<string>([...captainIds, ...fleetopMembers.map((m) => m.userId)]);

    // Fetch usernames for captains
    const captainUsers = await prisma.user.findMany({
      where: { id: { in: [...captainIds] } },
      select: { id: true, username: true },
    });
    const usernameMap = new Map<string, string>(captainUsers.map((u) => [u.id, u.username]));
    for (const m of fleetopMembers) usernameMap.set(m.userId, m.user.username);

    const baseUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const fleetplannerUrl = baseUrl;

    // Create companion sessions + build links
    const links: Array<{ userId: string; username: string; link: string }> = [];
    for (const uid of allUserIds) {
      const token = await createMissionVoiceSession(uid);
      const params = new URLSearchParams({ token, url: fleetplannerUrl });
      links.push({
        userId: uid,
        username: usernameMap.get(uid) ?? uid,
        link: `dccc://fleet-voice?${params.toString()}`,
      });
    }

    return reply.send({ links });
  });
}
