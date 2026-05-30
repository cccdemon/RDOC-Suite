import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordEventResult = { id: string } | null;

function fleetplannerBotToken(): string | undefined {
  const env = getEnv();
  return env.DISCORD_FLEETPLANNER_BOT_TOKEN || env.DISCORD_BOT_TOKEN;
}

// ── Bot REST helpers (multi-tenant) ────────────────────────────────

/** Fetch a guild's basic info via the bot token. Bot must be a member. */
export async function fetchGuildBasic(
  guildId: string,
): Promise<{ id: string; name: string; icon: string | null } | null> {
  const token = fleetplannerBotToken();
  if (!token) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ id: string; name: string; icon: string | null }>;
}

/** Fetch a member's Discord role ids in a guild (for role→fleet-role mapping). */
export async function fetchGuildMemberRoles(guildId: string, userId: string): Promise<string[] | null> {
  const token = fleetplannerBotToken();
  if (!token) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const member = (await res.json()) as { roles?: string[] };
  return Array.isArray(member.roles) ? member.roles : [];
}

// ── Scheduled events (posted to the operation's own guild) ─────────

export async function createScheduledEvent(op: {
  id: string;
  guildId: string;
  title: string;
  description: string;
  scheduledAt: Date;
}): Promise<DiscordEventResult> {
  const env = getEnv();
  const token = fleetplannerBotToken();
  if (!token) return null;

  // Per-guild event channel (optional). Falls back to an EXTERNAL event.
  const guild = await prisma.guild.findUnique({
    where: { id: op.guildId },
    select: { eventChannelId: true },
  });
  const eventChannelId = guild?.eventChannelId ?? null;

  // Discord requires events to be at least 1h long; use 3h as default
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();

  const body = eventChannelId
    ? {
        name: op.title,
        description: op.description || undefined,
        privacy_level: 2,
        scheduled_start_time: startTime,
        entity_type: 2, // VOICE
        channel_id: eventChannelId,
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

  const res = await fetch(`${DISCORD_API}/guilds/${op.guildId}/scheduled-events`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
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

export async function deleteScheduledEvent(guildId: string, eventId: string): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) return;

  await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
}

export type CaptainDiscordRole = "commander" | "admiral";

export async function assignCaptainDiscordRole(userId: string, role: CaptainDiscordRole): Promise<void> {
  const env = getEnv();
  const token = fleetplannerBotToken();
  if (!env.DISCORD_GUILD_ID || !token) {
    throw new Error("Discord Fleetplanner Bot integration is not configured");
  }

  const roleId = role === "commander" ? env.DISCORD_COMMANDER_ROLE_ID : env.DISCORD_ADMIRAL_ROLE_ID;
  if (!roleId) {
    throw new Error(`Discord ${role} role id is not configured`);
  }

  const res = await fetch(`${DISCORD_API}/guilds/${env.DISCORD_GUILD_ID}/members/${userId}/roles/${roleId}`, {
    method: "PUT",
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord role assignment failed (${res.status}): ${err}`);
  }
}

export async function sendDiscordChannelMessage(channelId: string, content: string): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) throw new Error("Discord Fleetplanner Bot integration is not configured");
  if (!channelId.trim()) throw new Error("Feedback channel is not configured");

  const res = await fetch(`${DISCORD_API}/channels/${encodeURIComponent(channelId.trim())}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord feedback send failed (${res.status}): ${err}`);
  }
}

export async function sendDiscordDm(userId: string, content: string): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) throw new Error("Discord Fleetplanner Bot integration is not configured");

  const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: userId }),
    signal: AbortSignal.timeout(8000),
  });

  if (!channelRes.ok) {
    const err = await channelRes.text().catch(() => channelRes.statusText);
    throw new Error(`Discord DM channel creation failed (${channelRes.status}): ${err}`);
  }

  const channel = await channelRes.json() as { id: string };
  const messageRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: content.slice(0, 1900), allowed_mentions: { parse: [] } }),
    signal: AbortSignal.timeout(8000),
  });

  if (!messageRes.ok) {
    const err = await messageRes.text().catch(() => messageRes.statusText);
    throw new Error(`Discord DM send failed (${messageRes.status}): ${err}`);
  }
}

export async function sendAcceptedCaptainVoiceDm(
  userId: string,
  input: { operationTitle: string; unitName: string; operationUrl: string },
): Promise<void> {
  const env = getEnv();
  const lines = [
    "Hello Captain,",
    `your unit "${input.unitName}" was accepted for "${input.operationTitle}".`,
    "You now have captain voice rights for this event.",
    "",
    `Operation: ${input.operationUrl}`,
  ];
  if (env.FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL) {
    lines.push(`Download voice client: ${env.FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL}`);
  }
  if (env.FLEETPLANNER_VOICE_CLIENT_CONFIG_URL) {
    lines.push(`Voice client config: ${env.FLEETPLANNER_VOICE_CLIENT_CONFIG_URL}`);
  }
  if (!env.FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL && !env.FLEETPLANNER_VOICE_CLIENT_CONFIG_URL) {
    lines.push("Voice client links are not configured yet. Ask your fleet lead for the current setup.");
  }

  await sendDiscordDm(userId, lines.join("\n"));
}

export async function sendSeatAssignmentDm(
  userId: string,
  input: {
    operationTitle: string;
    operationUrl: string;
    unitName: string;
    captainName: string;
    seatLabel: string;
  },
): Promise<void> {
  await sendDiscordDm(userId, [
    "Soldier,",
    `for "${input.operationTitle}" you were assigned to:`,
    `Ship / Unit: ${input.unitName}`,
    `Captain: ${input.captainName}`,
    `Seat: ${input.seatLabel}`,
    "",
    `Operation: ${input.operationUrl}`,
  ].join("\n"));
}
