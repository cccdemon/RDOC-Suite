// FR-P1 Phase 4a: operator formations (Verbände). Ships are grouped into a
// CompositionGroup with kind="formation"; membership is FleetUnit.formationId.
// Pure DB ops, operator-only (gated in the routes).

import { prisma } from "../db.js";

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
