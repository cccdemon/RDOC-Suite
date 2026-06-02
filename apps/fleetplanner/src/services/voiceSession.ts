import { randomUUID } from "node:crypto";
import { RoomServiceClient } from "livekit-server-sdk";
import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { discordUserIdForFleetplannerUser } from "./discord.js";
import { missionVoiceAccessUsers } from "./missionCommanders.js";
import { syncFleetplannerRelayBots } from "./relayBots.js";
import { cleanupOperationVoiceChannels, launchOperationVoiceChannels } from "./voiceBots.js";

type Logger = { info: (msg: string) => void; error: (e: unknown, msg: string) => void };

// ── Permission check ────────────────────────────────────────────────

export async function hasVoicePermission(guildId: string): Promise<boolean> {
  const env = getEnv();
  if (env.RAUMDOCK_GUILD_ID && guildId === env.RAUMDOCK_GUILD_ID) return true;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guild = await (prisma.guild.findUnique as any)({
    where: { id: guildId },
    select: { voiceEnabled: true },
  }) as { voiceEnabled: boolean } | null;
  return guild?.voiceEnabled ?? false;
}

// ── LiveKit helpers ─────────────────────────────────────────────────

function roomServiceClient(): RoomServiceClient | null {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;
  const host = env.LIVEKIT_URL.replace(/^wss?:\/\//, "https://").replace(/^https?:\/\//, "https://");
  return new RoomServiceClient(host, env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET);
}

async function deleteLivekitRoom(name: string): Promise<void> {
  const client = roomServiceClient();
  if (!client) return;
  try {
    await client.deleteRoom(name);
  } catch {
    // Room may not exist yet (no participants joined) — that's fine
  }
}

// ── Discord role helpers ────────────────────────────────────────────

async function grantDiscordRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const env = getEnv();
  const token = env.DISCORD_FLEETPLANNER_BOT_TOKEN;
  if (!token) {
    console.warn(`[voiceSession] cannot grant role ${roleId} to user ${userId}: DISCORD_FLEETPLANNER_BOT_TOKEN not set`);
    return false;
  }
  const discordId = await discordUserIdForFleetplannerUser(userId).catch(() => null);
  if (!discordId) {
    console.warn(`[voiceSession] cannot grant role ${roleId}: no Discord identity for fleetplanner user ${userId}`);
    return false;
  }
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      { method: "PUT", headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      console.warn(`[voiceSession] grant role ${roleId} to ${discordId} in guild ${guildId} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[voiceSession] grant role ${roleId} to ${discordId} in guild ${guildId} errored: ${String(e)}`);
    return false;
  }
}

async function revokeDiscordRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<boolean> {
  const env = getEnv();
  const token = env.DISCORD_FLEETPLANNER_BOT_TOKEN;
  if (!token) {
    console.warn(`[voiceSession] cannot revoke role ${roleId} from user ${userId}: DISCORD_FLEETPLANNER_BOT_TOKEN not set`);
    return false;
  }
  const discordId = await discordUserIdForFleetplannerUser(userId).catch(() => null);
  if (!discordId) {
    console.warn(`[voiceSession] cannot revoke role ${roleId}: no Discord identity for fleetplanner user ${userId}`);
    return false;
  }
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordId}/roles/${roleId}`,
      { method: "DELETE", headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) {
      console.warn(`[voiceSession] revoke role ${roleId} from ${discordId} in guild ${guildId} failed: HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (e) {
    console.warn(`[voiceSession] revoke role ${roleId} from ${discordId} in guild ${guildId} errored: ${String(e)}`);
    return false;
  }
}

// ── Core session management ─────────────────────────────────────────

type OpForVoice = {
  id: string;
  guildId: string;
  globalVoiceRoom: string | null;
  commanderVoiceRoom: string | null;
  guild: {
    globalVoiceRoleId: string | null;
    commanderVoiceRoleId: string | null;
  };
};

async function getOpForVoice(operationId: string): Promise<OpForVoice | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (prisma.operation.findUnique as any)({
    where: { id: operationId },
    select: {
      id: true,
      guildId: true,
      globalVoiceRoom: true,
      commanderVoiceRoom: true,
      guild: { select: { globalVoiceRoleId: true, commanderVoiceRoleId: true } },
    },
  }) as Promise<OpForVoice | null>;
}

export async function openMissionVoiceSession(operationId: string): Promise<void> {
  const op = await getOpForVoice(operationId);
  if (!op) return;

  // Idempotent: only create rooms once
  const globalRoom = op.globalVoiceRoom ?? `fg-${randomUUID()}`;
  const commanderRoom = op.commanderVoiceRoom ?? `fc-${randomUUID()}`;

  if (!op.globalVoiceRoom || !op.commanderVoiceRoom) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.operation.update as any)({
      where: { id: operationId },
      data: { globalVoiceRoom: globalRoom, commanderVoiceRoom: commanderRoom },
    });
  }

  // Grant Discord roles (non-fatal per user)
  const { commanderUserIds, globalVoiceUserIds } = await missionVoiceAccessUsers(operationId);

  let granted = 0;
  let grantFailed = 0;
  if (op.guild.globalVoiceRoleId) {
    for (const userId of globalVoiceUserIds) {
      if (await grantDiscordRole(op.guildId, userId, op.guild.globalVoiceRoleId)) granted++;
      else grantFailed++;
    }
  }
  if (op.guild.commanderVoiceRoleId) {
    for (const userId of commanderUserIds) {
      if (await grantDiscordRole(op.guildId, userId, op.guild.commanderVoiceRoleId)) granted++;
      else grantFailed++;
    }
  }
  if (grantFailed > 0) {
    console.warn(`[voiceSession] openMissionVoiceSession op ${operationId}: ${granted} role grant(s) ok, ${grantFailed} failed — Discord voice permissions may be incomplete`);
  }

  try {
    await launchOperationVoiceChannels(operationId);
  } catch (err) {
    console.warn(`[voiceSession] openMissionVoiceSession op ${operationId}: relay bot channel prep failed (non-fatal): ${String(err)}`);
  }
}

export async function setMissionGlobalVoiceRole(
  operationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const op = await getOpForVoice(operationId);
  if (!op?.globalVoiceRoom || !op.guild.globalVoiceRoleId) return;
  if (enabled) {
    await grantDiscordRole(op.guildId, userId, op.guild.globalVoiceRoleId);
  } else {
    await revokeDiscordRole(op.guildId, userId, op.guild.globalVoiceRoleId);
  }
}

export async function setMissionCommanderVoiceRole(
  operationId: string,
  userId: string,
  enabled: boolean,
): Promise<void> {
  const op = await getOpForVoice(operationId);
  if (!op?.commanderVoiceRoom || !op.guild.commanderVoiceRoleId) return;
  if (enabled) {
    await grantDiscordRole(op.guildId, userId, op.guild.commanderVoiceRoleId);
  } else {
    await revokeDiscordRole(op.guildId, userId, op.guild.commanderVoiceRoleId);
  }
}

export async function closeMissionVoiceSession(operationId: string): Promise<void> {
  const op = await getOpForVoice(operationId);
  if (!op) return;

  // Delete LiveKit rooms
  if (op.globalVoiceRoom) await deleteLivekitRoom(op.globalVoiceRoom);
  if (op.commanderVoiceRoom) await deleteLivekitRoom(op.commanderVoiceRoom);

  // Clear room names from DB
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.operation.update as any)({
    where: { id: operationId },
    data: { globalVoiceRoom: null, commanderVoiceRoom: null },
  });

  // Revoke Discord roles
  const { commanderUserIds, globalVoiceUserIds } = await missionVoiceAccessUsers(operationId);

  let revoked = 0;
  let revokeFailed = 0;
  if (op.guild.globalVoiceRoleId) {
    for (const userId of globalVoiceUserIds) {
      if (await revokeDiscordRole(op.guildId, userId, op.guild.globalVoiceRoleId)) revoked++;
      else revokeFailed++;
    }
  }
  if (op.guild.commanderVoiceRoleId) {
    for (const userId of commanderUserIds) {
      if (await revokeDiscordRole(op.guildId, userId, op.guild.commanderVoiceRoleId)) revoked++;
      else revokeFailed++;
    }
  }
  if (revokeFailed > 0) {
    console.warn(`[voiceSession] closeMissionVoiceSession op ${operationId}: ${revoked} role revoke(s) ok, ${revokeFailed} failed`);
  }

  try {
    await cleanupOperationVoiceChannels(operationId);
  } catch (err) {
    console.warn(`[voiceSession] closeMissionVoiceSession op ${operationId}: relay bot channel cleanup failed (non-fatal): ${String(err)}`);
  }
  await syncFleetplannerRelayBots(op.guildId).catch((err) =>
    console.warn(`[voiceSession] closeMissionVoiceSession op ${operationId}: relay bot config sync failed (non-fatal): ${String(err)}`),
  );
}

// ── Stale session cleanup scheduler ────────────────────────────────

let cleanupRunning = false;

export async function cleanupStaleVoiceSessions(log: Logger): Promise<void> {
  if (cleanupRunning) return;
  cleanupRunning = true;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const stale = await (prisma.operation.findMany as any)({
      where: {
        status: { in: ["open", "locked", "in_progress"] },
        scheduledAt: { lt: cutoff },
        OR: [{ globalVoiceRoom: { not: null } }, { commanderVoiceRoom: { not: null } }],
      },
      select: { id: true },
    }) as Array<{ id: string }>;
    for (const op of stale) {
      try {
        await closeMissionVoiceSession(op.id);
        log.info(`[voiceSession] Cleaned up stale voice session for op ${op.id}`);
      } catch (e) {
        log.error(e, `[voiceSession] Cleanup failed for op ${op.id}`);
      }
    }
  } finally {
    cleanupRunning = false;
  }
}

export function startVoiceSessionScheduler(log: Logger): void {
  setTimeout(() => {
    void cleanupStaleVoiceSessions(log);
    setInterval(() => void cleanupStaleVoiceSessions(log), 5 * 60 * 1000); // every 5 min
  }, 15000);
}
