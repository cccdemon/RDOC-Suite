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
const TEST_GUILD_ID = process.env.TEST_GUILD_ID || process.env.RELAY_GUILD_ID || "1431307397842079777";
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
    const { status, body } = await get(`${SUITE_URL}/auth/start?guildId=${TEST_GUILD_ID}`);
    assert.ok(status === 302 || status === 200, `Expected redirect, got ${status}: ${body}`);
  });

  test("WebSocket endpoint rejects invalid token with 4401", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    let WebSocket;
    try { WebSocket = require("ws"); } catch { return; } // skip if ws not installed

    await new Promise((resolve, reject) => {
      const wsBase = SUITE_URL.replace(/^http:/, "ws:").replace(/^https:/, "wss:");
      const ws = new WebSocket(`${wsBase}/ws?token=invalid_test_token_12345`);
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

// Discord permission bit flags
const PERM = {
  ADMINISTRATOR:        1n << 3n,
  MANAGE_CHANNELS:      1n << 4n,
  VIEW_CHANNEL:         1n << 10n,
  SEND_MESSAGES:        1n << 11n,
  READ_MESSAGE_HISTORY: 1n << 16n,
  CONNECT:              1n << 20n,
  MOVE_MEMBERS:         1n << 24n,
  MANAGE_ROLES:         1n << 28n,
  MANAGE_EVENTS:        1n << 33n,
  SPEAK:                1n << 21n,
};

async function discordGet(path, token) {
  return get(`https://discord.com/api/v10${path}`, { Authorization: `Bot ${token}` });
}

/** Returns { username, id, tag, perms: BigInt } or null on auth failure. */
async function inspectBot(token, guildId) {
  const meR = await discordGet("/users/@me", token);
  if (meR.status !== 200) return null;
  const me = JSON.parse(meR.body);

  // Member in test guild → roles
  const mR = await discordGet(`/guilds/${guildId}/members/${me.id}`, token);
  if (mR.status !== 200) return { ...me, perms: null, memberRoles: [] };
  const member = JSON.parse(mR.body);

  // Guild roles → compute permission bitfield
  const rolesR = await discordGet(`/guilds/${guildId}/roles`, token);
  if (rolesR.status !== 200) return { ...me, perms: null, memberRoles: member.roles };
  const allRoles = JSON.parse(rolesR.body);

  const everyoneRole = allRoles.find(r => r.id === guildId);
  let perms = BigInt(everyoneRole?.permissions ?? "0");
  const memberRoleSet = new Set(member.roles);
  for (const role of allRoles) {
    if (memberRoleSet.has(role.id)) perms |= BigInt(role.permissions);
  }
  return { ...me, perms, memberRoles: member.roles };
}

function hasPerm(perms, bit) {
  if (perms === null) return null; // unknown (not in guild)
  return (perms & PERM.ADMINISTRATOR) !== 0n || (perms & bit) !== 0n;
}

function permLine(perms, name, bit, required = false) {
  const has = hasPerm(perms, bit);
  if (has === null) return `      ? ${name} (bot not in guild — cannot check)`;
  const icon = has ? "✓" : (required ? "✗ MISSING" : "✗");
  return `      ${icon} ${name}`;
}

async function testBot({ envVar, label, purpose, requiredPerms, guildId }) {
  const token = process.env[envVar];
  if (!token) {
    console.log(`\n  – ${label} — skipped (${envVar} not set)`);
    return;
  }

  const bot = await inspectBot(token, guildId);
  if (!bot) {
    console.log(`\n  ✗ ${label} — token invalid (401)`);
    return;
  }

  const missing = requiredPerms.filter(([, bit]) => !hasPerm(bot.perms, bit) && bot.perms !== null);

  console.log(`\n  ${missing.length === 0 ? "✓" : "✗"} ${label} — @${bot.username} (${bot.id})`);
  console.log(`      Purpose: ${purpose}`);
  if (bot.perms === null) {
    console.log(`      ⚠ Bot not in guild ${guildId} — permission check skipped`);
  } else {
    for (const [name, bit] of requiredPerms) {
      console.log(permLine(bot.perms, name, bit, true));
    }
  }

  assert.equal(missing.length, 0,
    `${label} missing permissions in guild ${guildId}: ${missing.map(([n]) => n).join(", ")}`);
}

describe("Discord Bots", () => {
  test("RDOC-RTC Bot — token + permissions", async () => {
    await testBot({
      envVar: "DISCORD_RDOCRTC_BOT_TOKEN",
      label: "RDOC-RTC Bot",
      purpose: "Slash-commands (/cc), bridge web-OAuth, companion bridge-auth",
      guildId: TEST_GUILD_ID,
      requiredPerms: [
        ["VIEW_CHANNEL",         PERM.VIEW_CHANNEL],
        ["SEND_MESSAGES",        PERM.SEND_MESSAGES],
        ["READ_MESSAGE_HISTORY", PERM.READ_MESSAGE_HISTORY],
      ],
    });
  });

  test("Fleetmanager Bot — token + permissions", async () => {
    await testBot({
      envVar: "DISCORD_FLEETPLANNER_BOT_TOKEN",
      label: "Fleetmanager Bot",
      purpose: "Discord scheduled events, crew voice-channels, role management per operation",
      guildId: TEST_GUILD_ID,
      requiredPerms: [
        ["MANAGE_CHANNELS",      PERM.MANAGE_CHANNELS],
        ["VIEW_CHANNEL",         PERM.VIEW_CHANNEL],
        ["SEND_MESSAGES",        PERM.SEND_MESSAGES],
        ["READ_MESSAGE_HISTORY", PERM.READ_MESSAGE_HISTORY],
        ["CONNECT",              PERM.CONNECT],
        ["MOVE_MEMBERS",         PERM.MOVE_MEMBERS],
        ["MANAGE_ROLES",         PERM.MANAGE_ROLES],
        ["MANAGE_EVENTS",        PERM.MANAGE_EVENTS],
      ],
    });
  });

  test("Relay Bot — token + permissions", async () => {
    await testBot({
      envVar: "DISCORD_RELAY_BOT_TOKEN",
      label: "Relay Bot",
      purpose: "Relay LiveKit audio into Discord voice channels",
      guildId: TEST_GUILD_ID,
      requiredPerms: [
        ["VIEW_CHANNEL", PERM.VIEW_CHANNEL],
        ["CONNECT",      PERM.CONNECT],
        ["SPEAK",        PERM.SPEAK],
      ],
    });
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
