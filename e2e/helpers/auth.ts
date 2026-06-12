import { type Browser, type BrowserContext, request } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://suite.raumdock.org";
const SECRET = process.env.E2E_TEST_LOGIN_SECRET as string;
const HOST = new URL(BASE).hostname;

export type InstanceRole = "crew" | "fleetoperator" | "superadmin";
export type GuildRole = "crew" | "fleetoperator";

export interface TestActor {
  username: string;
  userId: string;
  guildId: string;
  csrfToken: string;
  sid: string;
}

/** Mint a session for a synthetic e2e-* test player via the env-gated seam. */
export async function login(username: string, role: InstanceRole = "crew", guildRole: GuildRole = "crew"): Promise<TestActor> {
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post("/fleetplanner/e2e/login", {
    headers: { "x-e2e-secret": SECRET, "content-type": "application/json" },
    data: { username, role, guildRole },
  });
  if (!res.ok()) throw new Error(`e2e login failed for ${username}: ${res.status()} ${await res.text()}`);
  const body = (await res.json()) as { userId: string; guildId: string; csrfToken: string };
  const state = await ctx.storageState();
  const sid = state.cookies.find((c) => c.name === "fp_sid")?.value ?? "";
  await ctx.dispose();
  if (!sid) throw new Error(`e2e login for ${username} returned no fp_sid cookie`);
  return { username, userId: body.userId, guildId: body.guildId, csrfToken: body.csrfToken, sid };
}

/** A browser context already carrying the actor's session cookie. */
export async function actorContext(browser: Browser, actor: TestActor): Promise<BrowserContext> {
  const context = await browser.newContext({ baseURL: `${BASE}/fleetplanner-next/`, ignoreHTTPSErrors: true });
  await context.addCookies([
    { name: "fp_sid", value: actor.sid, domain: HOST, path: "/", httpOnly: true, secure: true, sameSite: "Lax" },
  ]);
  return context;
}

/** Delete all operations in the synthetic E2E guild (post-run cleanup). */
export async function cleanup(): Promise<number> {
  const ctx = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true });
  const res = await ctx.post("/fleetplanner/e2e/cleanup", { headers: { "x-e2e-secret": SECRET } });
  const body = res.ok() ? ((await res.json()) as { deletedOperations: number }) : { deletedOperations: 0 };
  await ctx.dispose();
  return body.deletedOperations;
}

/** Raw API base for direct JSON calls (mirrors what the SPA client uses). */
export const API = `${BASE}/fleetplanner/api/v1`;
export const SPA = `${BASE}/fleetplanner-next`;
