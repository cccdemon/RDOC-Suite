import crypto from "node:crypto";

// Stateless capability tokens shared between the fleetplanner and this service.
// Format: base64url(json payload) + "." + base64url(hmac-sha256(payload)).
// The payload carries its own `exp` (unix seconds). Secret = the shared
// MISSIONCOVER_SERVICE_SECRET. Keep this algorithm identical on both sides.

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signToken(payload: Record<string, unknown>, secret: string, ttlSeconds: number): string {
  const body = { ...payload, exp: Math.floor(Date.now() / 1000) + ttlSeconds };
  const json = Buffer.from(JSON.stringify(body), "utf8");
  const sig = crypto.createHmac("sha256", secret).update(json).digest();
  return `${b64url(json)}.${b64url(sig)}`;
}

export function verifyToken<T = Record<string, unknown>>(token: string, secret: string): T | null {
  const dot = token.indexOf(".");
  if (dot < 0) return null;
  const jsonPart = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);
  let json: Buffer;
  let sig: Buffer;
  try {
    json = Buffer.from(jsonPart, "base64url");
    sig = Buffer.from(sigPart, "base64url");
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
