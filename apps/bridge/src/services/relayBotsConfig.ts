import { getPrisma } from "@rdoc-suite/db";
import { getEnv } from "../config/env.js";

export type BotEntry = { name: string; token: string; channelId: string };

export type RelayBotsConfigData = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  roomName: string;
  guildId: string;
  bots: BotEntry[];
};

const SINGLETON_ID = "singleton";

export async function getRelayBotsConfig(): Promise<RelayBotsConfigData> {
  const row = await getPrisma().relayBotsConfig.findUnique({ where: { id: SINGLETON_ID } });
  const env = getEnv();
  if (!row) {
    return {
      livekitUrl: "",
      livekitApiKey: "",
      livekitApiSecret: "",
      roomName: env.RELAY_LIVEKIT_ROOM,
      guildId: env.RELAY_GUILD_ID ?? "",
      bots: [],
    };
  }
  return {
    livekitUrl: row.livekitUrl,
    livekitApiKey: row.livekitApiKey,
    livekitApiSecret: row.livekitApiSecret,
    roomName: row.roomName,
    guildId: row.guildId,
    bots: JSON.parse(row.botsJson) as BotEntry[],
  };
}

export async function setRelayBotsConfig(
  data: RelayBotsConfigData,
  updatedById: string,
): Promise<void> {
  await getPrisma().relayBotsConfig.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      livekitUrl: data.livekitUrl,
      livekitApiKey: data.livekitApiKey,
      livekitApiSecret: data.livekitApiSecret,
      roomName: data.roomName,
      guildId: data.guildId,
      botsJson: JSON.stringify(data.bots),
      updatedById,
    },
    update: {
      livekitUrl: data.livekitUrl,
      livekitApiKey: data.livekitApiKey,
      livekitApiSecret: data.livekitApiSecret,
      roomName: data.roomName,
      guildId: data.guildId,
      botsJson: JSON.stringify(data.bots),
      updatedById,
    },
  });
}

/** Effective LiveKit credentials: DB config takes priority over env. */
export async function getRelayLivekitCredentials(): Promise<{
  url: string;
  apiKey: string;
  apiSecret: string;
}> {
  const env = getEnv();
  const row = await getPrisma().relayBotsConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (row?.livekitApiKey) {
    return {
      url: row.livekitUrl || env.LIVEKIT_URL,
      apiKey: row.livekitApiKey,
      apiSecret: row.livekitApiSecret,
    };
  }
  return { url: env.LIVEKIT_URL, apiKey: env.LIVEKIT_API_KEY, apiSecret: env.LIVEKIT_API_SECRET };
}

/** Effective relay room name: DB config takes priority over env. */
export async function getRelayRoomName(): Promise<string> {
  const row = await getPrisma().relayBotsConfig.findUnique({ where: { id: SINGLETON_ID } });
  if (row?.roomName) return row.roomName;
  return getEnv().RELAY_LIVEKIT_ROOM;
}

/** Best-effort ping to the relay bots service to reload its config. */
export async function notifyRelayBotsReload(): Promise<void> {
  const env = getEnv();
  if (!env.RELAY_BOTS_ADMIN_URL) return;
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.RELAY_BOTS_ADMIN_SECRET) {
    const creds = Buffer.from(`admin:${env.RELAY_BOTS_ADMIN_SECRET}`).toString("base64");
    headers["authorization"] = `Basic ${creds}`;
  }
  try {
    await fetch(`${env.RELAY_BOTS_ADMIN_URL}/api/reload`, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // service not running or not reachable — ignore
  }
}
