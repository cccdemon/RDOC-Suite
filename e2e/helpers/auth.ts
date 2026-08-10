import { type Browser, type BrowserContext, request } from "@playwright/test";
import { APP, BASE, HOSTNAME, SECURE_COOKIES } from "./env.js";

const SECRET = process.env.E2E_TEST_LOGIN_SECRET as string;

export type InstanceRole = "crew" | "fleetoperator" | "superadmin";
export type GuildRole = "crew" | "fleetoperator";

export interface TestActor {
  username: string;
  userId: string;
  guildId: string;
  csrfToken: string;
  sid: string;
  /** Synthetic Discord snowflake, when one was requested at login. */
  discordId: string | null;
}

/** Options beyond the positional role arguments (kept for the existing specs). */
export interface LoginOptions {
  guildId?: string;
  /** Attach a synthetic Discord identity (must match /^3\d{17}$/). Needed for
   *  every Discord-side flow: DMs, interaction buttons, interest resolution. */
  discordId?: string;
}

/** Mint a session for a synthetic e2e-* test player via the env-gated seam.
 * Pass `guildId` to target the secondary synthetic guild (cross-guild flows). */
export async function login(
  username: string,
  role: InstanceRole = "crew",
  guildRole: GuildRole = "crew",
  guildIdOrOptions?: string | LoginOptions,
): Promise<TestActor> {
  const options: LoginOptions =
    typeof guildIdOrOptions === "string" ? { guildId: guildIdOrOptions } : (guildIdOrOptions ?? {});
  const { guildId, discordId } = options;
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post(`${APP}/e2e/login`, {
    headers: { "x-e2e-secret": SECRET, "content-type": "application/json" },
    data: { username, role, guildRole, ...(guildId ? { guildId } : {}), ...(discordId ? { discordId } : {}) },
  });
  if (!res.ok()) throw new Error(`e2e login failed for ${username}: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { userId: string; guildId: string; csrfToken: string; discordId: string | null };
  const state = await ctx.storageState();
  const sid = state.cookies.find((c) => c.name === "fp_sid")?.value ?? "";
  await ctx.dispose();
  if (!sid) throw new Error(`e2e login for ${username} returned no fp_sid cookie`);
  return {
    username,
    userId: body.userId,
    guildId: body.guildId,
    csrfToken: body.csrfToken,
    discordId: body.discordId ?? null,
    sid,
  };
}

/** A browser context already carrying the actor's session cookie. */
export async function actorContext(browser: Browser, actor: TestActor): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: `${APP}/`, ignoreHTTPSErrors: true });
  await context.addCookies([
    { name: "fp_sid", value: actor.sid, domain: HOSTNAME, path: "/", httpOnly: true, secure: SECURE_COOKIES, sameSite: "Lax" },
  ]);
  return context;
}

/** Delete all operations in the synthetic E2E guild (post-run cleanup). */
export async function cleanup(): Promise<number> {
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post(`${APP}/e2e/cleanup`, { headers: { "x-e2e-secret": SECRET } });
  const body = res.ok() ? ((await res.json()) as { deletedOperations: number }) : { deletedOperations: 0 };
  await ctx.dispose();
  return body.deletedOperations;
}

/**
 * Seed the small deterministic ship catalog the local stack ships with. The real
 * catalog comes from the SC-wiki sync (internet + minutes), so specs that pick a
 * ship call this instead of hoping the catalog is warm.
 */
export async function seedShips(): Promise<number> {
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post(`${APP}/e2e/seed-ships`, { headers: { "x-e2e-secret": SECRET } });
  const body = res.ok() ? ((await res.json()) as { ships: number }) : { ships: 0 };
  await ctx.dispose();
  return body.ships;
}

/** Raw API base for direct JSON calls (mirrors what the SPA client uses). */
export const API = `${APP}/api/v1`;
export const SPA = APP;
export { APP, BASE } from "./env.js";

/** Synthetic guild ids the seam mints into (primary + secondary for cross-guild). */
export const E2E_GUILD_ID = "100000000000000001";
export const E2E_GUILD_ID_2 = "100000000000000002";
