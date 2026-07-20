// Roster-Fundament 2026-07-20: who may the operator drop onto a seat or into a
// Trupp/Staffel? The host guild's members, plus — for a partner event — the
// members of every partner guild that can actually see this op. Everyone
// returned is a real, logged-in User: there is deliberately no free-text
// placeholder, so an assignment always maps to an account that can be notified.

import { prisma } from "../db.js";

export type AssignablePerson = {
  userId: string;
  username: string;
  guildId: string;
  guildName: string;
  /** false = reachable through a partnership, not a member of the host guild. */
  isHost: boolean;
};

/**
 * Guilds whose members are assignable for this op: the host guild always, and
 * the partner guilds the op was actually distributed to (approved/auto) or that
 * can see it because it is `partners`/`public` visible.
 */
async function reachableGuildIds(operationId: string): Promise<{ hostGuildId: string; guildIds: string[] } | null> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: { guildId: true, visibility: true },
  });
  if (!op) return null;

  const ids = new Set<string>([op.guildId]);

  // Explicitly distributed partner events.
  const shared = await prisma.eventDistribution.findMany({
    where: { operationId, status: { in: ["approved", "auto"] } },
    select: { targetGuildId: true },
  });
  for (const s of shared) ids.add(s.targetGuildId);

  // Op is open to partners → every active partnership of the host guild counts.
  if (op.visibility === "partners" || op.visibility === "public") {
    const links = await prisma.guildPartnership.findMany({
      where: {
        status: "active",
        OR: [{ guildAId: op.guildId }, { guildBId: op.guildId }],
      },
      select: { guildAId: true, guildBId: true },
    });
    for (const l of links) {
      const other = l.guildAId === op.guildId ? l.guildBId : l.guildAId;
      if (other) ids.add(other);
    }
  }

  return { hostGuildId: op.guildId, guildIds: [...ids] };
}

/**
 * People the operator can assign, host guild first, then partners, each block
 * alphabetical. A user in several reachable guilds is listed once, preferring
 * their host-guild identity.
 */
export async function assignablePeople(operationId: string): Promise<AssignablePerson[]> {
  const reach = await reachableGuildIds(operationId);
  if (!reach) return [];

  const memberships = await prisma.guildMembership.findMany({
    where: { guildId: { in: reach.guildIds } },
    select: {
      guildId: true,
      user: { select: { id: true, username: true, active: true } },
      guild: { select: { name: true } },
    },
  });

  const byUser = new Map<string, AssignablePerson>();
  for (const m of memberships) {
    if (!m.user || !m.user.active) continue;
    const isHost = m.guildId === reach.hostGuildId;
    const existing = byUser.get(m.user.id);
    if (existing && (existing.isHost || !isHost)) continue; // keep host identity
    byUser.set(m.user.id, {
      userId: m.user.id,
      username: m.user.username,
      guildId: m.guildId,
      guildName: m.guild?.name ?? "",
      isHost,
    });
  }

  return [...byUser.values()].sort(
    (a, b) =>
      Number(b.isHost) - Number(a.isHost) ||
      a.guildName.localeCompare(b.guildName) ||
      a.username.localeCompare(b.username),
  );
}
