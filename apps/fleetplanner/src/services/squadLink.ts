import crypto from "node:crypto";

import { getEnv } from "../config/env.js";

// RDOC SquadLink Lite deep-link (FR SquadLink-CommandNet).
//
// The Fleetplanner hands operation commanders a `squadlink://connect` link that
// joins the operation's CommandNet voice room without PIN/code entry. SquadLink
// Lite itself is unchanged — it already parses this link (parseDirectLink) and
// connects. We only build the URL here.
//
// The room join token is HMAC-SHA256(secret, room) as lowercase hex. This MUST
// stay byte-for-byte identical to the init-server's `token_for`
// (RDOC-SACompanion server/init/src/auth.rs → hmac_hex). The init-server checks
// only this HMAC on WS connect (no session-store lookup), so the link does not
// expire and has no "join immediately" window.
//
// Scope: one shared CommandNet room per operation (`op-<opId>-command`). Parallel
// operations get distinct rooms automatically (opId in the room name).

/** Whether the deep-link feature is configured (shared room-auth secret present). */
export function squadLinkConfigured(): boolean {
  const s = getEnv().SQUADLINK_ROOM_AUTH_SECRET;
  return typeof s === "string" && s.length > 0;
}

/** The CommandNet room name for an operation. Charset matches the app's validator
 *  (`[A-Za-z0-9_-]`, ≤64): cuid/snowflake op ids fit, length stays well under 64. */
export function commandRoom(opId: string): string {
  return `op-${opId}-command`;
}

/** HMAC-SHA256(secret, room) hex — the room's valid join token. */
function mintToken(room: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(room).digest("hex");
}

/** The Microsoft Store install link, if a listing is configured. */
export function squadLinkStoreUrl(): string | undefined {
  const u = getEnv().SQUADLINK_STORE_URL;
  return u && u.length > 0 ? u : undefined;
}

/**
 * Build the `squadlink://connect` deep-link for a commander joining an op's
 * CommandNet room. `name` is the display name; `uid` is the stable identity
 * (the app sanitizes it to `[A-Za-z0-9_.-]`). Returns null if not configured.
 */
export function buildCommandNetLink(opId: string, name: string, uid: string): string | null {
  const env = getEnv();
  const secret = env.SQUADLINK_ROOM_AUTH_SECRET;
  if (!secret) return null;
  const room = commandRoom(opId);
  const token = mintToken(room, secret);
  // squadlink:// is a custom scheme; URL/URLSearchParams handle percent-encoding.
  const u = new URL("squadlink://connect");
  u.searchParams.set("ws", env.SQUADLINK_WS_URL);
  u.searchParams.set("room", room);
  u.searchParams.set("token", token);
  if (name) u.searchParams.set("name", name);
  if (uid) u.searchParams.set("uid", uid);
  return u.toString();
}
