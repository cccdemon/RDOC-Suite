// OAuth login. Discord is the only provider; GitHub and Google were removed
// 2026-09-14. UserIdentity.provider stays a string, so old rows still load.

import { discordApiBase, discordAuthorizeBase, getEnv } from "../config/env.js";

export type OAuthProvider = "discord";

export type ExternalProfile = {
  provider: OAuthProvider;
  providerId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  // Ids of guilds the user is a member of (from the `guilds` scope).
  discordGuildIds?: string[];
};

// ── Shared state store (PKCE-less, server-side nonce) ──────────────

const states = new Map<string, { provider: OAuthProvider; expires: number; returnTo?: string }>();

/**
 * Where to send the user after login. Only a same-site relative path is
 * accepted ("/ops/abc?x=1"); anything that a browser could read as another
 * origin ("//evil", "/\evil", "https://…") or that carries control characters
 * is refused, otherwise this is an open redirect. Returns undefined → "/".
 */
export function safeReturnTo(raw: unknown): string | undefined {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 512) return undefined;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return undefined;
  for (let i = 0; i < raw.length; i++) {
    const c = raw.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return undefined;
  }
  // /auth/* would loop back into the OAuth handshake.
  if (raw === "/auth" || raw.startsWith("/auth/")) return undefined;
  return raw;
}

export function issueState(provider: OAuthProvider, returnTo?: string): string {
  const state = crypto.randomUUID();
  states.set(state, { provider, expires: Date.now() + 5 * 60 * 1000, returnTo });
  if (states.size > 500) {
    const now = Date.now();
    for (const [k, v] of states) if (v.expires < now) states.delete(k);
  }
  return state;
}

export function consumeState(state: string): { provider: OAuthProvider; returnTo?: string } | null {
  const v = states.get(state);
  if (!v || v.expires < Date.now()) return null;
  states.delete(state);
  return { provider: v.provider, returnTo: v.returnTo };
}

// ── Discord ────────────────────────────────────────────────────────

export function discordEnabled(): boolean {
  return !!(discordOAuthClientId() && discordOAuthClientSecret());
}

export function discordOAuthClientId(): string | undefined {
  const env = getEnv();
  // Fleetplanner web login uses the RDOC-Fleetplanner app.
  return env.DISCORD_FLEETPLANNER_CLIENT_ID ?? env.DISCORD_CLIENT_ID;
}

export function discordOAuthClientSecret(): string | undefined {
  const env = getEnv();
  return env.DISCORD_FLEETPLANNER_CLIENT_SECRET ?? env.DISCORD_CLIENT_SECRET;
}

function discordAuthorizeUrl(state: string, redirectUri: string): string {
  const env = getEnv();
  const p = new URLSearchParams({
    client_id: discordOAuthClientId()!,
    redirect_uri: redirectUri,
    response_type: "code",
    // `guilds` lets us read which Discord servers the user is in, to scope
    // their fleetplanner access to guilds where the bot is installed.
    scope: "identify guilds",
    state,
  });
  return `${discordAuthorizeBase()}/oauth2/authorize?${p}`;
}

async function discordExchange(code: string, redirectUri: string): Promise<ExternalProfile> {
  const tokenRes = await fetch(`${discordApiBase()}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: discordOAuthClientId()!,
      client_secret: discordOAuthClientSecret()!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch(`${discordApiBase()}/users/@me`, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) throw new Error(`Discord user fetch: ${userRes.status}`);
  const u = (await userRes.json()) as {
    id: string; username: string; global_name?: string | null;
    avatar: string | null; email?: string | null;
  };

  // Fetch the user's guild list (guilds scope) so we can scope access.
  let discordGuildIds: string[] = [];
  try {
    const guildsRes = await fetch(`${discordApiBase()}/users/@me/guilds`, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (guildsRes.ok) {
      const guilds = (await guildsRes.json()) as Array<{ id: string }>;
      discordGuildIds = guilds.map((g) => g.id);
    }
  } catch {
    // guild list is best effort; leave empty
  }

  return {
    provider: "discord",
    providerId: u.id,
    username: u.global_name ?? u.username,
    email: u.email ?? null,
    avatarUrl: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=64` : null,
    discordGuildIds,
  };
}

// ── Dispatch helper ────────────────────────────────────────────────

export function redirectUriFor(
  provider: OAuthProvider,
  webPublicUrl: string,
  basePath: string,
): string {
  return `${webPublicUrl}${basePath}/auth/${provider}/callback`;
}

export async function exchangeForProfile(
  provider: OAuthProvider,
  code: string,
  redirectUri: string,
): Promise<ExternalProfile> {
  switch (provider) {
    case "discord": return discordExchange(code, redirectUri);
  }
}

export function authorizeUrlFor(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  switch (provider) {
    case "discord": return discordAuthorizeUrl(state, redirectUri);
  }
}
