import { prisma } from "../db.js";
import {
  createGuildVoiceChannel,
  deleteDiscordChannel,
  discordUserIdForFleetplannerUser,
  moveGuildMemberToVoice,
  updateDiscordChannelName,
} from "./discord.js";
import { bridgeConfigured, getBridgeVoiceStates } from "./bridge.js";
import { syncFleetplannerRelayBots, syncOperationRelayBots } from "./relayBots.js";
import { decryptSecret, encryptSecret } from "./secrets.js";

const SNOWFLAKE = /^\d{16,25}$/;
const VIEW_CHANNEL = 1n << 10n;
const CONNECT = 1n << 20n;
const VOICE_ACCESS = (VIEW_CHANNEL | CONNECT).toString();

function cleanLabel(raw: string): string {
  const label = raw.trim().slice(0, 60);
  if (!label) throw new Error("Bot label is required");
  return label;
}

function cleanSnowflake(raw: string, field: string): string {
  const value = raw.trim();
  if (!SNOWFLAKE.test(value)) throw new Error(`${field} must be a Discord snowflake ID`);
  return value;
}

function cleanChannelName(raw: string): string {
  const name = raw.trim().slice(0, 100);
  if (!name) throw new Error("Channel name is required");
  return name;
}

function decryptVoiceBotToken(bot: {
  tokenCiphertext: string;
  tokenIv: string;
  tokenSalt: string;
  tokenTag: string;
}): string {
  return decryptSecret({
    ciphertext: bot.tokenCiphertext,
    iv: bot.tokenIv,
    salt: bot.tokenSalt,
    tag: bot.tokenTag,
  });
}

export async function addGuildVoiceBot(input: {
  guildId: string;
  label: string;
  botUserId: string;
  token: string;
}) {
  const label = cleanLabel(input.label);
  const botUserId = cleanSnowflake(input.botUserId, "Bot user ID");
  const token = input.token.trim();
  if (token.length < 30) throw new Error("Bot token looks too short");

  const existing = await prisma.guildVoiceBot.findUnique({
    where: { guildId_botUserId: { guildId: input.guildId, botUserId } },
    select: { id: true },
  });
  if (!existing) {
    const count = await prisma.guildVoiceBot.count({ where: { guildId: input.guildId } });
    if (count >= 6) throw new Error("A maximum of six voice relay bots can be configured");
  }

  const encrypted = encryptSecret(token);
  return prisma.guildVoiceBot.upsert({
    where: { guildId_botUserId: { guildId: input.guildId, botUserId } },
    create: {
      guildId: input.guildId,
      label,
      botUserId,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenSalt: encrypted.salt,
      tokenTag: encrypted.tag,
    },
    update: {
      label,
      tokenCiphertext: encrypted.ciphertext,
      tokenIv: encrypted.iv,
      tokenSalt: encrypted.salt,
      tokenTag: encrypted.tag,
    },
  });
}

export async function updateGuildVoiceBot(
  guildId: string,
  id: string,
  input: { label?: string; token?: string },
): Promise<void> {
  const bot = await prisma.guildVoiceBot.findFirst({ where: { guildId, id } });
  if (!bot) throw new Error("Voice bot not found");

  const data: Record<string, unknown> = {};
  if (input.label?.trim()) data.label = cleanLabel(input.label);
  if (input.token?.trim()) {
    const token = input.token.trim();
    if (token.length < 30) throw new Error("Bot token looks too short");
    const encrypted = encryptSecret(token);
    data.tokenCiphertext = encrypted.ciphertext;
    data.tokenIv = encrypted.iv;
    data.tokenSalt = encrypted.salt;
    data.tokenTag = encrypted.tag;
  }
  if (Object.keys(data).length === 0) return;
  await prisma.guildVoiceBot.update({ where: { id }, data });
}

export async function deleteGuildVoiceBot(guildId: string, id: string): Promise<void> {
  await prisma.guildVoiceBot.deleteMany({ where: { guildId, id } });
}

export async function decryptGuildVoiceBotToken(id: string): Promise<string | null> {
  const bot = await prisma.guildVoiceBot.findUnique({ where: { id } });
  if (!bot) return null;
  return decryptSecret({
    ciphertext: bot.tokenCiphertext,
    iv: bot.tokenIv,
    salt: bot.tokenSalt,
    tag: bot.tokenTag,
  });
}

export async function launchOperationVoiceChannels(operationId: string): Promise<{
  created: number;
  existing: number;
  botsAssigned: number;
  skippedDiscordUsers: number;
}> {
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    include: {
      guild: true,
      voiceChannels: true,
      units: {
        where: { status: "accepted" },
        include: {
          ship: true,
          captain: true,
          seats: { where: { active: true }, include: { user: true }, orderBy: { order: "asc" } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!op) throw new Error("Operation not found");
  if (op.units.length === 0) throw new Error("No accepted units to create channels for");

  const existingUnitIds = new Set(op.voiceChannels.map((channel) => channel.unitId));
  const unitsToCreate = op.units.filter((unit) => !existingUnitIds.has(unit.id));
  if (unitsToCreate.length === 0) {
    await syncOperationRelayBots(operationId);
    return {
      created: 0,
      existing: op.voiceChannels.length,
      botsAssigned: 0,
      skippedDiscordUsers: 0,
    };
  }

  const availableBots = await prisma.guildVoiceBot.findMany({
    where: { guildId: op.guildId, assignedChannelId: null },
    orderBy: { createdAt: "asc" },
  });
  if (availableBots.length < unitsToCreate.length) {
    throw new Error(
      `Not enough available voice bots (${availableBots.length}/${unitsToCreate.length})`,
    );
  }

  let botCursor = 0;
  let created = 0;
  let botsAssigned = 0;
  let skippedDiscordUsers = 0;

  for (const unit of unitsToCreate) {
    const userIds = new Set<string>([unit.captainId]);
    for (const seat of unit.seats) {
      if (seat.userId) userIds.add(seat.userId);
    }

    const bot = availableBots[botCursor++];
    const botToken = decryptVoiceBotToken(bot);
    const channelName =
      unit.unitType === "ship" ? (unit.ship?.name ?? "Unknown Ship") : (unit.squadName ?? "Squad");
    const permissionOverwrites: Array<{ id: string; type: 0 | 1; allow?: string; deny?: string }> =
      [
        {
          id: op.guildId,
          type: 0,
          deny: VOICE_ACCESS,
        },
      ];
    permissionOverwrites.push({ id: bot.botUserId, type: 1, allow: VOICE_ACCESS });
    for (const userId of userIds) {
      try {
        permissionOverwrites.push({
          id: await discordUserIdForFleetplannerUser(userId),
          type: 1,
          allow: VOICE_ACCESS,
        });
      } catch {
        skippedDiscordUsers += 1;
      }
    }

    const channel = await createGuildVoiceChannel({
      guildId: op.guildId,
      name: channelName,
      parentId: op.guild.voiceChannelCategoryId,
      permissionOverwrites,
      botToken,
    });

    await prisma.guildVoiceBot.update({
      where: { id: bot.id },
      data: { assignedChannelId: channel.id },
    });
    botsAssigned += 1;

    await prisma.fleetVoiceChannel.create({
      data: {
        operationId: op.id,
        unitId: unit.id,
        guildId: op.guildId,
        channelId: channel.id,
        channelName,
        voiceBotId: bot?.id,
      },
    });
    created += 1;
  }

  await syncOperationRelayBots(operationId);

  return {
    created,
    existing: op.voiceChannels.length,
    botsAssigned,
    skippedDiscordUsers,
  };
}

export async function renameOperationVoiceChannel(input: {
  operationId: string;
  voiceChannelId: string;
  name: string;
}): Promise<void> {
  const name = cleanChannelName(input.name);
  const channel = await prisma.fleetVoiceChannel.findFirst({
    where: { id: input.voiceChannelId, operationId: input.operationId },
    include: { voiceBot: true },
  });
  if (!channel) throw new Error("Voice channel not found");
  if (!channel.voiceBot) throw new Error("Voice channel has no assigned bot");

  await updateDiscordChannelName({
    channelId: channel.channelId,
    name,
    botToken: decryptVoiceBotToken(channel.voiceBot),
  });
  await prisma.fleetVoiceChannel.update({
    where: { id: channel.id },
    data: { channelName: name },
  });
  await syncOperationRelayBots(input.operationId);
}

export async function deleteOperationVoiceChannel(input: {
  operationId: string;
  voiceChannelId: string;
}): Promise<void> {
  const channel = await prisma.fleetVoiceChannel.findFirst({
    where: { id: input.voiceChannelId, operationId: input.operationId },
    include: { voiceBot: true },
  });
  if (!channel) throw new Error("Voice channel not found");
  if (!channel.voiceBot) throw new Error("Voice channel has no assigned bot");

  await deleteDiscordChannel({
    channelId: channel.channelId,
    botToken: decryptVoiceBotToken(channel.voiceBot),
  });
  await prisma.$transaction([
    prisma.fleetVoiceChannel.delete({ where: { id: channel.id } }),
    prisma.guildVoiceBot.update({
      where: { id: channel.voiceBot.id },
      data: { assignedChannelId: null },
    }),
  ]);
  await syncOperationRelayBots(input.operationId);
}

export async function cleanupOperationVoiceChannels(operationId: string): Promise<{
  deleted: number;
  disconnected: number;
  skippedDiscordUsers: number;
  skippedOccupied: number;
  skippedUnknown: number;
}> {
  const channels = await prisma.fleetVoiceChannel.findMany({
    where: { operationId },
    include: {
      voiceBot: true,
      unit: {
        include: {
          seats: { where: { userId: { not: null } }, orderBy: { order: "asc" } },
        },
      },
    },
  });

  let deleted = 0;
  let disconnected = 0;
  let skippedDiscordUsers = 0;
  let skippedOccupied = 0;
  let skippedUnknown = 0;

  const guildId = channels[0]?.guildId;
  let occupiedChannelIds: Set<string> | null = null;
  if (guildId && bridgeConfigured()) {
    try {
      const voice = await getBridgeVoiceStates(guildId);
      if (!voice.offline) {
        occupiedChannelIds = new Set(
          voice.voiceStates
            .filter((state) => Boolean(state.channelId))
            .map((state) => state.channelId!),
        );
      }
    } catch {
      occupiedChannelIds = null;
    }
  }

  for (const channel of channels) {
    if (!channel.voiceBot) {
      throw new Error(`Voice channel ${channel.channelId} has no assigned bot`);
    }
    const botToken = decryptVoiceBotToken(channel.voiceBot);

    if (!occupiedChannelIds) {
      skippedUnknown += 1;
      continue;
    }

    if (occupiedChannelIds.has(channel.channelId)) {
      skippedOccupied += 1;
      continue;
    }

    await deleteDiscordChannel({
      channelId: channel.channelId,
      botToken,
    });

    await prisma.$transaction([
      prisma.fleetVoiceChannel.delete({ where: { id: channel.id } }),
      prisma.guildVoiceBot.update({
        where: { id: channel.voiceBot.id },
        data: { assignedChannelId: null },
      }),
    ]);
    deleted += 1;
  }

  if (channels[0]) {
    await syncFleetplannerRelayBots(channels[0].guildId);
  }

  return { deleted, disconnected, skippedDiscordUsers, skippedOccupied, skippedUnknown };
}

export async function moveOperationCrewToVoiceChannels(operationId: string): Promise<{
  moved: number;
  notConnected: number;
  skippedDiscordUsers: number;
  channels: number;
}> {
  // createdAt asc → the first unit a user belongs to is their PRIMARY unit.
  // Matches userMissionVoiceChannels + launchOperationVoiceChannels ordering.
  const channels = await prisma.fleetVoiceChannel.findMany({
    where: { operationId },
    include: {
      voiceBot: true,
      unit: {
        include: {
          seats: { where: { userId: { not: null }, active: true }, orderBy: { order: "asc" } },
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  // A user can be captain/seat in multiple units (e.g. ship captain + FPS squad
  // member). Discord allows only one voice channel, so move each user EXACTLY
  // once, into their primary (first) unit's channel — deterministic, no
  // "last move wins" race.
  type Ch = (typeof channels)[number];
  const primaryChannelByUser = new Map<string, Ch>();
  for (const channel of channels) {
    if (!channel.voiceBot) {
      throw new Error(`Voice channel ${channel.channelId} has no assigned bot`);
    }
    const userIds = new Set<string>([channel.unit.captainId]);
    for (const seat of channel.unit.seats) {
      if (seat.userId) userIds.add(seat.userId);
    }
    for (const userId of userIds) {
      if (!primaryChannelByUser.has(userId)) primaryChannelByUser.set(userId, channel);
    }
  }

  let moved = 0;
  let notConnected = 0;
  let skippedDiscordUsers = 0;

  for (const [userId, channel] of primaryChannelByUser) {
    if (!channel.voiceBot) continue;
    const botToken = decryptVoiceBotToken(channel.voiceBot);
    try {
      const didMove = await moveGuildMemberToVoice({
        guildId: channel.guildId,
        userId: await discordUserIdForFleetplannerUser(userId),
        channelId: channel.channelId,
        botToken,
      });
      if (didMove) moved += 1;
      else notConnected += 1;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("has no linked Discord identity")) {
        skippedDiscordUsers += 1;
        continue;
      }
      throw err;
    }
  }

  return { moved, notConnected, skippedDiscordUsers, channels: channels.length };
}
