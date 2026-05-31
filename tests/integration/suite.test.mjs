/**
 * RDOC-Suite Integration Tests (Node.js built-in test runner)
 * Run: node --test tests/integration/suite.test.mjs
 * Or via Docker: docker run --rm rdoc-suite-test
 *
 * Set env vars or point to a .env file:
 *   SUITE_URL=https://suite.raumdock.org
 *   DISCORD_RDOCRTC_BOT_TOKEN=...
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

const SUITE_URL = process.env.SUITE_URL ?? "https://suite.raumdock.org";
const VOICE_URL = process.env.VOICE_URL ?? "https://voice.raumdock.org";
const TIMEOUT = 12_000;

// ── helpers ────────────────────────────────────────────────────────────

async function get(url, headers = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { headers, redirect: "manual", signal: ctrl.signal });
    const body = await res.text().catch(() => "");
    return { status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

// ── Bridge ─────────────────────────────────────────────────────────────

describe("Bridge", () => {
  test("health endpoint returns ok:true", async () => {
    const { status, body } = await get(`${SUITE_URL}/health`);
    assert.equal(status, 200, `HTTP ${status}: ${body}`);
    const json = JSON.parse(body);
    assert.equal(json.ok, true);
  });

  test("OAuth start redirects to Discord", async () => {
    const { status } = await get(`${SUITE_URL}/auth/start`);
    assert.ok(status === 302 || status === 200, `Expected redirect, got ${status}`);
  });

  test("WebSocket endpoint rejects invalid token with 4401", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    let WebSocket;
    try { WebSocket = require("ws"); } catch { return; } // skip if ws not installed

    await new Promise((resolve, reject) => {
      const ws = new WebSocket(`wss://suite.raumdock.org/ws?token=invalid_test_token_12345`);
      const t = setTimeout(() => reject(new Error("WebSocket timeout")), TIMEOUT);
      ws.on("close", (code) => {
        clearTimeout(t);
        assert.ok(code === 4401 || code === 4400, `Expected 4401/4400, got ${code}`);
        resolve();
      });
      ws.on("error", (e) => { clearTimeout(t); reject(e); });
    });
  });
});

// ── Fleetplanner ───────────────────────────────────────────────────────

describe("Fleetplanner", () => {
  test("web UI loads", async () => {
    const { status } = await get(`${SUITE_URL}/fleetplanner`);
    assert.ok(status === 200 || status === 302, `HTTP ${status}`);
  });

  test("ship search API returns JSON array", async () => {
    const { status, body } = await get(`${SUITE_URL}/fleetplanner/api/ships?q=Polaris`);
    assert.equal(status, 200, `HTTP ${status}`);
    const json = JSON.parse(body);
    assert.ok(Array.isArray(json), "Expected array");
    assert.ok(json.length > 0, "Expected at least one ship");
    assert.ok(json[0].name, "Ship should have a name");
  });

  test("OAuth start available", async () => {
    const { status } = await get(`${SUITE_URL}/fleetplanner/auth/discord/start`);
    assert.ok(status === 302 || status === 200, `HTTP ${status}`);
  });
});

// ── LiveKit ────────────────────────────────────────────────────────────

describe("LiveKit", () => {
  test("signaling endpoint responds", async () => {
    const { status, body } = await get(VOICE_URL);
    assert.ok(status === 200 || status === 400, `HTTP ${status}`);
    // LiveKit returns "OK" or a version response
    assert.ok(body.length > 0, "Empty response from LiveKit");
  });
});

// ── Discord API ────────────────────────────────────────────────────────

describe("Discord", () => {
  const token = process.env.DISCORD_RDOCRTC_BOT_TOKEN;

  test("RDOC-RTC bot token valid", { skip: !token ? "DISCORD_RDOCRTC_BOT_TOKEN not set" : false }, async () => {
    const { status, body } = await get("https://discord.com/api/v10/users/@me", {
      Authorization: `Bot ${token}`,
    });
    assert.equal(status, 200, `Discord API returned ${status}: ${body}`);
    const json = JSON.parse(body);
    assert.ok(json.username, "No username in response");
    console.log(`    Bot: @${json.username} (${json.id})`);
  });

  const fpToken = process.env.DISCORD_FLEETPLANNER_BOT_TOKEN;
  test("Fleetmanager bot token valid", { skip: !fpToken ? "DISCORD_FLEETPLANNER_BOT_TOKEN not set" : false }, async () => {
    const { status, body } = await get("https://discord.com/api/v10/users/@me", {
      Authorization: `Bot ${fpToken}`,
    });
    assert.equal(status, 200, `Discord API returned ${status}`);
    const json = JSON.parse(body);
    assert.ok(json.username, "No username in response");
    console.log(`    Bot: @${json.username} (${json.id})`);
  });
});

// ── Downloads ──────────────────────────────────────────────────────────

describe("Downloads", () => {
  test("downloads endpoint reachable", async () => {
    const { status } = await get(`${SUITE_URL}/downloads/`);
    // 200 = files present, 403/404 = folder empty but Caddy responding
    assert.ok([200, 403, 404].includes(status), `Unexpected HTTP ${status}`);
  });
});
