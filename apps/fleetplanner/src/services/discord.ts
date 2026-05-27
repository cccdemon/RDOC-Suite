import { getEnv } from "../config/env.js";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordEventResult = { id: string } | null;

export async function createScheduledEvent(op: {
  id: string;
  title: string;
  description: string;
  scheduledAt: Date;
}): Promise<DiscordEventResult> {
  const env = getEnv();
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) return null;

  // Discord requires events to be at least 1h long; use 3h as default
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const isVoice = !!env.DISCORD_EVENT_CHANNEL_ID;

  const body = isVoice
    ? {
        name: op.title,
        description: op.description || undefined,
        privacy_level: 2,
        scheduled_start_time: startTime,
        entity_type: 2, // VOICE
        channel_id: env.DISCORD_EVENT_CHANNEL_ID,
      }
    : {
        name: op.title,
        description: op.description || undefined,
        privacy_level: 2,
        scheduled_start_time: startTime,
        scheduled_end_time: endTime,
        entity_type: 3, // EXTERNAL
        entity_metadata: {
          location: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`,
        },
      };

  const res = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/scheduled-events`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${env.DISCORD_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord event creation failed (${res.status}): ${err}`);
  }

  const data = await res.json() as { id: string };
  return data;
}

export async function deleteScheduledEvent(eventId: string): Promise<void> {
  const env = getEnv();
  if (!env.DISCORD_GUILD_ID || !env.DISCORD_BOT_TOKEN) return;

  await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/scheduled-events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${env.DISCORD_BOT_TOKEN}` },
    signal: AbortSignal.timeout(8000),
  });
}
