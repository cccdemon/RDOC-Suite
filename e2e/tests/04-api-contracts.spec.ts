import { test, expect, request, type BrowserContext } from "@playwright/test";
import { API, actorContext, login, type TestActor } from "../helpers/auth.js";

test.describe.configure({ mode: "serial" });

let actor: TestActor;
let ctx: BrowserContext;

function expectJson(res: { headers(): Record<string, string> }) {
  expect(res.headers()["content-type"]).toMatch(/application\/json/);
}

test.beforeAll(async ({ browser }) => {
  actor = await login("e2e-api", "crew", "crew");
  ctx = await actorContext(browser, actor);
});

test.afterAll(async () => {
  await ctx?.close();
});

test("public JSON endpoints return stable envelopes", async () => {
  const anon = await request.newContext({ ignoreHTTPSErrors: true });

  const health = await anon.get(`${API}/health`);
  await expect(health).toBeOK();
  expectJson(health);
  expect(await health.json()).toMatchObject({ status: "ok", service: "fleetplanner-api" });

  const spec = await anon.get(`${API}/openapi.json`);
  await expect(spec).toBeOK();
  const openapi = await spec.json();
  expect(openapi.openapi).toMatch(/^3\./);
  expect(openapi.paths["/api/v1/operations"]).toBeTruthy();

  const session = await anon.get(`${API}/session`);
  await expect(session).toBeOK();
  expect(await session.json()).toMatchObject({ user: null, memberships: [] });

  const ops = await anon.get(`${API}/operations?past=true`);
  await expect(ops).toBeOK();
  expect(Array.isArray((await ops.json()).operations)).toBeTruthy();

  await anon.dispose();
});

test("protected endpoints reject anonymous callers with JSON 401", async () => {
  const anon = await request.newContext({ ignoreHTTPSErrors: true });
  for (const url of [`${API}/guilds`, `${API}/account`, `${API}/hangar`, `${API}/locations/search?q=HUR`]) {
    const res = await anon.get(url);
    expect(res.status(), url).toBe(401);
    expectJson(res);
    const body = await res.json();
    expect(body.error.code).toBe("unauthenticated");
    expect(body.error.requestId).toBeTruthy();
  }
  await anon.dispose();
});

test("authenticated API reads session, guilds, account and hangar", async () => {
  const session = await ctx.request.get(`${API}/session`);
  await expect(session).toBeOK();
  const sessionBody = await session.json();
  expect(sessionBody.user.username).toBe("e2e-api");
  expect(sessionBody.csrfToken).toBe(actor.csrfToken);
  expect(sessionBody.memberships.some((m: { guildId: string }) => m.guildId === actor.guildId)).toBeTruthy();

  const guilds = await ctx.request.get(`${API}/guilds`);
  await expect(guilds).toBeOK();
  expect((await guilds.json()).guilds.length).toBeGreaterThanOrEqual(1);

  const account = await ctx.request.get(`${API}/account`);
  await expect(account).toBeOK();
  expect((await account.json()).identities.some((i: { provider: string }) => i.provider === "e2e")).toBeTruthy();

  const hangar = await ctx.request.get(`${API}/hangar`);
  await expect(hangar).toBeOK();
  expect(Array.isArray((await hangar.json()).ships)).toBeTruthy();
});

test("mutations require CSRF even with a valid session", async () => {
  const res = await ctx.request.post(`${API}/feedback`, {
    data: { subject: "E2E no csrf", message: "Should be rejected before Discord side effects." },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error.code).toBe("forbidden");
});
