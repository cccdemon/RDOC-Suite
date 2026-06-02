import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectPrisma, getPrisma } from "@rdoc-suite/db";
import { buildApp } from "../app.js";
import { issueSessionToken } from "../auth/sessionToken.js";
import { resetEnvCache } from "../config/env.js";
import { setRelayBotsConfig } from "../services/relayBotsConfig.js";

const SECRET = process.env.SESSION_SECRET ?? "";
const GUILD_ID = "777666555444333222";
const USER_ID = "111122223333444455";
const RELAY_SECRET = "relay-service-secret-min-16-chars-long";

let app: FastifyInstance;
let token: string;

beforeAll(async () => {
  app = await buildApp();
  token = await issueSessionToken(SECRET, { sub: USER_ID });
});

afterAll(async () => {
  await app.close();
  await disconnectPrisma();
});

afterEach(async () => {
  delete process.env.RELAY_BOTS_SECRET;
  resetEnvCache();
  await getPrisma().relayBotsConfig.deleteMany({ where: { guildId: GUILD_ID } });
});

async function getCapabilities(): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await app.inject({
    method: "GET",
    url: `/suite/capabilities?guildId=${GUILD_ID}`,
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

describe("GET /suite/capabilities relay capability", () => {
  it("does not expose Bridge Relay through suite capabilities when no mission is active", async () => {
    const { status, body } = await getCapabilities();

    expect(status).toBe(200);
    expect(body.canUseRelay).toBe(false);
  });

  it("keeps canUseRelay false even when legacy bridge relay config exists", async () => {
    process.env.RELAY_BOTS_SECRET = RELAY_SECRET;
    resetEnvCache();
    await setRelayBotsConfig(
      GUILD_ID,
      {
        livekitUrl: "ws://localhost:7880",
        livekitApiKey: "devkey",
        livekitApiSecret: "secret-secret-secret-secret-secret-1234",
        roomName: "voice-relay",
        guildId: GUILD_ID,
        bots: [{ name: "Relay 1", token: "bot-token", channelId: "123456789012345678" }],
      },
      USER_ID,
    );

    const { status, body } = await getCapabilities();

    expect(status).toBe(200);
    expect(body.canUseRelay).toBe(false);
  });
});
