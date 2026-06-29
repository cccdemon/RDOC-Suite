// FR-P3 Stream-Event Phase B2 — Twitch live-status.
// Resolves which twitch.tv channels are currently live via the Helix API, using
// an app access token (client_credentials). Feature is OFF unless both
// TWITCH_CLIENT_ID and TWITCH_CLIENT_SECRET are set. Results are cached briefly
// so op-detail polling doesn't hammer the API or hit rate limits.
import { getEnv } from "../config/env.js";

const HELIX = "https://api.twitch.tv/helix";
const TOKEN_URL = "https://id.twitch.tv/oauth2/token";
const LIVE_TTL_MS = 60_000; // re-check a login's live state at most once per minute

export function twitchLiveConfigured(): boolean {
  const env = getEnv();
  return !!(env.TWITCH_CLIENT_ID && env.TWITCH_CLIENT_SECRET);
}

/** Extract the lowercase Twitch login from a twitch.tv URL, or null. */
export function twitchLoginFromUrl(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "twitch.tv" && !host.endsWith(".twitch.tv")) return null;
  const seg = u.pathname.split("/").filter(Boolean)[0];
  if (!seg) return null;
  const login = seg.toLowerCase();
  // Skip non-channel paths (videos, directory, etc.).
  if (["videos", "directory", "p", "settings", "downloads", "store"].includes(login)) return null;
  if (!/^[a-z0-9_]{2,30}$/.test(login)) return null;
  return login;
}

// ── app access token (cached until shortly before expiry) ──────────
let token: { value: string; expiresAt: number } | null = null;

async function appToken(): Promise<string | null> {
  const env = getEnv();
  if (!env.TWITCH_CLIENT_ID || !env.TWITCH_CLIENT_SECRET) return null;
  const now = Date.now();
  if (token && now < token.expiresAt - 30_000) return token.value;
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID,
    client_secret: env.TWITCH_CLIENT_SECRET,
    grant_type: "client_credentials",
  });
  const res = await fetch(TOKEN_URL, { method: "POST", body, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Twitch token request failed (${res.status})`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: now + data.expires_in * 1000 };
  return token.value;
}

// ── per-login live cache ───────────────────────────────────────────
const liveCache = new Map<string, { live: boolean; at: number }>();

/**
 * Return the subset of `logins` that are currently live. Cached per login for
 * LIVE_TTL_MS. Returns an empty set when the feature is unconfigured or on error
 * (live-status is best-effort — never breaks the op view).
 */
export async function liveLogins(logins: string[]): Promise<Set<string>> {
  const live = new Set<string>();
  if (!twitchLiveConfigured() || logins.length === 0) return live;

  const now = Date.now();
  const uniq = [...new Set(logins.map((l) => l.toLowerCase()))];
  const stale: string[] = [];
  for (const l of uniq) {
    const c = liveCache.get(l);
    if (c && now - c.at < LIVE_TTL_MS) {
      if (c.live) live.add(l);
    } else {
      stale.push(l);
    }
  }
  if (stale.length === 0) return live;

  try {
    const tok = await appToken();
    const env = getEnv();
    if (!tok || !env.TWITCH_CLIENT_ID) return live;
    // Helix accepts up to 100 user_login params per call.
    for (let i = 0; i < stale.length; i += 100) {
      const batch = stale.slice(i, i + 100);
      const qs = batch.map((l) => `user_login=${encodeURIComponent(l)}`).join("&");
      const res = await fetch(`${HELIX}/streams?first=100&${qs}`, {
        headers: { "Client-Id": env.TWITCH_CLIENT_ID, Authorization: `Bearer ${tok}` },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`Helix /streams failed (${res.status})`);
      const data = (await res.json()) as { data: Array<{ user_login: string; type: string }> };
      const liveNow = new Set(data.data.filter((s) => s.type === "live").map((s) => s.user_login.toLowerCase()));
      for (const l of batch) {
        const isLive = liveNow.has(l);
        liveCache.set(l, { live: isLive, at: now });
        if (isLive) live.add(l);
      }
    }
  } catch {
    // best-effort: leave whatever the cache already had
  }
  return live;
}
