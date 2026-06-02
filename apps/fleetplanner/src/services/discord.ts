import { readFileSync } from "node:fs";
import sharp from "sharp";
import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";

const DISCORD_API = "https://discord.com/api/v10";

export type DiscordEventResult = { id: string } | null;

const OP_IMAGE_TYPES = new Set([
  "combat", "pve", "mining", "salvage", "training",
  "mixed", "exploration", "transport", "social",
]);

// Resized images are cached in memory — 9 types, load once per process lifetime.
const imageCache = new Map<string, string>();

async function opTypeImageDataUri(opType: string | null | undefined): Promise<string | undefined> {
  const type = opType?.toLowerCase() ?? "combat";
  const safe = OP_IMAGE_TYPES.has(type) ? type : "combat";
  const cached = imageCache.get(safe);
  if (cached) return cached;
  try {
    const file = new URL(`../../public/mission-images/${safe}.png`, import.meta.url);
    const raw = readFileSync(file);
    // Resize to 1280×720 and re-encode as JPEG — keeps payload well under Discord's limit.
    const resized = await sharp(raw).resize(1280, 720, { fit: "cover" }).jpeg({ quality: 80 }).toBuffer();
    const uri = `data:image/jpeg;base64,${resized.toString("base64")}`;
    imageCache.set(safe, uri);
    return uri;
  } catch (err) {
    console.warn(`[discord] opTypeImageDataUri: failed to process ${safe}.png —`, err instanceof Error ? err.message : err);
    return undefined;
  }
}

function fleetplannerBotToken(): string | undefined {
  const env = getEnv();
  return env.DISCORD_FLEETPLANNER_BOT_TOKEN;
}

export function discordInviteUrl(input: {
  clientId: string;
  permissions: string;
  guildId?: string;
  applicationsCommands?: boolean;
}): string {
  const params = new URLSearchParams({
    client_id: input.clientId,
    scope: input.applicationsCommands === false ? "bot" : "bot applications.commands",
    permissions: input.permissions,
  });
  if (input.guildId) {
    params.set("guild_id", input.guildId);
    params.set("disable_guild_select", "true");
  }
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function discordUserIdForFleetplannerUser(userId: string): Promise<string> {
  const identity = await prisma.userIdentity.findFirst({
    where: { userId, provider: "discord" },
    select: { providerId: true },
  });
  if (identity?.providerId) return identity.providerId;

  // Legacy installs used the Discord snowflake directly as User.id.
  if (/^\d{16,25}$/.test(userId)) return userId;
  throw new Error("User has no linked Discord identity");
}

async function discordRecipientIdForUser(userId: string): Promise<string> {
  return discordUserIdForFleetplannerUser(userId);
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

export async function fetchGuildMemberByBot(
  guildId: string,
  userId: string,
): Promise<{ user?: { id?: string; username?: string; bot?: boolean }; roles?: string[] } | null> {
  const token = fleetplannerBotToken();
  if (!token) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/members/${userId}`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json() as Promise<{ user?: { id?: string; username?: string; bot?: boolean }; roles?: string[] }>;
}

export async function fetchGuildRolesByBot(guildId: string): Promise<Array<{ id: string; name: string; permissions: string }> | null> {
  const token = fleetplannerBotToken();
  if (!token) return null;
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/roles`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  return res.json() as Promise<Array<{ id: string; name: string; permissions: string }>>;
}

export async function fetchGuildVoiceChannels(
  guildId: string,
): Promise<Array<{ id: string; name: string }>> {
  const token = fleetplannerBotToken();
  if (!token) return [];
  const res = await fetch(`${DISCORD_API}/guilds/${guildId}/channels`, {
    headers: { Authorization: `Bot ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const channels = await res.json() as Array<{ id: string; name: string; type: number }>;
  return channels
    .filter((c) => c.type === 2) // GUILD_VOICE
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => ({ id: c.id, name: c.name }));
}

export async function fetchBotIdentity(token: string): Promise<{ id: string; username: string } | null> {
  const clean = token.trim();
  if (!clean) return null;
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bot ${clean}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return null;
  const body = await res.json() as { id?: string; username?: string };
  return body.id && body.username ? { id: body.id, username: body.username } : null;
}

type PermissionOverwrite = {
  id: string;
  type: 0 | 1;
  allow?: string;
  deny?: string;
};

export async function createGuildVoiceChannel(input: {
  guildId: string;
  name: string;
  parentId?: string | null;
  permissionOverwrites?: PermissionOverwrite[];
  botToken?: string;
}): Promise<{ id: string }> {
  const token = input.botToken ?? fleetplannerBotToken();
  if (!token) throw new Error("Discord bot token is not configured");

  const body = {
    name: input.name.slice(0, 100),
    type: 2,
    parent_id: input.parentId || undefined,
    permission_overwrites: input.permissionOverwrites ?? undefined,
  };

  const res = await fetch(`${DISCORD_API}/guilds/${input.guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord voice channel creation failed (${res.status}): ${err}`);
  }

  return res.json() as Promise<{ id: string }>;
}

export async function updateDiscordChannelName(input: {
  channelId: string;
  name: string;
  botToken: string;
}): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${input.channelId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${input.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ name: input.name.slice(0, 100) }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord voice channel rename failed (${res.status}): ${err}`);
  }
}

export async function deleteDiscordChannel(input: {
  channelId: string;
  botToken: string;
}): Promise<void> {
  const res = await fetch(`${DISCORD_API}/channels/${input.channelId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${input.botToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord voice channel deletion failed (${res.status}): ${err}`);
  }
}

export async function disconnectGuildMemberFromVoice(input: {
  guildId: string;
  userId: string;
  botToken: string;
}): Promise<void> {
  const res = await fetch(`${DISCORD_API}/guilds/${input.guildId}/members/${input.userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${input.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel_id: null }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok && res.status !== 404) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord voice disconnect failed (${res.status}): ${err}`);
  }
}

export async function moveGuildMemberToVoice(input: {
  guildId: string;
  userId: string;
  channelId: string;
  botToken: string;
}): Promise<boolean> {
  const res = await fetch(`${DISCORD_API}/guilds/${input.guildId}/members/${input.userId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${input.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel_id: input.channelId }),
    signal: AbortSignal.timeout(10000),
  });
  if (res.ok) return true;
  if (res.status === 400 || res.status === 404) return false;
  const err = await res.text().catch(() => res.statusText);
  throw new Error(`Discord voice move failed (${res.status}): ${err}`);
}

// ── Scheduled events (posted to the operation's own guild) ─────────

export async function createScheduledEvent(op: {
  id: string;
  guildId: string;
  title: string;
  description: string;
  scheduledAt: Date;
  eventVoiceChannelId?: string | null;
  opType?: string | null;
}): Promise<DiscordEventResult> {
  const env = getEnv();
  const token = fleetplannerBotToken();
  if (!token) return null;

  const voiceChannelId = op.eventVoiceChannelId ?? null;

  // Discord requires events to be at least 1h long; use 3h as default
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const image = await opTypeImageDataUri(op.opType);

  const body = voiceChannelId
    ? {
        name: op.title,
        description: op.description || undefined,
        privacy_level: 2,
        scheduled_start_time: startTime,
        entity_type: 2, // VOICE
        channel_id: voiceChannelId,
        ...(image ? { image } : {}),
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
        ...(image ? { image } : {}),
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
    throw new Error(
      `Discord event creation failed for guild ${op.guildId} (${res.status}): ${err}`,
    );
  }

  const data = await res.json() as { id: string };

  // Prepend the Fleetplanner event link to the description.
  const eventUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`;
  const updatedDescription = op.description
    ? `### Fleetplanner Link\n${eventUrl}\n### Missionsbeschreibung\n${op.description}`
    : `### Fleetplanner Link\n${eventUrl}`;
  await fetch(`${DISCORD_API}/guilds/${op.guildId}/scheduled-events/${data.id}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ description: updatedDescription.slice(0, 1000) }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => { /* non-fatal — event already created */ });

  return data;
}

function getEventChannelId(op: { eventVoiceChannelId?: string | null }): string | null {
  return op.eventVoiceChannelId ?? null;
}

function buildEventDescription(opId: string, description?: string) {
  const eventUrl = `${getEnv().WEB_PUBLIC_URL}${getEnv().PUBLIC_BASE_PATH}/ops/${opId}`;
  return description
    ? `### Fleetplanner Link\n${eventUrl}\n### Missionsbeschreibung\n${description}`
    : `### Fleetplanner Link\n${eventUrl}`;
}

export async function updateScheduledEvent(op: {
  id: string;
  guildId: string;
  title: string;
  description: string;
  scheduledAt: Date;
  eventVoiceChannelId?: string | null;
  discordEventId: string;
  opType?: string | null;
}): Promise<void> {
  const env = getEnv();
  const token = fleetplannerBotToken();
  if (!token) return;

  const voiceChannelId = await getEventChannelId(op);
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();
  const updatedDescription = buildEventDescription(op.id, op.description).slice(0, 1000);
  const image = await opTypeImageDataUri(op.opType);

  const body = voiceChannelId
    ? {
        name: op.title,
        description: updatedDescription,
        privacy_level: 2,
        scheduled_start_time: startTime,
        entity_type: 2, // VOICE
        channel_id: voiceChannelId,
        ...(image ? { image } : {}),
      }
    : {
        name: op.title,
        description: updatedDescription,
        privacy_level: 2,
        scheduled_start_time: startTime,
        scheduled_end_time: endTime,
        entity_type: 3, // EXTERNAL
        entity_metadata: {
          location: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`,
        },
        ...(image ? { image } : {}),
      };

  const res = await fetch(
    `${DISCORD_API}/guilds/${op.guildId}/scheduled-events/${op.discordEventId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    },
  );

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord event update failed (${res.status}): ${err}`);
  }
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
  const discordUserId = await discordRecipientIdForUser(userId);

  const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: discordUserId }),
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
