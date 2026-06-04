import type { FastifyReply, FastifyRequest } from "fastify";
import { getEnv, getOAuthEnv } from "../config/env.js";
import { type AdminRecord, getAdminRecord } from "../services/admins.js";
import {
  ADMIN_SESSION_COOKIE,
  verifyAdminSessionCookie,
} from "./cookie.js";

/**
 * What every protected admin route receives once the gate has passed.
 * `sub` and `guildId` come from the JWT cookie; `role` and `protected`
 * come from a fresh DB lookup so a stale cookie can never grant more
 * power than the DB currently allows. Cost: one indexed lookup per
 * request — cheap for an admin UI.
 */
export type AdminSession = {
  sub: string;
  guildId: string;
  role: AdminRecord["role"];
  protected: boolean;
};

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Expected public origin (scheme+host[:port]) of the admin UI, from OAUTH_REDIRECT_URI. */
function expectedOrigin(): string | null {
  const oauth = getOAuthEnv();
  if (!oauth) return null;
  try {
    return new URL(oauth.OAUTH_REDIRECT_URI).origin;
  } catch {
    return null;
  }
}

/**
 * CSRF guard for state-changing admin requests. The admin session is an
 * HttpOnly SameSite=Lax cookie; SameSite=Lax already blocks most cross-site
 * POSTs, but we add an explicit Origin/Referer check (defense in depth,
 * consistent with the fleetplanner _csrf checks) for any unsafe method.
 *
 * Modern browsers always send an Origin header on cross-origin (and
 * same-origin non-GET) requests, so a request whose Origin/Referer does not
 * match our own public origin is rejected. Returns true when the request is
 * allowed to proceed.
 */
function passesCsrf(request: FastifyRequest): boolean {
  if (!UNSAFE_METHODS.has(request.method.toUpperCase())) return true;
  const expected = expectedOrigin();
  if (!expected) return true; // misconfigured env — don't hard-fail the UI

  const origin = request.headers.origin;
  if (typeof origin === "string" && origin) {
    return origin === expected;
  }
  // No Origin header — fall back to Referer's origin.
  const referer = request.headers.referer;
  if (typeof referer === "string" && referer) {
    try {
      return new URL(referer).origin === expected;
    } catch {
      return false;
    }
  }
  // Unsafe method with neither Origin nor Referer: reject.
  return false;
}

/**
 * Per-route admin gate. Resolves to the AdminSession when the caller
 * has a valid admin cookie AND a matching AdminUser row, otherwise
 * sends a redirect to /admin/login (preserving the original URL as
 * ?return_to=) and returns null. Caller should `return` immediately
 * when null.
 *
 * If the cookie is valid but the AdminUser row has been removed
 * (e.g., another admiral kicked them), the user is treated as
 * unauthenticated — back to login.
 */
export async function requireAdminSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AdminSession | null> {
  if (!passesCsrf(request)) {
    reply.code(403).send({ error: "csrf_origin_mismatch" });
    return null;
  }
  const cookie = request.cookies[ADMIN_SESSION_COOKIE];
  const adminSecret = getEnv().ADMIN_SESSION_SECRET ?? getEnv().SESSION_SECRET;
  if (cookie) {
    const verdict = await verifyAdminSessionCookie(adminSecret, cookie);
    if (verdict.ok) {
      const record = await getAdminRecord({
        guildId: verdict.payload.guildId,
        userId: verdict.payload.sub,
      });
      if (record) {
        return {
          sub: verdict.payload.sub,
          guildId: verdict.payload.guildId,
          role: record.role,
          protected: record.protected,
        };
      }
    }
  }
  const basePath = getEnv().PUBLIC_BASE_PATH;
  const returnTo = encodeURIComponent(request.url);
  reply.redirect(`${basePath}/admin/login?return_to=${returnTo}`);
  return null;
}
