// FR-P1 fleet-needs — CQB personnel pool + squad bundling.
// A person signs up as a CQB soldier (no role taxonomy); the fleet operator
// bundles signups into squads (CompositionGroup.kind = "squad"). Pure DB ops.

import { prisma } from "../db.js";
import { shipClass } from "./composition.js";

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

/** Clamp a requested squad size into a sane range, or null for "no cap". */
function clampSize(size: number | null | undefined): number | null {
  if (size == null || !Number.isFinite(size)) return null;
  const n = Math.floor(size);
  if (n <= 0) return null;
  return Math.min(24, n);
}

/** Operator: create a squad group from selected (still-unassigned) signups. */
export async function bundleSquad(
  operationId: string,
  name: string,
  signupIds: string[],
  targetSize?: number | null,
) {
  const last = await prisma.compositionGroup.aggregate({
    where: { operationId },
    _max: { order: true },
  });
  const group = await prisma.compositionGroup.create({
    data: {
      operationId,
      name,
      kind: "squad",
      order: (last._max.order ?? -1) + 1,
      targetSize: clampSize(targetSize),
    },
  });
  if (signupIds.length) {
    await prisma.cqbSignup.updateMany({
      where: { operationId, id: { in: signupIds }, assignedGroupId: null },
      data: { assignedGroupId: group.id, status: "accepted" },
    });
  }
  return group;
}

/** Operator: move a single signup into an existing squad (drag-drop). */
export async function assignToSquad(
  operationId: string,
  signupId: string,
  groupId: string,
): Promise<void> {
  const group = await prisma.compositionGroup.findFirst({
    where: { id: groupId, operationId, kind: "squad" },
    select: { id: true },
  });
  if (!group) return;
  await prisma.cqbSignup.updateMany({
    where: { id: signupId, operationId },
    data: { assignedGroupId: groupId, status: "accepted" },
  });
}

/**
 * Operator: move an existing signup to another squad, or back to the pool
 * (groupId = null). Used for after-the-fact reassignment.
 */
export async function reassignSignup(
  operationId: string,
  signupId: string,
  groupId: string | null,
): Promise<void> {
  if (groupId) {
    const group = await prisma.compositionGroup.findFirst({
      where: { id: groupId, operationId, kind: "squad" },
      select: { id: true },
    });
    if (!group) return;
    await prisma.cqbSignup.updateMany({
      where: { id: signupId, operationId },
      data: { assignedGroupId: groupId, status: "accepted" },
    });
  } else {
    await prisma.cqbSignup.updateMany({
      where: { id: signupId, operationId },
      data: { assignedGroupId: null, status: "pending" },
    });
  }
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
    await bundleSquad(operationId, `Squad ${existing + created + 1}`, chunk, sz);
    created++;
  }
  return created;
}

/**
 * Operator: place a "let the operator place me" crew member into a CQB team.
 * Creates/updates their CqbSignup and clears their pending crew request.
 * Operator override — no capacity gate.
 */
export async function placeInSquad(
  operationId: string,
  userId: string,
  groupId: string,
): Promise<void> {
  const group = await prisma.compositionGroup.findFirst({
    where: { id: groupId, operationId, kind: "squad" },
    select: { id: true },
  });
  if (!group) return;
  await prisma.cqbSignup.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, assignedGroupId: groupId, status: "accepted" },
    update: { assignedGroupId: groupId, status: "accepted" },
  });
  await prisma.crewAssignmentRequest.deleteMany({ where: { operationId, userId } });
}

/** Operator: rename a squad ("CQB Team N" is only the default). */
export async function renameSquad(
  operationId: string,
  groupId: string,
  name: string,
): Promise<void> {
  const n = name.trim().slice(0, 80);
  if (!n) return;
  await prisma.compositionGroup.updateMany({
    where: { id: groupId, operationId, kind: "squad" },
    data: { name: n },
  });
}

/** Operator: set (or clear) a squad's target size. */
export async function setSquadSize(
  operationId: string,
  groupId: string,
  size: number | null,
): Promise<void> {
  await prisma.compositionGroup.updateMany({
    where: { id: groupId, operationId, kind: "squad" },
    data: { targetSize: clampSize(size) },
  });
}

/**
 * Player: join a named CQB squad directly (a "seat" in the squad). Capacity-
 * gated by the squad's targetSize. Returns the squad name on success, or a
 * failure reason ("not_found" | "full").
 */
export async function joinSquad(
  operationId: string,
  userId: string,
  groupId: string,
): Promise<{ ok: true; name: string } | { ok: false; reason: "not_found" | "full" }> {
  const group = await prisma.compositionGroup.findFirst({
    where: { id: groupId, operationId, kind: { in: ["squad", "fighter_squad"] } },
    select: { id: true, name: true, targetSize: true },
  });
  if (!group) return { ok: false, reason: "not_found" };
  if (group.targetSize != null) {
    const members = await prisma.cqbSignup.count({
      where: { operationId, assignedGroupId: groupId, status: { not: "rejected" } },
    });
    // Already in this squad? Re-joining is a no-op success, not "full".
    const alreadyIn = await prisma.cqbSignup.count({
      where: { operationId, userId, assignedGroupId: groupId },
    });
    if (!alreadyIn && members >= group.targetSize) return { ok: false, reason: "full" };
  }
  // One CQB signup per op+user — joining a squad moves the player into it.
  await prisma.cqbSignup.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, assignedGroupId: groupId, status: "accepted" },
    update: { assignedGroupId: groupId, status: "accepted" },
  });
  return { ok: true, name: group.name };
}

/**
 * Operator: embed a CQB team into (or detach from) a non-fighter ship.
 * carrierUnitId null = detach. Fighters can't carry a team.
 */
export async function setSquadCarrier(
  operationId: string,
  groupId: string,
  carrierUnitId: string | null,
): Promise<{ ok: boolean; reason?: "group_not_found" | "ship_not_found" | "fighter" }> {
  const group = await prisma.compositionGroup.findFirst({
    where: { id: groupId, operationId, kind: "squad" },
    select: { id: true },
  });
  if (!group) return { ok: false, reason: "group_not_found" };
  if (carrierUnitId) {
    const carrier = await prisma.fleetUnit.findFirst({
      where: { id: carrierUnitId, operationId, unitType: "ship" },
      select: { id: true, ship: { select: { size: true, career: true, role: true } } },
    });
    if (!carrier) return { ok: false, reason: "ship_not_found" };
    if (shipClass(carrier.ship) === "Fighter") return { ok: false, reason: "fighter" };
  }
  await prisma.compositionGroup.updateMany({
    where: { id: groupId, operationId, kind: "squad" },
    data: { carrierUnitId },
  });
  return { ok: true };
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
