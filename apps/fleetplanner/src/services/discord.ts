import { readFileSync } from "node:fs";
import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import sharp from "sharp";
import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { discordRecurrenceRule, type RecurrenceLike } from "./recurrence.js";

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

// Fetch a rendered mission-cover PNG and turn it into a Discord image data URI.
// Size-guarded; failures are non-fatal (falls back to the opType image).
async function coverImageDataUri(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > 8 * 1024 * 1024) return null;
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

/** Patch an existing scheduled event's cover image (after a cover is (re)generated). */
export async function updateScheduledEventImage(
  guildId: string,
  eventId: string,
  coverUrl: string,
): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) return;
  const image = await coverImageDataUri(coverUrl);
  if (!image) return;
  await fetch(`${DISCORD_API}/guilds/${guildId}/scheduled-events/${eventId}`, {
    method: "PATCH",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ image }),
    signal: AbortSignal.timeout(8000),
  }).catch(() => {});
}

export async function createScheduledEvent(op: {
  id: string;
  guildId: string;
  title: string;
  description: string;
  scheduledAt: Date;
  eventVoiceChannelId?: string | null;
  opType?: string | null;
  cover?: { url: string } | null;
  recurrence?: RecurrenceLike | null;
}): Promise<DiscordEventResult> {
  const env = getEnv();
  const token = fleetplannerBotToken();
  if (!token) return null;

  const voiceChannelId = op.eventVoiceChannelId ?? null;

  // Discord requires events to be at least 1h long; use 3h as default
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();
  // Prefer the rendered mission cover; fall back to the generic opType image.
  const image = (op.cover?.url ? await coverImageDataUri(op.cover.url) : null)
    ?? (await opTypeImageDataUri(op.opType));

  // FR-P3: a recurring series gets one native recurring Discord event.
  const recurrenceRule = op.recurrence
    ? discordRecurrenceRule(op.recurrence, startTime)
    : null;

  const body = voiceChannelId
    ? {
        name: op.title,
        description: op.description || undefined,
        privacy_level: 2,
        scheduled_start_time: startTime,
        entity_type: 2, // VOICE
        channel_id: voiceChannelId,
        ...(image ? { image } : {}),
        ...(recurrenceRule ? { recurrence_rule: recurrenceRule } : {}),
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
        ...(recurrenceRule ? { recurrence_rule: recurrenceRule } : {}),
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

// ── Partner event distribution (FR-P1) ─────────────────────────────
// A distributed event lives in a PARTNER guild but always points back to
// the HOST op page (entity_type EXTERNAL, location = host op URL — decision
// F1.3). Voice/relay is F2's concern and is never baked into this event.

type PartnerEventOp = {
  id: string;
  title: string;
  description: string;
  scheduledAt: Date;
  opType?: string | null;
  cover?: { url: string } | null;
};

function partnerEventBody(op: PartnerEventOp, image: string | undefined) {
  const env = getEnv();
  const startTime = op.scheduledAt.toISOString();
  const endTime = new Date(op.scheduledAt.getTime() + 3 * 60 * 60 * 1000).toISOString();
  return {
    name: op.title,
    description: buildEventDescription(op.id, op.description).slice(0, 1000),
    privacy_level: 2,
    scheduled_start_time: startTime,
    scheduled_end_time: endTime,
    entity_type: 3, // EXTERNAL
    entity_metadata: {
      location: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`,
    },
    ...(image ? { image } : {}),
  };
}

/** Create a scheduled event in a partner guild that links back to the host op. */
export async function createPartnerScheduledEvent(
  targetGuildId: string,
  op: PartnerEventOp,
): Promise<DiscordEventResult> {
  const token = fleetplannerBotToken();
  if (!token) return null;

  const image = (op.cover?.url ? await coverImageDataUri(op.cover.url) : null)
    ?? (await opTypeImageDataUri(op.opType));
  const body = partnerEventBody(op, image);

  const res = await fetch(`${DISCORD_API}/guilds/${targetGuildId}/scheduled-events`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(
      `Discord partner event creation failed for guild ${targetGuildId} (${res.status}): ${err}`,
    );
  }
  return (await res.json()) as { id: string };
}

/** Update an already-distributed partner event in place. */
export async function updatePartnerScheduledEvent(
  targetGuildId: string,
  eventId: string,
  op: PartnerEventOp,
): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) return;

  const image = await opTypeImageDataUri(op.opType);
  const body = partnerEventBody(op, image);

  const res = await fetch(
    `${DISCORD_API}/guilds/${targetGuildId}/scheduled-events/${eventId}`,
    {
      method: "PATCH",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(8000),
    },
  );
  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    throw new Error(`Discord partner event update failed (${res.status}): ${err}`);
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

export type DiscordAttachment = {
  filename: string;
  contentType: string;
  data: Uint8Array;
};

export async function sendDiscordChannelMessage(
  channelId: string,
  content: string,
  attachments: DiscordAttachment[] = [],
): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) throw new Error("Discord Fleetplanner Bot integration is not configured");
  if (!channelId.trim()) throw new Error("Feedback channel is not configured");

  const url = `${DISCORD_API}/channels/${encodeURIComponent(channelId.trim())}/messages`;
  const payload = {
    content: content.slice(0, 1900),
    allowed_mentions: { parse: [] as string[] },
    ...(attachments.length
      ? { attachments: attachments.map((a, i) => ({ id: i, filename: a.filename })) }
      : {}),
  };

  let res: Response;
  if (attachments.length) {
    // Discord file upload = multipart/form-data with a payload_json part + files[n].
    const form = new FormData();
    form.append("payload_json", JSON.stringify(payload));
    attachments.forEach((a, i) => {
      form.append(
        `files[${i}]`,
        new Blob([a.data as BlobPart], { type: a.contentType || "application/octet-stream" }),
        a.filename,
      );
    });
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${token}` },
      body: form,
      signal: AbortSignal.timeout(20000),
    });
  } else {
    res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
  }

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

// Minimal Discord message-component / embed shapes (FR-P1 approval DMs).
export type DiscordEmbed = {
  title?: string;
  description?: string;
  url?: string;
  color?: number;
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
};
export type DiscordComponentRow = {
  type: 1;
  components: Array<{
    type: 2;
    style: number;
    label: string;
    custom_id: string;
  }>;
};

/**
 * DM a fleetplanner user an embed + message components (buttons). Used for the
 * FR-P1 event-distribution approval prompt. Best-effort: throws on hard failure
 * so the caller can count/log, but callers treat it as non-fatal.
 */
export async function sendDiscordDmComponents(
  userId: string,
  payload: { content?: string; embeds?: DiscordEmbed[]; components?: DiscordComponentRow[] },
): Promise<void> {
  const token = fleetplannerBotToken();
  if (!token) throw new Error("Discord Fleetplanner Bot integration is not configured");
  const discordUserId = await discordRecipientIdForUser(userId);

  const channelRes = await fetch(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recipient_id: discordUserId }),
    signal: AbortSignal.timeout(8000),
  });
  if (!channelRes.ok) {
    const err = await channelRes.text().catch(() => channelRes.statusText);
    throw new Error(`Discord DM channel creation failed (${channelRes.status}): ${err}`);
  }
  const channel = (await channelRes.json()) as { id: string };
  const messageRes = await fetch(`${DISCORD_API}/channels/${channel.id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      content: payload.content?.slice(0, 1900),
      embeds: payload.embeds,
      components: payload.components,
      allowed_mentions: { parse: [] },
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!messageRes.ok) {
    const err = await messageRes.text().catch(() => messageRes.statusText);
    throw new Error(`Discord DM send failed (${messageRes.status}): ${err}`);
  }
}

// SPKI DER prefix for an Ed25519 raw public key (RFC 8410) — lets us build a
// KeyObject from Discord's 32-byte hex key without any external dependency.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

/**
 * Verify a Discord HTTP-interaction signature (Ed25519 over timestamp+body).
 * Returns false on any malformed input — never throws.
 */
export function verifyDiscordInteraction(
  rawBody: string,
  signatureHex: string,
  timestamp: string,
): boolean {
  const publicKeyHex = getEnv().DISCORD_FLEETPLANNER_PUBLIC_KEY;
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKeyHex, "hex")]),
      format: "der",
      type: "spki",
    });
    return cryptoVerify(
      null,
      Buffer.from(timestamp + rawBody),
      key,
      Buffer.from(signatureHex, "hex"),
    );
  } catch {
    return false;
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
