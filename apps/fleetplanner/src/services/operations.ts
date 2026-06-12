import { prisma } from "../db.js";
import { getActivePartnerGuildIds } from "./partnerships.js";

export type OpVisibility = "private" | "partners" | "public";
export const OP_VISIBILITIES: readonly OpVisibility[] = ["private", "partners", "public"];

export function isOpVisibility(v: string): v is OpVisibility {
  return (OP_VISIBILITIES as readonly string[]).includes(v);
}

export type CreateOperationInput = {
  guildId: string;
  title: string;
  description?: string;
  opType?: string;
  visibility?: OpVisibility;
  meetingSystem?: string;
  meetingLocation?: string;
  scheduledAt: Date;
  eventVoiceChannelId?: string;
  minParticipants?: number;
  maxParticipants?: number | null;
};

/** Append an audit entry (best-effort; never throws into the caller). */
export async function logAudit(
  operationId: string,
  actorId: string | null,
  actor: string,
  action: string,
  detail = "",
) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma as any).auditLog.create({
      data: { operationId, actorId, actor, action, detail },
    });
  } catch {
    /* audit must never break the action */
  }
}

export async function createOperation(createdById: string, input: CreateOperationInput) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {
    guildId: input.guildId,
    title: input.title,
    description: input.description ?? "",
    opType: input.opType ?? "combat",
    visibility: input.visibility ?? "private",
    meetingSystem: input.meetingSystem ?? "stanton",
    meetingLocation: input.meetingLocation ?? "",
    scheduledAt: input.scheduledAt,
    createdById,
    status: "draft",
    eventVoiceChannelId: input.eventVoiceChannelId || null,
    minParticipants: input.minParticipants ?? 0,
    maxParticipants: input.maxParticipants ?? null,
  };
  return prisma.operation.create({ data });
}

/**
 * Change an operation's visibility. Authorization is enforced by the
 * caller (fleetoperator in the op's guild OR an OperationLeader). Returns
 * the updated row.
 */
export async function setOperationVisibility(id: string, visibility: OpVisibility) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.operation.update as any)({
    where: { id },
    data: { visibility },
  });
}

export async function getOperation(id: string) {
  return prisma.operation.findUnique({
    where: { id },
    include: {
      createdBy: true,
      leaders: { include: { user: true } },
      crewRequests: { include: { user: true }, orderBy: { createdAt: "asc" } },
      groups: {
        orderBy: { order: "asc" },
        include: {
          requirements: {
            orderBy: { order: "asc" },
            include: {
              fleetUnits: {
                include: {
                  ship: true,
                  captain: true,
                  seats: { include: { user: true }, orderBy: { order: "asc" } },
                },
              },
            },
          },
        },
      },
      units: {
        include: {
          ship: true,
          captain: true,
          seats: { include: { user: true }, orderBy: { order: "asc" } },
          requirement: true,
        },
        orderBy: { createdAt: "asc" },
      },
      auditLogs: { orderBy: { createdAt: "desc" }, take: 50 },
      questions: { orderBy: { createdAt: "desc" } },
      cover: true,
      recurrence: true,
      // FR-P2: pilots who clicked "Interested" on the Discord event (active only).
      eventInterests: {
        where: { status: "interested" },
        orderBy: { firstSeenAt: "asc" },
      },
      // FR-P1: CQB personnel pool (individuals; operator bundles into squads).
      cqbSignups: {
        where: { status: { not: "rejected" } },
        include: { user: true },
        orderBy: { createdAt: "asc" },
      },
      // Mission board: players who opted to let operators see their hangar.
      hangarShares: {
        where: { allowOperatorHangarView: true },
        include: { user: true },
        orderBy: { updatedAt: "desc" },
      },
      // FR-P3: operator-curated tutorial/resource links.
      resourceLinks: { orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }] },
    },
  });
}

export async function listOperations(guildId: string, includePast = false) {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return prisma.operation.findMany({
    where: {
      guildId,
      ...(includePast ? {} : { scheduledAt: { gte: cutoff } }),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      guild: { select: { id: true, name: true, iconHash: true, timezone: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true, seats: { select: { userId: true } } } },
    },
  });
}

/**
 * List operations visible without a login. ONLY operations explicitly
 * marked visibility "public" — status is irrelevant. This is the one
 * operation query allowed to omit a guildId scope.
 */
export async function listPublicOperations(includePast = false) {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.operation.findMany as any)({
    where: {
      visibility: "public",
      ...(includePast ? {} : { scheduledAt: { gte: cutoff } }),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      guild: { select: { id: true, name: true, iconHash: true, timezone: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true, seats: { select: { userId: true } } } },
    },
  });
}

/**
 * List operations from a guild's active partner guilds that are visible
 * to partners (visibility "partners" or "public"). Empty when the guild
 * has no active partnerships.
 */
export async function listPartnerOperations(guildId: string, includePast = false) {
  const partnerIds = await getActivePartnerGuildIds(guildId);
  if (partnerIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.operation.findMany as any)({
    where: {
      guildId: { in: partnerIds },
      visibility: { in: ["partners", "public"] },
      ...(includePast ? {} : { scheduledAt: { gte: cutoff } }),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      guild: { select: { id: true, name: true, iconHash: true, timezone: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true, seats: { select: { userId: true } } } },
    },
  });
}

/** List operations across multiple guilds (all user's servers). */
export async function listAllUserOperations(guildIds: string[], includePast = false) {
  if (guildIds.length === 0) return [];
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000);
  return prisma.operation.findMany({
    where: {
      guildId: { in: guildIds },
      ...(includePast ? {} : { scheduledAt: { gte: cutoff } }),
    },
    orderBy: { scheduledAt: "asc" },
    include: {
      guild: { select: { id: true, name: true, iconHash: true, timezone: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true, seats: { select: { userId: true } } } },
    },
  });
}

export async function updateOperation(id: string, input: Partial<CreateOperationInput>) {
  return prisma.operation.update({
    where: { id },
    data: {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.opType !== undefined && { opType: input.opType }),
      ...(input.meetingSystem !== undefined && { meetingSystem: input.meetingSystem }),
      ...(input.meetingLocation !== undefined && { meetingLocation: input.meetingLocation }),
      ...(input.scheduledAt !== undefined && { scheduledAt: input.scheduledAt }),
      ...("maxParticipants" in input && { maxParticipants: input.maxParticipants ?? null }),
      ...("eventVoiceChannelId" in input && { eventVoiceChannelId: input.eventVoiceChannelId || null }),
    },
  });
}

export async function deleteOperation(id: string) {
  await prisma.operation.delete({ where: { id } });
}

export async function setStatus(id: string, status: string) {
  return prisma.operation.update({ where: { id }, data: { status } });
}

export async function addLeader(operationId: string, userId: string, leaderRole = "raid_leader") {
  return prisma.operationLeader.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, leaderRole },
    update: { leaderRole },
  });
}

export async function removeLeader(operationId: string, userId: string) {
  await prisma.operationLeader.delete({
    where: { operationId_userId: { operationId, userId } },
  }).catch(() => null);
}
