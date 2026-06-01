import { prisma } from "../db.js";

export type MissionCommanderKind = "squadleader" | "participant";

export type MissionCommander = {
  userId: string;
  username: string;
  kind: MissionCommanderKind;
  globalVoice: boolean;
};

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
        where: { status: "accepted", unitType: "squad" },
        select: { captainId: true, captain: { select: { id: true, username: true } } },
        orderBy: { createdAt: "asc" },
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

  for (const participant of participants) {
    if (byId.has(participant.userId)) continue;
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
    where: { operationId, captainId: userId, status: "accepted", unitType: "squad" },
    select: { id: true },
  });
  if (squadleader) return true;

  const participant = await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId },
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
