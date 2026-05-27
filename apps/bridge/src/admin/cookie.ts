import { jwtVerify, SignJWT } from "jose";

/**
 * Admin web-UI session cookie. Separate from the Commander session
 * tokens in `apps/bridge/src/auth/sessionToken.ts` — different purpose
 * (browser-side cookie vs WS bearer), different TTL (24 h vs 30 days),
 * different issuer string so they cannot be confused at verify-time.
 */

const ISSUER = "dccc-bridge-admin";
const AUDIENCE = "dccc-admin-ui";
const TTL_SECONDS = 24 * 60 * 60; // 24 h

export const ADMIN_SESSION_COOKIE = "dccc_admin_session";

export type AdminSessionPayload = {
  /** Discord userId of the signed-in admin. */
  sub: string;
  /** Guild this admin is signed in for. */
  guildId: string;
};

function secretKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueAdminSessionCookie(
  secret: string,
  payload: AdminSessionPayload,
): Promise<string> {
  return await new SignJWT({ guildId: payload.guildId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + TTL_SECONDS)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .sign(secretKey(secret));
}

export type AdminVerifyResult =
  | { ok: true; payload: AdminSessionPayload }
  | { ok: false; reason: "expired" | "invalid" };

export async function verifyAdminSessionCookie(
  secret: string,
  raw: string,
): Promise<AdminVerifyResult> {
  try {
    const { payload } = await jwtVerify(raw, secretKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.sub !== "string" || typeof payload.guildId !== "string") {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, payload: { sub: payload.sub, guildId: payload.guildId as string } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("expired") || message.includes("exp")) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

/**
 * Cookie options for the admin session. Path scoped to /admin so the
 * cookie never leaks into the rest of the bridge API surface. Secure
 * iff the deployment publishes the admin UI over HTTPS (it should).
 */
export function adminCookieOptions(opts: { publicBasePath: string; secure: boolean }): {
  path: string;
  httpOnly: boolean;
  sameSite: "lax";
  secure: boolean;
  maxAge: number;
} {
  return {
    path: `${opts.publicBasePath}/admin`,
    httpOnly: true,
    sameSite: "lax",
    secure: opts.secure,
    maxAge: TTL_SECONDS,
  };
}
