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

async function isGuildFleetoperator(guildId: string | undefined, userId: string): Promise<boolean> {
  if (!guildId) return false;
  const model = (prisma as any).guildMembership;
  if (!model) return false;
  const membership = (await model.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { role: true },
  })) as { role: string } | null;
  return membership?.role === "fleetoperator";
}

export async function listMissionCommanders(operationId: string): Promise<MissionCommander[]> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: {
      guildId: true,
      units: {
        where: { status: "accepted" },
        select: { captainId: true, captain: { select: { id: true, username: true } } },
        orderBy: { createdAt: "asc" },
      },
      leaders: {
        select: { userId: true, user: { select: { id: true, username: true } } },
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
    const existing = byId.get(leader.userId);
    byId.set(leader.userId, {
      userId: leader.userId,
      username: existing?.username ?? leader.user.username,
      kind: existing?.kind ?? "participant",
      globalVoice: true,
    });
  }

  const fleetoperatorModel = (prisma as any).guildMembership;
  const fleetoperators = op.guildId && fleetoperatorModel
    ? await fleetoperatorModel.findMany({
        where: { guildId: op.guildId, role: "fleetoperator", user: { active: true } },
        select: { userId: true, user: { select: { id: true, username: true } } },
        orderBy: { userId: "asc" },
      }) as Array<{ userId: string; user: { username: string } }>
    : [];
  for (const member of fleetoperators) {
    const existing = byId.get(member.userId);
    byId.set(member.userId, {
      userId: member.userId,
      username: existing?.username ?? member.user.username,
      kind: existing?.kind ?? "participant",
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
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: { guildId: true },
  });
  if (await isGuildFleetoperator(op?.guildId, userId)) return true;

  const squadleader = await prisma.fleetUnit.findFirst({
    where: { operationId, captainId: userId, status: "accepted" },
    select: { id: true },
  });
  if (squadleader) return true;

  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { id: true },
  });
  if (leader) return true;

  const participant = await (prisma as any).missionVoiceParticipant.findFirst({
    where: { operationId, userId },
    select: { id: true },
  });
  return Boolean(participant);
}

export async function hasMissionRelayVoice(operationId: string, userId: string): Promise<boolean> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: { guildId: true },
  });
  if (await isGuildFleetoperator(op?.guildId, userId)) return true;

  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { id: true },
  });
  if (leader) return true;

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
