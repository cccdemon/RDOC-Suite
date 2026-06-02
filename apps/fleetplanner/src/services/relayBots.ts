import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { decryptSecret } from "./secrets.js";

type RelayBotConfig = {
  name: string;
  token: string;
  channelId: string;
};

function basicAuth(secret: string | undefined): string | undefined {
  if (!secret) return undefined;
  return `Basic ${Buffer.from(`admin:${secret}`).toString("base64")}`;
}

function requireRelayEnv(): {
  adminUrl: string;
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  roomName: string;
  adminSecret?: string;
} {
  const env = getEnv();
  const adminUrl = env.RELAY_BOTS_ADMIN_URL || "http://relay-bots:8788";
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) {
    throw new Error("LiveKit relay env is not configured for Fleetplanner");
  }
  return {
    adminUrl: adminUrl.replace(/\/$/, ""),
    livekitUrl: env.LIVEKIT_URL,
    livekitApiKey: env.LIVEKIT_API_KEY,
    livekitApiSecret: env.LIVEKIT_API_SECRET,
    roomName: env.RELAY_LIVEKIT_ROOM,
    adminSecret: env.RELAY_BOTS_ADMIN_SECRET,
  };
}

async function postRelayConfig(input: {
  guildId: string;
  relayRoomName: string;
  bots: RelayBotConfig[];
}): Promise<{ bots: number }> {
  const env = requireRelayEnv();
  const headers: Record<string, string> = { "content-type": "application/json" };
  const auth = basicAuth(env.adminSecret);
  if (auth) headers.authorization = auth;

  const res = await fetch(`${env.adminUrl}/api/config`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      livekit: {
        url: env.livekitUrl,
        apiKey: env.livekitApiKey,
        apiSecret: env.livekitApiSecret,
        relayRoomName: input.relayRoomName,
      },
      discord: { guildId: input.guildId, bots: input.bots },
    }),
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Relay bots sync failed (${res.status}): ${err}`);
  }

  return { bots: input.bots.length };
}

function rowToRelayBot(row: {
  channelId: string;
  voiceBot: {
    label: string;
    tokenCiphertext: string;
    tokenIv: string;
    tokenSalt: string;
    tokenTag: string;
  } | null;
}): RelayBotConfig[] {
  if (!row.voiceBot) return [];
  return [{
    name: row.voiceBot.label,
    channelId: row.channelId,
    token: decryptSecret({
      ciphertext: row.voiceBot.tokenCiphertext,
      iv: row.voiceBot.tokenIv,
      salt: row.voiceBot.tokenSalt,
      tag: row.voiceBot.tokenTag,
    }),
  }];
}

export async function syncOperationRelayBots(operationId: string): Promise<{ bots: number }> {
  const env = requireRelayEnv();
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: { guildId: true, globalVoiceRoom: true },
  });
  if (!op) throw new Error("Operation not found");

  const rows = await prisma.fleetVoiceChannel.findMany({
    where: { operationId },
    include: { voiceBot: true },
    orderBy: { createdAt: "asc" },
  });
  const bots = rows.flatMap(rowToRelayBot);

  return postRelayConfig({
    guildId: op.guildId,
    relayRoomName: op.globalVoiceRoom || env.roomName,
    bots,
  });
}

export async function syncFleetplannerRelayBots(guildId: string): Promise<{ bots: number }> {
  const env = requireRelayEnv();
  const activeRelayOp = await prisma.operation.findFirst({
    where: {
      guildId,
      globalVoiceRoom: { not: null },
      status: { in: ["open", "locked", "in_progress"] },
      voiceChannels: { some: { voiceBotId: { not: null } } },
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
  });
  if (activeRelayOp) return syncOperationRelayBots(activeRelayOp.id);

  return postRelayConfig({
    guildId,
    relayRoomName: env.roomName,
    bots: [],
  });
}
