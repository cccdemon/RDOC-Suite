// FR-P3 Org Fleet — guild ship roster (who owns what).
//
// Aggregates GuildMembership → User → UserShip → Ship for one guild, plus the
// member's Discord identity (for the contact deep link). Guild-scoped only;
// the caller (apiV1) enforces that the viewer is a member of `guildId`.
import { prisma } from "../db.js";

export type OrgFleetRow = {
  userId: string;
  username: string;
  discordId: string | null;
  discordHandle: string | null;
  shipId: string;
  shipName: string;
  manufacturer: string;
  shipClass: string;
  nickname: string | null;
  quantity: number;
};

export async function getOrgFleetRows(guildId: string): Promise<OrgFleetRow[]> {
  // Org-Flotte is restricted to "Orgamember" — members carrying the configured
  // Discord role (admiralRoleId → GuildMembership.role "fleetoperator"). Plain
  // crew are excluded from both the roster and (in the route) viewing it.
  const memberships = await prisma.guildMembership.findMany({
    where: { guildId, role: "fleetoperator" },
    select: { userId: true },
  });
  const userIds = memberships.map((m) => m.userId);
  if (userIds.length === 0) return [];

  const owned = await prisma.userShip.findMany({
    where: { userId: { in: userIds } },
    include: {
      ship: { select: { id: true, name: true, manufacturer: true, size: true } },
      user: {
        select: {
          id: true,
          username: true,
          identities: {
            where: { provider: "discord" },
            select: { providerId: true, username: true },
            take: 1,
          },
        },
      },
    },
    // Stable order: ship name, then owner — the SPA re-pivots client-side.
    orderBy: [{ ship: { name: "asc" } }, { user: { username: "asc" } }],
  });

  return owned.map((u) => {
    const dc = u.user.identities[0];
    return {
      userId: u.user.id,
      username: u.user.username,
      discordId: dc?.providerId ?? null,
      discordHandle: dc?.username ?? null,
      shipId: u.ship.id,
      shipName: u.ship.name,
      manufacturer: u.ship.manufacturer,
      shipClass: u.ship.size,
      nickname: u.nickname,
      quantity: u.quantity,
    };
  });
}
