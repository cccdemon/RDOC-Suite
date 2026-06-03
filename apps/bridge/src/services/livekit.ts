import { AccessToken, RoomServiceClient } from "livekit-server-sdk";
import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { getRelayLivekitCredentials, getRelayRoomName } from "./relayBotsConfig.js";

const TOKEN_TTL_SECONDS = 60 * 60;

export function bridgeRoomName(guildId: string): string {
  return `commander-bridge-${guildId}`;
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
  const room = bridgeRoomName(opts.guildId);

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
