import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../app.js";
import { issueSessionToken } from "../auth/sessionToken.js";
import { resetEnvCache } from "../config/env.js";

const SECRET = process.env.SESSION_SECRET ?? "";
const USER_ID = "111122223333444455";
const RELAY_SECRET = "relay-service-secret-min-16-chars-long";

let app: FastifyInstance;
let httpUrl: string;

beforeAll(async () => {
  app = await buildApp();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  httpUrl = address;
});

afterAll(async () => {
  await app.close();
});

afterEach(() => {
  delete process.env.RELAY_BOTS_SECRET;
  delete process.env.RELAY_REQUIRED_ROLE_ID;
  resetEnvCache();
});

function setRelaySecret(): void {
  process.env.RELAY_BOTS_SECRET = RELAY_SECRET;
  resetEnvCache();
}

describe("GET /relay/token", () => {
  it("401 when no bearer at all", async () => {
    const res = await fetch(`${httpUrl}/relay/token`);
    expect(res.status).toBe(401);
  });

  it("subscriber role: 503 when RELAY_BOTS_SECRET is unset", async () => {
    const res = await fetch(`${httpUrl}/relay/token?role=subscriber`, {
      headers: { authorization: "Bearer anything" },
    });
    expect(res.status).toBe(503);
  });

  it("subscriber role: 401 when the bearer is not the service secret", async () => {
    setRelaySecret();
    // A perfectly valid companion JWT must NOT unlock a subscriber token.
    const jwt = await issueSessionToken(SECRET, { sub: USER_ID });
    const res = await fetch(`${httpUrl}/relay/token?role=subscriber`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(401);
  });

  it("subscriber role: 200 + token when the service secret matches", async () => {
    setRelaySecret();
    const res = await fetch(`${httpUrl}/relay/token?role=subscriber`, {
      headers: { authorization: `Bearer ${RELAY_SECRET}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string; url?: string };
    expect(body.token).toBeTruthy();
    expect(body.url).toMatch(/^ws/);
  });

  it("publisher role: 200 with a valid companion JWT (no role gate configured)", async () => {
    const jwt = await issueSessionToken(SECRET, { sub: USER_ID });
    const res = await fetch(`${httpUrl}/relay/token`, {
      headers: { authorization: `Bearer ${jwt}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token?: string };
    expect(body.token).toBeTruthy();
  });

  it("publisher role: 401 with an invalid JWT", async () => {
    const res = await fetch(`${httpUrl}/relay/token`, {
      headers: { authorization: "Bearer not.a.jwt" },
    });
    expect(res.status).toBe(401);
  });
});
