import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectPrisma, getPrisma } from "@rdoc-suite/db";
import { buildApp } from "../app.js";
import { resetEnvCache } from "../config/env.js";
import { saveGuildConfig } from "../services/guildConfig.js";

// Auth + validation coverage for the two voice M2M endpoints added for
// Fleetplanner raid-planer parity:
//   POST /internal/fleet/guilds/:guildId/discord/channels/reorder
//   POST /internal/fleet/guilds/:guildId/discord/strategy-channel
// The Discord-hitting success paths (200) are intentionally not exercised
// here — they require mocking the Discord REST API. These tests cover the
// guard rails that run before any Discord call: bearer auth, body
// validation, and the allowed-channel-list check.

const GUILD_ID = "888777666555444333";
const ALLOWED_A = "111111111111111111";
const ALLOWED_B = "222222222222222222";
const NOT_ALLOWED = "999999999999999999";
const FLEET_SECRET = "fleet-secret-this-is-at-least-32-chars-long!!";

const ENV = {
  BRIDGE_FLEET_SECRET: FLEET_SECRET,
  DISCORD_RDOCRTC_CLIENT_ID: "100000000000000000",
  DISCORD_CLIENT_SECRET: "test-secret",
  DISCORD_RDOCRTC_BOT_TOKEN: "test-bot-token",
  OAUTH_REDIRECT_URI: "http://localhost:8787/auth/callback",
};

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  for (const [k, v] of Object.entries(ENV)) process.env[k] = v;
  resetEnvCache();
  app = await buildApp();
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
});

afterAll(async () => {
  for (const k of Object.keys(ENV)) delete process.env[k];
  resetEnvCache();
  await app.close();
  await disconnectPrisma();
});

async function cleanup(): Promise<void> {
  await getPrisma().guildConfig.deleteMany({ where: { guildId: GUILD_ID } });
}
beforeEach(cleanup);
afterEach(cleanup);

function authed(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { authorization: `Bearer ${FLEET_SECRET}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

describe("POST /internal/fleet/guilds/:guildId/discord/channels/reorder", () => {
  const url = () => `${baseUrl}/internal/fleet/guilds/${GUILD_ID}/discord/channels/reorder`;

  it("rejects a wrong bearer secret with 401", async () => {
    const res = await fetch(url(), {
      method: "POST",
      headers: { authorization: "Bearer nope", "content-type": "application/json" },
      body: JSON.stringify({ ordered: [ALLOWED_A, ALLOWED_B] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects an ordered list shorter than 2 with 400", async () => {
    const res = await fetch(url(), authed({ ordered: [ALLOWED_A] }));
    expect(res.status).toBe(400);
  });

  it("rejects an order containing a channel outside the allowed list with 403", async () => {
    await saveGuildConfig(GUILD_ID, { allowedVoiceChannelIds: [ALLOWED_A, ALLOWED_B] });
    const res = await fetch(url(), authed({ ordered: [ALLOWED_A, NOT_ALLOWED] }));
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "channel_not_in_allowed_list" });
  });
});

describe("POST /internal/fleet/guilds/:guildId/discord/strategy-channel", () => {
  const url = () => `${baseUrl}/internal/fleet/guilds/${GUILD_ID}/discord/strategy-channel`;

  it("rejects a wrong bearer secret with 401", async () => {
    const res = await fetch(url(), {
      method: "POST",
      headers: { authorization: "Bearer nope", "content-type": "application/json" },
      body: JSON.stringify({ name: "Strat", userIds: [ALLOWED_A] }),
    });
    expect(res.status).toBe(401);
  });

  it("rejects a missing name with 400", async () => {
    const res = await fetch(url(), authed({ userIds: [ALLOWED_A] }));
    expect(res.status).toBe(400);
  });

  it("rejects an empty userIds list with 400", async () => {
    const res = await fetch(url(), authed({ name: "Strat", userIds: [] }));
    expect(res.status).toBe(400);
  });
});
