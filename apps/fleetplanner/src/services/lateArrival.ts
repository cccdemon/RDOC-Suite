// Late-arrival ("nachkommen"): a unit, a seated player, or a CQB/pilot signup can
// be marked as arriving later with an ETA clock time (HH:MM). Storage is a nullable
// `lateEta` string on each model; null clears the flag. Auth (owner-or-operator) is
// enforced in the routes — these are pure DB ops that also return the owner userId
// so the caller can run the ownership check.

import { prisma } from "../db.js";

/** Returns the unit's captain (owner) or null if the unit isn't in this op. */
export async function unitOwner(operationId: string, unitId: string): Promise<string | null> {
  const u = await prisma.fleetUnit.findFirst({ where: { id: unitId, operationId }, select: { captainId: true } });
  return u?.captainId ?? null;
}

export async function setUnitLateEta(unitId: string, eta: string | null): Promise<void> {
  await prisma.fleetUnit.update({ where: { id: unitId }, data: { lateEta: eta } });
}

/** Returns the seat's occupant userId (or null if unclaimed / not in this op). */
export async function seatOwner(operationId: string, seatId: string): Promise<string | null | undefined> {
  const s = await prisma.seatAssignment.findFirst({
    where: { id: seatId, fleetUnit: { operationId } },
    select: { userId: true },
  });
  return s ? s.userId : undefined; // undefined = seat not found; null = unclaimed
}

export async function setSeatLateEta(seatId: string, eta: string | null): Promise<void> {
  await prisma.seatAssignment.update({ where: { id: seatId }, data: { lateEta: eta } });
}

/** Returns the CQB/pilot signup's owner userId, or null if not in this op. */
export async function cqbOwner(operationId: string, signupId: string): Promise<string | null> {
  const s = await prisma.cqbSignup.findFirst({ where: { id: signupId, operationId }, select: { userId: true } });
  return s?.userId ?? null;
}

export async function setCqbLateEta(signupId: string, eta: string | null): Promise<void> {
  await prisma.cqbSignup.update({ where: { id: signupId }, data: { lateEta: eta } });
}
