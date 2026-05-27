import { getEnv } from "../config/env.js";

const DISCORD_API = "https://discord.com/api/v10";
const states = new Map<string, number>(); // state → expires timestamp

export function redirectUri(): string {
  const env = getEnv();
  return `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/auth/callback`;
}

export function issueState(): string {
  const state = crypto.randomUUID();
  states.set(state, Date.now() + 5 * 60 * 1000);
  if (states.size > 200) {
    const now = Date.now();
    for (const [k, exp] of states) if (exp < now) states.delete(k);
  }
  return state;
}

export function consumeState(state: string): boolean {
  const exp = states.get(state);
  if (!exp || exp < Date.now()) return false;
  states.delete(state);
  return true;
}

export function buildAuthorizeUrl(state: string): string {
  const env = getEnv();
  const p = new URLSearchParams({
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: "identify",
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${p}`;
}

export type DiscordTokenResponse = { access_token: string; token_type: string };
export type DiscordUser = { id: string; username: string; discriminator?: string; avatar: string | null; global_name?: string | null };

export async function exchangeCode(code: string): Promise<DiscordTokenResponse> {
  const env = getEnv();
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed: ${res.status}`);
  return res.json() as Promise<DiscordTokenResponse>;
}

export async function fetchDiscordUser(accessToken: string): Promise<DiscordUser> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed: ${res.status}`);
  return res.json() as Promise<DiscordUser>;
}

export function displayName(u: DiscordUser): string {
  return u.global_name ?? u.username;
}

export function avatarUrl(u: DiscordUser): string | null {
  if (!u.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.webp?size=64`;
}
