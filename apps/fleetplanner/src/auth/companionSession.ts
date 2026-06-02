import { prisma } from "../db.js";

// Narrow token distributed to users through rdoc://mission links.
const MISSION_VOICE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type CompanionScope = "full" | "mission-voice";
export type MissionVoiceSession = { userId: string; operationId: string };

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function createSession(
  userId: string,
  scope: CompanionScope,
  ttlMs: number,
  operationId?: string,
): Promise<string> {
  const id = randomHex(32); // 64-char hex bearer token
  const expiresAt = new Date(Date.now() + ttlMs);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.companionSession.create as any)({
    data: { id, userId, expiresAt, scope, operationId: operationId ?? null },
  });
  return id;
}

export async function createMissionVoiceSession(
  userId: string,
  operationId: string,
): Promise<string> {
  return createSession(userId, "mission-voice", MISSION_VOICE_TTL_MS, operationId);
}

async function loadScopedSession(
  token: string,
  allowed: readonly CompanionScope[],
): Promise<{ userId: string; operationId: string | null; scope: CompanionScope } | null> {
  if (!token || token.length !== 64) return null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const session = (await (prisma.companionSession.findUnique as any)({
    where: { id: token },
    select: { userId: true, expiresAt: true, scope: true, operationId: true },
  })) as { userId: string; expiresAt: Date; scope: string; operationId: string | null } | null;
  if (!session || session.expiresAt < new Date()) return null;
  if (!allowed.includes(session.scope as CompanionScope)) return null;
  return {
    userId: session.userId,
    operationId: session.operationId,
    scope: session.scope as CompanionScope,
  };
}

export async function loadMissionVoiceSession(token: string): Promise<MissionVoiceSession | null> {
  const session = await loadScopedSession(token, ["mission-voice"]);
  if (!session?.operationId) return null;
  return { userId: session.userId, operationId: session.operationId };
}
