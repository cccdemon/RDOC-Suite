import crypto from "node:crypto";

// Capability tokens shared with the @rdoc-suite/mission-cover service. The
// algorithm MUST stay byte-for-byte identical to apps/mission-cover token.ts.
// Format: base64url(json) + "." + base64url(hmac-sha256(json)). Payload carries
// its own `exp` (unix seconds). Secret = MISSIONCOVER_SERVICE_SECRET.

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signCoverToken(
  payload: Record<string, unknown>,
  secret: string,
  ttlSeconds: number,
): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const json = Buffer.from(JSON.stringify(body), "utf8");
  const sig = crypto.createHmac("sha256", secret).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export function verifyCoverToken<T = Record<string, unknown>>(token: string, secret: string): T | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  let json: Buffer;
  let sig: Buffer;
  try {
    json = Buffer.from(token.slice(0, dot), "base64url");
    sig = Buffer.from(token.slice(dot + 1), "base64url");
  } catch {
    return null;
  }
  const expected = crypto.createHmac("sha256", secret).update(json).digest();
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null;
  let payload: { exp?: number } & Record<string, unknown>;
  try {
    payload = JSON.parse(json.toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload as T;
}
