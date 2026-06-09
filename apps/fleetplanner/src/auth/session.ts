import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import type { User } from "@prisma/client";
import { parseLocale, setLocale } from "../i18n/index.js";

const COOKIE = "fp_sid";
const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export async function createSession(userId: string): Promise<{ id: string; csrfToken: string; expiresAt: Date }> {
  const csrfToken = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + TTL_MS);
  const session = await prisma.userSession.create({
    data: { userId, csrfToken, expiresAt },
  });
  return { id: session.id, csrfToken, expiresAt };
}

export async function loadSession(request: FastifyRequest): Promise<{ user: User; sessionId: string; csrfToken: string } | null> {
  const sid = (request.cookies as Record<string, string | undefined>)[COOKIE];
  if (!sid) return null;
  const session = await prisma.userSession.findUnique({
    where: { id: sid },
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

export function setSessionCookie(reply: FastifyReply, sessionId: string, expiresAt: Date): void {
  reply.setCookie(COOKIE, sessionId, {
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
