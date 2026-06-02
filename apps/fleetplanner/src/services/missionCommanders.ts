import { prisma } from "../db.js";

export type MissionCommanderKind = "squadleader" | "leader" | "participant";

export type MissionCommander = {
  userId: string;
  username: string;
  kind: MissionCommanderKind;
  globalVoice: boolean;
};

const MISSION_VOICE_LEADER_ROLES = new Set(["event_leader", "raid_leader", "wing_commander"]);

type ParticipantRow = {
  userId: string;
  globalVoice: boolean;
  user: { id: string; username: string };
};

export async function listMissionCommanders(operationId: string): Promise<MissionCommander[]> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      units: {
        where: { status: "accepted" },
        select: { captainId: true, captain: { select: { id: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
      leaders: {
        select: { userId: true, leaderRole: true, user: { select: { id: true, username: true } } },
        orderBy: { userId: "asc" },
      },
    },
  });
  if (!op) return [];

  const participants = (await (prisma as any).missionVoiceParticipant.findMany({
    where: { operationId },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: "asc" },
  })) as ParticipantRow[];
  const participantByUser = new Map(participants.map((row) => [row.userId, row]));

  const byId = new Map<string, MissionCommander>();
  for (const unit of op.units) {
    const participant = participantByUser.get(unit.captainId);
    byId.set(unit.captainId, {
      userId: unit.captainId,
      username: unit.captain.username,
      kind: "squadleader",
      globalVoice: participant?.globalVoice ?? false,
    });
  }

  for (const leader of op.leaders) {
    if (!MISSION_VOICE_LEADER_ROLES.has(leader.leaderRole)) continue;
    const existing = byId.get(leader.userId);
    byId.set(leader.userId, {
      userId: leader.userId,
      username: existing?.username ?? leader.user.username,
      kind: existing?.kind === "squadleader" ? "squadleader" : "leader",
      globalVoice: true,
    });
  }

  for (const participant of participants) {
    const existing = byId.get(participant.userId);
    if (existing) {
      byId.set(participant.userId, {
        ...existing,
        globalVoice: existing.globalVoice || participant.globalVoice,
      });
      continue;
    }
    byId.set(participant.userId, {
      userId: participant.userId,
      username: participant.user.username,
      kind: "participant",
      globalVoice: participant.globalVoice,
    });
  }

  return [...byId.values()];
}

export async function isMissionCommander(operationId: string, userId: string): Promise<boolean> {
  const squadleader = await prisma.fleetUnit.findFirst({
    where: { operationId, captainId: userId, status: "accepted" },
    select: { id: true },
  });
  if (squadleader) return true;

  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { leaderRole: true },
  });
  if (leader && MISSION_VOICE_LEADER_ROLES.has(leader.leaderRole)) return true;

  const participant = await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId },
    select: { id: true },
  });
  return Boolean(participant);
}

export async function hasMissionRelayVoice(operationId: string, userId: string): Promise<boolean> {
  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { leaderRole: true },
  });
  if (leader && MISSION_VOICE_LEADER_ROLES.has(leader.leaderRole)) return true;

  const participant = await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId, globalVoice: true },
    select: { id: true },
  });
  return Boolean(participant);
}

export async function missionVoiceAccessUsers(operationId: string): Promise<{
  commanderUserIds: Set<string>;
  globalVoiceUserIds: Set<string>;
}> {
  const commanders = await listMissionCommanders(operationId);
  return {
    commanderUserIds: new Set(commanders.map((commander) => commander.userId)),
    globalVoiceUserIds: new Set(
      commanders
        .filter((commander) => commander.globalVoice)
        .map((commander) => commander.userId),
    ),
  };
}
