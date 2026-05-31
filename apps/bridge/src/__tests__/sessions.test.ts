import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { disconnectPrisma, getPrisma } from "@rdoc-suite/db";
import { buildApp } from "../app.js";
import { resetEnvCache } from "../config/env.js";
import { addAdmin } from "../services/admins.js";
import { issueSessionToken } from "../auth/sessionToken.js";
import {
  createSession,
  endSession,
  listActiveSessions,
  mintSessionInvite,
  consumeSessionInvite,
} from "../services/sessions.js";

const GUILD_ID = "777666555444333222";
const ADMIRAL_ID = "300300300300300300";
const COMMANDER_ID = "400400400400400400";
const OTHER_GUILD_ID = "999888777666555444";

const OAUTH_ENV = {
  DISCORD_RDOCRTC_CLIENT_ID: "100000000000000000",
  DISCORD_CLIENT_SECRET: "test-secret",
  DISCORD_RDOCRTC_BOT_TOKEN: "test-bot-token",
  OAUTH_REDIRECT_URI: "http://localhost:8787/auth/callback",
};

let app: FastifyInstance;
let baseUrl: string;
let admiralToken: string;
let commanderToken: string;

beforeAll(async () => {
  for (const [k, v] of Object.entries(OAUTH_ENV)) process.env[k] = v;
  resetEnvCache();
  app = await buildApp();
  baseUrl = await app.listen({ host: "127.0.0.1", port: 0 });
  admiralToken = await issueSessionToken(process.env.SESSION_SECRET!, { sub: ADMIRAL_ID });
  commanderToken = await issueSessionToken(process.env.SESSION_SECRET!, { sub: COMMANDER_ID });
});

afterAll(async () => {
  for (const k of Object.keys(OAUTH_ENV)) delete process.env[k];
  resetEnvCache();
  await app.close();
  await disconnectPrisma();
});

async function cleanup(): Promise<void> {
  const sessions = await getPrisma().session.findMany({
    where: { guildId: { in: [GUILD_ID, OTHER_GUILD_ID] } },
  });
  if (sessions.length > 0) {
    await getPrisma().sessionInvite.deleteMany({
      where: { sessionId: { in: sessions.map((s) => s.id) } },
    });
    await getPrisma().session.deleteMany({
      where: { id: { in: sessions.map((s) => s.id) } },
    });
  }
  await getPrisma().adminUser.deleteMany({ where: { guildId: { in: [GUILD_ID, OTHER_GUILD_ID] } } });
}
beforeEach(cleanup);
afterEach(cleanup);

// ── Service layer ────────────────────────────────────────────────────────────

describe("session service", () => {
  it("creates a session with a unique livekitRoom", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op Alpha", createdBy: ADMIRAL_ID });
    expect(s.id).toBeTruthy();
    expect(s.livekitRoom).toBe(`session-${s.id}`);
    expect(s.status).toBe("active");
    expect(s.guildId).toBe(GUILD_ID);
  });

  it("listActiveSessions returns only active sessions for the guild", async () => {
    const a = await createSession({ guildId: GUILD_ID, label: "A", createdBy: ADMIRAL_ID });
    const b = await createSession({ guildId: GUILD_ID, label: "B", createdBy: ADMIRAL_ID });
    await createSession({ guildId: OTHER_GUILD_ID, label: "Other", createdBy: ADMIRAL_ID });
    await endSession({ sessionId: b.id, guildId: GUILD_ID });

    const active = await listActiveSessions(GUILD_ID);
    expect(active).toHaveLength(1);
    expect(active[0]?.id).toBe(a.id);
  });

  it("endSession marks the session ended and sets endedAt", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const result = await endSession({ sessionId: s.id, guildId: GUILD_ID });
    expect(result.ok).toBe(true);

    const list = await listActiveSessions(GUILD_ID);
    expect(list).toHaveLength(0);
  });

  it("endSession returns not_found for wrong guild", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const result = await endSession({ sessionId: s.id, guildId: OTHER_GUILD_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("not_found");
  });

  it("endSession returns already_ended on double-end", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    await endSession({ sessionId: s.id, guildId: GUILD_ID });
    const second = await endSession({ sessionId: s.id, guildId: GUILD_ID });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_ended");
  });
});

describe("sessionInvite service", () => {
  it("mints + consumes an invite, returning LiveKit room", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id,
      guildId: GUILD_ID,
      label: "Alice",
      createdBy: ADMIRAL_ID,
    });
    expect(invite).not.toBeNull();
    expect(invite!.plaintext).toMatch(/^[0-9a-f]{64}$/);

    const result = await consumeSessionInvite({
      rawToken: invite!.plaintext,
      userId: COMMANDER_ID,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.sessionId).toBe(s.id);
      expect(result.livekitRoom).toBe(s.livekitRoom);
      expect(result.sessionLabel).toBe("Op");
    }
  });

  it("rejects an already-used invite on second attempt", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id, guildId: GUILD_ID, label: "Alice", createdBy: ADMIRAL_ID,
    });
    await consumeSessionInvite({ rawToken: invite!.plaintext, userId: COMMANDER_ID });
    const second = await consumeSessionInvite({ rawToken: invite!.plaintext, userId: COMMANDER_ID });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("already_used");
  });

  it("rejects an expired invite", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id, guildId: GUILD_ID, label: "Alice", createdBy: ADMIRAL_ID,
      ttlHours: -1, // already expired
    });
    const result = await consumeSessionInvite({ rawToken: invite!.plaintext, userId: COMMANDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("expired");
  });

  it("rejects an invite for an ended session", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id, guildId: GUILD_ID, label: "Alice", createdBy: ADMIRAL_ID,
    });
    await endSession({ sessionId: s.id, guildId: GUILD_ID });
    const result = await consumeSessionInvite({ rawToken: invite!.plaintext, userId: COMMANDER_ID });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("session_ended");
  });

  it("returns null when minting invite for ended session", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    await endSession({ sessionId: s.id, guildId: GUILD_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id, guildId: GUILD_ID, label: "Alice", createdBy: ADMIRAL_ID,
    });
    expect(invite).toBeNull();
  });
});

// ── HTTP routes ──────────────────────────────────────────────────────────────

describe("POST /sessions", () => {
  beforeEach(() => addAdmin({ guildId: GUILD_ID, userId: ADMIRAL_ID, role: "admiral" }));

  it("creates a session for an admin", async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${admiralToken}` },
      body: JSON.stringify({ guildId: GUILD_ID, label: "Op Alpha" }),
    });
    expect(res.status).toBe(201);
    const body = await res.json() as Record<string, unknown>;
    expect(body.status).toBe("active");
    expect(body.label).toBe("Op Alpha");
  });

  it("rejects non-admin (no AdminUser row)", async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${commanderToken}` },
      body: JSON.stringify({ guildId: GUILD_ID, label: "Op Alpha" }),
    });
    expect(res.status).toBe(403);
  });

  it("rejects missing bearer", async () => {
    const res = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: GUILD_ID, label: "Op Alpha" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("DELETE /sessions/:id", () => {
  beforeEach(() => addAdmin({ guildId: GUILD_ID, userId: ADMIRAL_ID, role: "admiral" }));

  it("ends a session", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const res = await fetch(`${baseUrl}/sessions/${s.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${admiralToken}` },
      body: JSON.stringify({ guildId: GUILD_ID }),
    });
    expect(res.status).toBe(200);
    expect((await listActiveSessions(GUILD_ID))).toHaveLength(0);
  });

  it("returns 404 for a session in the wrong guild", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    await addAdmin({ guildId: OTHER_GUILD_ID, userId: ADMIRAL_ID, role: "admiral" });
    const otherToken = await issueSessionToken(process.env.SESSION_SECRET!, { sub: ADMIRAL_ID });
    const res = await fetch(`${baseUrl}/sessions/${s.id}`, {
      method: "DELETE",
      headers: { "content-type": "application/json", authorization: `Bearer ${otherToken}` },
      body: JSON.stringify({ guildId: OTHER_GUILD_ID }),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /sessions/:id/invites + POST /sessions/join", () => {
  beforeEach(() => addAdmin({ guildId: GUILD_ID, userId: ADMIRAL_ID, role: "admiral" }));

  it("admiral mints an invite; commander joins and gets LiveKit credentials", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });

    const mintRes = await fetch(`${baseUrl}/sessions/${s.id}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${admiralToken}` },
      body: JSON.stringify({ guildId: GUILD_ID, label: "Alice" }),
    });
    expect(mintRes.status).toBe(201);
    const invite = await mintRes.json() as Record<string, unknown>;
    expect(typeof invite.plaintext).toBe("string");

    const joinRes = await fetch(`${baseUrl}/sessions/join`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${commanderToken}` },
      body: JSON.stringify({ inviteToken: invite.plaintext }),
    });
    expect(joinRes.status).toBe(200);
    const joined = await joinRes.json() as Record<string, unknown>;
    expect(joined.sessionId).toBe(s.id);
    expect(joined.sessionLabel).toBe("Op");
    expect(typeof joined.livekitToken).toBe("string");
    expect(joined.livekitUrl).toBe(process.env.LIVEKIT_URL);
  });

  it("join returns 409 on second use of the same token", async () => {
    const s = await createSession({ guildId: GUILD_ID, label: "Op", createdBy: ADMIRAL_ID });
    const invite = await mintSessionInvite({
      sessionId: s.id, guildId: GUILD_ID, label: "Alice", createdBy: ADMIRAL_ID,
    });

    await fetch(`${baseUrl}/sessions/join`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${commanderToken}` },
      body: JSON.stringify({ inviteToken: invite!.plaintext }),
    });

    const second = await fetch(`${baseUrl}/sessions/join`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${commanderToken}` },
      body: JSON.stringify({ inviteToken: invite!.plaintext }),
    });
    expect(second.status).toBe(409);
  });

  it("join returns 404 for an unknown token", async () => {
    const res = await fetch(`${baseUrl}/sessions/join`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${commanderToken}` },
      body: JSON.stringify({ inviteToken: "a".repeat(64) }),
    });
    expect(res.status).toBe(404);
  });
});
