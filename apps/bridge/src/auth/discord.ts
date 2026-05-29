import { z } from "zod";

const DISCORD_API = "https://discord.com/api/v10";

const tokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.string(),
  expires_in: z.number(),
  refresh_token: z.string().optional(),
  scope: z.string(),
});

export type TokenResponse = z.infer<typeof tokenResponseSchema>;

const userSchema = z.object({
  id: z.string().regex(/^[0-9]{17,20}$/),
  username: z.string(),
  global_name: z.string().nullable().optional(),
});

export type DiscordUser = z.infer<typeof userSchema>;

const memberSchema = z.object({
  user: userSchema.optional(),
  nick: z.string().nullable().optional(),
  roles: z.array(z.string().regex(/^[0-9]{17,20}$/)),
});

export type DiscordGuildMember = z.infer<typeof memberSchema>;

export type DiscordHttpError = {
  kind: "http_error";
  status: number;
  message: string;
};

export type DiscordResult<T> = { ok: true; value: T } | { ok: false; error: DiscordHttpError };

async function postForm(url: string, body: Record<string, string>): Promise<Response> {
  return await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });
}

/**
 * Wraps fetch with one retry on HTTP 429 honoring Discord's Retry-After
 * header (in seconds). Bounded so we never block forever — the cap is
 * 15 seconds because Discord's PATCH /channels rate-limit can quote a
 * retry-after up to ~10s, and we want to ride that through rather
 * than fail with the user clicking "Rename" twice in a row. Above the
 * cap we surface the 429 to the caller (they can decide whether to
 * tell the user to wait longer, or apply ducking / batching).
 */
async function fetchWithRateLimit(input: string, init?: RequestInit): Promise<Response> {
  const first = await fetch(input, init);
  if (first.status !== 429) return first;
  const retryAfterRaw = first.headers.get("retry-after") ?? "1";
  const retryAfterSec = Number.parseFloat(retryAfterRaw);
  if (!isFinite(retryAfterSec) || retryAfterSec > 15) return first;
  const retryAfterMs = retryAfterSec * 1000;
  await new Promise((resolve) => setTimeout(resolve, retryAfterMs));
  return await fetch(input, init);
}

export async function exchangeCodeForToken(opts: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<DiscordResult<TokenResponse>> {
  const res = await postForm(`${DISCORD_API}/oauth2/token`, {
    client_id: opts.clientId,
    client_secret: opts.clientSecret,
    grant_type: "authorization_code",
    code: opts.code,
    redirect_uri: opts.redirectUri,
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const parsed = tokenResponseSchema.safeParse(await res.json());
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        kind: "http_error",
        status: 502,
        message: "discord token response shape unexpected",
      },
    };
  }
  return { ok: true, value: parsed.data };
}

export async function fetchCurrentUser(accessToken: string): Promise<DiscordResult<DiscordUser>> {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const parsed = userSchema.safeParse(await res.json());
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "discord user shape unexpected" },
    };
  }
  return { ok: true, value: parsed.data };
}

/**
 * 404 from `/guilds/{gid}/members/{uid}` is ambiguous: either the bot
 * isn't a member of the guild (Unknown Guild — code 10004) or the user
 * isn't a member (Unknown Member — code 10007). Callers care about
 * the difference for the error message they show. We expose it via a
 * tagged variant on the null result.
 */
export type GuildMemberLookup =
  | { present: true; member: DiscordGuildMember }
  | { present: false; reason: "bot_not_in_guild" | "user_not_in_guild" | "unknown" };

export async function fetchGuildMember(opts: {
  botToken: string;
  guildId: string;
  userId: string;
}): Promise<DiscordResult<GuildMemberLookup>> {
  const res = await fetchWithRateLimit(
    `${DISCORD_API}/guilds/${opts.guildId}/members/${opts.userId}`,
    {
      headers: { Authorization: `Bot ${opts.botToken}` },
    },
  );
  if (res.status === 404) {
    const body = await res.text();
    let reason: "bot_not_in_guild" | "user_not_in_guild" | "unknown" = "unknown";
    try {
      const parsed = JSON.parse(body) as { code?: number };
      if (parsed.code === 10004) reason = "bot_not_in_guild";
      else if (parsed.code === 10007) reason = "user_not_in_guild";
    } catch {
      // fall through with reason=unknown
    }
    return { ok: true, value: { present: false, reason } };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const parsed = memberSchema.safeParse(await res.json());
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "discord member shape unexpected" },
    };
  }
  return { ok: true, value: { present: true, member: parsed.data } };
}

/**
 * Strip a single role from a guild member. Requires the bot to have
 * Manage Roles permission AND the role being removed must rank below
 * the bot's highest role in the guild role hierarchy — Discord
 * enforces this server-side and returns 403 if violated.
 */
export async function removeGuildMemberRole(opts: {
  botToken: string;
  guildId: string;
  userId: string;
  roleId: string;
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(
    `${DISCORD_API}/guilds/${opts.guildId}/members/${opts.userId}/roles/${opts.roleId}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bot ${opts.botToken}` },
    },
  );
  // 204 No Content = success; 404 also counts as success (role
  // already gone — idempotent from the caller's POV).
  if (res.status === 204 || res.status === 404) {
    return { ok: true, value: true };
  }
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}

/**
 * Add a single role to a guild member. Same hierarchy + permission
 * rules as removeGuildMemberRole (Manage Roles + role-below-bot).
 */
export async function addGuildMemberRole(opts: {
  botToken: string;
  guildId: string;
  userId: string;
  roleId: string;
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(
    `${DISCORD_API}/guilds/${opts.guildId}/members/${opts.userId}/roles/${opts.roleId}`,
    {
      method: "PUT",
      headers: { Authorization: `Bot ${opts.botToken}` },
    },
  );
  if (res.status === 204) {
    return { ok: true, value: true };
  }
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}

/**
 * Move a guild member to a different voice channel (or kick them out
 * of voice with channelId=null). Requires the bot to have Move Members
 * permission AND the user must currently BE in voice — Discord rejects
 * the call with 400 otherwise. Pass channelId=null to disconnect.
 */
export async function moveGuildMember(opts: {
  botToken: string;
  guildId: string;
  userId: string;
  channelId: string | null;
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(
    `${DISCORD_API}/guilds/${opts.guildId}/members/${opts.userId}`,
    {
      method: "PATCH",
      headers: {
        Authorization: `Bot ${opts.botToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ channel_id: opts.channelId }),
    },
  );
  if (res.ok) return { ok: true, value: true };
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}

/**
 * Rename a Discord channel (or change any other modifiable property,
 * but rename is the only one we currently expose). Requires Manage
 * Channels in the target channel's category.
 */
export async function modifyChannel(opts: {
  botToken: string;
  channelId: string;
  body: { name?: string };
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/channels/${opts.channelId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.body),
  });
  if (res.ok) return { ok: true, value: true };
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}

const guildChannelSchema = z.object({
  id: z.string().regex(/^[0-9]{17,20}$/),
  name: z.string(),
  // Discord channel types: 0 = text, 2 = voice, 4 = category, 13 = stage, ...
  type: z.number().int(),
  position: z.number().int().optional(),
  parent_id: z.string().regex(/^[0-9]{17,20}$/).nullable().optional(),
});

export type DiscordGuildChannel = z.infer<typeof guildChannelSchema>;

/**
 * List every channel in a guild. Bot needs to be a member of the
 * guild (no special permission beyond that). We filter callers-side
 * for voice channels (type 2) etc.
 */
export async function fetchGuildChannels(opts: {
  botToken: string;
  guildId: string;
}): Promise<DiscordResult<DiscordGuildChannel[]>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/guilds/${opts.guildId}/channels`, {
    headers: { Authorization: `Bot ${opts.botToken}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "guild channels not an array" },
    };
  }
  const parsed: DiscordGuildChannel[] = [];
  for (const c of raw) {
    const r = guildChannelSchema.safeParse(c);
    if (r.success) parsed.push(r.data);
  }
  return { ok: true, value: parsed };
}

const guildRoleSchema = z.object({
  id: z.string().regex(/^[0-9]{17,20}$/),
  name: z.string(),
  position: z.number().int(),
});

export type DiscordGuildRole = z.infer<typeof guildRoleSchema>;

/**
 * List every role in a guild. Used to populate the Role-Assign
 * dropdown in the admin UI so we don't display raw snowflakes.
 */
export async function fetchGuildRoles(opts: {
  botToken: string;
  guildId: string;
}): Promise<DiscordResult<DiscordGuildRole[]>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/guilds/${opts.guildId}/roles`, {
    headers: { Authorization: `Bot ${opts.botToken}` },
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const raw: unknown = await res.json();
  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "guild roles not an array" },
    };
  }
  const parsed: DiscordGuildRole[] = [];
  for (const r of raw) {
    const result = guildRoleSchema.safeParse(r);
    if (result.success) parsed.push(result.data);
  }
  return { ok: true, value: parsed };
}

/**
 * Open a DM channel with a user, then send a message into it.
 * Two-step Discord-REST flow: first POST /users/@me/channels which
 * creates-or-returns the existing DM channel, then post to that
 * channel's messages endpoint. Bots can DM any user that shares a
 * guild with them; the recipient can also have closed DMs and
 * Discord will then return a 403 — we surface that as an http_error.
 */
export async function sendDirectMessage(opts: {
  botToken: string;
  userId: string;
  content: string;
}): Promise<DiscordResult<true>> {
  const dmRes = await fetchWithRateLimit(`${DISCORD_API}/users/@me/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ recipient_id: opts.userId }),
  });
  if (!dmRes.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: dmRes.status, message: await dmRes.text() },
    };
  }
  const dmJson = (await dmRes.json()) as { id?: string };
  if (!dmJson.id) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "create-dm response missing id" },
    };
  }
  const msgRes = await fetchWithRateLimit(`${DISCORD_API}/channels/${dmJson.id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ content: opts.content }),
  });
  if (!msgRes.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: msgRes.status, message: await msgRes.text() },
    };
  }
  return { ok: true, value: true };
}

export function buildAuthorizeUrl(opts: {
  clientId: string;
  redirectUri: string;
  state: string;
  scope?: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: opts.clientId,
    scope: opts.scope ?? "identify guilds.members.read",
    redirect_uri: opts.redirectUri,
    state: opts.state,
    prompt: "consent",
  });
  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

export async function createGuildVoiceChannel(opts: {
  botToken: string;
  guildId: string;
  name: string;
  parentId: string | null;
}): Promise<DiscordResult<DiscordGuildChannel>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/guilds/${opts.guildId}/channels`, {
    method: "POST",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: opts.name,
      type: 2,
      parent_id: opts.parentId ?? undefined,
    }),
  });
  if (!res.ok) {
    return {
      ok: false,
      error: { kind: "http_error", status: res.status, message: await res.text() },
    };
  }
  const raw: unknown = await res.json();
  const parsed = guildChannelSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      error: { kind: "http_error", status: 502, message: "create-channel response malformed" },
    };
  }
  return { ok: true, value: parsed.data };
}

export async function bulkModifyChannelPositions(opts: {
  botToken: string;
  guildId: string;
  items: Array<{ id: string; position: number }>;
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/guilds/${opts.guildId}/channels`, {
    method: "PATCH",
    headers: {
      Authorization: `Bot ${opts.botToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.items),
  });
  if (res.ok || res.status === 204) return { ok: true, value: true };
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}

export async function deleteChannel(opts: {
  botToken: string;
  channelId: string;
}): Promise<DiscordResult<true>> {
  const res = await fetchWithRateLimit(`${DISCORD_API}/channels/${opts.channelId}`, {
    method: "DELETE",
    headers: { Authorization: `Bot ${opts.botToken}` },
  });
  if (res.ok || res.status === 404) return { ok: true, value: true };
  return {
    ok: false,
    error: { kind: "http_error", status: res.status, message: await res.text() },
  };
}
