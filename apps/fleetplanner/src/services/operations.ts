import { prisma } from "../db.js";

export type CreateOperationInput = {
  guildId: string;
  title: string;
  description?: string;
  opType?: string;
  meetingSystem?: string;
  meetingLocation?: string;
  scheduledAt: Date;
};

export async function createOperation(createdById: string, input: CreateOperationInput) {
  return prisma.operation.create({
    data: {
      guildId: input.guildId,
      title: input.title,
      description: input.description ?? "",
      opType: input.opType ?? "combat",
      meetingSystem: input.meetingSystem ?? "stanton",
      meetingLocation: input.meetingLocation ?? "",
      scheduledAt: input.scheduledAt,
      createdById,
      status: "draft",
    },
  });
}

export async function getOperation(id: string) {
  return prisma.operation.findUnique({
    where: { id },
    include: {
      createdBy: true,
      leaders: { include: { user: true } },
      crewRequests: { include: { user: true }, orderBy: { createdAt: "asc" } },
      voiceChannels: {
        include: {
          unit: { include: { ship: true, captain: true } },
          voiceBot: { select: { id: true, label: true, botUserId: true, assignedChannelId: true } },
        },
        orderBy: { createdAt: "asc" },
      },
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
      guild: { select: { id: true, name: true, iconHash: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true } },
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
      guild: { select: { id: true, name: true, iconHash: true } },
      createdBy: true,
      leaders: { include: { user: true } },
      units: { select: { id: true, status: true } },
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
