import { prisma } from "../db.js";

export type CreateOperationInput = {
  title: string;
  description?: string;
  opType?: string;
  scheduledAt: Date;
};

export async function createOperation(createdById: string, input: CreateOperationInput) {
  return prisma.operation.create({
    data: {
      title: input.title,
      description: input.description ?? "",
      opType: input.opType ?? "combat",
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

export async function listOperations(includePast = false) {
  const cutoff = new Date(Date.now() - 3 * 60 * 60 * 1000); // show ops up to 3h in the past
  return prisma.operation.findMany({
    where: includePast ? {} : { scheduledAt: { gte: cutoff } },
    orderBy: { scheduledAt: "asc" },
    include: {
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
