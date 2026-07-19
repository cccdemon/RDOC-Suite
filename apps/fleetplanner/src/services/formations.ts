// FR-P1 Phase 4a: operator formations (Verbände). Ships are grouped into a
// CompositionGroup with kind="formation"; membership is FleetUnit.formationId.
// Pure DB ops, operator-only (gated in the routes).

import { prisma } from "../db.js";
import { shipClass } from "./composition.js";

/**
 * Auto-fill: when a fighter unit is accepted without a squad, drop it into the
 * FIRST Jäger-Staffel (fighter_squad group, by order) that still has a free slot
 * — occupancy = bound fighter units + person-pilots, capped at targetSize. If all
 * squads are full it stays "Ohne Staffel". Never creates squads (squad count is
 * fixed by the Bedarf). No-op for non-fighter units or ones already in a squad.
 */
export async function autoAssignFighterToSquad(operationId: string, unitId: string): Promise<void> {
  const unit = await prisma.fleetUnit.findFirst({
    where: { id: unitId, operationId },
    select: { id: true, unitType: true, formationId: true, ship: { select: { size: true, career: true, role: true } } },
  });
  if (!unit || unit.unitType !== "ship" || unit.formationId) return;
  if (shipClass(unit.ship) !== "Fighter") return;
  const squads = await prisma.compositionGroup.findMany({
    where: { operationId, kind: "fighter_squad" },
    orderBy: { order: "asc" },
    select: { id: true, targetSize: true },
  });
  for (const sq of squads) {
    if (sq.targetSize != null) {
      const [units, persons] = await Promise.all([
        prisma.fleetUnit.count({ where: { operationId, formationId: sq.id, status: { not: "rejected" } } }),
        prisma.cqbSignup.count({ where: { operationId, assignedGroupId: sq.id, status: { not: "rejected" } } }),
      ]);
      if (units + persons >= sq.targetSize) continue; // full → try next squad
    }
    await prisma.fleetUnit.update({ where: { id: unitId }, data: { formationId: sq.id } });
    return;
  }
  // All squads full (or none defined) → leave the fighter "Ohne Staffel".
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
