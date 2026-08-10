#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// discord-mock — a Discord API simulator for the local RDOC-Suite test stack.
//
// It speaks the exact subset of the Discord REST API that apps/fleetplanner
// uses (see src/services/discord.ts + src/auth/providers.ts) and records every
// call, so tests can assert "the app created a scheduled event with this title"
// instead of "the function did not throw".
//
// It also speaks the RETURN path: POST /__mock/interaction signs a Discord HTTP
// interaction with the same Ed25519 key the app verifies against and posts it to
// /discord/interactions — that is how the FR-P1 approval buttons get tested.
//
// Zero dependencies (node:http + node:crypto) so the container is a plain
// `node:20-alpine` with two files copied in.
//
// Never run this anywhere near production: it hands out OAuth tokens for any
// user id asked for and accepts any bot token unless DISCORD_MOCK_BOT_TOKEN is set.
// ─────────────────────────────────────────────────────────────────────────────
import http from "node:http";
import { createPrivateKey, createPublicKey, sign as edSign, randomUUID } from "node:crypto";
import {
  freshState,
  seedState,
  addUser,
  joinGuild,
  nextId,
  CHANNEL_TEXT,
  CHANNEL_ANNOUNCEMENT,
} from "./state.mjs";

const PORT = Number(process.env.PORT ?? 4400);
const HOST = process.env.HOST ?? "0.0.0.0";
// Bot token the app is expected to present. Unset → accept any non-empty token.
const EXPECTED_BOT_TOKEN = process.env.DISCORD_MOCK_BOT_TOKEN ?? "";
// Where signed interactions get posted (the app's interactions endpoint).
const APP_INTERACTIONS_URL =
  process.env.DISCORD_MOCK_APP_INTERACTIONS_URL ?? "http://fleetplanner:3200/discord/interactions";
// 32-byte Ed25519 seed. The default is a fixed TEST key; the matching public key
// hex must be the app's DISCORD_FLEETPLANNER_PUBLIC_KEY (see tests/stack/env.test).
const KEY_SEED = process.env.DISCORD_MOCK_KEY_SEED ?? "rdoc-suite-discord-mock-seed-01!";

// ── Ed25519 key (raw 32-byte seed → PKCS8 DER, RFC 8410) ────────────────────
const PKCS8_ED25519_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
const seedBuf = Buffer.from(KEY_SEED, "utf8");
if (seedBuf.length !== 32) {
  console.error(`[discord-mock] DISCORD_MOCK_KEY_SEED must be exactly 32 bytes (got ${seedBuf.length})`);
  process.exit(1);
}
const privateKey = createPrivateKey({
  key: Buffer.concat([PKCS8_ED25519_PREFIX, seedBuf]),
  format: "der",
  type: "pkcs8",
});
const publicKeyHex = (() => {
  const spki = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  return Buffer.from(spki.subarray(spki.length - 32)).toString("hex");
})();

let state = freshState();

// ── helpers ─────────────────────────────────────────────────────────────────
const json = (res, status, body) => {
  const payload = JSON.stringify(body ?? {});
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
};
const noContent = (res) => {
  res.writeHead(204);
  res.end();
};
const discordError = (res, status, message, code = 0) =>
  json(res, status, { message, code });

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks);
}

/**
 * Summarise a request body for the call log. JSON is kept as-is except that
 * base64 image data URIs are collapsed — a scheduled-event create carries a
 * ~200 KB cover image and nobody wants that in an assertion diff.
 */
function summariseJson(value) {
  if (Array.isArray(value)) return value.map(summariseJson);
  if (value && typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = summariseJson(v);
    return out;
  }
  if (typeof value === "string" && value.startsWith("data:")) {
    const [meta] = value.split(",", 1);
    return `${meta},<${value.length - meta.length - 1} base64 chars>`;
  }
  return value;
}

/** Crude multipart scan: enough to record filenames + sizes of uploaded files. */
function summariseMultipart(buf, contentType) {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? "");
  const boundary = boundaryMatch ? (boundaryMatch[1] ?? boundaryMatch[2]).trim() : null;
  const files = [];
  let payload = null;
  if (boundary) {
    const parts = buf.toString("latin1").split(`--${boundary}`);
    for (const part of parts) {
      const headerEnd = part.indexOf("\r\n\r\n");
      if (headerEnd === -1) continue;
      const headers = part.slice(0, headerEnd);
      const body = part.slice(headerEnd + 4).replace(/\r\n$/, "");
      const filename = /filename="([^"]*)"/i.exec(headers)?.[1];
      const name = /name="([^"]*)"/i.exec(headers)?.[1];
      if (filename) files.push({ filename, bytes: Buffer.byteLength(body, "latin1") });
      else if (name === "payload_json") {
        try {
          payload = summariseJson(JSON.parse(body));
        } catch {
          payload = body.slice(0, 500);
        }
      }
    }
  }
  return { multipart: true, payload_json: payload, files };
}

function parseBody(buf, contentType) {
  if (!buf.length) return null;
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("application/json")) {
    try {
      return summariseJson(JSON.parse(buf.toString("utf8")));
    } catch {
      return { unparsable: buf.toString("utf8").slice(0, 500) };
    }
  }
  if (ct.includes("multipart/form-data")) return summariseMultipart(buf, contentType);
  if (ct.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(buf.toString("utf8")));
  }
  return { raw: buf.toString("utf8").slice(0, 500) };
}

function record(req, url, body) {
  state.calls.push({
    at: new Date().toISOString(),
    method: req.method,
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    auth: authKind(req),
    body,
  });
  // Bound the log so a long-running stack can't eat memory.
  if (state.calls.length > 2000) state.calls.splice(0, state.calls.length - 2000);
}

function authKind(req) {
  const h = req.headers.authorization ?? "";
  if (h.startsWith("Bot ")) return "bot";
  if (h.startsWith("Bearer ")) return "bearer";
  return "none";
}

function botAuthed(req) {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Bot ")) return false;
  const token = h.slice(4).trim();
  if (!token) return false;
  return EXPECTED_BOT_TOKEN ? token === EXPECTED_BOT_TOKEN : true;
}

function bearerUser(req) {
  const h = req.headers.authorization ?? "";
  if (!h.startsWith("Bearer ")) return null;
  const userId = state.oauthTokens[h.slice(7).trim()];
  return userId ? state.users[userId] ?? null : null;
}

/** Fault injection — first matching rule wins and is consumed if `times` is set. */
function takeFault(method, pathname) {
  const idx = state.faults.findIndex((f) => {
    if (f.method && f.method.toUpperCase() !== method) return false;
    const pattern = String(f.path ?? "").replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
    return new RegExp(`^${pattern}$`).test(pathname);
  });
  if (idx === -1) return null;
  const fault = state.faults[idx];
  if (typeof fault.times === "number") {
    fault.times -= 1;
    if (fault.times <= 0) state.faults.splice(idx, 1);
  }
  return fault;
}

// ── route table ─────────────────────────────────────────────────────────────
// Each entry: [method, RegExp over pathname, handler(ctx)]. Handlers get
// { req, res, url, body, params }.
const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

const API = "/api/v10";

// ── OAuth2 ──────────────────────────────────────────────────────────────────
// Browser lands here (the app 302s to it). We immediately "approve" as the
// configured login user and bounce back with a code — no consent screen.
route("GET", new RegExp(`^${API}/oauth2/authorize$`), ({ res, url }) => {
  const redirectUri = url.searchParams.get("redirect_uri");
  const stateParam = url.searchParams.get("state") ?? "";
  if (!redirectUri) return discordError(res, 400, "redirect_uri is required");

  // Which user signs in: explicit ?mock_user=, else the seeded loginAs, else the
  // first known user. Tests set it with POST /__mock/login-as.
  const requested = url.searchParams.get("mock_user") ?? state.loginAs ?? Object.keys(state.users)[0];
  if (!requested) return discordError(res, 400, "no mock user configured — POST /__mock/login-as first");
  const user = state.users[requested] ?? addUser(state, { id: requested, username: `user-${requested}` });

  const code = randomUUID();
  state.oauthCodes[code] = user.id;
  const target = new URL(redirectUri);
  target.searchParams.set("code", code);
  if (stateParam) target.searchParams.set("state", stateParam);
  res.writeHead(302, { location: target.toString() });
  res.end();
});

route("POST", new RegExp(`^${API}/oauth2/token$`), ({ res, body }) => {
  const code = body?.code;
  const userId = code ? state.oauthCodes[code] : null;
  if (!userId) return discordError(res, 400, "invalid_grant");
  delete state.oauthCodes[code];
  const accessToken = `mock-access-${randomUUID()}`;
  state.oauthTokens[accessToken] = userId;
  json(res, 200, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 604800,
    refresh_token: `mock-refresh-${randomUUID()}`,
    scope: "identify guilds",
  });
});

// `users/@me` is dual-purpose: bot token → bot identity, bearer → the user.
route("GET", new RegExp(`^${API}/users/@me$`), ({ req, res }) => {
  if (botAuthed(req)) return json(res, 200, { ...state.bot, bot: true });
  const user = bearerUser(req);
  if (!user) return discordError(res, 401, "401: Unauthorized");
  json(res, 200, user);
});

route("GET", new RegExp(`^${API}/users/@me/guilds$`), ({ req, res }) => {
  const user = bearerUser(req);
  if (!user) return discordError(res, 401, "401: Unauthorized");
  const guilds = Object.values(state.guilds)
    .filter((g) => Boolean(g.members[user.id]))
    .map((g) => ({ id: g.id, name: g.name, icon: g.icon, owner: false, permissions: "0" }));
  json(res, 200, guilds);
});

// ── Guild reads (bot token) ─────────────────────────────────────────────────
route("GET", new RegExp(`^${API}/guilds/([^/]+)$`), ({ req, res, params }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  // Missing guild = the bot is not a member — exactly the 404 the app treats as
  // "absent" in checkGuildBotPresence().
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  json(res, 200, { id: g.id, name: g.name, icon: g.icon });
});

route("GET", new RegExp(`^${API}/guilds/([^/]+)/members/([^/]+)$`), ({ req, res, params }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  const member = g.members[params[1]];
  if (!member) return discordError(res, 404, "Unknown Member", 10007);
  json(res, 200, { user: member.user, roles: member.roles, nick: member.nick });
});

route("GET", new RegExp(`^${API}/guilds/([^/]+)/roles$`), ({ req, res, params }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  json(res, 200, g.roles);
});

route("GET", new RegExp(`^${API}/guilds/([^/]+)/channels$`), ({ req, res, params }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  json(res, 200, g.channels);
});

// ── Scheduled events ────────────────────────────────────────────────────────
function validateScheduledEvent(body) {
  if (!body || typeof body !== "object") return "body must be an object";
  if (!body.name) return "name is required";
  if (body.privacy_level !== 2) return "privacy_level must be 2 (GUILD_ONLY)";
  if (!body.scheduled_start_time) return "scheduled_start_time is required";
  if (body.entity_type === 3) {
    if (!body.scheduled_end_time) return "scheduled_end_time is required for EXTERNAL events";
    if (!body.entity_metadata?.location) return "entity_metadata.location is required for EXTERNAL events";
  } else if (body.entity_type === 2) {
    if (!body.channel_id) return "channel_id is required for VOICE events";
  } else {
    return `unsupported entity_type ${body.entity_type}`;
  }
  return null;
}

route("POST", new RegExp(`^${API}/guilds/([^/]+)/scheduled-events$`), ({ req, res, params, body }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  // Mirror Discord's validation: the app must send a well-formed event or the
  // test fails here rather than silently passing against a permissive stub.
  const problem = validateScheduledEvent(body);
  if (problem) return json(res, 400, { message: problem, code: 50035 });

  const id = nextId();
  const event = {
    id,
    guild_id: g.id,
    name: body.name,
    description: body.description ?? null,
    scheduled_start_time: body.scheduled_start_time,
    scheduled_end_time: body.scheduled_end_time ?? null,
    entity_type: body.entity_type,
    entity_metadata: body.entity_metadata ?? null,
    channel_id: body.channel_id ?? null,
    privacy_level: body.privacy_level,
    status: 1,
    recurrence_rule: body.recurrence_rule ?? null,
    // Images arrive as data: URIs; keep only the fact + size.
    image: body.image ? String(body.image).slice(0, 40) : null,
    interested: [],
    created_at: new Date().toISOString(),
    patches: [],
  };
  g.scheduledEvents[id] = event;
  json(res, 200, event);
});

route("PATCH", new RegExp(`^${API}/guilds/([^/]+)/scheduled-events/([^/]+)$`), ({ req, res, params, body }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  const event = g.scheduledEvents[params[1]];
  if (!event) return discordError(res, 404, "Unknown Guild Scheduled Event", 10070);
  const patch = { ...body };
  if (patch.image) patch.image = String(patch.image).slice(0, 40);
  event.patches.push({ at: new Date().toISOString(), ...patch });
  Object.assign(event, patch);
  json(res, 200, event);
});

route("DELETE", new RegExp(`^${API}/guilds/([^/]+)/scheduled-events/([^/]+)$`), ({ req, res, params }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  if (!g.scheduledEvents[params[1]]) return discordError(res, 404, "Unknown Guild Scheduled Event", 10070);
  delete g.scheduledEvents[params[1]];
  noContent(res);
});

// "Interested" users — paginated exactly like Discord (limit + after cursor) so
// the app's paging loop is exercised, not bypassed.
route("GET", new RegExp(`^${API}/guilds/([^/]+)/scheduled-events/([^/]+)/users$`), ({ req, res, params, url }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const g = state.guilds[params[0]];
  if (!g) return discordError(res, 404, "Unknown Guild", 10004);
  const event = g.scheduledEvents[params[1]];
  if (!event) return discordError(res, 404, "Unknown Guild Scheduled Event", 10070);

  const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 100);
  const after = url.searchParams.get("after");
  const withMember = url.searchParams.get("with_member") === "true";

  const all = event.interested.map((entry) => {
    const user = state.users[entry.userId] ?? { id: entry.userId, username: `user-${entry.userId}`, global_name: null };
    const row = { guild_scheduled_event_id: event.id, user };
    if (withMember) row.member = { nick: entry.nick ?? g.members[entry.userId]?.nick ?? null, roles: g.members[entry.userId]?.roles ?? [] };
    return row;
  });
  const startIdx = after ? all.findIndex((r) => r.user.id === after) + 1 : 0;
  json(res, 200, all.slice(startIdx, startIdx + limit));
});

// ── DMs + channel messages ──────────────────────────────────────────────────
route("POST", new RegExp(`^${API}/users/@me/channels$`), ({ req, res, body }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const recipientId = body?.recipient_id;
  if (!recipientId) return discordError(res, 400, "recipient_id is required");
  const channelId = `dm-${recipientId}`;
  state.dmChannels[channelId] ??= { id: channelId, recipient_id: recipientId, messages: [] };
  json(res, 200, { id: channelId, type: 1, recipients: [{ id: recipientId }] });
});

route("POST", new RegExp(`^${API}/channels/([^/]+)/messages$`), ({ req, res, params, body }) => {
  if (!botAuthed(req)) return discordError(res, 401, "401: Unauthorized");
  const channelId = decodeURIComponent(params[0]);
  const message = {
    id: nextId(),
    channel_id: channelId,
    content: body?.content ?? body?.payload_json?.content ?? "",
    embeds: body?.embeds ?? body?.payload_json?.embeds ?? [],
    components: body?.components ?? body?.payload_json?.components ?? [],
    attachments: body?.files ?? [],
    at: new Date().toISOString(),
  };
  if (state.dmChannels[channelId]) {
    state.dmChannels[channelId].messages.push(message);
  } else {
    const known = Object.values(state.guilds).some((g) => g.channels.some((c) => c.id === channelId));
    // Unknown channel id = the app was configured with a bogus channel. Discord
    // answers 404 here; the feedback-ticket error path depends on that.
    if (!known) return discordError(res, 404, "Unknown Channel", 10003);
    (state.channelMessages[channelId] ??= []).push(message);
  }
  json(res, 200, message);
});

// ── control plane (/__mock/*) ───────────────────────────────────────────────
route("GET", /^\/__mock\/health$/, ({ res }) =>
  json(res, 200, { ok: true, publicKeyHex, guilds: Object.keys(state.guilds).length, calls: state.calls.length }),
);

route("GET", /^\/__mock\/keys$/, ({ res }) => json(res, 200, { publicKeyHex }));

route("POST", /^\/__mock\/reset$/, ({ res }) => {
  state = freshState();
  json(res, 200, { ok: true });
});

route("POST", /^\/__mock\/seed$/, ({ res, body }) => {
  seedState(state, body ?? {});
  json(res, 200, { ok: true, guilds: Object.keys(state.guilds) });
});

route("GET", /^\/__mock\/state$/, ({ res }) => json(res, 200, state));

route("GET", /^\/__mock\/calls$/, ({ res, url }) => {
  const method = url.searchParams.get("method");
  const pathFilter = url.searchParams.get("path");
  const since = url.searchParams.get("since");
  let calls = state.calls;
  if (method) calls = calls.filter((c) => c.method === method.toUpperCase());
  if (pathFilter) calls = calls.filter((c) => c.path.includes(pathFilter));
  if (since) calls = calls.filter((c) => c.at >= since);
  json(res, 200, calls);
});

route("POST", /^\/__mock\/calls\/clear$/, ({ res }) => {
  state.calls = [];
  json(res, 200, { ok: true });
});

// Which Discord user the next OAuth login authenticates as.
route("POST", /^\/__mock\/login-as$/, ({ res, body }) => {
  if (!body?.id) return json(res, 400, { error: "id is required" });
  const user = addUser(state, body);
  state.loginAs = user.id;
  for (const guildId of body.guildIds ?? []) joinGuild(state, guildId, user.id, body.roles ?? []);
  json(res, 200, { ok: true, user });
});

// Mark users as "Interested" in a scheduled event (drives eventInterest sync).
route("POST", /^\/__mock\/interest$/, ({ res, body }) => {
  const g = state.guilds[body?.guildId];
  if (!g) return json(res, 404, { error: "unknown guild" });
  const event = g.scheduledEvents[body?.eventId];
  if (!event) return json(res, 404, { error: "unknown event" });
  event.interested = (body.users ?? []).map((u) => {
    if (u.username) addUser(state, { id: u.id, username: u.username, global_name: u.global_name });
    return { userId: u.id, nick: u.nick ?? null };
  });
  json(res, 200, { ok: true, interested: event.interested.length });
});

// Fault injection: [{ method, path (glob), status, body, times }]
route("POST", /^\/__mock\/faults$/, ({ res, body }) => {
  state.faults = Array.isArray(body) ? body : (body?.faults ?? []);
  json(res, 200, { ok: true, faults: state.faults.length });
});

// ── the return path: sign an interaction and POST it to the app ─────────────
route("POST", /^\/__mock\/interaction$/, async ({ res, body }) => {
  const target = body?.url ?? APP_INTERACTIONS_URL;
  const payload = body?.payload ?? {
    // Default: a component (button) press, which is all FR-P1 needs.
    type: 3,
    data: { custom_id: body?.customId ?? "", component_type: 2 },
    member: { user: { id: body?.discordUserId ?? state.loginAs ?? "0" } },
    guild_id: body?.guildId,
    id: nextId(),
    application_id: state.bot.id,
    token: `mock-interaction-${randomUUID()}`,
    version: 1,
  };
  const rawBody = JSON.stringify(payload);
  const timestamp = body?.timestamp ?? String(Math.floor(Date.now() / 1000));
  // A deliberately wrong signature lets a test prove the app REJECTS unsigned
  // interactions — the security property that endpoint exists for.
  const signature = body?.badSignature
    ? "00".repeat(64)
    : edSign(null, Buffer.from(timestamp + rawBody), privateKey).toString("hex");

  try {
    const upstream = await fetch(target, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-signature-ed25519": signature,
        "x-signature-timestamp": timestamp,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    const text = await upstream.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* non-JSON error body */
    }
    json(res, 200, { status: upstream.status, body: parsed ?? text, sentPayload: payload });
  } catch (err) {
    json(res, 502, { error: String(err?.message ?? err), target });
  }
});

// ── dispatcher ──────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "discord-mock"}`);
  const raw = await readBody(req);
  const parsed = parseBody(raw, req.headers["content-type"]);
  const isControl = url.pathname.startsWith("/__mock/");
  if (!isControl) record(req, url, parsed);

  if (!isControl) {
    const fault = takeFault(req.method ?? "GET", url.pathname);
    if (fault) {
      return json(res, fault.status ?? 500, fault.body ?? { message: "injected failure", code: 0 });
    }
  }

  for (const r of routes) {
    if (r.method !== req.method) continue;
    const match = r.pattern.exec(url.pathname);
    if (!match) continue;
    try {
      await r.handler({ req, res, url, body: parsed, params: match.slice(1).map(decodeURIComponent) });
    } catch (err) {
      console.error("[discord-mock] handler error", err);
      if (!res.headersSent) json(res, 500, { message: String(err?.message ?? err) });
    }
    return;
  }
  json(res, 404, { message: `discord-mock has no route for ${req.method} ${url.pathname}`, code: 0 });
});

server.listen(PORT, HOST, () => {
  console.log(`[discord-mock] listening on http://${HOST}:${PORT}`);
  console.log(`[discord-mock] interaction public key: ${publicKeyHex}`);
  console.log(`[discord-mock] interactions target:    ${APP_INTERACTIONS_URL}`);
});
