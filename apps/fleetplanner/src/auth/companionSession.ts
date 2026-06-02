import { prisma } from "../db.js";

// Narrow token distributed to other users via dccc://fleet-voice links. Shorter
// TTL and limited scope — only the mission-voice polling endpoint accepts it.
const MISSION_VOICE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CompanionScope = "full" | "mission-voice";

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSession(userId: string, scope: CompanionScope, ttlMs: number): Promise<string> {
  const id = randomHex(32); // 64-char hex bearer token
  const expiresAt = new Date(Date.now() + ttlMs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.companionSession.create as any)({ data: { id, userId, expiresAt, scope } });
  return id;
}

/** Narrow, short-lived token for dccc://fleet-voice links. Only usable on the
 *  mission-voice polling endpoint — NOT a full companion session. */
export async function createMissionVoiceSession(userId: string): Promise<string> {
  return createSession(userId, "mission-voice", MISSION_VOICE_TTL_MS);
}

async function loadScopedSession(token: string, allowed: readonly CompanionScope[]): Promise<string | null> {
  if (!token || token.length !== 64) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = await (prisma.companionSession.findUnique as any)({
    where: { id: token },
    select: { userId: true, expiresAt: true, scope: true },
  }) as { userId: string; expiresAt: Date; scope: string } | null;
  if (!session || session.expiresAt < new Date()) return null;
  if (!allowed.includes(session.scope as CompanionScope)) return null;
  return session.userId;
}

/** Loads a token valid for the mission-voice endpoint: a full companion session
 *  OR a dedicated mission-voice token. */
export async function loadMissionVoiceSession(token: string): Promise<string | null> {
  return loadScopedSession(token, ["full", "mission-voice"]);
}
