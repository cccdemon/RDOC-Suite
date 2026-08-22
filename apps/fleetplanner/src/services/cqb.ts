// FR-P1 fleet-needs — CQB personnel pool + squad bundling.
// A person signs up as a CQB soldier (no role taxonomy); the fleet operator
// bundles signups into squads (CompositionGroup.kind = "squad"). Pure DB ops.

import { prisma } from "../db.js";
import { effectiveShipClass } from "./composition.js";
import { nextFreeSlot } from "./formations.js";

/** Groups a person can be slotted into. Slot 0 of any of them is the Captain. */
const SLOTTED_KINDS = ["squad", "fighter_squad", "formation"];

/** Join payload for a person entering `groupId` at the lowest free slot. */
async function joinData(operationId: string, groupId: string) {
  return { assignedGroupId: groupId, status: "accepted", slotIndex: await nextFreeSlot(operationId, groupId) };
}

/** Player: volunteer as a CQB soldier (idempotent per op+user). When `groupId`
 *  is given the player joins that squad directly (self-service slot); otherwise
 *  it's a flexible signup the operator places later. */
export async function createSignup(
  operationId: string,
  userId: string,
  note: string | null,
  groupId?: string | null,
) {
  const join = groupId ? await joinData(operationId, groupId) : {};
  return prisma.cqbSignup.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, note, ...join },
    update: { note, ...join },
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
export async function placeInSquad(
  operationId: string,
  userId: string,
  groupId: string,
): Promise<void> {
  const group = await prisma.compositionGroup.findFirst({
    // Operator can place a player into a CQB squad OR a fighter wing.
    where: { id: groupId, operationId, kind: { in: SLOTTED_KINDS } },
    select: { id: true },
  });
  if (!group) return;
  const join = await joinData(operationId, groupId);
  await prisma.cqbSignup.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, ...join },
    update: join,
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

/** Operator: create a squad group from selected (still-unassigned) signups.
 *  Slots go out in the given order, so the first signup becomes Captain. */
async function bundleSquad(
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
  // Slots are handed out in the given order — the first signup becomes Captain.
  let slot = 0;
  for (const id of signupIds) {
    const moved = await prisma.cqbSignup.updateMany({
      where: { operationId, id, assignedGroupId: null },
      data: { assignedGroupId: group.id, status: "accepted", slotIndex: slot },
    });
    if (moved.count) slot++;
  }
  return group;
}

/** Operator: move a single signup into an existing squad (drag-drop). */

/** Operator: chunk the whole unassigned pool into squads of `size`. Returns
 *  how many squads were created. */
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

/** Operator: dissolve a squad — its members go back into the flexible pool
 *  rather than being dropped from the operation. */
export async function unbundle(operationId: string, groupId: string): Promise<void> {
  await prisma.cqbSignup.updateMany({
    where: { operationId, assignedGroupId: groupId },
    data: { assignedGroupId: null, status: "pending", slotIndex: null },
  });
  await prisma.compositionGroup.deleteMany({
    where: { id: groupId, operationId, kind: "squad" },
  });
}
