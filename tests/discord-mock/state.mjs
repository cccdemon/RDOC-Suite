// In-memory Discord state for the simulator. Deliberately plain objects — the
// whole point is that a test can GET /__mock/state and assert on it, and POST
// /__mock/seed to shape it, without knowing anything about the implementation.

/** Snowflake-ish ids. Monotonic so ordering assertions (`after=` paging) hold. */
let counter = 1_000_000_000_000_000_000n;
export function nextId() {
  counter += 1n;
  return counter.toString();
}

export const E2E_GUILD_ID = "100000000000000001";
export const E2E_GUILD_ID_2 = "100000000000000002";

/** Discord channel types we care about. */
export const CHANNEL_TEXT = 0;
export const CHANNEL_VOICE = 2;
export const CHANNEL_ANNOUNCEMENT = 5;

function guild(id, name, extra = {}) {
  return {
    id,
    name,
    icon: null,
    roles: [
      { id: `${id}0`, name: "@everyone", permissions: "104324673" },
      { id: `${id}1`, name: "Admiral", permissions: "8" },
      { id: `${id}2`, name: "Captain", permissions: "0" },
      { id: `${id}3`, name: "Crew", permissions: "0" },
    ],
    channels: [
      { id: `${id}90`, name: "allgemein", type: CHANNEL_TEXT },
      { id: `${id}91`, name: "feedback", type: CHANNEL_TEXT },
      { id: `${id}92`, name: "ankuendigungen", type: CHANNEL_ANNOUNCEMENT },
      { id: `${id}93`, name: "Ops-Voice", type: CHANNEL_VOICE },
    ],
    /** discordUserId → { user, roles, nick } */
    members: {},
    /** eventId → scheduled event object */
    scheduledEvents: {},
    ...extra,
  };
}

export function freshState() {
  const g1 = guild(E2E_GUILD_ID, "E2E-Testserver");
  const g2 = guild(E2E_GUILD_ID_2, "E2E-Testserver-2");
  const state = {
    /** The bot the app authenticates as (`Authorization: Bot …`). */
    bot: { id: "900000000000000001", username: "RDOC-Fleetplanner-Mock" },
    guilds: { [g1.id]: g1, [g2.id]: g2 },
    /** discordUserId → user object (the Discord "global" user directory). */
    users: {},
    /** DM channel id → { recipient_id, messages: [] } */
    dmChannels: {},
    /** channel id → messages[] (guild text channels; feedback tickets land here) */
    channelMessages: {},
    /** OAuth: code → discordUserId, accessToken → discordUserId */
    oauthCodes: {},
    oauthTokens: {},
    /** Who /oauth2/authorize signs in as when the browser is redirected there. */
    loginAs: null,
    /** Recorded requests — the assertion surface for "did the app call Discord?" */
    calls: [],
    /** Fault injection: [{ method, pathPattern, status, body, times }] */
    faults: [],
  };
  addUser(state, {
    id: "200000000000000001",
    username: "e2e-operator",
    global_name: "E2E Operator",
    email: "e2e-operator@example.invalid",
  });
  joinGuild(state, E2E_GUILD_ID, "200000000000000001", [`${E2E_GUILD_ID}1`]);
  return state;
}

export function addUser(state, user) {
  state.users[user.id] = {
    id: user.id,
    username: user.username,
    global_name: user.global_name ?? user.username,
    avatar: user.avatar ?? null,
    email: user.email ?? null,
    bot: user.bot ?? false,
  };
  return state.users[user.id];
}

export function joinGuild(state, guildId, userId, roles = [], nick = null) {
  const g = state.guilds[guildId];
  if (!g) return null;
  const user = state.users[userId] ?? addUser(state, { id: userId, username: `user-${userId}` });
  g.members[userId] = { user, roles, nick };
  return g.members[userId];
}

/**
 * Merge a partial state fragment (from POST /__mock/seed). Shallow per top-level
 * key, but guilds merge per guild so a test can add a channel without restating
 * the whole guild.
 */
export function seedState(state, fragment) {
  for (const [key, value] of Object.entries(fragment ?? {})) {
    if (key === "guilds") {
      for (const [gid, g] of Object.entries(value)) {
        state.guilds[gid] = { ...(state.guilds[gid] ?? guild(gid, g.name ?? `Guild ${gid}`)), ...g };
      }
    } else if (key === "users") {
      for (const u of Object.values(value)) addUser(state, u);
    } else if (key === "members") {
      // [{ guildId, userId, roles, nick }]
      for (const m of value) joinGuild(state, m.guildId, m.userId, m.roles ?? [], m.nick ?? null);
    } else {
      state[key] = value;
    }
  }
  return state;
}
