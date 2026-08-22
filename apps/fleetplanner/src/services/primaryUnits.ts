import { prisma } from "../db.js";

// A "multi-position" user is assigned (as captain or active seat) to 2+ accepted
// units in one operation. Discord allows only one voice channel per person, so
// exactly one unit is their PRIMARY (main) channel. This service resolves that
// choice: an explicit pick (by the user or a mission leader) wins; otherwise a
// system default applies — prefer an FPS/ground squad, else the earliest unit.

export type UserUnit = {
  unitId: string;
  unitType: string; // "ship" | "squad"
  name: string;
  createdAt: Date;
  hasChannel: boolean;
};

/** All accepted units each user belongs to (captain or active seat), grouped by
 *  userId, ordered by unit createdAt ascending. */
export async function userUnitsByUser(operationId: string): Promise<Map<string, UserUnit[]>> {
  const units = await prisma.fleetUnit.findMany({
    where: { operationId, status: "accepted" },
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      unitType: true,
      squadName: true,
      createdAt: true,
      captainId: true,
      ship: { select: { name: true } },
      seats: { where: { active: true, userId: { not: null } }, select: { userId: true } },
    },
  });

  const byUser = new Map<string, UserUnit[]>();
  const add = (userId: string, u: (typeof units)[number]) => {
    const name = u.unitType === "ship" ? (u.ship?.name ?? "Ship") : (u.squadName ?? "Squad");
    const entry: UserUnit = {
      unitId: u.id,
      unitType: u.unitType,
      name,
      createdAt: u.createdAt,
      hasChannel: false,
    };
    const list = byUser.get(userId);
    if (list) {
      if (!list.some((e) => e.unitId === entry.unitId)) list.push(entry);
    } else {
      byUser.set(userId, [entry]);
    }
  };

  for (const u of units) {
    add(u.captainId, u);
    for (const seat of u.seats) if (seat.userId) add(seat.userId, u);
  }
  return byUser;
}

/** System default primary when the user hasn't chosen: prefer an FPS/ground
 *  squad (the example case — boots-on-ground main channel), else the earliest
 *  unit. `units` must be createdAt-ascending. */
export function defaultPrimaryUnit(units: UserUnit[]): UserUnit | null {
  if (units.length === 0) return null;
  const squad = units.find((u) => u.unitType !== "ship");
  return squad ?? units[0];
}

/** Explicit per-user primary-unit choices for the op (userId → unitId). */
async function getPrimaryChoices(operationId: string): Promise<Map<string, string>> {
  const rows = await prisma.opPrimaryUnit.findMany({
    where: { operationId },
    select: { userId: true, unitId: true },
  });
  return new Map(rows.map((r) => [r.userId, r.unitId]));
}

/** Effective primary unit per user (explicit choice if still valid, else
 *  default). Only includes users actually in 1+ unit. */
export async function resolvePrimaryUnits(operationId: string): Promise<Map<string, string>> {
  const [byUser, choices] = await Promise.all([
    userUnitsByUser(operationId),
    getPrimaryChoices(operationId),
  ]);
  const out = new Map<string, string>();
  for (const [userId, units] of byUser) {
    const chosen = choices.get(userId);
    if (chosen && units.some((u) => u.unitId === chosen)) {
      out.set(userId, chosen);
      continue;
    }
    const def = defaultPrimaryUnit(units);
    if (def) out.set(userId, def.unitId);
  }
  return out;
}

/** Persist a person's primary-unit choice. Validates that they actually hold
 *  a place in that unit; `setByUserId` records who chose it (self or an
 *  operator). Without a choice the roster falls back to defaultPrimaryUnit. */
export async function setPrimaryUnit(
  operationId: string,
  userId: string,
  unitId: string,
  setByUserId: string,
): Promise<void> {
  const units = (await userUnitsByUser(operationId)).get(userId) ?? [];
  if (!units.some((u) => u.unitId === unitId)) {
    throw new Error("User is not assigned to that unit");
  }
  await prisma.opPrimaryUnit.upsert({
    where: { operationId_userId: { operationId, userId } },
    update: { unitId, setByUserId },
    create: { operationId, userId, unitId, setByUserId },
  });
}

/** Drop an explicit choice → falls back to the system default. */
export async function clearPrimaryUnit(operationId: string, userId: string): Promise<void> {
  await prisma.opPrimaryUnit
    .delete({ where: { operationId_userId: { operationId, userId } } })
    .catch(() => {});
}

export type MultiPositionAssignment = {
  userId: string;
  username: string;
  units: UserUnit[];
  /** Explicit choice, or null when running on the system default. */
  chosenUnitId: string | null;
  /** Unit the user is actually moved into (choice or default). */
  effectiveUnitId: string;
};

/** Users in 2+ accepted units, with their units + current primary choice — the
 *  data the op detail UI needs to render the primary-channel picker. */
export async function getMultiPositionAssignments(
  operationId: string,
): Promise<MultiPositionAssignment[]> {
  const byUser = await userUnitsByUser(operationId);
  const multi = [...byUser.entries()].filter(([, units]) => units.length >= 2);
  if (multi.length === 0) return [];

  const userIds = multi.map(([userId]) => userId);
  const [users, choices] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, username: true } }),
    getPrimaryChoices(operationId),
  ]);
  const nameById = new Map(users.map((u) => [u.id, u.username]));

  return multi
    .map(([userId, units]) => {
      const chosen = choices.get(userId);
      const valid = chosen && units.some((u) => u.unitId === chosen) ? chosen : null;
      const effective = valid ?? defaultPrimaryUnit(units)?.unitId ?? units[0].unitId;
      return {
        userId,
        username: nameById.get(userId) ?? userId,
        units,
        chosenUnitId: valid,
        effectiveUnitId: effective,
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}
