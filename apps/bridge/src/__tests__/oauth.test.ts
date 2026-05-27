import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { resetEnvCache } from "../config/env.js";

const OAUTH_ENV = {
  DISCORD_CLIENT_ID: "100000000000000000",
  DISCORD_CLIENT_SECRET: "test-client-secret",
  DISCORD_BOT_TOKEN: "test-bot-token",
  OAUTH_REDIRECT_URI: "http://localhost:8787/auth/callback",
  COMPANION_REDIRECT_URI: "dccc://auth",
};

const GUILD_ID = "123456789012345678";
const USER_ID = "111122223333444455";
const COMMANDER_ROLE_ID = "200000000000000000";
const OTHER_ROLE_ID = "300000000000000000";

let app: FastifyInstance;

beforeAll(async () => {
  for (const [k, v] of Object.entries(OAUTH_ENV)) {
    process.env[k] = v;
  }
  resetEnvCache();
  app = await buildApp();
  await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  for (const k of Object.keys(OAUTH_ENV)) {
    delete process.env[k];
  }
  resetEnvCache();
  await app.close();
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Mock fetch with a queue of responses. Each call returns the next one. */
function mockFetchSequence(responses: Array<Partial<Response> & { json?: () => unknown }>): void {
  let i = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => {
      const r = responses[i++];
      if (!r) throw new Error(`unexpected fetch call #${i}`);
      return {
        ok: r.ok ?? true,
        status: r.status ?? 200,
        text: async () => "",
        json: async () => (r.json ? r.json() : {}),
      } as Response;
    }),
  );
}

describe("GET /auth/start", () => {
  it("redirects to discord with correct params", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    expect(res.statusCode).toBe(302);
    const location = res.headers.location as string;
    expect(location.startsWith("https://discord.com/oauth2/authorize")).toBe(true);
    expect(location).toContain(`client_id=${OAUTH_ENV.DISCORD_CLIENT_ID}`);
    expect(location).toContain("scope=identify+guilds.members.read");
    expect(location).toContain("state=");
    expect(res.cookies.find((c) => c.name === "dccc_oauth_state")).toBeDefined();
  });

  it("rejects bad guildId", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=not-a-snowflake`,
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("GET /auth/callback", () => {
  it("rejects when state cookie is missing", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=xyz`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("missing_state_cookie");
  });

  it("rejects when state in cookie doesn't match state in query", async () => {
    // Start flow to get a cookie
    const startRes = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    const stateCookie = startRes.cookies.find((c) => c.name === "dccc_oauth_state");
    expect(stateCookie).toBeDefined();

    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=wrong-state`,
      cookies: { dccc_oauth_state: stateCookie!.value },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("state_mismatch");
  });
});

import { getPrisma } from "@dccc/db";

async function seedGuildConfig(opts: { enabled: boolean; roleIds: string[] }): Promise<void> {
  await getPrisma().guildConfig.upsert({
    where: { guildId: GUILD_ID },
    create: {
      guildId: GUILD_ID,
      enabled: opts.enabled,
      commanderRoleIds: JSON.stringify(opts.roleIds),
      allowedVoiceChannelIds: "[]",
      bridgeMode: "external_voice",
    },
    update: {
      enabled: opts.enabled,
      commanderRoleIds: JSON.stringify(opts.roleIds),
    },
  });
}

async function clearGuildConfig(): Promise<void> {
  await getPrisma().guildConfig.deleteMany({ where: { guildId: GUILD_ID } });
}

describe("GET /auth/callback (full flow with mocked Discord API)", () => {
  it("issues a session token on success and redirects to companion", async () => {
    await seedGuildConfig({ enabled: true, roleIds: [COMMANDER_ROLE_ID] });
    mockFetchSequence([
      // token exchange
      {
        json: () => ({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify guilds.members.read",
        }),
      },
      // /users/@me
      { json: () => ({ id: USER_ID, username: "tester" }) },
      // /guilds/.../members/...
      { json: () => ({ roles: [COMMANDER_ROLE_ID, OTHER_ROLE_ID] }) },
    ]);

    const startRes = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    const stateCookie = startRes.cookies.find((c) => c.name === "dccc_oauth_state")!;
    const location = startRes.headers.location as string;
    const state = new URL(location).searchParams.get("state")!;

    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=${state}`,
      cookies: { dccc_oauth_state: stateCookie.value },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/html/);
    // The success page contains both the dccc:// deep link and a
    // base64-encoded sign-in code; either path delivers a valid token.
    expect(res.payload).toMatch(/dccc:\/\/auth\?token=[^&]+&guildId=123456789012345678/);

    await clearGuildConfig();
  });

  it("returns 403 if guild is disabled", async () => {
    await seedGuildConfig({ enabled: false, roleIds: [COMMANDER_ROLE_ID] });
    mockFetchSequence([
      {
        json: () => ({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify",
        }),
      },
      { json: () => ({ id: USER_ID, username: "tester" }) },
    ]);

    const startRes = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    const stateCookie = startRes.cookies.find((c) => c.name === "dccc_oauth_state")!;
    const state = new URL(startRes.headers.location as string).searchParams.get("state")!;

    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=${state}`,
      cookies: { dccc_oauth_state: stateCookie.value },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("guild_not_enabled");

    await clearGuildConfig();
  });

  it("returns 403 if user lacks the commander role", async () => {
    await seedGuildConfig({ enabled: true, roleIds: [COMMANDER_ROLE_ID] });
    mockFetchSequence([
      {
        json: () => ({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify",
        }),
      },
      { json: () => ({ id: USER_ID, username: "tester" }) },
      { json: () => ({ roles: [OTHER_ROLE_ID] }) },
    ]);

    const startRes = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    const stateCookie = startRes.cookies.find((c) => c.name === "dccc_oauth_state")!;
    const state = new URL(startRes.headers.location as string).searchParams.get("state")!;

    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=${state}`,
      cookies: { dccc_oauth_state: stateCookie.value },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("missing_commander_role");

    await clearGuildConfig();
  });

  it("returns 403 if user is not a guild member at all", async () => {
    await seedGuildConfig({ enabled: true, roleIds: [COMMANDER_ROLE_ID] });
    mockFetchSequence([
      {
        json: () => ({
          access_token: "fake-access-token",
          token_type: "Bearer",
          expires_in: 3600,
          scope: "identify",
        }),
      },
      { json: () => ({ id: USER_ID, username: "tester" }) },
      // Discord returns 404 → fetchGuildMember returns null
      { ok: false, status: 404 },
    ]);

    const startRes = await app.inject({
      method: "GET",
      url: `/auth/start?guildId=${GUILD_ID}`,
    });
    const stateCookie = startRes.cookies.find((c) => c.name === "dccc_oauth_state")!;
    const state = new URL(startRes.headers.location as string).searchParams.get("state")!;

    const res = await app.inject({
      method: "GET",
      url: `/auth/callback?code=abc&state=${state}`,
      cookies: { dccc_oauth_state: stateCookie.value },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().error).toBe("not_a_member");

    await clearGuildConfig();
  });
});
