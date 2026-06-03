import { prisma } from "../db.js";

// Who took part in an operation, derived from the assigned roster (NOT live
// voice attendance — that is never persisted). A participant is anyone who held
// a mission position in the op:
//   - an OperationLeader (event/fleet/raid/wing),
//   - the captain of an accepted unit,
//   - the holder of an active seat in an accepted unit,
//   - a manually-added MissionVoiceParticipant (Command Net).
// Pending/rejected units do not count — they never flew.

export type MissionParticipant = {
  userId: string;
  username: string;
  /** Discord account id (snowflake), if the user linked Discord. */
  discordId: string | null;
  /** Discord display name at link time, if known. */
  discordName: string | null;
  /** Human-readable roles the user held, e.g. ["Raid Leader", "Captain"]. */
  roles: string[];
  /** Unit/ship/squad names the user was part of (captain or seat). */
  units: string[];
};

const LEADER_ROLE_LABELS: Record<string, string> = {
  event_leader: "Event Leader",
  fleet_commander: "Fleet Commander",
  raid_leader: "Raid Leader",
  wing_commander: "Wing Commander",
};

type Acc = {
  userId: string;
  username: string;
  roles: Set<string>;
  units: Set<string>;
};

function entry(map: Map<string, Acc>, userId: string, username: string): Acc {
  let acc = map.get(userId);
  if (!acc) {
    acc = { userId, username, roles: new Set(), units: new Set() };
    map.set(userId, acc);
  }
  return acc;
}

export async function getMissionParticipants(operationId: string): Promise<MissionParticipant[]> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      leaders: {
        select: { leaderRole: true, user: { select: { id: true, username: true } } },
      },
      units: {
        where: { status: "accepted" },
        orderBy: { createdAt: "asc" },
        select: {
          unitType: true,
          squadName: true,
          ship: { select: { name: true } },
          captain: { select: { id: true, username: true } },
          seats: {
            where: { active: true, userId: { not: null } },
            select: { label: true, user: { select: { id: true, username: true } } },
          },
        },
      },
    },
  });
  if (!op) return [];

  const participants = (await (prisma as any).missionVoiceParticipant.findMany({
    where: { operationId },
    select: { user: { select: { id: true, username: true } } },
  })) as Array<{ user: { id: string; username: string } }>;

  const map = new Map<string, Acc>();

  for (const leader of op.leaders) {
    const acc = entry(map, leader.user.id, leader.user.username);
    acc.roles.add(LEADER_ROLE_LABELS[leader.leaderRole] ?? leader.leaderRole.replace(/_/g, " "));
  }

  for (const unit of op.units) {
    const unitName =
      unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
    const cap = entry(map, unit.captain.id, unit.captain.username);
    cap.roles.add("Captain");
    cap.units.add(unitName);
    for (const seat of unit.seats) {
      if (!seat.user) continue;
      const acc = entry(map, seat.user.id, seat.user.username);
      acc.roles.add(seat.label);
      acc.units.add(unitName);
    }
  }

  for (const p of participants) {
    const acc = entry(map, p.user.id, p.user.username);
    acc.roles.add("Command Net");
  }

  // Resolve Discord identities in one query for the collected users.
  const userIds = [...map.keys()];
  const identities = userIds.length
    ? await prisma.userIdentity.findMany({
        where: { userId: { in: userIds }, provider: "discord" },
        select: { userId: true, providerId: true, username: true },
      })
    : [];
  const discordByUser = new Map(identities.map((i) => [i.userId, i]));

  return [...map.values()]
    .map((acc) => {
      const discord = discordByUser.get(acc.userId);
      return {
        userId: acc.userId,
        username: acc.username,
        discordId: discord?.providerId ?? null,
        discordName: discord?.username ?? null,
        roles: [...acc.roles],
        units: [...acc.units],
      };
    })
    .sort((a, b) => a.username.localeCompare(b.username));
}

function csvCell(value: string): string {
  // RFC 4180: quote always, escape embedded quotes by doubling.
  return `"${value.replace(/"/g, '""')}"`;
}

export function participantsToCsv(participants: MissionParticipant[]): string {
  const header = ["Username", "Discord", "Discord ID", "Roles", "Units"];
  const rows = participants.map((p) =>
    [
      p.username,
      p.discordName ?? "",
      p.discordId ?? "",
      p.roles.join(", "),
      p.units.join(", "),
    ]
      .map(csvCell)
      .join(","),
  );
  // Prepend a UTF-8 BOM so Excel reads non-ASCII names correctly. CRLF line ends.
  return "﻿" + [header.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";
}
