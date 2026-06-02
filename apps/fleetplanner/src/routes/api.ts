import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
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
  discordUserIdForFleetplannerUser,
  createScheduledEvent,
  deleteScheduledEvent,
  sendAcceptedCaptainVoiceDm,
  sendDiscordDm,
  sendSeatAssignmentDm,
} from "../services/discord.js";
import { bridgeConfigured, getBridgeVoiceStates } from "../services/bridge.js";
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
  setMissionGlobalVoiceRole,
} from "../services/voiceSession.js";
import {
  issueUnitLivekitToken,
  issueMissionVoiceToken,
} from "../services/livekit.js";
import {
  createMissionVoiceSession,
  loadMissionVoiceSession,
} from "../auth/companionSession.js";
import { prisma } from "../db.js";
import type { Ship } from "@prisma/client";
import { specForShip, specForSquad } from "../services/seats.js";
import { hasMissionRelayVoice, isMissionCommander, listMissionCommanders } from "../services/missionCommanders.js";

function setCompanionCors(reply: FastifyReply, request: FastifyRequest): void {
  const origin = request.headers.origin;
  reply.header("access-control-allow-origin", typeof origin === "string" && origin ? origin : "null");
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET, OPTIONS");
  reply.header("access-control-allow-headers", "authorization, content-type");
}

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
  const ui =
    body.ui === "new" ? `?tab=${encodeURIComponent(tab)}&flash=${flash}` : `?flash=${flash}`;
  return basePath(`/ops/${opId}${ui}`);
}

const UNIT_TYPES = ["ship", "squad"] as const;
const REQUIREMENT_CATEGORIES = [
  "fps",
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

async function assertRequirementFitsUnit(
  operationId: string,
  requirementId: string | undefined,
  unitType: string,
  selectedShipId: string | undefined,
  currentUnitId?: string,
) {
  if (!requirementId) return;
  const requirement = await prisma.compositionRequirement.findUnique({
    where: { id: requirementId },
    include: {
      group: { select: { operationId: true } },
      fleetUnits: { select: { id: true, status: true } },
    },
  });
  if (!requirement || requirement.group.operationId !== operationId) {
    throw new Error("Composition slot does not belong to this operation");
  }
  const filled = requirement.fleetUnits.filter(
    (unit) => unit.id !== currentUnitId && unit.status !== "rejected",
  ).length;
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
  if (requirement.category === "any") return;
  if (unitType === "squad" && !["fps", "ground"].includes(requirement.category)) {
    throw new Error("FPS squads can only fill FPS, ground or any slots");
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

async function assertUniqueSquadName(
  operationId: string,
  squadName: string | undefined,
  currentUnitId?: string,
): Promise<void> {
  const normalized = squadName?.trim().toLocaleLowerCase();
  if (!normalized) return;
  const squads = await prisma.fleetUnit.findMany({
    where: {
      operationId,
      unitType: "squad",
      status: { not: "rejected" },
      ...(currentUnitId ? { id: { not: currentUnitId } } : {}),
    },
    select: { squadName: true },
  });
  if (squads.some((unit) => unit.squadName?.trim().toLocaleLowerCase() === normalized)) {
    throw new Error("Squad name already exists in this operation");
  }
}


function missionDeepLink(token: string): string {
  const env = getEnv();
  const fleetplannerUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
  const params = new URLSearchParams({ token, url: fleetplannerUrl });
  return `rdoc://mission?${params.toString()}`;
}

function missionWrapperLink(token: string): string {
  const env = getEnv();
  const params = new URLSearchParams({ token });
  return `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/companion/mission?${params.toString()}`;
}

function companionDownloadLink(): string {
  const env = getEnv();
  return `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/companion/download`;
}

type MissionStartRecipient = {
  userId: string;
  username: string;
};

async function listMissionStartRecipients(operationId: string): Promise<{
  operationTitle: string;
  leaderNames: string[];
  recipients: MissionStartRecipient[];
}> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      title: true,
      leaders: {
        select: {
          userId: true,
          user: { select: { username: true } },
        },
        orderBy: { userId: "asc" },
      },
      units: {
        where: { status: "accepted" },
        select: {
          captainId: true,
          captain: { select: { username: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!op) return { operationTitle: "", leaderNames: [], recipients: [] };

  const recipients = new Map<string, MissionStartRecipient>();
  for (const unit of op.units) {
    recipients.set(unit.captainId, {
      userId: unit.captainId,
      username: unit.captain.username,
    });
  }
  for (const leader of op.leaders) {
    recipients.set(leader.userId, {
      userId: leader.userId,
      username: leader.user.username,
    });
  }
  for (const commander of await listMissionCommanders(operationId)) {
    recipients.set(commander.userId, {
      userId: commander.userId,
      username: commander.username,
    });
  }

  return {
    operationTitle: op.title,
    leaderNames: op.leaders.map((leader) => leader.user.username),
    recipients: [...recipients.values()],
  };
}

async function sendMissionCommanderStartDms(operationId: string): Promise<{
  sent: number;
  failed: number;
}> {
  const env = getEnv();
  const { operationTitle, leaderNames, recipients } = await listMissionStartRecipients(operationId);
  if (!operationTitle) return { sent: 0, failed: 0 };
  const leadBy = leaderNames.length > 0 ? leaderNames.join(", ") : "Mission Command";
  let sent = 0;
  let failed = 0;
  for (const recipient of recipients) {
    const token = await createMissionVoiceSession(recipient.userId, operationId);
    const wrapperLink = missionWrapperLink(token);
    const rawLink = missionDeepLink(token);
    const lines = [
      `The Operation ${operationTitle} - Lead by ${leadBy} has started.`,
      "",
    ];
    lines.push(
      `- Please use this Voice Client to participate in the Commanders Voice ${companionDownloadLink()}`,
    );
    lines.push(
      `- If you've already installed SquadLink, here is your configuration Link: ${wrapperLink}`,
    );
    lines.push("");
    lines.push(`Raw configuration link, if needed: ${rawLink}`);
    lines.push("");
    lines.push("Good Hunt");
    try {
      await sendDiscordDm(recipient.userId, lines.join("\n"));
      sent++;
    } catch {
      failed++;
    }
  }
  return { sent, failed };
}

async function canApproveUnits(userId: string, instanceRole: string, operationId: string) {
  const opRole = await effectiveOpRole(userId, instanceRole, operationId);
  if (opRole === "fleetoperator") return true;
  if (!opRole) return false;
  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { id: true },
  });
  return !!leader;
}

type MissionDiscordVoiceState = {
  required: boolean;
  ok: boolean;
  status:
    | "ok"
    | "no_expected_channel"
    | "not_linked"
    | "bridge_unavailable"
    | "not_in_voice"
    | "wrong_channel";
  expectedChannel: { id: string; name: string } | null;
  currentChannel: { id: string; name: string } | null;
};

async function activeMissionOperationForToken(
  userId: string,
  operationId: string,
  activeStatuses: readonly string[],
): Promise<{
  id: string;
  title: string;
  guildId: string;
  eventVoiceChannelId: string | null;
  globalVoiceRoom: string | null;
  commanderVoiceRoom: string | null;
} | null> {
  const op = await prisma.operation.findFirst({
    where: {
      id: operationId,
      status: { in: [...activeStatuses] },
    },
    select: {
      id: true,
      title: true,
      guildId: true,
      eventVoiceChannelId: true,
      globalVoiceRoom: true,
      commanderVoiceRoom: true,
    },
  });
  if (!op) return null;

  const membership = await prisma.guildMembership.findUnique({
    where: { guildId_userId: { guildId: op.guildId, userId } },
    select: { role: true },
  });
  if (membership?.role === "fleetoperator") return op;

  const unit = await prisma.fleetUnit.findFirst({
    where: { operationId, captainId: userId, status: "accepted" },
    select: { id: true },
  });
  if (unit) return op;

  const leader = await prisma.operationLeader.findFirst({
    where: { operationId, userId },
    select: { id: true },
  });
  if (leader) return op;

  const participant = (await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId },
    select: { id: true },
  })) as { id: string } | null;
  return participant ? op : null;
}

async function expectedMissionVoiceChannel(
  operationId: string,
  userId: string,
): Promise<{ id: string; name: string } | null> {
  const unit = await prisma.fleetUnit.findFirst({
    where: {
      operationId,
      status: "accepted",
      OR: [
        { captainId: userId },
        { seats: { some: { userId, active: true } } },
      ],
    },
    select: {
      voiceChannel: { select: { channelId: true, channelName: true } },
      unitType: true,
      squadName: true,
      ship: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  if (!unit?.voiceChannel) return null;
  const fallbackName = unit.unitType === "ship" ? (unit.ship?.name ?? "Ship") : (unit.squadName ?? "Squad");
  return {
    id: unit.voiceChannel.channelId,
    name: unit.voiceChannel.channelName || fallbackName,
  };
}

async function missionDiscordVoiceState(
  operation: { id: string; guildId: string; eventVoiceChannelId: string | null },
  userId: string,
): Promise<MissionDiscordVoiceState> {
  const expected = (await expectedMissionVoiceChannel(operation.id, userId)) ??
    (operation.eventVoiceChannelId
      ? { id: operation.eventVoiceChannelId, name: "Event Voice" }
      : null);
  if (!expected) {
    return {
      required: false,
      ok: true,
      status: "no_expected_channel",
      expectedChannel: null,
      currentChannel: null,
    };
  }

  const discordId = await discordUserIdForFleetplannerUser(userId).catch(() => null);
  if (!discordId) {
    return {
      required: true,
      ok: false,
      status: "not_linked",
      expectedChannel: expected,
      currentChannel: null,
    };
  }

  if (!bridgeConfigured()) {
    return {
      required: true,
      ok: false,
      status: "bridge_unavailable",
      expectedChannel: expected,
      currentChannel: null,
    };
  }

  try {
    const voice = await getBridgeVoiceStates(operation.guildId);
    if (voice.offline) {
      return {
        required: true,
        ok: false,
        status: "bridge_unavailable",
        expectedChannel: expected,
        currentChannel: null,
      };
    }
    const channelNames = new Map(voice.channels.map((channel) => [channel.id, channel.name]));
    const currentId = voice.voiceStates.find((state) => state.userId === discordId)?.channelId ?? null;
    const current = currentId ? { id: currentId, name: channelNames.get(currentId) ?? currentId } : null;
    const allowedChannelIds = new Set([expected.id]);
    if (operation.eventVoiceChannelId) allowedChannelIds.add(operation.eventVoiceChannelId);
    if (!currentId) {
      return {
        required: true,
        ok: false,
        status: "not_in_voice",
        expectedChannel: expected,
        currentChannel: null,
      };
    }
    if (!allowedChannelIds.has(currentId)) {
      return {
        required: true,
        ok: false,
        status: "wrong_channel",
        expectedChannel: expected,
        currentChannel: current,
      };
    }
    return {
      required: true,
      ok: true,
      status: "ok",
      expectedChannel: expected,
      currentChannel: current,
    };
  } catch {
    return {
      required: true,
      ok: false,
      status: "bridge_unavailable",
      expectedChannel: expected,
      currentChannel: null,
    };
  }
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
      const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
      if (!opRole) return reply.code(403).send({ error: "Forbidden" });
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
        if (unitType === "squad") {
          await assertUniqueSquadName(req.params.id, squadName);
        }
        await assertRequirementFitsUnit(
          req.params.id,
          requirementId || undefined,
          unitType,
          selectedShipId,
        );
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

  // ── Edit fleet unit ──────────────────────────────────────────────────
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/edit",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id },
        include: {
          operation: { select: { guildId: true, status: true, leaders: true } },
          seats: { orderBy: { order: "asc" } },
        },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      if (unit.operation.status === "completed" || unit.operation.status === "cancelled") {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Closed+operations+cannot+be+edited", "fleet"),
          302,
        );
      }

      const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
      const canEdit =
        unit.captainId === ctx.user.id ||
        opRole === "fleetoperator" ||
        unit.operation.leaders.some((leader) => leader.userId === ctx.user.id);
      if (!canEdit) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"),
          302,
        );
      }

      try {
        const unitType = req.body.unitType || unit.unitType;
        if (!UNIT_TYPES.includes(unitType as (typeof UNIT_TYPES)[number])) {
          throw new Error("Invalid unit type");
        }
        const missionLocked = ["in_progress", "completed", "cancelled"].includes(
          unit.operation.status,
        );

        const selectedShipId =
          unitType === "ship" ? req.body.shipId || req.body.ownedShipId || unit.shipId || "" : "";
        if (unitType === "ship") {
          if (!selectedShipId) throw new Error("Select a ship");
          const ship = await prisma.ship.findUnique({ where: { id: selectedShipId } });
          if (!ship) throw new Error("Ship not found");
        }

        const squadName =
          unitType === "squad"
            ? req.body.squadName?.trim().slice(0, 80) || unit.squadName || "FPS Team"
            : null;
        const squadSize =
          unitType === "squad" ? parsePositiveInt(req.body.squadSize, unit.squadSize ?? 4) : null;
        if (unitType === "squad" && (!squadSize || squadSize < 2 || squadSize > 8)) {
          throw new Error("Squad size must be between 2 and 8");
        }
        if (unitType === "squad") {
          await assertUniqueSquadName(req.params.id, squadName ?? undefined, unit.id);
        }
        if (
          missionLocked &&
          (unit.unitType !== unitType ||
            (unitType === "ship" && unit.shipId !== selectedShipId) ||
            (unitType === "squad" &&
              (unit.squadName !== squadName || unit.squadSize !== squadSize)))
        ) {
          throw new Error("Unit name and structure cannot be changed after mission start");
        }

        const requirementId = req.body.requirementId?.trim() || undefined;
        await assertRequirementFitsUnit(
          req.params.id,
          requirementId,
          unitType,
          selectedShipId || undefined,
          unit.id,
        );

        const structuralChange =
          unit.unitType !== unitType ||
          (unitType === "ship" && unit.shipId !== selectedShipId) ||
          (unitType === "squad" && (unit.squadName !== squadName || unit.squadSize !== squadSize));
        const approvalRelevantChange =
          structuralChange ||
          (unit.requirementId ?? "") !== (requirementId ?? "") ||
          (unit.captainNote ?? "") !== (req.body.captainNote?.trim().slice(0, 240) ?? "");
        const nextStatus =
          unit.status === "accepted" && approvalRelevantChange ? "pending" : unit.status;
        const specs =
          structuralChange && unitType === "ship"
            ? specForShip((await prisma.ship.findUnique({ where: { id: selectedShipId } }))!)
            : structuralChange && squadSize
              ? specForSquad(squadSize)
              : null;

        await prisma.$transaction(async (tx) => {
          await tx.fleetUnit.update({
            where: { id: unit.id },
            data: {
              unitType,
              shipId: unitType === "ship" ? selectedShipId : null,
              squadName,
              squadSize,
              requirementId: requirementId ?? null,
              captainNote: req.body.captainNote?.trim().slice(0, 240) || null,
              status: nextStatus,
              ...(nextStatus === "pending" ? { leaderNote: null } : {}),
            },
          });

          if (specs) {
            await tx.seatAssignment.deleteMany({ where: { unitId: unit.id } });
            for (const spec of specs) {
              await tx.seatAssignment.create({
                data: {
                  unitId: unit.id,
                  label: spec.label,
                  seatType: spec.seatType,
                  order: spec.order,
                  ...(spec.order === 0 ? { userId: unit.captainId } : {}),
                },
              });
            }
          }
        });

        const flash =
          unit.status === "accepted" && nextStatus === "pending"
            ? "warn:Unit+updated+and+needs+acceptance+again."
            : "ok:Unit+updated.";
        return reply.redirect(opReturnUrl(req.params.id, req.body, flash, "fleet"), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to update unit";
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
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      if (!(await canApproveUnits(ctx.user.id, ctx.user.role, req.params.id))) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"),
          302,
        );
      }
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
      sendAcceptedCaptainVoiceDm(unit.captainId, {
        operationTitle: unit.operation.title,
        unitName,
        operationUrl,
      }).catch((err) => app.log.warn(err, "Accepted captain DM failed"));
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Unit+accepted.", "fleet"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/reject",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      if (!(await canApproveUnits(ctx.user.id, ctx.user.role, req.params.id))) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"),
          302,
        );
      }
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
      const previous = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { status: true },
      });
      const updated = await setStatus(req.params.id, newStatus);

      // Mission voice session: open/in_progress → create rooms + grant roles
      if (newStatus === "open" || newStatus === "in_progress") {
        if (await hasVoicePermission(updated.guildId)) {
          if (newStatus === "in_progress") {
            try {
              await openMissionVoiceSession(req.params.id);
            } catch (err) {
              app.log.warn(err, "Mission voice session open failed (non-fatal)");
            }
          } else {
            openMissionVoiceSession(req.params.id).catch((err) =>
              app.log.warn(err, "Mission voice session open failed (non-fatal)"),
            );
          }
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
          const commanderDms =
            previous?.status !== "in_progress"
              ? await sendMissionCommanderStartDms(req.params.id)
              : { sent: 0, failed: 0 };
          const skipped = moved.skippedDiscordUsers
            ? `+${moved.skippedDiscordUsers}+users+had+no+Discord+identity.`
            : "";
          const notConnected = moved.notConnected
            ? `+${moved.notConnected}+users+were+not+connected+to+voice.`
            : "";
          const dmFlash =
            previous?.status !== "in_progress"
              ? `+Commander+DMs:+${commanderDms.sent}+sent,+${commanderDms.failed}+failed.`
              : "";
          return reply.redirect(
            opReturnUrl(
              req.params.id,
              req.body,
              `ok:Status+updated.+Moved+${moved.moved}+crew+into+${moved.channels}+voice+channels.${notConnected}${skipped}${dmFlash}`,
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
              `ok:Status+updated.+Deleted+${cleanup.deleted}+empty+voice+channels.${occupied}${unknown}${skipped}`,
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

      // Tenant gate: only members of the op's guild — or any logged-in
      // user when the op is public / partner-visible — may claim a seat.
      // effectiveOpRole returns null otherwise. This both closes a prior
      // hole (claim was requireAuth-only) and enables cross-guild
      // participation on public ops.
      const claimRole = await effectiveOpRole(ctx.user.id, ctx.user.role, opId);
      if (!claimRole) return reply.code(403).send({ error: "Forbidden" });

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

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/requirements",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { label, category, count, note } = req.body;
      if (!label?.trim() || !category) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Need+and+type+required", "fleet"),
          302,
        );
      }
      if (!REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Invalid+need+type", "fleet"),
          302,
        );
      }
      const group =
        (await prisma.compositionGroup.findFirst({
          where: { operationId: req.params.id, name: "Fleet Needs" },
          select: { id: true },
        })) ??
        (await prisma.compositionGroup.create({
          data: { operationId: req.params.id, name: "Fleet Needs", order: 0 },
          select: { id: true },
        }));
      const last = await prisma.compositionRequirement.aggregate({
        where: { groupId: group.id },
        _max: { order: true },
      });
      await prisma.compositionRequirement.create({
        data: {
          groupId: group.id,
          label: label.trim(),
          category,
          count: Math.min(20, Math.max(1, parsePositiveInt(count, 1))),
          note: note?.trim() || null,
          order: (last._max.order ?? -1) + 1,
        },
      });
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Need+added.", "fleet"), 302);
    },
  );

  app.post<{ Params: { id: string; reqId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/requirements/:reqId/edit",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const { label, category, count, note } = req.body;
      if (!label?.trim() || !category) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Need+and+type+required", "fleet"),
          302,
        );
      }
      if (!REQUIREMENT_CATEGORIES.includes(category as (typeof REQUIREMENT_CATEGORIES)[number])) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Invalid+need+type", "fleet"),
          302,
        );
      }
      const requirement = await prisma.compositionRequirement.findFirst({
        where: { id: req.params.reqId, group: { operationId: req.params.id } },
        include: { fleetUnits: { select: { status: true } } },
      });
      if (!requirement) return reply.code(404).send({ error: "Requirement not found" });
      const filled = requirement.fleetUnits.filter((unit) => unit.status !== "rejected").length;
      await prisma.compositionRequirement.update({
        where: { id: req.params.reqId },
        data: {
          label: label.trim(),
          category,
          count: Math.min(20, Math.max(filled, parsePositiveInt(count, requirement.count))),
          note: note?.trim() || null,
        },
      });
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Need+updated.", "fleet"), 302);
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

  // ── Companion auto-voice endpoint — RETIRED ──────────────────────────
  // The old companion polled GET /api/companion/voice (20s loop) for a
  // fleet unit room + global voice token via a separate Fleetplanner OAuth
  // token. The mission-first companion removed that flow: LOCAL voice comes
  // from /api/companion/mission-voice (commander room) and GLOBAL voice is
  // the Discord relay. The endpoint is gone; old apps fail silently and
  // retry on their next tick. See docs/companion-app-opus.md.

  // ── Mission Voice Session — companion polling endpoint ──────────────
  // Returns the two mission voice rooms (global + optional commander)
  // for the user's currently active operation.
  app.options("/api/companion/mission-voice", async (req, reply) => {
    setCompanionCors(reply, req);
    return reply.code(204).send();
  });

  app.get("/api/companion/mission-voice", async (req, reply) => {
    setCompanionCors(reply, req);
    const authHeader = (req.headers as Record<string, string | undefined>).authorization;
    if (!authHeader?.startsWith("Bearer ")) return reply.code(401).send({ error: "unauthorized" });
    const session = await loadMissionVoiceSession(authHeader.slice(7));
    if (!session) return reply.code(401).send({ error: "unauthorized" });
    const { userId, operationId } = session;

    const ACTIVE_STATUSES = ["open", "locked", "in_progress"] as const;

    const activeOp = await activeMissionOperationForToken(userId, operationId, ACTIVE_STATUSES);

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

    const relayRoom = activeOp.globalVoiceRoom;
    const commanderRoom = activeOp.commanderVoiceRoom;
    if (!relayRoom) return reply.send({ op: null });

    const env = getEnv();
    if (!env.LIVEKIT_URL) return reply.send({ op: null });

    const discordVoice = await missionDiscordVoiceState(activeOp, userId);
    const isCommander = await isMissionCommander(activeOp.id, userId);
    const canRelay = await hasMissionRelayVoice(activeOp.id, userId);
    const commanderToken =
      discordVoice.ok && isCommander && commanderRoom
        ? await issueMissionVoiceToken(userId, commanderRoom)
        : null;
    const relayIdentityUserId =
      discordVoice.ok && canRelay && relayRoom
        ? await discordUserIdForFleetplannerUser(userId).catch(() => userId)
        : userId;
    const relayToken =
      discordVoice.ok && canRelay && relayRoom
        ? await issueMissionVoiceToken(relayIdentityUserId, relayRoom)
        : null;

    return reply.send({
      op: {
        opId: activeOp.id,
        opTitle: activeOp.title,
        livekitUrl: env.LIVEKIT_URL,
        discordVoice,
        commanderRoom:
          commanderToken && commanderRoom ? { room: commanderRoom, token: commanderToken } : null,
        relayRoom:
          relayToken && relayRoom ? { room: relayRoom, token: relayToken } : null,
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

    const commanders = await listMissionCommanders(op.id);

    // Create mission-scoped companion sessions + build clickable wrapper links.
    const links: Array<{ userId: string; username: string; link: string }> = [];
    for (const commander of commanders) {
      const token = await createMissionVoiceSession(commander.userId, op.id);
      links.push({
        userId: commander.userId,
        username: commander.username,
        link: missionWrapperLink(token),
      });
    }

    return reply.send({ links });
  });

  // ── Mission voice participants (add/remove manual commanders) ────────
  // Grants the commander room to someone who isn't a captain. Persisted so
  // the mission-voice endpoint's isCommander check recognises them.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-participants/add",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const userId = req.body.userId?.trim();
      if (!userId)
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:User+required", "commanders"),
          302,
        );
      const op = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { guildId: true },
      });
      if (!op) return reply.code(404).send({ error: "Not found" });
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (!user)
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Unknown+user", "commanders"),
          302,
        );
      const globalVoice = req.body.globalVoice === "1";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).missionVoiceParticipant.upsert({
        where: { operationId_userId: { operationId: req.params.id, userId } },
        update: { globalVoice },
        create: { operationId: req.params.id, userId, addedById: ctx.user.id, globalVoice },
      });
      if (globalVoice) {
        await setMissionGlobalVoiceRole(req.params.id, userId, true).catch((err) =>
          req.log.warn(err, "Global Voice role sync failed (non-fatal)"),
        );
      }
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Commander+added.", "commanders"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string; userId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-participants/:userId/global-voice",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const user = await prisma.user.findUnique({
        where: { id: req.params.userId },
        select: { id: true },
      });
      if (!user) return reply.code(404).send({ error: "User not found" });
      const isCommander = await isMissionCommander(req.params.id, req.params.userId);
      if (!isCommander) {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:User+is+not+a+commander", "commanders"),
          302,
        );
      }
      const globalVoice = req.body.globalVoice === "1";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).missionVoiceParticipant.upsert({
        where: { operationId_userId: { operationId: req.params.id, userId: req.params.userId } },
        update: { globalVoice },
        create: {
          operationId: req.params.id,
          userId: req.params.userId,
          addedById: ctx.user.id,
          globalVoice,
        },
      });
      await setMissionGlobalVoiceRole(req.params.id, req.params.userId, globalVoice).catch((err) =>
        req.log.warn(err, "Global Voice role sync failed (non-fatal)"),
      );
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Global+Voice+updated.", "commanders"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string; userId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/voice-participants/:userId/remove",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await setMissionGlobalVoiceRole(req.params.id, req.params.userId, false).catch((err) =>
        req.log.warn(err, "Global Voice role revoke failed (non-fatal)"),
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).missionVoiceParticipant.deleteMany({
        where: { operationId: req.params.id, userId: req.params.userId },
      });
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Commander+removed.", "commanders"),
        302,
      );
    },
  );
}
