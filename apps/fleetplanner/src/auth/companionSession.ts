import { prisma } from "../db.js";

const TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

function randomHex(bytes: number): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createCompanionSession(userId: string): Promise<string> {
  const id = randomHex(32); // 64-char hex bearer token
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.companionSession.create({ data: { id, userId, expiresAt } });
  return id;
}

export async function loadCompanionSession(token: string): Promise<string | null> {
  if (!token || token.length !== 64) return null;
  const session = await prisma.companionSession.findUnique({
    where: { id: token },
    select: { userId: true, expiresAt: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  return session.userId;
}
