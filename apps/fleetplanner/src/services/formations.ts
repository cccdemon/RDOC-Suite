// FR-P1 Phase 4a: operator formations (Verbände). Ships are grouped into a
// CompositionGroup with kind="formation"; membership is FleetUnit.formationId.
// Pure DB ops, operator-only (gated in the routes).

import { prisma } from "../db.js";
import { effectiveShipClass } from "./composition.js";

// A Jäger-Staffel holds "à N Jäger" from the fighter-squad Bedarf (default 2).
const DEFAULT_FIGHTER_SQUAD_SIZE = 2;

// Groups that can hold members with positional slots (slot 0 = Captain).
const SLOTTED_KINDS = ["squad", "fighter_squad", "formation"] as const;

export async function fighterSquadCapacity(operationId: string): Promise<number> {
  const req = await prisma.compositionRequirement.findFirst({
    where: { group: { operationId }, needType: "fighter_squad" },
    select: { squadSize: true },
  });
  return req?.squadSize ?? DEFAULT_FIGHTER_SQUAD_SIZE;
}

/**
 * Jäger-Staffeln of an op, in display order. Primary source is the Bedarf-
 * materialised `fighter_squad` groups. Legacy fallback: ops where the operator
 * built their Staffeln as `formation` groups (pre-2026-07-20 rosters) — those
 * keep working, so no data migration is needed.
 */
export async function fighterSquads(operationId: string) {
  const squads = await prisma.compositionGroup.findMany({
    where: { operationId, kind: "fighter_squad" },
    orderBy: { order: "asc" },
    select: { id: true, name: true, order: true, parentId: true },
  });
  if (squads.length) return squads;
  return prisma.compositionGroup.findMany({
    where: { operationId, kind: "formation" },
    orderBy: { order: "asc" },
    select: { id: true, name: true, order: true, parentId: true },
  });
}

/**
 * Lowest unused member slot in a group. Fighter units and person-pilots share one
 * slot space, so a Staffel with a unit in slot 0 hands out slot 1 to the next
 * pilot — slot 0 (the Captain) is never silently duplicated.
 */
export async function nextFreeSlot(operationId: string, groupId: string): Promise<number> {
  const [units, people] = await Promise.all([
    prisma.fleetUnit.findMany({
      where: { operationId, formationId: groupId, status: { not: "rejected" } },
      select: { formationSlot: true },
    }),
    prisma.cqbSignup.findMany({
      where: { operationId, assignedGroupId: groupId, status: { not: "rejected" } },
      select: { slotIndex: true },
    }),
  ]);
  const taken = new Set<number>();
  for (const u of units) if (u.formationSlot != null) taken.add(u.formationSlot);
  for (const p of people) if (p.slotIndex != null) taken.add(p.slotIndex);
  let i = 0;
  while (taken.has(i)) i++;
  return i;
}

/**
 * Hang a Staffel/Trupp under a Verband, or detach it (parentId = null).
 * Only a `formation` may be a parent, and nesting stays ONE level deep: a group
 * that already has a parent cannot itself become one. Self-parenting is rejected.
 */
export async function setGroupParent(
  operationId: string,
  groupId: string,
  parentId: string | null,
): Promise<{ ok: boolean; reason?: "group_not_found" | "parent_not_found" | "self" | "too_deep" }> {
  if (parentId && parentId === groupId) return { ok: false, reason: "self" };
  const group = await prisma.compositionGroup.findFirst({
    where: { id: groupId, operationId, kind: { in: [...SLOTTED_KINDS] } },
    select: { id: true },
  });
  if (!group) return { ok: false, reason: "group_not_found" };
  if (parentId) {
    const parent = await prisma.compositionGroup.findFirst({
      where: { id: parentId, operationId, kind: "formation" },
      select: { id: true, parentId: true },
    });
    if (!parent) return { ok: false, reason: "parent_not_found" };
    if (parent.parentId) return { ok: false, reason: "too_deep" };
    // The group we're nesting must not already act as a parent itself.
    const hasChildren = await prisma.compositionGroup.count({ where: { operationId, parentId: groupId } });
    if (hasChildren) return { ok: false, reason: "too_deep" };
  }
  await prisma.compositionGroup.update({ where: { id: groupId }, data: { parentId } });
  return { ok: true };
}

/**
 * Move a member to an explicit slot inside its group (drag onto slot N).
 * Swaps with whoever holds that slot, so "make X the Captain" is a single call
 * against slot 0 and never leaves two members claiming the same position.
 */
export async function setMemberSlot(
  operationId: string,
  member: { kind: "unit"; id: string } | { kind: "person"; id: string },
  slot: number,
): Promise<{ ok: boolean; reason?: "not_found" | "no_group" }> {
  const s = Math.max(0, Math.floor(slot));
  const groupId =
    member.kind === "unit"
      ? (await prisma.fleetUnit.findFirst({ where: { id: member.id, operationId }, select: { formationId: true } }))
          ?.formationId ?? null
      : (await prisma.cqbSignup.findFirst({ where: { id: member.id, operationId }, select: { assignedGroupId: true } }))
          ?.assignedGroupId ?? null;
  if (!groupId) return { ok: false, reason: "no_group" };

  // Whoever sits in the target slot trades places with the mover.
  const [unitAt, personAt] = await Promise.all([
    prisma.fleetUnit.findFirst({
      where: { operationId, formationId: groupId, formationSlot: s, status: { not: "rejected" } },
      select: { id: true },
    }),
    prisma.cqbSignup.findFirst({
      where: { operationId, assignedGroupId: groupId, slotIndex: s, status: { not: "rejected" } },
      select: { id: true },
    }),
  ]);
  const prev =
    member.kind === "unit"
      ? (await prisma.fleetUnit.findUnique({ where: { id: member.id }, select: { formationSlot: true } }))?.formationSlot
      : (await prisma.cqbSignup.findUnique({ where: { id: member.id }, select: { slotIndex: true } }))?.slotIndex;

  await prisma.$transaction(async (tx) => {
    if (unitAt && unitAt.id !== member.id) {
      await tx.fleetUnit.update({ where: { id: unitAt.id }, data: { formationSlot: prev ?? null } });
    }
    if (personAt && personAt.id !== member.id) {
      await tx.cqbSignup.update({ where: { id: personAt.id }, data: { slotIndex: prev ?? null } });
    }
    if (member.kind === "unit") {
      await tx.fleetUnit.update({ where: { id: member.id }, data: { formationSlot: s } });
    } else {
      await tx.cqbSignup.update({ where: { id: member.id }, data: { slotIndex: s } });
    }
  });
  return { ok: true };
}

/** How many fighters (fighter-class units + placed person-pilots) sit in a group. */
export async function groupFighterCount(operationId: string, groupId: string): Promise<number> {
  const units = await prisma.fleetUnit.findMany({
    where: { operationId, formationId: groupId, unitType: "ship", status: { not: "rejected" } },
    select: { unitType: true, roleOverride: true, ship: { select: { size: true, career: true, role: true } } },
  });
  const fighters = units.filter((u) => effectiveShipClass(u) === "Fighter").length;
  const pilots = await prisma.cqbSignup.count({
    where: { operationId, assignedGroupId: groupId, status: { not: "rejected" } },
  });
  return fighters + pilots;
}

/**
 * Auto-fill: when a fighter unit is accepted without a Staffel, drop it into the
 * FIRST Staffel (by order) that still has a free slot — capacity = the fighter-squad
 * Bedarf size (default 2). If every Staffel is full (or none exist) it stays "Ohne
 * Staffel". Never creates Staffeln (their count IS the Bedarf). No-op for non-fighter
 * units or ones already assigned.
 */
export async function autoAssignFighterToSquad(operationId: string, unitId: string): Promise<void> {
  const unit = await prisma.fleetUnit.findFirst({
    where: { id: unitId, operationId },
    select: { id: true, unitType: true, formationId: true, roleOverride: true, ship: { select: { size: true, career: true, role: true } } },
  });
  if (!unit || unit.unitType !== "ship" || unit.formationId) return;
  if (effectiveShipClass(unit) !== "Fighter") return;
  const cap = await fighterSquadCapacity(operationId);
  for (const f of await fighterSquads(operationId)) {
    if ((await groupFighterCount(operationId, f.id)) >= cap) continue; // full → next
    await prisma.fleetUnit.update({
      where: { id: unitId },
      data: { formationId: f.id, formationSlot: await nextFreeSlot(operationId, f.id) },
    });
    return;
  }
  // All Staffeln full (or none created yet) → leave the fighter "Ohne Staffel".
}

/**
 * Operator backfill: run auto-fill over ALL already-accepted fighters that have no
 * Staffel yet (oldest first), so existing rosters get distributed too. Returns the
 * number of fighters that landed in a Staffel. Idempotent — re-running only places
 * what still fits.
 */
export async function autoFillAllFighters(operationId: string): Promise<number> {
  const fighters = await prisma.fleetUnit.findMany({
    where: { operationId, unitType: "ship", status: "accepted", formationId: null },
    orderBy: { createdAt: "asc" },
    select: { id: true, unitType: true, roleOverride: true, ship: { select: { size: true, career: true, role: true } } },
  });
  let placed = 0;
  for (const f of fighters) {
    if (effectiveShipClass(f) !== "Fighter") continue;
    await autoAssignFighterToSquad(operationId, f.id);
    const u = await prisma.fleetUnit.findUnique({ where: { id: f.id }, select: { formationId: true } });
    if (u?.formationId) placed++;
  }
  return placed;
}

/** Create a named formation for an op. */
export async function createFormation(operationId: string, name: string) {
  const last = await prisma.compositionGroup.aggregate({
    where: { operationId },
    _max: { order: true },
  });
  return prisma.compositionGroup.create({
    data: {
      operationId,
      kind: "formation",
      name: name.trim().slice(0, 80) || "Formation",
      order: (last._max.order ?? -1) + 1,
    },
  });
}

/** Rename a formation. */
export async function renameFormation(operationId: string, formationId: string, name: string): Promise<void> {
  const n = name.trim().slice(0, 80);
  if (!n) return;
  await prisma.compositionGroup.updateMany({
    where: { id: formationId, operationId, kind: "formation" },
    data: { name: n },
  });
}

/** Delete a formation; its ships are freed (formationId → null via FK). */
export async function deleteFormation(operationId: string, formationId: string): Promise<void> {
  await prisma.compositionGroup.deleteMany({
    where: { id: formationId, operationId, kind: "formation" },
  });
}

/** Assign a ship unit to a group, or detach it (formationId = null). The target
 *  group may be a Verband (kind="formation") OR a Jäger-Staffel
 *  (kind="fighter_squad") — both are stored in the same `FleetUnit.formationId`
 *  ref. Assignment is never gated by the squad's target size, so an operator can
 *  over-fill a squad. The unit takes the lowest free slot; landing on slot 0 makes
 *  it the group's Captain. */
export async function assignUnitToFormation(
  operationId: string,
  unitId: string,
  formationId: string | null,
): Promise<{ ok: boolean; reason?: string }> {
  const unit = await prisma.fleetUnit.findFirst({
    where: { id: unitId, operationId },
    select: { id: true, unitType: true },
  });
  if (!unit) return { ok: false, reason: "unit_not_found" };
  if (unit.unitType !== "ship") return { ok: false, reason: "only_ships" };
  if (!formationId) {
    await prisma.fleetUnit.update({ where: { id: unitId }, data: { formationId: null, formationSlot: null } });
    return { ok: true };
  }
  const f = await prisma.compositionGroup.findFirst({
    where: { id: formationId, operationId, kind: { in: [...SLOTTED_KINDS] } },
    select: { id: true },
  });
  if (!f) return { ok: false, reason: "formation_not_found" };
  await prisma.fleetUnit.update({
    where: { id: unitId },
    data: { formationId, formationSlot: await nextFreeSlot(operationId, formationId) },
  });
  return { ok: true };
}
