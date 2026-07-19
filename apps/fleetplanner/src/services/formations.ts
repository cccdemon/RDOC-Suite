// FR-P1 Phase 4a: operator formations (Verbände). Ships are grouped into a
// CompositionGroup with kind="formation"; membership is FleetUnit.formationId.
// Pure DB ops, operator-only (gated in the routes).

import { prisma } from "../db.js";
import { shipClass } from "./composition.js";

// A Jäger-Staffel is a Verband (formation) the operator created. Its fighter
// capacity is the "à N Jäger" from the fighter-squad Bedarf (default 2).
const DEFAULT_FIGHTER_SQUAD_SIZE = 2;

async function fighterSquadCapacity(operationId: string): Promise<number> {
  const req = await prisma.compositionRequirement.findFirst({
    where: { group: { operationId }, needType: "fighter_squad" },
    select: { squadSize: true },
  });
  return req?.squadSize ?? DEFAULT_FIGHTER_SQUAD_SIZE;
}

// How many fighters (fighter-class units + placed person-pilots) sit in a formation.
async function formationFighterCount(operationId: string, formationId: string): Promise<number> {
  const units = await prisma.fleetUnit.findMany({
    where: { operationId, formationId, unitType: "ship", status: { not: "rejected" } },
    select: { ship: { select: { size: true, career: true, role: true } } },
  });
  const fighters = units.filter((u) => shipClass(u.ship) === "Fighter").length;
  const pilots = await prisma.cqbSignup.count({
    where: { operationId, assignedGroupId: formationId, status: { not: "rejected" } },
  });
  return fighters + pilots;
}

/**
 * Auto-fill: when a fighter unit is accepted without a Staffel, drop it into the
 * FIRST Verband/formation (by order) that still has a free fighter slot — capacity
 * = the fighter-squad Bedarf size (default 2). If every formation is full (or none
 * exist) it stays "Ohne Staffel". Never creates formations. No-op for non-fighter
 * units or ones already assigned.
 */
export async function autoAssignFighterToSquad(operationId: string, unitId: string): Promise<void> {
  const unit = await prisma.fleetUnit.findFirst({
    where: { id: unitId, operationId },
    select: { id: true, unitType: true, formationId: true, ship: { select: { size: true, career: true, role: true } } },
  });
  if (!unit || unit.unitType !== "ship" || unit.formationId) return;
  if (shipClass(unit.ship) !== "Fighter") return;
  const cap = await fighterSquadCapacity(operationId);
  const formations = await prisma.compositionGroup.findMany({
    where: { operationId, kind: "formation" },
    orderBy: { order: "asc" },
    select: { id: true },
  });
  for (const f of formations) {
    if ((await formationFighterCount(operationId, f.id)) >= cap) continue; // full → next
    await prisma.fleetUnit.update({ where: { id: unitId }, data: { formationId: f.id } });
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
    select: { id: true, ship: { select: { size: true, career: true, role: true } } },
  });
  let placed = 0;
  for (const f of fighters) {
    if (shipClass(f.ship) !== "Fighter") continue;
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
 *  over-fill a squad. */
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
  if (formationId) {
    const f = await prisma.compositionGroup.findFirst({
      where: { id: formationId, operationId, kind: { in: ["formation", "fighter_squad"] } },
      select: { id: true },
    });
    if (!f) return { ok: false, reason: "formation_not_found" };
  }
  await prisma.fleetUnit.update({ where: { id: unitId }, data: { formationId } });
  return { ok: true };
}
