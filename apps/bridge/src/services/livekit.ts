import { randomBytes } from "node:crypto";
import { AccessToken } from "livekit-server-sdk";
import { getEnv } from "../config/env.js";

const TOKEN_TTL_SECONDS = 60 * 60;

export function bridgeRoomName(guildId: string): string {
  return `commander-bridge-${guildId}`;
}

/**
 * Issues a short-lived LiveKit access token that lets the user join the
 * commander-bridge room for the given guild. The LiveKit identity is the
 * Discord user id PLUS a per-token random suffix, so a fast press/release/
 * press cycle does not look like a duplicate-identity collision to LiveKit
 * (its server-side cleanup is asynchronous). Our own RoomRegistry still
 * tracks the real userId, so the active-commander count stays correct.
 *
 * The display name uses the Discord user id so commanders can be identified
 * in LiveKit logs even though the identity is randomized.
 */
export async function issueLivekitToken(opts: {
  userId: string;
  guildId: string;
}): Promise<string> {
  const { LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = getEnv();
  const room = bridgeRoomName(opts.guildId);
  const suffix = randomBytes(4).toString("hex");

  const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
    identity: `${opts.userId}-${suffix}`,
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

