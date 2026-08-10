// Client for the Discord simulator's control plane (tests/discord-mock).
//
// Specs use this to (a) shape what Discord "contains", (b) assert what the app
// sent to Discord, and (c) push signed interactions back into the app. Without
// E2E_DISCORD_MOCK_URL every helper throws — the Discord specs guard with
// `test.skip(!discordMockAvailable())` so a run against a live instance simply
// skips them instead of failing.
import { request, type APIRequestContext } from "@playwright/test";
import { DISCORD_MOCK_URL } from "./env.js";

export const E2E_GUILD_ID = "100000000000000001";
export const E2E_GUILD_ID_2 = "100000000000000002";

export function discordMockAvailable(): boolean {
  return DISCORD_MOCK_URL.length > 0;
}

let ctx: APIRequestContext | null = null;
async function mock(): Promise<APIRequestContext> {
  if (!discordMockAvailable()) {
    throw new Error("E2E_DISCORD_MOCK_URL is not set — the Discord simulator is not reachable.");
  }
  ctx ??= await request.newContext({ baseURL: DISCORD_MOCK_URL });
  return ctx;
}

export async function disposeDiscordMock(): Promise<void> {
  await ctx?.dispose();
  ctx = null;
}

async function post<T>(path: string, data?: unknown): Promise<T> {
  const res = await (await mock()).post(path, data === undefined ? {} : { data });
  if (!res.ok()) throw new Error(`discord-mock ${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

async function get<T>(path: string): Promise<T> {
  const res = await (await mock()).get(path);
  if (!res.ok()) throw new Error(`discord-mock ${path} → ${res.status()} ${await res.text()}`);
  return (await res.json()) as T;
}

// ── shaping ─────────────────────────────────────────────────────────

/** Wipe the simulator back to its seeded baseline (2 guilds, 1 user). */
export const resetDiscord = () => post<{ ok: true }>("/__mock/reset");

/** Merge a state fragment: `{ guilds, users, members: [{guildId,userId,roles}] }`. */
export const seedDiscord = (fragment: Record<string, unknown>) => post<{ ok: true }>("/__mock/seed", fragment);

/** Who the next OAuth login authenticates as. */
export const loginAs = (user: {
  id: string;
  username: string;
  global_name?: string;
  email?: string;
  guildIds?: string[];
  roles?: string[];
}) => post<{ ok: true }>("/__mock/login-as", user);

/** Mark Discord users as "Interested" in a scheduled event. */
export const setInterested = (
  guildId: string,
  eventId: string,
  users: Array<{ id: string; username?: string; nick?: string }>,
) => post<{ ok: true; interested: number }>("/__mock/interest", { guildId, eventId, users });

/**
 * Make Discord fail. `path` is a glob over the API path.
 *   injectFaults([{ method: "POST", path: "/api/v10/guilds/*\/scheduled-events", status: 429, times: 1 }])
 */
export const injectFaults = (
  faults: Array<{ method?: string; path: string; status: number; body?: unknown; times?: number }>,
) => post<{ ok: true }>("/__mock/faults", faults);

export const clearFaults = () => injectFaults([]);

// ── assertion surface ───────────────────────────────────────────────

export type MockScheduledEvent = {
  id: string;
  guild_id: string;
  name: string;
  description: string | null;
  scheduled_start_time: string;
  scheduled_end_time: string | null;
  entity_type: number;
  entity_metadata: { location?: string } | null;
  channel_id: string | null;
  recurrence_rule: unknown;
  image: string | null;
  patches: Array<Record<string, unknown>>;
};

export type MockState = {
  bot: { id: string; username: string };
  guilds: Record<string, {
    id: string;
    name: string;
    roles: Array<{ id: string; name: string; permissions: string }>;
    channels: Array<{ id: string; name: string; type: number }>;
    members: Record<string, { user: { id: string; username: string }; roles: string[]; nick: string | null }>;
    scheduledEvents: Record<string, MockScheduledEvent>;
  }>;
  dmChannels: Record<string, { id: string; recipient_id: string; messages: Array<{ content: string; embeds: unknown[]; components: unknown[] }> }>;
  channelMessages: Record<string, Array<{ content: string; attachments: Array<{ filename: string; bytes: number }> }>>;
};

export const discordState = () => get<MockState>("/__mock/state");

export type MockCall = {
  at: string;
  method: string;
  path: string;
  query: Record<string, string>;
  auth: "bot" | "bearer" | "none";
  body: Record<string, unknown> | null;
};

export const discordCalls = (filter: { method?: string; path?: string; since?: string } = {}) => {
  const q = new URLSearchParams();
  if (filter.method) q.set("method", filter.method);
  if (filter.path) q.set("path", filter.path);
  if (filter.since) q.set("since", filter.since);
  return get<MockCall[]>(`/__mock/calls${q.toString() ? `?${q}` : ""}`);
};

export const clearDiscordCalls = () => post<{ ok: true }>("/__mock/calls/clear");

/** All scheduled events in a guild, newest last. */
export async function scheduledEvents(guildId = E2E_GUILD_ID): Promise<MockScheduledEvent[]> {
  const state = await discordState();
  return Object.values(state.guilds[guildId]?.scheduledEvents ?? {});
}

/** The DM messages the bot sent to one Discord user. */
export async function dmsTo(discordUserId: string) {
  const state = await discordState();
  return state.dmChannels[`dm-${discordUserId}`]?.messages ?? [];
}

/** Messages posted to a guild text channel (feedback tickets, announcements). */
export async function channelMessages(channelId: string) {
  const state = await discordState();
  return state.channelMessages[channelId] ?? [];
}

// ── the return path: signed interactions ────────────────────────────

/**
 * Press a Discord message-component button as `discordUserId`. The simulator
 * signs the payload with the Ed25519 key the app verifies against, so this
 * exercises the real signature path — not a test-only bypass.
 */
export const pressButton = (opts: { customId: string; discordUserId: string; guildId?: string }) =>
  post<{ status: number; body: { type?: number; data?: { content?: string } } | string }>(
    "/__mock/interaction",
    opts,
  );

/** Same, but with a deliberately invalid signature — must be rejected (401). */
export const pressButtonUnsigned = (opts: { customId: string; discordUserId: string }) =>
  post<{ status: number; body: unknown }>("/__mock/interaction", { ...opts, badSignature: true });

/** Discord's endpoint-validation PING handshake. */
export const sendPing = () =>
  post<{ status: number; body: { type?: number } }>("/__mock/interaction", { payload: { type: 1 } });

/**
 * Poll until `predicate` holds. Several app→Discord paths are fire-and-forget
 * or scheduler-driven, so specs need a bounded wait rather than a sleep.
 */
export async function waitFor<T>(
  produce: () => Promise<T>,
  predicate: (value: T) => boolean,
  { timeoutMs = 15_000, intervalMs = 500, what = "condition" } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last: T = await produce();
  while (Date.now() < deadline) {
    if (predicate(last)) return last;
    await new Promise((r) => setTimeout(r, intervalMs));
    last = await produce();
  }
  throw new Error(`timed out after ${timeoutMs}ms waiting for ${what}; last value: ${JSON.stringify(last).slice(0, 800)}`);
}
