// Hangar sharing (mission-board feature). A player can opt in, per operation, to
// let the operation's operators see their hangar (UserShip list) — e.g. so an
// operator can pick a fitting ship for a type-bound slot. Opt-in, op-scoped,
// never public. Backed by the OperationHangarShare model + existing UserShip.

import { prisma } from "../db.js";

export interface SharedHangar {
  userId: string;
  username: string;
  note: string | null;
  ships: Array<{ id: string; name: string; nickname: string | null }>;
}

/**
 * Who may see other players' shared hangars in an op: only fleet operators,
 * superadmins, or a leader of this op. Pure predicate (the caller resolves the
 * viewer's effective op role + leadership) so it is trivially testable.
 */
export function canViewHangars(
  effectiveOpRole: string | null | undefined,
  isLeader = false,
): boolean {
  return effectiveOpRole === "fleetoperator" || effectiveOpRole === "superadmin" || isLeader;
}

/** Player sets (opt in/out of) their own hangar share for one operation. */
export async function setHangarShare(
  operationId: string,
  userId: string,
  opts: { allow: boolean; note?: string | null },
): Promise<void> {
  const note = opts.note?.trim().slice(0, 280) || null;
  await prisma.operationHangarShare.upsert({
    where: { operationId_userId: { operationId, userId } },
    create: { operationId, userId, allowOperatorHangarView: opts.allow, note },
    update: { allowOperatorHangarView: opts.allow, note },
  });
}

/** A player's own share row for an op (null if never set). */
export async function getHangarShare(operationId: string, userId: string) {
  return prisma.operationHangarShare.findUnique({
    where: { operationId_userId: { operationId, userId } },
  });
}

/**
 * All players who shared their hangar for this op, each with their UserShip
 * list. Operator-only data — callers MUST gate with canViewHangars first.
 */
export async function listSharedHangars(operationId: string): Promise<SharedHangar[]> {
  const shares = await prisma.operationHangarShare.findMany({
    where: { operationId, allowOperatorHangarView: true },
    include: { user: true },
    orderBy: { updatedAt: "desc" },
  });
  if (shares.length === 0) return [];
  const userIds = shares.map((s) => s.userId);
  const owned = await prisma.userShip.findMany({
    where: { userId: { in: userIds } },
    include: { ship: true },
    orderBy: { ship: { name: "asc" } },
  });
  const byUser = new Map<string, SharedHangar["ships"]>();
  for (const o of owned) {
    const list = byUser.get(o.userId) ?? [];
    list.push({ id: o.shipId, name: o.ship?.name ?? "Unknown Ship", nickname: o.nickname });
    byUser.set(o.userId, list);
  }
  return shares.map((s) => ({
    userId: s.userId,
    username: s.user.username,
    note: s.note,
    ships: byUser.get(s.userId) ?? [],
  }));
}
