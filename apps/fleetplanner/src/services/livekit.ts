import { randomBytes } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { getEnv } from "../config/env.js";

const TOKEN_TTL_SECONDS = 4 * 60 * 60; // 4h — covers typical operation duration

export function fleetUnitRoom(operationId: string, unitId: string): string {
  return `fleet-${operationId}-unit-${unitId}`;
}

export function fleetGlobalRoom(operationId: string): string {
  return `fleet-${operationId}-global`;
}

/**
 * Issues a LiveKit participant token for a fleet unit voice room.
 * Returns null when LiveKit is not configured (optional feature).
 * The random suffix on the identity prevents duplicate-identity collisions
 * when a captain reconnects quickly (same pattern as the bridge).
 */
export async function issueUnitLivekitToken(
  userId: string,
  operationId: string,
  unitId: string,
): Promise<{ livekitUrl: string; token: string; room: string } | null> {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;

  const room = fleetUnitRoom(operationId, unitId);
  const suffix = randomBytes(4).toString("hex");
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: `${userId}-${suffix}`,
    name: userId,
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
  return { livekitUrl: env.LIVEKIT_URL, token: await at.toJwt(), room };
}

/** Issues a LiveKit token for a Mission Voice room (global or commander).
 *  Both rooms grant publish+subscribe — who can join is controlled by
 *  which token the backend issues, not by LiveKit room config. */
export async function issueMissionVoiceToken(
  userId: string,
  room: string,
): Promise<string | null> {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;
  const suffix = randomBytes(4).toString("hex");
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: `${userId}-${suffix}`,
    name: userId,
    ttl: 8 * 60 * 60, // 8h — covers typical operation duration
  });
  at.addGrant({ room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false, roomRecord: false });
  return at.toJwt();
}

export async function issueGlobalVoiceToken(
  userId: string,
  operationId: string,
): Promise<{ livekitUrl: string; token: string; room: string } | null> {
  const env = getEnv();
  if (!env.LIVEKIT_URL || !env.LIVEKIT_API_KEY || !env.LIVEKIT_API_SECRET) return null;

  const room = fleetGlobalRoom(operationId);
  const suffix = randomBytes(4).toString("hex");
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity: `${userId}-${suffix}`,
    name: userId,
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
  return { livekitUrl: env.LIVEKIT_URL, token: await at.toJwt(), room };
}
