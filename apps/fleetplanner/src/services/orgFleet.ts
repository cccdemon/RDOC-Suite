// FR-P3 Org Fleet — guild ship roster (who owns what).
//
// Aggregates GuildMembership → User → UserShip → Ship for one guild, plus the
// member's Discord identity (for the contact deep link) and a Fleetyards match
// (source link + cached image). Guild-scoped; the caller (apiV1) enforces that
// the viewer is an Orgamember of `guildId`.
//
// Restrictions (user 2026-06-15):
//  - roster = members with role "fleetoperator" (the Orgamember Discord role)
//  - AND only those who opted in (`User.shareHangarWithOrg`).
import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import { normShipName } from "./shipSync.js";

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
  sourceUrl: string | null;
  imageUrl: string | null;
};

export async function getOrgFleetRows(guildId: string): Promise<OrgFleetRow[]> {
  const memberships = await prisma.guildMembership.findMany({
    where: { guildId, role: "fleetoperator" },
    select: { userId: true },
  });
  const userIds = memberships.map((m) => m.userId);
  if (userIds.length === 0) return [];

  const owned = await prisma.userShip.findMany({
    // Opt-in only: the owner must have shared their hangar with the org.
    where: { userId: { in: userIds }, user: { shareHangarWithOrg: true } },
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
    orderBy: [{ ship: { name: "asc" } }, { user: { username: "asc" } }],
  });

  // One Fleetyards lookup for all distinct ship names → slug (source link) +
  // store image (lazy-cached locally by the /assets/ship-images route).
  const keys = [...new Set(owned.map((u) => normShipName(u.ship.name)).filter(Boolean))];
  const fy = keys.length
    ? await prisma.fleetyardsShip.findMany({
        where: { nameKey: { in: keys } },
        select: { nameKey: true, slug: true, storeImageUrl: true },
      })
    : [];
  const fyByKey = new Map(fy.map((f) => [f.nameKey, f]));
  const env = getEnv();
  const base = env.PUBLIC_BASE_PATH ?? "";

  return owned.map((u) => {
    const dc = u.user.identities[0];
    const f = fyByKey.get(normShipName(u.ship.name));
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
      sourceUrl: f?.slug ? `https://fleetyards.net/ships/${f.slug}` : null,
      imageUrl: f?.storeImageUrl ? `${base}/assets/ship-images/${u.ship.id}` : null,
    };
  });
}
