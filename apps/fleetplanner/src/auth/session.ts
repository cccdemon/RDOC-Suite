import type { FastifyReply, FastifyRequest } from "fastify";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import { prisma } from "../db.js";
import type { User } from "@prisma/client";
import { parseLocale, setLocale } from "../i18n/index.js";

const COOKIE = "fp_sid";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// The cookie carries a 32-byte cryptographically random bearer token (64 hex
// chars). The database stores ONLY its SHA-256 hash (`tokenHash`), never the
// token itself — so a DB/backup leak can't be replayed as a session, and the
// row's primary key (a guessable-ish cuid) is no longer the secret. Lookup is by
// hash; the PK `id` stays an internal handle (used for revocation/`destroySession`).
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
): Promise<{ id: string; token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("hex");
  const csrfToken = randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const session = await prisma.userSession.create({
    data: { userId, csrfToken, expiresAt, tokenHash: hashToken(token) },
  });
  return { id: session.id, token, csrfToken, expiresAt };
}

export async function loadSession(request: FastifyRequest): Promise<{ user: User; sessionId: string; csrfToken: string } | null> {
  const token = (request.cookies as Record<string, string | undefined>)[COOKIE];
  if (!token) return null;
  const session = await prisma.userSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;
  // Upgrade the request locale from the Accept-Language baseline to the user's
  // stored preference (single source of truth across all surfaces).
  const userLocale = parseLocale(session.user.locale);
  if (userLocale) setLocale(userLocale);
  return { user: session.user, sessionId: session.id, csrfToken: session.csrfToken };
}

// Secure cookies require HTTPS. In production (behind Traefik TLS) that's
// always the case, but local dev runs over plain http://localhost:3200,
// where a Secure cookie is silently dropped and login never sticks. Gate
// on NODE_ENV so prod stays Secure and dev works.
const SECURE_COOKIES = process.env.NODE_ENV === "production";

export function setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
  reply.setCookie(COOKIE, token, {
    httpOnly: true,
    secure: SECURE_COOKIES,
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: "/" });
}

export async function destroySession(sessionId: string): Promise<void> {
  await prisma.userSession.delete({ where: { id: sessionId } }).catch(() => null);
}
