// FR-P1 fleet-needs — CQB personnel pool + squad bundling.
// A person signs up as a CQB soldier (no role taxonomy); the fleet operator
// bundles signups into squads (CompositionGroup.kind = "squad"). Pure DB ops.

import { prisma } from "../db.js";

/** Player: volunteer as a CQB soldier (idempotent per op+user). */
export async function createSignup(operationId: string, userId: string, note: string | null) {
  return prisma.cqbSignup.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, note },
    update: { note },
  });
}

/** Withdraw a signup (player self, or operator removing someone). */
export async function withdrawSignup(operationId: string, userId: string) {
  await prisma.cqbSignup.deleteMany({ where: { operationId, userId } });
}

/** Operator: create a squad group from selected (still-unassigned) signups. */
export async function bundleSquad(operationId: string, name: string, signupIds: string[]) {
  const last = await prisma.compositionGroup.aggregate({
    where: { operationId },
    _max: { order: true },
  });
  const group = await prisma.compositionGroup.create({
    data: { operationId, name, kind: "squad", order: (last._max.order ?? -1) + 1 },
  });
  if (signupIds.length) {
    await prisma.cqbSignup.updateMany({
      where: { operationId, id: { in: signupIds }, assignedGroupId: null },
      data: { assignedGroupId: group.id, status: "accepted" },
    });
  }
  return group;
}

/** Operator: chunk all unassigned signups into squads of `size` (2–8). */
export async function autoBundle(operationId: string, size: number): Promise<number> {
  const sz = Math.max(2, Math.min(8, Math.floor(size) || 4));
  const pending = await prisma.cqbSignup.findMany({
    where: { operationId, assignedGroupId: null, status: { not: "rejected" } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  const existing = await prisma.compositionGroup.count({
    where: { operationId, kind: "squad" },
  });
  let created = 0;
  for (let i = 0; i < pending.length; i += sz) {
    const chunk = pending.slice(i, i + sz).map((s) => s.id);
    if (chunk.length === 0) continue;
    await bundleSquad(operationId, `Squad ${existing + created + 1}`, chunk);
    created++;
  }
  return created;
}

/** Operator: dissolve a squad group → its members return to the pool. */
export async function unbundle(operationId: string, groupId: string): Promise<void> {
  await prisma.cqbSignup.updateMany({
    where: { operationId, assignedGroupId: groupId },
    data: { assignedGroupId: null, status: "pending" },
  });
  await prisma.compositionGroup.deleteMany({
    where: { id: groupId, operationId, kind: "squad" },
  });
}
