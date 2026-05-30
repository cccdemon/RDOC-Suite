// Generic multi-provider OAuth support.
// Each provider implements OAuthProvider; the auth routes use the
// generic flow and provider-specific credential helpers.

import { getEnv } from "../config/env.js";

export type OAuthProvider = "discord" | "github" | "google";

export type ExternalProfile = {
  provider: OAuthProvider;
  providerId: string;
  username: string;
  email: string | null;
  avatarUrl: string | null;
  // Discord only: ids of guilds the user is a member of (from `guilds` scope).
  discordGuildIds?: string[];
};

// ── Shared state store (PKCE-less, server-side nonce) ──────────────

const states = new Map<string, { provider: OAuthProvider; expires: number; linkUserId?: string }>();

export function issueState(provider: OAuthProvider, linkUserId?: string): string {
  const state = crypto.randomUUID();
  states.set(state, { provider, expires: Date.now() + 5 * 60 * 1000, linkUserId });
  if (states.size > 500) {
    const now = Date.now();
    for (const [k, v] of states) if (v.expires < now) states.delete(k);
  }
  return state;
}

export function consumeState(state: string): { provider: OAuthProvider; linkUserId?: string } | null {
  const v = states.get(state);
  if (!v || v.expires < Date.now()) return null;
  states.delete(state);
  return { provider: v.provider, linkUserId: v.linkUserId };
}

// ── Discord ────────────────────────────────────────────────────────

export function discordEnabled(): boolean {
  const env = getEnv();
  return !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET);
}

export function discordAuthorizeUrl(state: string, redirectUri: string): string {
  const env = getEnv();
  const p = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    // `guilds` lets us read which Discord servers the user is in, to scope
    // their fleetplanner access to guilds where the bot is installed.
    scope: "identify guilds",
    state,
  });
  return `https://discord.com/api/v10/oauth2/authorize?${p}`;
}

export async function discordExchange(code: string, redirectUri: string): Promise<ExternalProfile> {
  const env = getEnv();
  const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID!,
      client_secret: env.DISCORD_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Discord token exchange: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch("https://discord.com/api/v10/users/@me", {
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
    const guildsRes = await fetch("https://discord.com/api/v10/users/@me/guilds", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (guildsRes.ok) {
      const guilds = (await guildsRes.json()) as Array<{ id: string }>;
      discordGuildIds = guilds.map((g) => g.id);
    }
  } catch {
    // guilds scope may be absent (link flow); leave empty
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

// ── GitHub ─────────────────────────────────────────────────────────

export function githubEnabled(): boolean {
  const env = getEnv();
  return !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET);
}

export function githubAuthorizeUrl(state: string, redirectUri: string): string {
  const env = getEnv();
  const p = new URLSearchParams({
    client_id: env.GITHUB_CLIENT_ID!,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    state,
  });
  return `https://github.com/login/oauth/authorize?${p}`;
}

export async function githubExchange(code: string, redirectUri: string): Promise<ExternalProfile> {
  const env = getEnv();
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({
      client_id: env.GITHUB_CLIENT_ID,
      client_secret: env.GITHUB_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`GitHub token exchange: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token?: string; error?: string };
  if (!tokens.access_token) throw new Error(`GitHub token error: ${tokens.error ?? "unknown"}`);

  const userRes = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json" },
  });
  if (!userRes.ok) throw new Error(`GitHub user fetch: ${userRes.status}`);
  const u = (await userRes.json()) as {
    id: number; login: string; name?: string | null; email?: string | null; avatar_url?: string | null;
  };

  // Try to get primary email if not public
  let email = u.email ?? null;
  if (!email) {
    try {
      const emailRes = await fetch("https://api.github.com/user/emails", {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: "application/vnd.github+json" },
      });
      if (emailRes.ok) {
        const emails = (await emailRes.json()) as Array<{ email: string; primary: boolean; verified: boolean }>;
        email = emails.find((e) => e.primary && e.verified)?.email ?? emails[0]?.email ?? null;
      }
    } catch {
      // email stays null; not required
    }
  }

  return {
    provider: "github",
    providerId: String(u.id),
    username: u.name ?? u.login,
    email,
    avatarUrl: u.avatar_url ?? null,
  };
}

// ── Google ─────────────────────────────────────────────────────────

export function googleEnabled(): boolean {
  const env = getEnv();
  return !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export function googleAuthorizeUrl(state: string, redirectUri: string): string {
  const env = getEnv();
  const p = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid profile email",
    access_type: "online",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

export async function googleExchange(code: string, redirectUri: string): Promise<ExternalProfile> {
  const env = getEnv();
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });
  if (!tokenRes.ok) throw new Error(`Google token exchange: ${tokenRes.status}`);
  const tokens = (await tokenRes.json()) as { access_token: string };

  const userRes = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userRes.ok) throw new Error(`Google user fetch: ${userRes.status}`);
  const u = (await userRes.json()) as {
    sub: string; name?: string; email?: string | null; picture?: string | null;
  };

  return {
    provider: "google",
    providerId: u.sub,
    username: u.name ?? u.email ?? u.sub,
    email: u.email ?? null,
    avatarUrl: u.picture ?? null,
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
    case "github":  return githubExchange(code, redirectUri);
    case "google":  return googleExchange(code, redirectUri);
  }
}

export function authorizeUrlFor(
  provider: OAuthProvider,
  state: string,
  redirectUri: string,
): string {
  switch (provider) {
    case "discord": return discordAuthorizeUrl(state, redirectUri);
    case "github":  return githubAuthorizeUrl(state, redirectUri);
    case "google":  return googleAuthorizeUrl(state, redirectUri);
  }
}
