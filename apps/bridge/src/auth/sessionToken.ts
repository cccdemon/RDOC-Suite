import { SignJWT, jwtVerify, errors as joseErrors } from "jose";
import { z } from "zod";

const ISSUER = "dccc-bridge";
const AUDIENCE = "dccc-companion";
const DEFAULT_TTL_SECONDS = 15 * 60;

// Session tokens identify the Discord user only. The guildId the user
// is currently bridged into is supplied per-WS-connect via the URL
// query so the user can switch servers without re-doing OAuth.
// Older tokens may still include a `guildId` claim — kept optional
// for backward-compat, but the bridge ignores it.
const payloadSchema = z.object({
  sub: z.string().regex(/^[0-9]{17,20}$/, "sub must be a Discord snowflake"),
  guildId: z
    .string()
    .regex(/^[0-9]{17,20}$/, "guildId must be a Discord snowflake")
    .optional(),
  iat: z.number().int().nonnegative().optional(),
  exp: z.number().int().nonnegative().optional(),
});

export type SessionTokenPayload = z.infer<typeof payloadSchema>;

const revokedJti = new Set<string>();

function secretToKey(secret: string): Uint8Array {
  return new TextEncoder().encode(secret);
}

export async function issueSessionToken(
  secret: string,
  payload: Pick<SessionTokenPayload, "sub"> & { guildId?: string },
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // guildId stays optional in the payload for backward-compat with
  // clients/tests that still mint per-guild tokens. The bridge always
  // prefers a URL-supplied guildId; this claim is just the fallback.
  const extra = payload.guildId ? { guildId: payload.guildId } : {};
  return await new SignJWT(extra)
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt(now)
    .setExpirationTime(now + ttlSeconds)
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setJti(crypto.randomUUID())
    .sign(secretToKey(secret));
}

export type VerifyResult =
  | { ok: true; payload: SessionTokenPayload }
  | { ok: false; reason: "invalid" | "expired" | "revoked" };

export async function verifySessionToken(secret: string, token: string): Promise<VerifyResult> {
  try {
    const { payload } = await jwtVerify(token, secretToKey(secret), {
      issuer: ISSUER,
      audience: AUDIENCE,
    });
    if (typeof payload.jti === "string" && revokedJti.has(payload.jti)) {
      return { ok: false, reason: "revoked" };
    }
    const parsed = payloadSchema.safeParse(payload);
    if (!parsed.success) {
      return { ok: false, reason: "invalid" };
    }
    return { ok: true, payload: parsed.data };
  } catch (err) {
    if (err instanceof joseErrors.JWTExpired) {
      return { ok: false, reason: "expired" };
    }
    return { ok: false, reason: "invalid" };
  }
}

export function revokeToken(jti: string): void {
  revokedJti.add(jti);
}

export function _clearRevocations(): void {
  revokedJti.clear();
}
