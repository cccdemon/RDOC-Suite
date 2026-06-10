import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { requireAuth, requireOpRole } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { searchLocalShips } from "../services/scwiki.js";
import {
  registerUnit,
  deleteUnit,
  setUnitStatus,
  claimSeat,
  assignSeat,
  unclaimSeat,
} from "../services/units.js";
import { setStatus, addLeader, removeLeader, getOperation, logAudit } from "../services/operations.js";
import { setPrimaryUnit, clearPrimaryUnit } from "../services/primaryUnits.js";
import { setHangarShare } from "../services/hangarShare.js";
import {
  createSignup as createCqbSignup,
  withdrawSignup as withdrawCqbSignup,
  bundleSquad as bundleCqbSquad,
  autoBundle as autoBundleCqb,
  unbundle as unbundleCqb,
  reassignSignup as reassignCqbSignup,
  renameSquad as renameCqbSquad,
  placeInSquad as placeCrewInSquad,
  setSquadSize as setCqbSquadSize,
  joinSquad as joinCqbSquad,
  setSquadCarrier as setCqbSquadCarrier,
} from "../services/cqb.js";
import {
  addShipNeeds,
  setFighterSquads,
  setCqbTeams,
  removeShipNeed,
  renameShipNeed,
} from "../services/needs.js";
import {
  createFormation,
  deleteFormation,
  assignUnitToFormation,
} from "../services/formations.js";
import {
  distributeOperation,
  deleteDistributedEvents,
} from "../services/eventDistribution.js";
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
  setMissionCommanderVoiceRole,
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

const MISSION_VOICE_LEADER_ROLES = new Set(["event_leader", "raid_leader", "wing_commander"]);

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
  if (body.ui === "new") {
    return basePath(`/ops/${opId}/manage?tab=${encodeURIComponent(tab)}&flash=${flash}`);
  }
  return basePath(`/ops/${opId}?flash=${flash}`);
}

const UNIT_TYPES = ["ship", "squad", "vehicle"] as const;
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
    throw new Error("Fleet Requirement slot does not belong to this operation");
  }
  const filled = requirement.fleetUnits.filter(
    (unit) => unit.id !== currentUnitId && unit.status !== "rejected",
  ).length;
  if (filled >= requirement.count) {
    throw new Error("Fleet Requirement slot is already full");
  }
  if (
    !REQUIREMENT_CATEGORIES.includes(
      requirement.category as (typeof REQUIREMENT_CATEGORIES)[number],
    )
  ) {
    throw new Error("Fleet Requirement slot has an invalid category");
  }
  if (requirement.category === "any") return;
  if (unitType === "squad" && !["fps", "ground"].includes(requirement.category)) {
    throw new Error("FPS squads can only fill FPS, ground or any slots");
  }
  // Ship ↔ slot category is a HINT, not a hard gate: e.g. a subcapital with
  // punch can fill a capital role. The board flags mismatches (✓ marks a
  // match) and the FleetOperator decides — we do NOT block on it.
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
      `- Please use this Voice Client to participate in the Command Net ${companionDownloadLink()}`,
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

  const unit = await prisma.fleetUnit.findFirst({
    where: { operationId, captainId: userId, status: "accepted" },
    select: { id: true },
  });
  if (unit) return op;

  const leader = await prisma.operationLeader.findFirst({
    where: { operationId, userId, leaderRole: { in: ["event_leader", "raid_leader", "wing_commander"] } },
    select: { id: true },
  });
  if (leader) return op;

  const participant = (await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId },
    select: { id: true },
  })) as { id: string } | null;
  return participant ? op : null;
}

// Every relaybot voice channel created for this op (all units), regardless of
// which user is assigned where. The Commander Net gate accepts ANY of these
// plus the event channel — a commander just has to be "in the mission", not in
// their own specific unit channel.
async function opRelayBotChannels(operationId: string): Promise<Array<{ id: string; name: string }>> {
  const chans = await prisma.fleetVoiceChannel.findMany({
    where: { operationId },
    select: { channelId: true, channelName: true },
  });
  return chans.map((c) => ({ id: c.channelId, name: c.channelName || "Unit Voice" }));
}

async function missionDiscordVoiceState(
  operation: { id: string; guildId: string; eventVoiceChannelId: string | null },
  userId: string,
): Promise<MissionDiscordVoiceState> {
  // Commander Net presence rule: be in the event channel OR in ANY of the op's
  // relaybot unit channels (not restricted to the user's own unit).
  const relayBotChannels = await opRelayBotChannels(operation.id);
  // Guidance/expected channel: prefer the event channel, else the first unit
  // channel. The gate accepts all of them (allowedChannelIds below).
  const expected = (operation.eventVoiceChannelId
    ? { id: operation.eventVoiceChannelId, name: "Event Voice" }
    : (relayBotChannels[0] ?? null));
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
    // Accept the event channel + ANY relaybot unit channel of the op, so a
    // commander can sit in any mission channel (not only their own unit).
    const allowedChannelIds = new Set(relayBotChannels.map((c) => c.id));
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
        carrierUnitId,
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
        const isShipLike = unitType === "ship" || unitType === "vehicle";
        const selectedShipId = isShipLike ? shipId || ownedShipId : undefined;
        if (isShipLike) {
          if (!selectedShipId)
            throw new Error(unitType === "vehicle" ? "Select a vehicle" : "Select or search a ship");
          const ship = await prisma.ship.findUnique({ where: { id: selectedShipId } });
          if (!ship) throw new Error("Ship not found");
        }
        if (unitType === "vehicle" && !carrierUnitId) {
          throw new Error("A vehicle must be carried by a ship");
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
        if (isShipLike && selectedShipId && storeOwnedShip === "1") {
          await prisma.userShip.upsert({
            where: { userId_shipId: { userId: ctx.user.id, shipId: selectedShipId } },
            create: { userId: ctx.user.id, shipId: selectedShipId },
            update: {},
          });
        }
        await registerUnit(req.params.id, ctx.user.id, {
          unitType: unitType as "ship" | "squad" | "vehicle",
          shipId: selectedShipId,
          squadName: squadName || undefined,
          squadSize: parsedSquadSize,
          requirementId: requirementId || undefined,
          captainNote: captainNote || undefined,
          carrierUnitId: unitType === "vehicle" ? carrierUnitId || undefined : undefined,
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

        if (unit.status === "accepted" && nextStatus === "pending") {
          if (!(await isMissionCommander(req.params.id, unit.captainId))) {
            await setMissionCommanderVoiceRole(req.params.id, unit.captainId, false).catch((err) =>
              req.log.warn(err, "Command Net role revoke failed (non-fatal)"),
            );
          }
        }

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
      // Accept-into-slot: when a requirement is passed, slot the unit in the same
      // action (also used to slot an already-accepted unit — idempotent, no
      // re-pending). A full/mismatched slot is skipped; the unit stays accepted
      // but unslotted rather than failing the accept.
      const slotId = req.body.requirementId?.trim();
      if (slotId) {
        try {
          await assertRequirementFitsUnit(
            req.params.id,
            slotId,
            unit.unitType,
            unit.shipId ?? undefined,
            unit.id,
          );
          await prisma.fleetUnit.update({
            where: { id: unit.id },
            data: { requirementId: slotId },
          });
        } catch {
          /* slot full / mismatch — accept unslotted */
        }
      }
      await setMissionCommanderVoiceRole(req.params.id, unit.captainId, true).catch((err) =>
        req.log.warn(err, "Command Net role sync failed (non-fatal)"),
      );
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
        select: { id: true, captainId: true },
      });
      if (!unit) return reply.code(404).send({ error: "Unit not found" });
      await setUnitStatus(req.params.unitId, "rejected", req.body.note);
      if (!(await isMissionCommander(req.params.id, unit.captainId))) {
        await setMissionCommanderVoiceRole(req.params.id, unit.captainId, false).catch((err) =>
          req.log.warn(err, "Command Net role revoke failed (non-fatal)"),
        );
      }
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
      const valid = ["draft", "open", "locked", "starting", "in_progress", "completed", "cancelled"];
      const newStatus = req.body.status;
      if (!valid.includes(newStatus)) return reply.code(400).send({ error: "Invalid status" });
      const previous = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { status: true },
      });
      const updated = await setStatus(req.params.id, newStatus);
      await logAudit(
        req.params.id,
        ctx.user.id,
        ctx.user.username,
        `status:${newStatus}`,
        previous?.status ? `von ${previous.status}` : "",
      );

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
          // FR-P1: offer the op to active partner guilds (auto-share posts now,
          // manual partners get a pending row for the Phase-2 approval inbox).
          if (op.visibility === "partners" || op.visibility === "public") {
            distributeOperation(op)
              .then((r) =>
                app.log.info(
                  `Event distribution for op ${req.params.id}: ${r.auto} auto, ${r.pending} pending, ${r.failed} failed`,
                ),
              )
              .catch((err) => app.log.warn(err, "Event distribution failed (non-fatal)"));
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
      // FR-P1: cancelling also tears down any distributed partner events.
      if (newStatus === "cancelled") {
        deleteDistributedEvents(req.params.id).catch((err) =>
          app.log.warn(err, "Partner event distribution teardown failed (non-fatal)"),
        );
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
        const claimResult = await claimSeat(req.params.seatId, ctx.user.id);
        if (claimResult.vacatedCaptainSeat) {
          // Captain moved off the pilot seat — record it and ping the op leaders
          // so they can confirm the ship still has a captain.
          await logAudit(
            opId,
            ctx.user.id,
            ctx.user.username,
            "captain_left_pilot_seat",
            claimResult.unitName,
          );
          try {
            const leaders = await prisma.operationLeader.findMany({
              where: { operationId: opId },
              select: { userId: true },
            });
            const msg = `⚠️ ${ctx.user.username} left the captain (pilot) seat of "${claimResult.unitName}" — this ship may need a new captain.`;
            await Promise.all(
              leaders.map((l) => sendDiscordDm(l.userId, msg).catch(() => {})),
            );
          } catch {
            /* notification is best-effort */
          }
        }
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

  // ── Hangar sharing (mission board) ───────────────────────────────────
  // Player opts in/out of letting this op's operators see their hangar.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/hangar-share",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      // Players may only set their OWN share.
      await setHangarShare(req.params.id, ctx.user.id, {
        allow: req.body.allow === "1",
        note: req.body.note ?? null,
      });
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Hangar+sharing+updated.", "crew"),
        302,
      );
    },
  );

  // ── CQB personnel pool (FR-P1) ───────────────────────────────────────
  // Player volunteers as a CQB soldier; the operator bundles signups into squads.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb-signups",
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
          opReturnUrl(req.params.id, req.body, "error:Operation+is+not+open+for+registration", "fleet"),
          302,
        );
      }
      const note = req.body.note?.trim().slice(0, 240) || null;
      await createCqbSignup(req.params.id, ctx.user.id, note);
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Signed+up+as+CQB.", "fleet"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb-signups/withdraw",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const targetUserId = req.body.userId || ctx.user.id;
      const isOperator =
        (await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id)) === "fleetoperator";
      if (targetUserId !== ctx.user.id && !isOperator) {
        return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"), 302);
      }
      await withdrawCqbSignup(req.params.id, targetUserId);
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:CQB+signup+removed.", "fleet"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string | string[]> }>(
    "/api/ops/:id/cqb/bundle",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body as Record<string, unknown>, ctx.csrfToken))
        return reply.code(403).send({ error: "csrf" });
      const raw = req.body.signupId;
      const signupIds = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const body = req.body as Record<string, string>;
      if (signupIds.length === 0) {
        return reply.redirect(
          opReturnUrl(req.params.id, body, "error:Select+at+least+one+signup", "fleet"),
          302,
        );
      }
      const nameRaw = req.body.name;
      const name = (typeof nameRaw === "string" ? nameRaw : "").trim().slice(0, 80) || "Squad";
      const sizeRaw = typeof body.size === "string" ? parseInt(body.size, 10) : NaN;
      const targetSize = Number.isFinite(sizeRaw) ? sizeRaw : null;
      await bundleCqbSquad(req.params.id, name, signupIds, targetSize);
      return reply.redirect(opReturnUrl(req.params.id, body, "ok:Squad+created.", "fleet"), 302);
    },
  );

  // Operator: place a "let the operator place me" crew member into a CQB team.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/place",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const userId = (req.body.userId ?? "").trim();
      const groupId = (req.body.groupId ?? "").trim();
      if (userId && groupId) await placeCrewInSquad(req.params.id, userId, groupId);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Member+placed.", "fleet"), 302);
    },
  );

  // Operator: rename a CQB squad.
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/squads/:groupId/rename",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const name = (req.body.name ?? "").trim();
      if (!name) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Name+required", "fleet"), 302);
      await renameCqbSquad(req.params.id, req.params.groupId, name);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Squad+renamed.", "fleet"), 302);
    },
  );

  // Operator: give a participant a secondary position — assign them to an open
  // ship seat (in addition to their CQB team etc.).
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/seats/assign",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const seatId = (req.body.seatId ?? "").trim();
      const userId = (req.body.userId ?? "").trim();
      if (!seatId || !userId) {
        return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Seat+and+user+required", "fleet"), 302);
      }
      const seat = await prisma.seatAssignment.findFirst({
        where: { id: seatId, fleetUnit: { operationId: req.params.id } },
        select: { id: true },
      });
      if (!seat) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Seat+not+found", "fleet"), 302);
      try {
        await assignSeat(seatId, userId);
        // If this user was a "place me" crew request, they're now placed.
        await prisma.crewAssignmentRequest.deleteMany({ where: { operationId: req.params.id, userId } });
        return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Seat+assigned.", "fleet"), 302);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Failed to assign seat";
        return reply.redirect(opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"), 302);
      }
    },
  );

  // Operator: set (or clear) a squad's target size.
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/squads/:groupId/size",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const sizeRaw = parseInt(req.body.size ?? "", 10);
      await setCqbSquadSize(req.params.id, req.params.groupId, Number.isFinite(sizeRaw) ? sizeRaw : null);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Squad+size+saved.", "fleet"), 302);
    },
  );

  // Player: join a named CQB squad directly (capacity-gated by its target size).
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/squads/:groupId/join",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const op = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { id: true, status: true },
      });
      if (!op) return reply.code(404).send({ error: "Operation not found" });
      // Same gate as seat claim: any effective role on the op may join.
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
      if (!role) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"), 302);
      if (op.status !== "open" && op.status !== "draft") {
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:Operation+is+not+open+for+registration", "fleet"),
          302,
        );
      }
      const res = await joinCqbSquad(req.params.id, ctx.user.id, req.params.groupId);
      const flash = res.ok
        ? `ok:Joined+squad+${encodeURIComponent(res.name)}.`
        : res.reason === "full"
          ? "error:That+squad+is+full."
          : "error:Squad+not+found.";
      return reply.redirect(opReturnUrl(req.params.id, req.body, flash, "fleet"), 302);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/auto-bundle",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const size = parseInt(req.body.size ?? "4", 10);
      const created = await autoBundleCqb(req.params.id, Number.isFinite(size) ? size : 4);
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, `ok:Auto-bundled+into+${created}+squad(s).`, "fleet"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/assign",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const signupId = req.body.signupId;
      const groupId = (req.body.groupId ?? "").trim() || null; // empty = back to pool
      if (signupId) await reassignCqbSignup(req.params.id, signupId, groupId);
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Soldier+reassigned.", "fleet"),
        302,
      );
    },
  );

  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/unbundle/:groupId",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await unbundleCqb(req.params.id, req.params.groupId);
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Squad+dissolved.", "fleet"),
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
      const nextLeaderRole = validRoles.includes(leaderRole) ? leaderRole : "event_leader";
      await addLeader(req.params.id, userId, nextLeaderRole);
      if (MISSION_VOICE_LEADER_ROLES.has(nextLeaderRole)) {
        await setMissionCommanderVoiceRole(req.params.id, userId, true).catch((err) =>
          req.log.warn(err, "Command Net role sync failed (non-fatal)"),
        );
        await setMissionGlobalVoiceRole(req.params.id, userId, true).catch((err) =>
          req.log.warn(err, "Global Radio Net role sync failed (non-fatal)"),
        );
      } else {
        if (!(await isMissionCommander(req.params.id, userId))) {
          await setMissionCommanderVoiceRole(req.params.id, userId, false).catch((err) =>
            req.log.warn(err, "Command Net role revoke failed (non-fatal)"),
          );
        }
        if (!(await hasMissionRelayVoice(req.params.id, userId))) {
          await setMissionGlobalVoiceRole(req.params.id, userId, false).catch((err) =>
            req.log.warn(err, "Global Radio Net role revoke failed (non-fatal)"),
          );
        }
      }
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
      if (!(await isMissionCommander(req.params.id, userId))) {
        await setMissionCommanderVoiceRole(req.params.id, userId, false).catch((err) =>
          req.log.warn(err, "Command Net role revoke failed (non-fatal)"),
        );
      }
      if (!(await hasMissionRelayVoice(req.params.id, userId))) {
        await setMissionGlobalVoiceRole(req.params.id, userId, false).catch((err) =>
          req.log.warn(err, "Global Radio Net role revoke failed (non-fatal)"),
        );
      }
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Leader+removed.", "admin"),
        302,
      );
    },
  );

  // ── Primary voice unit (multi-position users) ────────────────────────
  // A user assigned to 2+ units picks (or a leader assigns) which unit is their
  // main Discord voice channel. Self-service for the user themselves; leaders
  // (fleetoperator or an OperationLeader) may set it for anyone. Empty unitId
  // clears the choice → system default.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/primary-unit",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const targetUserId = req.body.userId?.trim();
      const unitId = req.body.unitId?.trim() ?? "";
      if (!targetUserId)
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "error:userId+required", "fleet"),
          302,
        );

      // Authorize: self, or a leader (fleetoperator / OperationLeader).
      if (targetUserId !== ctx.user.id) {
        const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
        const isLeader =
          opRole === "fleetoperator" ||
          !!(await prisma.operationLeader.findUnique({
            where: { operationId_userId: { operationId: req.params.id, userId: ctx.user.id } },
            select: { id: true },
          }));
        if (!isLeader)
          return reply.redirect(
            opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"),
            302,
          );
      } else {
        // Self must at least be a member of the op's guild.
        const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, req.params.id);
        if (!opRole)
          return reply.redirect(
            opReturnUrl(req.params.id, req.body, "error:Forbidden", "fleet"),
            302,
          );
      }

      try {
        if (unitId) {
          await setPrimaryUnit(req.params.id, targetUserId, unitId, ctx.user.id);
        } else {
          await clearPrimaryUnit(req.params.id, targetUserId);
        }
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, "ok:Primary+channel+updated.", "fleet"),
          302,
        );
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Could not set primary channel";
        return reply.redirect(
          opReturnUrl(req.params.id, req.body, `error:${encodeURIComponent(msg)}`, "fleet"),
          302,
        );
      }
    },
  );

  // ── Fleet Requirement groups (legacy free-text add/edit removed Phase 5) ────
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

  // ── Structured fleet-need editor (FR-P1 Phase 2) ───────────────────────────
  // Ship needs: each picked type = exactly one hull.
  app.post<{ Params: { id: string }; Body: Record<string, string | string[]> }>(
    "/api/ops/:id/needs/ships",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body as Record<string, unknown>, ctx.csrfToken))
        return reply.code(403).send({ error: "csrf" });
      const raw = req.body.shipType;
      const types = Array.isArray(raw) ? raw : raw ? [raw] : [];
      const details = typeof req.body.details === "string" ? req.body.details : null;
      const name = typeof req.body.name === "string" ? req.body.name : null;
      const added = await addShipNeeds(req.params.id, types, details, name);
      const body = req.body as Record<string, string>;
      const flash = added ? `ok:Added+${added}+ship+need(s).` : "error:Pick+at+least+one+ship+type.";
      return reply.redirect(opReturnUrl(req.params.id, body, flash, "fleet"), 302);
    },
  );

  // Fighter need: N squads (each = 2 pilots, own fighter). Eager teams.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/needs/fighters",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await setFighterSquads(req.params.id, parseInt(req.body.count ?? "0", 10));
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Fighter+squads+set.", "fleet"), 302);
    },
  );

  // CQB need: N teams of `size` (4..8). Eager teams.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/needs/cqb",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await setCqbTeams(req.params.id, parseInt(req.body.count ?? "0", 10), parseInt(req.body.size ?? "4", 10));
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:CQB+teams+set.", "fleet"), 302);
    },
  );

  // Operator: embed a CQB team into a non-fighter ship (Phase 4b). Empty = detach.
  app.post<{ Params: { id: string; groupId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cqb/squads/:groupId/carrier",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const carrierUnitId = (req.body.carrierUnitId ?? "").trim() || null;
      const res = await setCqbSquadCarrier(req.params.id, req.params.groupId, carrierUnitId);
      const flash = res.ok
        ? "ok:Team+embedding+updated."
        : res.reason === "fighter"
          ? "error:Fighters+can't+carry+a+team."
          : "error:Could+not+embed+the+team.";
      return reply.redirect(opReturnUrl(req.params.id, req.body, flash, "fleet"), 302);
    },
  );

  // ── Formations (Verbände, Phase 4a) ────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/formations",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const name = (req.body.name ?? "").trim();
      if (!name) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Formation+name+required", "fleet"), 302);
      await createFormation(req.params.id, name);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Formation+created.", "fleet"), 302);
    },
  );

  app.post<{ Params: { id: string; fid: string }; Body: Record<string, string> }>(
    "/api/ops/:id/formations/:fid/delete",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await deleteFormation(req.params.id, req.params.fid);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Formation+removed.", "fleet"), 302);
    },
  );

  // Assign/detach a ship to a formation (formationId empty = detach).
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/formation",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const fid = (req.body.formationId ?? "").trim() || null;
      const res = await assignUnitToFormation(req.params.id, req.params.unitId, fid);
      const flash = res.ok ? "ok:Formation+updated." : "error:Only+ships+can+join+a+formation.";
      return reply.redirect(opReturnUrl(req.params.id, req.body, flash, "fleet"), 302);
    },
  );

  // Assign/move a ground vehicle to a carrier ship (carrierUnitId empty = detach).
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/units/:unitId/carrier",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      const veh = await prisma.fleetUnit.findFirst({
        where: { id: req.params.unitId, operationId: req.params.id, unitType: { in: ["vehicle", "ship"] } },
        select: { id: true },
      });
      if (!veh) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Unit+not+found", "fleet"), 302);
      // A unit cannot carry itself.
      if (req.params.unitId === ((req.body.carrierUnitId ?? "").trim() || null)) {
        return reply.redirect(opReturnUrl(req.params.id, req.body, "error:A+unit+can't+carry+itself", "fleet"), 302);
      }
      const carrierId = (req.body.carrierUnitId ?? "").trim() || null;
      if (carrierId) {
        const ship = await prisma.fleetUnit.findFirst({
          where: { id: carrierId, operationId: req.params.id, unitType: "ship" },
          select: { status: true },
        });
        if (!ship) return reply.redirect(opReturnUrl(req.params.id, req.body, "error:Carrier+ship+not+found", "fleet"), 302);
        await prisma.fleetUnit.update({ where: { id: req.params.unitId }, data: { carrierUnitId: carrierId, status: ship.status } });
      } else {
        await prisma.fleetUnit.update({ where: { id: req.params.unitId }, data: { carrierUnitId: null } });
      }
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Vehicle+carrier+updated.", "fleet"), 302);
    },
  );

  // Delete a single ship need.
  app.post<{ Params: { id: string; reqId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/needs/:reqId/delete",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await removeShipNeed(req.params.id, req.params.reqId);
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Ship+need+removed.", "fleet"), 302);
    },
  );

  // Rename a single ship need (give it a custom name).
  app.post<{ Params: { id: string; reqId: string }; Body: Record<string, string> }>(
    "/api/ops/:id/needs/:reqId/rename",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await renameShipNeed(req.params.id, req.params.reqId, req.body.name ?? "");
      return reply.redirect(opReturnUrl(req.params.id, req.body, "ok:Need+renamed.", "fleet"), 302);
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

    // `ended: true` = the mission is definitively over (no active op for this
    // token / guild voice disabled). The Companion clears its persisted mission
    // token and falls back to Bridge Mode. `ended: false` = transient/pending
    // (op active but voice not opened yet) → Companion keeps the token + waits.
    if (!activeOp) return reply.send({ op: null, ended: true });

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
      return reply.send({ op: null, ended: true });

    const relayRoom = activeOp.globalVoiceRoom;
    const commanderRoom = activeOp.commanderVoiceRoom;
    // Op is active but its voice session hasn't been opened yet (no relay room).
    // Pending, not ended — Companion keeps the token and keeps polling.
    if (!relayRoom) return reply.send({ op: null, ended: false });

    const env = getEnv();
    if (!env.LIVEKIT_URL) return reply.send({ op: null, ended: false });

    // Commander Net gate: must be in the event channel or any relaybot channel.
    const discordVoice = await missionDiscordVoiceState(activeOp, userId);
    const isCommander = await isMissionCommander(activeOp.id, userId);
    const canRelay = await hasMissionRelayVoice(activeOp.id, userId);

    // Global Radio (relay) gate is looser: a relay participant only needs to be
    // on the same Discord (a linked Discord account → guild member, since the op
    // is guild-scoped). No specific voice channel required — the relaybot speaks
    // for them. relayDiscordId doubles as the LiveKit identity for the relay room.
    const relayDiscordId =
      canRelay && relayRoom
        ? await discordUserIdForFleetplannerUser(userId).catch(() => null)
        : null;
    const relayOk = Boolean(canRelay && relayRoom && relayDiscordId);

    const commanderToken =
      discordVoice.ok && isCommander && commanderRoom
        ? await issueMissionVoiceToken(userId, commanderRoom)
        : null;
    const relayToken = relayOk
      ? await issueMissionVoiceToken(relayDiscordId!, relayRoom!)
      : null;

    // The mission token carries no display name; the companion shows the user's
    // own name in mission mode from this (Bridge roster isn't present there).
    const selfUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { username: true },
    });

    // Commander roster (userId → username) so the companion can label the
    // LiveKit commander-room participants by name, matching the Bridge roster.
    // The commander-room LiveKit identity name is the fleetplanner userId, which
    // is exactly the key listMissionCommanders returns.
    const commanders = isCommander
      ? (await listMissionCommanders(activeOp.id)).map((c) => ({
          userId: c.userId,
          username: c.username,
        }))
      : [];

    return reply.send({
      op: {
        opId: activeOp.id,
        opTitle: activeOp.title,
        livekitUrl: env.LIVEKIT_URL,
        selfUsername: selfUser?.username ?? null,
        discordVoice,
        commanders,
        // Global Radio is usable as long as the user is on the same Discord —
        // independent of the Commander Net channel gate (discordVoice).
        relayOk,
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
      await setMissionCommanderVoiceRole(req.params.id, userId, true).catch((err) =>
        req.log.warn(err, "Command Net role sync failed (non-fatal)"),
      );
      if (globalVoice) {
        await setMissionGlobalVoiceRole(req.params.id, userId, true).catch((err) =>
          req.log.warn(err, "Global Radio Net role sync failed (non-fatal)"),
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
        req.log.warn(err, "Global Radio Net role sync failed (non-fatal)"),
      );
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Global+Radio+Net+updated.", "commanders"),
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma as any).missionVoiceParticipant.deleteMany({
        where: { operationId: req.params.id, userId: req.params.userId },
      });
      if (!(await hasMissionRelayVoice(req.params.id, req.params.userId))) {
        await setMissionGlobalVoiceRole(req.params.id, req.params.userId, false).catch((err) =>
          req.log.warn(err, "Global Radio Net role revoke failed (non-fatal)"),
        );
      }
      if (!(await isMissionCommander(req.params.id, req.params.userId))) {
        await setMissionCommanderVoiceRole(req.params.id, req.params.userId, false).catch((err) =>
          req.log.warn(err, "Command Net role revoke failed (non-fatal)"),
        );
      }
      return reply.redirect(
        opReturnUrl(req.params.id, req.body, "ok:Commander+removed.", "commanders"),
        302,
      );
    },
  );
}
