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

/** Operator: set (or clear) a squad's target size. */
