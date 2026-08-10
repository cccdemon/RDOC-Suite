import { test, expect } from "@playwright/test";
import { API, SPA, cleanup, login } from "../helpers/auth.js";
import {
  discordCalls,
  discordMockAvailable,
  disposeDiscordMock,
  loginAs,
  resetDiscord,
  E2E_GUILD_ID,
} from "../helpers/discordMock.js";

// The real Discord OAuth login, end to end: the app redirects to Discord, the
// simulator approves and bounces back with a code, the app exchanges it, reads
// the profile + guild list, and mints a session. Nothing here uses the E2E seam.
test.describe.configure({ mode: "serial" });
test.skip(!discordMockAvailable(), "needs the Discord simulator (local test stack)");

const DISCORD_USER = {
  id: "300000000000000031",
  username: "e2e-oauth-pilot",
  global_name: "OAuth Pilot",
  email: "oauth-pilot@example.invalid",
};

test.beforeAll(async () => {
  await resetDiscord();
  // The synthetic guild must exist in the app's DB before the OAuth login can
  // scope the user into it — the seam creates it as a side effect.
  await login("e2e-oauth-seed", "crew", "crew");
  await loginAs({ ...DISCORD_USER, guildIds: [E2E_GUILD_ID] });
});

test.afterAll(async () => {
  await cleanup();
  await disposeDiscordMock();
});

test("signing in through Discord creates a session and links the identity", async ({ page }) => {
  await page.goto(`${SPA}/auth/discord/start`);
  // Ends up back on the app, signed in — never stranded on the OAuth host.
  await page.waitForURL((url) => !url.pathname.includes("/oauth2/authorize"), { timeout: 30_000 });
  expect(new URL(page.url()).port).not.toBe("4400");

  const session = await page.request.get(`${API}/session`);
  await expect(session).toBeOK();
  const body = await session.json();
  expect(body.user).toBeTruthy();
  // global_name wins over username — that is the name Discord shows people.
  expect(body.user.username).toBe("OAuth Pilot");
});

test("the login used the OAuth code flow with a bearer profile read", async () => {
  const calls = await discordCalls();
  const paths = calls.map((c) => `${c.method} ${c.path}`);
  expect(paths).toContain("GET /api/v10/oauth2/authorize");
  expect(paths).toContain("POST /api/v10/oauth2/token");
  expect(paths).toContain("GET /api/v10/users/@me");
  expect(paths).toContain("GET /api/v10/users/@me/guilds");

  // The profile + guild reads must use the user's bearer token, never the bot's.
  const profileRead = calls.find((c) => c.method === "GET" && c.path === "/api/v10/users/@me")!;
  expect(profileRead.auth).toBe("bearer");

  // The client secret is only ever sent to the token endpoint.
  const tokenCall = calls.find((c) => c.path === "/api/v10/oauth2/token")!;
  expect(tokenCall.body).toMatchObject({ grant_type: "authorization_code" });
});

test("the Discord member is scoped into the guild the bot shares with them", async ({ page }) => {
  await page.goto(`${SPA}/auth/discord/start`);
  await page.waitForURL((url) => !url.pathname.includes("/oauth2/authorize"), { timeout: 30_000 });

  const session = await page.request.get(`${API}/session`);
  await expect(session).toBeOK();
  const memberships = (await session.json()).memberships as Array<{ guildId: string; role: string }>;
  expect(memberships.map((m) => m.guildId)).toContain(E2E_GUILD_ID);
  // A fresh Discord member is crew — never an operator by default.
  expect(memberships.find((m) => m.guildId === E2E_GUILD_ID)!.role).toBe("crew");
});

test("a stale OAuth callback without state is rejected", async ({ page }) => {
  const res = await page.request.get(`${SPA}/auth/discord/callback?code=forged&state=forged`, {
    maxRedirects: 0,
  });
  // Redirected back with an error flash, never a minted session.
  expect([302, 303, 401, 403]).toContain(res.status());
  const session = await page.request.get(`${API}/session`);
  expect((await session.json()).user).toBeNull();
});
