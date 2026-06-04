import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { getRelayLivekitCredentials, getRelayRoomName } from "./relayBotsConfig.js";

const TOKEN_TTL_SECONDS = 60 * 60;

// The guild bridge LiveKit voice room rotates weekly: a long-lived room
// otherwise accumulates stale state, and a fresh key surface every 7 days is
// good hygiene. Only the LiveKit grant room rotates — the roster room id
// (bridgeRoomName) stays stable, so the squad list doesn't churn. Live clients
// are migrated to the new room by the bridge's periodic recheck, which
// re-mints + pushes a fresh audio:enable token; the empty old room is
// auto-reaped by LiveKit.
const BRIDGE_ROOM_ROTATION_MS = 7 * 24 * 60 * 60 * 1000;
const BRIDGE_ROOM_ROTATION_EPOCH = Date.UTC(2026, 0, 1);

/** Current weekly rotation index for the guild bridge LiveKit room. */
export function bridgeRoomRotationPeriod(now: number = Date.now()): number {
  return Math.floor((now - BRIDGE_ROOM_ROTATION_EPOCH) / BRIDGE_ROOM_ROTATION_MS);
}

/** Stable roster room id for the guild bridge (does NOT rotate). */
export function bridgeRoomName(guildId: string): string {
  return `commander-bridge-${guildId}`;
}

/** The actual LiveKit voice room for the guild bridge — rotates weekly. */
export function bridgeLivekitRoom(guildId: string, now: number = Date.now()): string {
  return `${bridgeRoomName(guildId)}-w${bridgeRoomRotationPeriod(now)}`;
}

export function sessionRoomName(sessionId: string): string {
  return `session-${sessionId}`;
}

/**
 * Issues a short-lived LiveKit access token that lets the user join the
 * commander-bridge room for the given guild. The LiveKit identity is the
 * Discord user id — STABLE, no random suffix. A random suffix made every
 * reconnect look like a new participant, so the SFU never evicted the stale
 * session and rooms filled with ghosts (which also overwrote the real audio
 * track on the client). PTT press/release only mutes the existing track — it
 * does not reconnect — so a stable identity is safe and lets LiveKit replace a
 * prior session on a genuine reconnect.
 */
export async function issueLivekitToken(opts: {
  userId: string;
  guildId: string;
}): Promise<string> {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = getEnv();
  const room = bridgeLivekitRoom(opts.guildId);

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: opts.userId,
    name: opts.userId,
    ttl: TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    roomRecord: false,
  });
  return await at.toJwt();
}

export async function issueSessionLivekitToken(opts: {
  userId: string;
  livekitRoom: string;
}): Promise<string> {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = getEnv();
  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: opts.userId,
    name: opts.userId,
    ttl: TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    room: opts.livekitRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: false,
    roomRecord: false,
  });
  return await at.toJwt();
}

/**
 * Issues a LiveKit token for the voice relay room.
 * Credentials come from RelayBotsConfig (admin-configured), falling back to
 * the bridge's own LiveKit env vars. Publishers get canPublish only;
 * subscribers (relay bots service) get canSubscribe only.
 */
export async function issueRelayToken(opts: {
  userId: string;
  guildId: string;
  role: "publisher" | "subscriber";
}): Promise<{ token: string; roomName: string; url: string }> {
  const { url, apiKey, apiSecret } = await getRelayLivekitCredentials(opts.guildId);
  const roomName = await getRelayRoomName(opts.guildId);
  // Stable identity (no random suffix): a reconnecting publisher replaces its
  // own prior participant instead of leaving a ghost in the relay room.
  const identity =
    opts.role === "subscriber" ? "relay-bot-service" : `relay-pub-${opts.userId}`;

  const at = new AccessToken(apiKey, apiSecret, {
    identity,
    name: opts.role === "subscriber" ? "Relay Bot Service" : `Relay-${opts.userId}`,
    ttl: TOKEN_TTL_SECONDS,
  });
  at.addGrant({
    room: roomName,
    roomJoin: true,
    canPublish: opts.role === "publisher",
    canSubscribe: opts.role === "subscriber",
    canPublishData: false,
    roomRecord: false,
  });
  return { token: await at.toJwt(), roomName, url };
}

/**
 * Ask LiveKit to delete the room, which ejects all participants immediately.
 * Best-effort: if the room never had anyone join it may not exist on LiveKit's
 * side yet, so errors are logged but not re-thrown.
 */
export async function deleteSessionRoom(livekitRoom: string): Promise<void> {
  const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = getEnv();
  const svc = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  try {
    await svc.deleteRoom(livekitRoom);
  } catch (err) {
    logger.warn({ err, livekitRoom }, "deleteSessionRoom: LiveKit deleteRoom failed (ignored)");
  }
}
