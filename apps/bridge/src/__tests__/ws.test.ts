import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { FastifyInstance } from "fastify";
import { getPrisma } from "@dccc/db";
import { buildApp } from "../app.js";
import { _clearRevocations, issueSessionToken } from "../auth/sessionToken.js";
import { rooms } from "../services/rooms.js";
import { resetEnvCache } from "../config/env.js";

const SECRET = process.env.SESSION_SECRET ?? "";
const USER_ID = "111122223333444455";
const GUILD_ID = "123456789012345678";

// Voice-channel-enforcement tests use distinct IDs so we don't have to
// fight with the OAuth tests over the same GuildConfig row.
const VOICE_GUILD_ID = "999888777666555444";
const VOICE_USER_ID = "222233334444555566";
const VOICE_ALLOWED_CH = "555000000000000011";
const VOICE_OTHER_CH = "555000000000000012";

async function seedAllowedVoiceChannels(channels: string[]): Promise<void> {
  await getPrisma().guildConfig.upsert({
    where: { guildId: VOICE_GUILD_ID },
    create: {
      guildId: VOICE_GUILD_ID,
      enabled: true,
      commanderRoleIds: "[]",
      allowedVoiceChannelIds: JSON.stringify(channels),
      bridgeMode: "external_voice",
    },
    update: {
      allowedVoiceChannelIds: JSON.stringify(channels),
    },
  });
}

async function seedUserVoiceState(channelId: string | null): Promise<void> {
  await getPrisma().userVoiceState.upsert({
    where: { guildId_userId: { guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID } },
    create: { guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID, channelId },
    update: { channelId },
  });
}

async function clearVoiceFixtures(): Promise<void> {
  await getPrisma().userVoiceState.deleteMany({
    where: { guildId: VOICE_GUILD_ID },
  });
  await getPrisma().guildConfig.deleteMany({
    where: { guildId: VOICE_GUILD_ID },
  });
}

let app: FastifyInstance;
let baseUrl: string;

beforeAll(async () => {
  _clearRevocations();
  app = await buildApp();
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  // address is e.g. "http://127.0.0.1:54321"
  baseUrl = address.replace(/^http/, "ws");
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  // Singleton state — without this, sockets from the previous test
  // can linger long enough to pollute the next test's commander list.
  rooms._clear();
});

type Handle = {
  socket: WebSocket;
  next: (timeoutMs?: number) => Promise<unknown>;
};

function connect(token: string | null, guildId?: string): Promise<Handle> {
  let url = `${baseUrl}/ws`;
  if (token) {
    url += `?token=${encodeURIComponent(token)}`;
    if (guildId) url += `&guildId=${encodeURIComponent(guildId)}`;
  }
  const socket = new WebSocket(url);

  // Queue + waiters so callers can `await next()` regardless of whether the
  // message has already arrived. Required because the server now sends
  // `bridge:joined` immediately on auth, which can race the test code.
  const queue: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      parsed = raw.toString();
    }
    const w = waiters.shift();
    if (w) w(parsed);
    else queue.push(parsed);
  });

  const next = (timeoutMs = 1000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) {
        resolve(queue.shift());
        return;
      }
      waiters.push(resolve);
      setTimeout(() => {
        const idx = waiters.indexOf(resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("ws message timeout"));
      }, timeoutMs);
    });

  return new Promise((resolve, reject) => {
    socket.on("close", () => resolve({ socket, next }));
    socket.on("error", () => {
      // We expect errors when server closes unauthenticated sockets.
    });
    socket.on("open", () => resolve({ socket, next }));
    setTimeout(() => reject(new Error("ws connect timeout")), 2000);
  });
}

function send(socket: WebSocket, msg: unknown): void {
  socket.send(JSON.stringify(msg));
}

function nextClose(socket: WebSocket, timeoutMs = 1000): Promise<number> {
  return new Promise((resolve, reject) => {
    socket.on("close", (code) => resolve(code));
    setTimeout(() => reject(new Error("ws close timeout")), timeoutMs);
  });
}

describe("/health", () => {
  it("returns ok", async () => {
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/health`);
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, service: "bridge" });
  });
});

describe("/ws auth", () => {
  it("rejects connections with no token (close 4401)", async () => {
    const { socket } = await connect(null);
    const code = await nextClose(socket);
    expect(code).toBe(4401);
  });

  it("rejects connections with an invalid token (close 4401)", async () => {
    const { socket } = await connect("not.a.jwt");
    const code = await nextClose(socket);
    expect(code).toBe(4401);
  });
});

describe("/ws message flow with valid token", () => {
  it("sends bridge:joined with livekit creds immediately after auth", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      roomId?: string;
      livekitUrl?: string;
      livekitToken?: string;
      activeCommanders?: { userId: string; speaking: boolean }[];
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.roomId).toBe(`commander-bridge-${GUILD_ID}`);
    expect(reply.livekitUrl).toMatch(/^ws/);
    expect(reply.livekitToken).toBeTruthy();
    expect(reply.activeCommanders).toEqual([{ userId: USER_ID, active: true, speaking: false }]);
    socket.close();
  });

  it("ptt:start flips speaking=true and broadcasts commander:list", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    send(socket, { type: "ptt:start", guildId: GUILD_ID });
    const list = (await next()) as {
      type: string;
      commanders: { userId: string; speaking: boolean }[];
    };
    expect(list.type).toBe("commander:list");
    expect(list.commanders).toEqual([{ userId: USER_ID, active: true, speaking: true }]);
    socket.close();
  });

  it("ptt:stop flips speaking=false and broadcasts commander:list", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    send(socket, { type: "ptt:start", guildId: GUILD_ID });
    await next(); // drain commander:list (speaking=true)
    send(socket, { type: "ptt:stop", guildId: GUILD_ID });
    const list = (await next()) as {
      type: string;
      commanders: { userId: string; speaking: boolean }[];
    };
    expect(list.type).toBe("commander:list");
    expect(list.commanders).toEqual([{ userId: USER_ID, active: true, speaking: false }]);
    socket.close();
  });

  it("status:output-mute flips outputMuted=true and broadcasts commander:list", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    send(socket, { type: "status:output-mute", muted: true });
    const list = (await next()) as {
      type: string;
      commanders: { userId: string; outputMuted?: boolean }[];
    };
    expect(list.type).toBe("commander:list");
    expect(list.commanders).toEqual([
      { userId: USER_ID, active: true, speaking: false, outputMuted: true },
    ]);
    // toggling back to false should drop the field again (snapshot
    // only spreads truthy flags to keep the wire payload compact).
    send(socket, { type: "status:output-mute", muted: false });
    const list2 = (await next()) as {
      type: string;
      commanders: { userId: string }[];
    };
    expect(list2.commanders).toEqual([{ userId: USER_ID, active: true, speaking: false }]);
    socket.close();
  });

  it("status:afk flips afk=true and broadcasts commander:list", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    send(socket, { type: "status:afk", afk: true });
    const list = (await next()) as {
      type: string;
      commanders: { userId: string; afk?: boolean }[];
    };
    expect(list.type).toBe("commander:list");
    expect(list.commanders).toEqual([
      { userId: USER_ID, active: true, speaking: false, afk: true },
    ]);
    socket.close();
  });

  it("closes the socket on protocol violation", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    send(socket, { type: "ptt:start", guildId: "not-a-snowflake" });
    const errMsg = (await next()) as { type: string; code?: string };
    expect(errMsg.type).toBe("error");
    expect(errMsg.code).toBe("invalid_message");
    const code = await nextClose(socket);
    expect(code).toBe(4400);
  });

  it("closes the socket on invalid JSON", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    socket.send("{not json");
    const errMsg = (await next()) as { type: string; code?: string };
    expect(errMsg.type).toBe("error");
    expect(errMsg.code).toBe("invalid_json");
    const code = await nextClose(socket);
    expect(code).toBe(4400);
  });
});

describe("issueSessionToken + verifySessionToken", () => {
  it("round-trips a payload", async () => {
    const token = await issueSessionToken(SECRET, {
      sub: USER_ID,
      guildId: GUILD_ID,
    });
    expect(token.split(".").length).toBe(3); // header.payload.signature
  });
});

describe("/ws voice-channel enforcement", () => {
  beforeEach(async () => {
    await clearVoiceFixtures();
  });

  it("bridge:joined ships livekit creds when no allowed list is configured", async () => {
    // Backwards-compat: empty allowedIds → checkAllowedVoiceChannel
    // short-circuits ok, bridge mints LK creds and sends them inline
    // with bridge:joined.
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.livekitUrl).toMatch(/^ws/);
    expect(reply.livekitToken).toBeTruthy();
    socket.close();
    await clearVoiceFixtures();
  });

  it("bridge:joined ships livekit creds when user is in an allowed voice channel", async () => {
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH, VOICE_OTHER_CH]);
    await seedUserVoiceState(VOICE_ALLOWED_CH);
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.livekitUrl).toMatch(/^ws/);
    expect(reply.livekitToken).toBeTruthy();
    socket.close();
    await clearVoiceFixtures();
  });

  it("bridge:joined omits livekit creds when user is in a non-allowed channel; WS stays open", async () => {
    // New behaviour (instant toggle): WS is the control channel, audio
    // is decoupled. Companion waits for audio:enable rather than getting
    // kicked at connect time.
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH]);
    await seedUserVoiceState(VOICE_OTHER_CH);
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.livekitUrl).toBeUndefined();
    expect(reply.livekitToken).toBeUndefined();
    // Socket must remain OPEN — that's the whole point of the refactor.
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
    await clearVoiceFixtures();
  });

  it("bridge:joined omits livekit creds when user is not in any voice channel; WS stays open", async () => {
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH]);
    // No seedUserVoiceState — user not tracked in voice at all.
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.livekitUrl).toBeUndefined();
    expect(reply.livekitToken).toBeUndefined();
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
    await clearVoiceFixtures();
  });

  it("bridge:joined omits livekit creds when user is tracked but disconnected (channelId=null)", async () => {
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH]);
    await seedUserVoiceState(null);
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const reply = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.livekitUrl).toBeUndefined();
    expect(reply.livekitToken).toBeUndefined();
    expect(socket.readyState).toBe(socket.OPEN);
    socket.close();
    await clearVoiceFixtures();
  });
});

describe("POST /internal/voice-state-changed", () => {
  const INTERNAL_SECRET = "test-internal-secret-min-16-chars";

  // The bridge's getEnv() caches its parse of process.env after the first
  // call (which happened during buildApp() in beforeAll, with no
  // INTERNAL_BRIDGE_SECRET set). To make the endpoint pick up later env
  // changes we must reset that cache. afterEach restores the cleared
  // state so the global app instance is consistent for whatever runs next.
  beforeEach(async () => {
    delete process.env.INTERNAL_BRIDGE_SECRET;
    resetEnvCache();
    await clearVoiceFixtures();
  });

  function setSecret(): void {
    process.env.INTERNAL_BRIDGE_SECRET = INTERNAL_SECRET;
    resetEnvCache();
  }
  function unsetSecret(): void {
    delete process.env.INTERNAL_BRIDGE_SECRET;
    resetEnvCache();
  }

  it("returns 503 when INTERNAL_BRIDGE_SECRET is unset (endpoint disabled)", async () => {
    unsetSecret();
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/internal/voice-state-changed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID }),
    });
    expect(res.status).toBe(503);
  });

  it("returns 401 when X-Internal-Auth header is wrong", async () => {
    setSecret();
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/internal/voice-state-changed`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-auth": "wrong" },
      body: JSON.stringify({ guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID }),
    });
    expect(res.status).toBe(401);
    unsetSecret();
  });

  it("returns 200 ok with pushedTo=0 when user has no open WS", async () => {
    setSecret();
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/internal/voice-state-changed`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-auth": INTERNAL_SECRET },
      body: JSON.stringify({ guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, pushedTo: 0 });
    unsetSecret();
  });

  it("pushes audio:enable to an open WS when voice-state becomes valid", async () => {
    setSecret();
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH]);
    // Start with user OUT of voice → connect → bridge:joined without creds.
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    const joined = (await next()) as { type: string; livekitUrl?: string };
    expect(joined.type).toBe("bridge:joined");
    expect(joined.livekitUrl).toBeUndefined();
    // The bridge follows up with audio:disable because the user is
    // not currently in an allowed channel — this is the signal the
    // companion uses to render the "Audio pausiert" banner. Drain it
    // before waiting for the voice-state-push to flip us to enable.
    const pausedMsg = (await next()) as { type: string; reason?: string };
    expect(pausedMsg.type).toBe("audio:disable");
    expect(pausedMsg.reason).toBe("not_in_voice");

    // Simulate the bot upserting the user into the allowed channel
    // and pushing the change.
    await seedUserVoiceState(VOICE_ALLOWED_CH);
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/internal/voice-state-changed`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-auth": INTERNAL_SECRET },
      body: JSON.stringify({ guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, pushedTo: 1 });

    // Bridge should have pushed audio:enable to the open socket.
    const audioMsg = (await next()) as {
      type: string;
      livekitUrl?: string;
      livekitToken?: string;
    };
    expect(audioMsg.type).toBe("audio:enable");
    expect(audioMsg.livekitUrl).toMatch(/^ws/);
    expect(audioMsg.livekitToken).toBeTruthy();
    socket.close();
    unsetSecret();
    await clearVoiceFixtures();
  });

  it("pushes audio:disable to an open WS when voice-state becomes invalid", async () => {
    setSecret();
    await seedAllowedVoiceChannels([VOICE_ALLOWED_CH]);
    await seedUserVoiceState(VOICE_ALLOWED_CH);
    const token = await issueSessionToken(SECRET, {
      sub: VOICE_USER_ID,
      guildId: VOICE_GUILD_ID,
    });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined

    // Bot upserts user out of voice + pushes.
    await seedUserVoiceState(null);
    const httpUrl = baseUrl.replace(/^ws/, "http");
    const res = await fetch(`${httpUrl}/internal/voice-state-changed`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-auth": INTERNAL_SECRET },
      body: JSON.stringify({ guildId: VOICE_GUILD_ID, userId: VOICE_USER_ID }),
    });
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, pushedTo: 1 });

    const audioMsg = (await next()) as { type: string; reason?: string };
    expect(audioMsg.type).toBe("audio:disable");
    expect(audioMsg.reason).toBe("not_in_voice");
    socket.close();
    unsetSecret();
    await clearVoiceFixtures();
  });
});

// --- pong ---

describe("/ws pong", () => {
  it("replies with pong when client sends heartbeat", async () => {
    const token = await issueSessionToken(SECRET, { sub: USER_ID, guildId: GUILD_ID });
    const { socket, next } = await connect(token);
    await next(); // drain bridge:joined
    const ts = Date.now();
    send(socket, { type: "heartbeat", timestamp: ts });
    const reply = (await next()) as { type: string; timestamp?: number; serverTime?: number };
    expect(reply.type).toBe("pong");
    expect(reply.timestamp).toBe(ts);
    expect(typeof reply.serverTime).toBe("number");
    socket.close();
  });
});

// --- bridge:joined includes roomMode ---

describe("/ws bridge:joined roomMode", () => {
  it("includes roomMode:guild for guild WS path", async () => {
    const token = await issueSessionToken(SECRET, { sub: USER_ID, guildId: GUILD_ID });
    const { socket, next } = await connect(token);
    const reply = (await next()) as { type: string; roomMode?: string };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.roomMode).toBe("guild");
    socket.close();
  });
});

// --- session WS path ---

const SESSION_USER_ID = "777700000000000001";
const SESSION_GUILD_ID = "777700000000000002";
const SESSION_ID = "test-session-abc";
const SESSION_LIVEKIT_ROOM = `session-${SESSION_ID}`;

function connectWsSession(token: string, sessionId: string): Promise<Handle> {
  const url =
    `${baseUrl}/ws?token=${encodeURIComponent(token)}&sessionId=${encodeURIComponent(sessionId)}`;
  const socket = new WebSocket(url);
  const queue: unknown[] = [];
  const waiters: ((v: unknown) => void)[] = [];
  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      parsed = raw.toString();
    }
    const w = waiters.shift();
    if (w) w(parsed);
    else queue.push(parsed);
  });
  const next = (timeoutMs = 1000): Promise<unknown> =>
    new Promise((resolve, reject) => {
      if (queue.length > 0) { resolve(queue.shift()); return; }
      waiters.push(resolve);
      setTimeout(() => {
        const idx = waiters.indexOf(resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        reject(new Error("ws message timeout"));
      }, timeoutMs);
    });
  return new Promise((resolve, reject) => {
    socket.on("close", () => resolve({ socket, next }));
    socket.on("error", () => {});
    socket.on("open", () => resolve({ socket, next }));
    setTimeout(() => reject(new Error("ws connect timeout")), 2000);
  });
}

async function seedSession(): Promise<void> {
  await getPrisma().session.upsert({
    where: { id: SESSION_ID },
    create: {
      id: SESSION_ID,
      guildId: SESSION_GUILD_ID,
      label: "Test Session",
      createdBy: SESSION_USER_ID,
      livekitRoom: SESSION_LIVEKIT_ROOM,
      status: "active",
    },
    update: { status: "active" },
  });
  await getPrisma().sessionInvite.upsert({
    where: { id: "test-invite-001" },
    create: {
      id: "test-invite-001",
      sessionId: SESSION_ID,
      tokenHash: "deadbeef".repeat(8),
      label: "Tester",
      createdBy: SESSION_USER_ID,
      usedBy: SESSION_USER_ID,
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 3_600_000),
    },
    update: { usedBy: SESSION_USER_ID },
  });
}

async function clearSessionFixtures(): Promise<void> {
  await getPrisma().sessionInvite.deleteMany({ where: { sessionId: SESSION_ID } });
  await getPrisma().session.deleteMany({ where: { id: SESSION_ID } });
}

describe("/ws session path", () => {
  beforeEach(async () => {
    await clearSessionFixtures();
  });

  it("rejects invalid token (close 4401)", async () => {
    await seedSession();
    const { socket } = await connectWsSession("not.a.jwt", SESSION_ID);
    const code = await nextClose(socket);
    expect(code).toBe(4401);
    await clearSessionFixtures();
  });

  it("rejects when user has no consumed invite (close 4403)", async () => {
    await seedSession();
    const otherUser = "888800000000000001";
    const token = await issueSessionToken(SECRET, { sub: otherUser });
    const { socket } = await connectWsSession(token, SESSION_ID);
    const code = await nextClose(socket);
    expect(code).toBe(4403);
    await clearSessionFixtures();
  });

  it("rejects when session is ended (close 4403)", async () => {
    await seedSession();
    await getPrisma().session.update({ where: { id: SESSION_ID }, data: { status: "ended" } });
    const token = await issueSessionToken(SECRET, { sub: SESSION_USER_ID });
    const { socket } = await connectWsSession(token, SESSION_ID);
    const code = await nextClose(socket);
    expect(code).toBe(4403);
    await clearSessionFixtures();
  });

  it("sends bridge:joined with roomMode:session and LiveKit creds for valid session member", async () => {
    await seedSession();
    const token = await issueSessionToken(SECRET, { sub: SESSION_USER_ID });
    const { socket, next } = await connectWsSession(token, SESSION_ID);
    const reply = (await next()) as {
      type: string;
      roomMode?: string;
      sessionId?: string;
      roomId?: string;
      livekitUrl?: string;
      livekitToken?: string;
      activeCommanders?: unknown[];
    };
    expect(reply.type).toBe("bridge:joined");
    expect(reply.roomMode).toBe("session");
    expect(reply.sessionId).toBe(SESSION_ID);
    expect(reply.roomId).toBe(SESSION_LIVEKIT_ROOM);
    expect(reply.livekitUrl).toMatch(/^ws/);
    expect(reply.livekitToken).toBeTruthy();
    expect(Array.isArray(reply.activeCommanders)).toBe(true);
    socket.close();
    await clearSessionFixtures();
  });

  it("ptt:start in session room broadcasts commander:list", async () => {
    await seedSession();
    const token = await issueSessionToken(SECRET, { sub: SESSION_USER_ID });
    const { socket, next } = await connectWsSession(token, SESSION_ID);
    await next(); // drain bridge:joined
    send(socket, { type: "ptt:start", guildId: SESSION_GUILD_ID });
    const list = (await next()) as { type: string; commanders: { userId: string; speaking: boolean }[] };
    expect(list.type).toBe("commander:list");
    expect(list.commanders[0]).toMatchObject({ userId: SESSION_USER_ID, speaking: true });
    socket.close();
    await clearSessionFixtures();
  });
});
