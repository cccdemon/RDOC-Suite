import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

// The Discord base URL is read per call from the env, so a test can point the
// whole service at a fake host and assert on the exact URLs it builds.
process.env.DISCORD_API_BASE = "http://discord.test/api/v10";
process.env.DISCORD_SITE_BASE = "http://discord.test";
process.env.DISCORD_FLEETPLANNER_BOT_TOKEN = "unit-test-bot-token";
process.env.WEB_PUBLIC_URL = "http://app.test";
process.env.PUBLIC_BASE_PATH = "";
// Fixed Ed25519 test key - same seed the Discord simulator uses
// (tests/discord-mock). getEnv() caches, so it has to be set before any import.
process.env.DISCORD_FLEETPLANNER_PUBLIC_KEY =
  "7dc71677aeadc6971e9f91d8903345fe531bab14c92ab3dbd55d5a06fdea91f2";

vi.mock("../../db.js", () => ({
  prisma: {
    userIdentity: { findFirst: vi.fn() },
  },
}));

// sharp is a native module and the op-type images are irrelevant to what this
// service is responsible for (building the right requests).
vi.mock("sharp", () => ({
  default: () => ({
    resize: () => ({ jpeg: () => ({ toBuffer: async () => Buffer.from("fake-jpeg") }) }),
  }),
}));

import { prisma } from "../../db.js";
import {
  createScheduledEvent,
  createPartnerScheduledEvent,
  deleteScheduledEvent,
  discordInviteUrl,
  discordUserIdForFleetplannerUser,
  fetchBotIdentity,
  fetchGuildBasic,
  fetchGuildMemberRoles,
  fetchGuildRolesByBot,
  fetchGuildTextChannels,
  checkGuildBotPresence,
  listScheduledEventUsers,
  sendDiscordChannelMessage,
  sendDiscordDm,
  updateScheduledEvent,
  verifyDiscordInteraction,
} from "../../services/discord.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

type Call = { url: string; init: RequestInit };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

function mockFetch(responder: (url: string, init: RequestInit) => unknown) {
  globalThis.fetch = vi.fn(async (input: unknown, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const result = responder(url, init);
    return result as Response;
  }) as unknown as typeof fetch;
}

const ok = (body: unknown, status = 200) =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: String(status),
    json: async () => body,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(8),
  }) as unknown as Response;

const body = (call: Call) => JSON.parse(String(call.init.body));

beforeEach(() => {
  vi.clearAllMocks();
  calls = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("discordInviteUrl", () => {
  it("builds a bot invite against the configured site base", () => {
    const url = discordInviteUrl({ clientId: "123", permissions: "8", guildId: "999" });
    expect(url.startsWith("http://discord.test/oauth2/authorize?")).toBe(true);
    const params = new URL(url).searchParams;
    expect(params.get("client_id")).toBe("123");
    expect(params.get("scope")).toBe("bot applications.commands");
    expect(params.get("guild_id")).toBe("999");
    expect(params.get("disable_guild_select")).toBe("true");
  });

  it("can request the bot scope alone", () => {
    const url = discordInviteUrl({ clientId: "1", permissions: "0", applicationsCommands: false });
    expect(new URL(url).searchParams.get("scope")).toBe("bot");
  });
});

describe("discordUserIdForFleetplannerUser", () => {
  it("returns the linked Discord identity", async () => {
    db.userIdentity.findFirst.mockResolvedValue({ providerId: "42" });
    expect(await discordUserIdForFleetplannerUser("u1")).toBe("42");
  });

  it("falls back to a legacy snowflake user id", async () => {
    db.userIdentity.findFirst.mockResolvedValue(null);
    expect(await discordUserIdForFleetplannerUser("123456789012345678")).toBe("123456789012345678");
  });

  it("throws when the user has no Discord at all", async () => {
    db.userIdentity.findFirst.mockResolvedValue(null);
    await expect(discordUserIdForFleetplannerUser("cuid-user")).rejects.toThrow(/no linked Discord/i);
  });
});

describe("bot REST reads", () => {
  it("authenticates every read with the bot token", async () => {
    mockFetch(() => ok({ id: "g1", name: "Guild", icon: null }));
    await fetchGuildBasic("g1");
    expect(calls[0].url).toBe("http://discord.test/api/v10/guilds/g1");
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bot unit-test-bot-token");
  });

  it("collapses a failed guild read to null", async () => {
    mockFetch(() => ok({ message: "Unknown Guild" }, 404));
    expect(await fetchGuildBasic("gone")).toBeNull();
  });

  it("distinguishes an absent bot from an unreachable Discord", async () => {
    mockFetch(() => ok({}, 200));
    expect(await checkGuildBotPresence("g1")).toBe("present");
    mockFetch(() => ok({}, 403));
    expect(await checkGuildBotPresence("g1")).toBe("absent");
    mockFetch(() => ok({}, 404));
    expect(await checkGuildBotPresence("g1")).toBe("absent");
    // A rate limit or an outage must NEVER read as "the bot was kicked" — that
    // would deactivate a live guild.
    mockFetch(() => ok({}, 429));
    expect(await checkGuildBotPresence("g1")).toBe("unknown");
    mockFetch(() => ok({}, 503));
    expect(await checkGuildBotPresence("g1")).toBe("unknown");
    mockFetch(() => {
      throw new Error("network down");
    });
    expect(await checkGuildBotPresence("g1")).toBe("unknown");
  });

  it("returns member roles, and null when the member is unknown", async () => {
    mockFetch(() => ok({ roles: ["r1", "r2"] }));
    expect(await fetchGuildMemberRoles("g1", "u1")).toEqual(["r1", "r2"]);
    mockFetch(() => ok({}, 404));
    expect(await fetchGuildMemberRoles("g1", "u1")).toBeNull();
  });

  it("returns a member without roles as an empty list, not null", async () => {
    mockFetch(() => ok({}));
    expect(await fetchGuildMemberRoles("g1", "u1")).toEqual([]);
  });

  it("passes guild roles through unchanged", async () => {
    const roles = [{ id: "r1", name: "Admiral", permissions: "8" }];
    mockFetch(() => ok(roles));
    expect(await fetchGuildRolesByBot("g1")).toEqual(roles);
  });

  it("keeps only text and announcement channels, sorted by name", async () => {
    mockFetch(() =>
      ok([
        { id: "c3", name: "zulu", type: 0 },
        { id: "c1", name: "alpha", type: 5 },
        { id: "c2", name: "voice", type: 2 },
        { id: "c4", name: "category", type: 4 },
      ]),
    );
    expect(await fetchGuildTextChannels("g1")).toEqual([
      { id: "c1", name: "alpha" },
      { id: "c3", name: "zulu" },
    ]);
  });

  it("returns no channels rather than throwing when Discord refuses", async () => {
    mockFetch(() => ok({ message: "Missing Access" }, 403));
    expect(await fetchGuildTextChannels("g1")).toEqual([]);
  });

  it("validates a bot token via users/@me", async () => {
    mockFetch(() => ok({ id: "b1", username: "TestBot" }));
    expect(await fetchBotIdentity("  some-token  ")).toEqual({ id: "b1", username: "TestBot" });
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe("Bot some-token");
    mockFetch(() => ok({ message: "401: Unauthorized" }, 401));
    expect(await fetchBotIdentity("bad")).toBeNull();
    expect(await fetchBotIdentity("   ")).toBeNull();
  });
});

describe("createScheduledEvent", () => {
  const op = {
    id: "op1",
    guildId: "g1",
    title: "Xenothreat",
    description: "Push them back.",
    scheduledAt: new Date("2026-09-01T18:00:00.000Z"),
  };

  it("creates an EXTERNAL event that links to the op page", async () => {
    mockFetch((url, init) => (init.method === "POST" ? ok({ id: "e1" }) : ok({})));
    const result = await createScheduledEvent(op);
    expect(result).toEqual({ id: "e1" });

    const create = body(calls[0]);
    expect(create.entity_type).toBe(3);
    expect(create.privacy_level).toBe(2);
    expect(create.entity_metadata.location).toBe("http://app.test/ops/op1");
    // Discord requires an end time for EXTERNAL events; the app uses +3h.
    expect(create.scheduled_end_time).toBe("2026-09-01T21:00:00.000Z");
  });

  it("creates a VOICE event when the op has a voice channel", async () => {
    mockFetch((_url, init) => (init.method === "POST" ? ok({ id: "e2" }) : ok({})));
    await createScheduledEvent({ ...op, eventVoiceChannelId: "chan-1" });
    const create = body(calls[0]);
    expect(create.entity_type).toBe(2);
    expect(create.channel_id).toBe("chan-1");
    expect(create.entity_metadata).toBeUndefined();
  });

  it("patches the description afterwards so the op link is first", async () => {
    mockFetch((_url, init) => (init.method === "POST" ? ok({ id: "e1" }) : ok({})));
    await createScheduledEvent(op);
    const patch = calls.find((c) => c.init.method === "PATCH")!;
    expect(patch.url).toBe("http://discord.test/api/v10/guilds/g1/scheduled-events/e1");
    expect(body(patch).description).toContain("http://app.test/ops/op1");
    expect(body(patch).description).toContain("Push them back.");
  });

  it("marks a stream op in the event name", async () => {
    mockFetch((_url, init) => (init.method === "POST" ? ok({ id: "e1" }) : ok({})));
    await createScheduledEvent({ ...op, isStreamEvent: true });
    expect(body(calls[0]).name).toBe("\u{1F7E3} Xenothreat");
  });

  it("throws with Discord's own status and message when creation fails", async () => {
    mockFetch(() => ok({ message: "Missing Permissions" }, 403));
    await expect(createScheduledEvent(op)).rejects.toThrow(/403/);
  });
});

describe("updateScheduledEvent", () => {
  it("patches the existing event in place", async () => {
    mockFetch(() => ok({ id: "e1" }));
    await updateScheduledEvent({
      id: "op1",
      guildId: "g1",
      title: "New Title",
      description: "New brief.",
      scheduledAt: new Date("2026-09-02T18:00:00.000Z"),
      discordEventId: "e1",
    });
    expect(calls[0].url).toBe("http://discord.test/api/v10/guilds/g1/scheduled-events/e1");
    expect(calls[0].init.method).toBe("PATCH");
    expect(body(calls[0]).name).toBe("New Title");
  });

  it("throws on a failed patch so the caller can log it", async () => {
    mockFetch(() => ok({ message: "Unknown Event" }, 404));
    await expect(
      updateScheduledEvent({
        id: "op1",
        guildId: "g1",
        title: "T",
        description: "",
        scheduledAt: new Date(),
        discordEventId: "gone",
      }),
    ).rejects.toThrow(/404/);
  });
});

describe("createPartnerScheduledEvent", () => {
  it("posts into the partner guild but keeps the host op link", async () => {
    mockFetch(() => ok({ id: "pe1" }));
    const result = await createPartnerScheduledEvent("partner-guild", {
      id: "op1",
      title: "Joint Op",
      description: "Together.",
      scheduledAt: new Date("2026-09-01T18:00:00.000Z"),
    });
    expect(result).toEqual({ id: "pe1" });
    expect(calls[0].url).toBe("http://discord.test/api/v10/guilds/partner-guild/scheduled-events");
    // Decision F1.3 — a distributed event never points at the partner's own copy.
    expect(body(calls[0]).entity_metadata.location).toBe("http://app.test/ops/op1");
  });
});

describe("listScheduledEventUsers", () => {
  it("prefers the guild nickname, then global name, then username", async () => {
    mockFetch(() =>
      ok([
        { user: { id: "1", username: "alpha", global_name: "Alpha" }, member: { nick: "Nick" } },
        { user: { id: "2", username: "bravo", global_name: "Bravo" }, member: null },
        { user: { id: "3", username: "charlie" } },
      ]),
    );
    expect(await listScheduledEventUsers("g1", "e1")).toEqual([
      { discordUserId: "1", displayName: "Nick" },
      { discordUserId: "2", displayName: "Bravo" },
      { discordUserId: "3", displayName: "charlie" },
    ]);
  });

  it("pages with ?after until a short page arrives", async () => {
    const page = (from: number) =>
      Array.from({ length: 100 }, (_, i) => ({ user: { id: String(from + i), username: `u${from + i}` } }));
    let served = 0;
    mockFetch(() => {
      served++;
      if (served === 1) return ok(page(1));
      if (served === 2) return ok(page(101).slice(0, 5));
      return ok([]);
    });
    const users = await listScheduledEventUsers("g1", "e1");
    expect(users).toHaveLength(105);
    // Second request continues after the last id of the first page.
    expect(new URL(calls[1].url).searchParams.get("after")).toBe("100");
  });

  it("throws instead of silently reporting nobody is interested", async () => {
    mockFetch(() => ok({ message: "Missing Access" }, 403));
    await expect(listScheduledEventUsers("g1", "e1")).rejects.toThrow(/403/);
  });
});

describe("deleteScheduledEvent", () => {
  it("issues a DELETE and swallows the outcome", async () => {
    mockFetch(() => ok({}, 204));
    await deleteScheduledEvent("g1", "e1");
    expect(calls[0].init.method).toBe("DELETE");
    expect(calls[0].url).toBe("http://discord.test/api/v10/guilds/g1/scheduled-events/e1");
  });
});

describe("sendDiscordChannelMessage", () => {
  it("suppresses mentions and truncates overlong content", async () => {
    mockFetch(() => ok({ id: "m1" }));
    await sendDiscordChannelMessage("c1", "x".repeat(5000));
    const payload = body(calls[0]);
    expect(payload.content).toHaveLength(1900);
    // A feedback ticket must never be able to @everyone the server.
    expect(payload.allowed_mentions).toEqual({ parse: [] });
  });

  it("refuses an empty channel id before touching Discord", async () => {
    mockFetch(() => ok({}));
    await expect(sendDiscordChannelMessage("   ", "hi")).rejects.toThrow(/channel is not configured/i);
    expect(calls).toHaveLength(0);
  });

  it("uploads attachments as multipart with a payload_json part", async () => {
    mockFetch(() => ok({ id: "m1" }));
    await sendDiscordChannelMessage("c1", "with file", [
      { filename: "shot.png", contentType: "image/png", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(calls[0].init.body).toBeInstanceOf(FormData);
    const form = calls[0].init.body as FormData;
    expect(JSON.parse(String(form.get("payload_json"))).attachments).toEqual([{ id: 0, filename: "shot.png" }]);
    expect(form.get("files[0]")).toBeTruthy();
  });

  it("throws with Discord's status when the post is refused", async () => {
    mockFetch(() => ok({ message: "Missing Access" }, 403));
    await expect(sendDiscordChannelMessage("c1", "hi")).rejects.toThrow(/403/);
  });
});

describe("sendDiscordDm", () => {
  it("opens a DM channel first, then posts into it", async () => {
    db.userIdentity.findFirst.mockResolvedValue({ providerId: "555" });
    mockFetch((url) => (url.endsWith("/users/@me/channels") ? ok({ id: "dm1" }) : ok({ id: "m1" })));
    await sendDiscordDm("user-1", "hello");
    expect(calls[0].url).toBe("http://discord.test/api/v10/users/@me/channels");
    expect(body(calls[0])).toEqual({ recipient_id: "555" });
    expect(calls[1].url).toBe("http://discord.test/api/v10/channels/dm1/messages");
    expect(body(calls[1]).content).toBe("hello");
  });

  it("fails loudly when the DM channel cannot be opened", async () => {
    db.userIdentity.findFirst.mockResolvedValue({ providerId: "555" });
    mockFetch(() => ok({ message: "Cannot send messages to this user" }, 403));
    await expect(sendDiscordDm("user-1", "hello")).rejects.toThrow(/DM channel creation failed \(403\)/);
  });

  it("never guesses a recipient for a user without a Discord identity", async () => {
    db.userIdentity.findFirst.mockResolvedValue(null);
    mockFetch(() => ok({}));
    await expect(sendDiscordDm("cuid-user", "hello")).rejects.toThrow(/no linked Discord/i);
    expect(calls).toHaveLength(0);
  });
});

describe("verifyDiscordInteraction", () => {
  function sign(timestamp: string, rawBody: string): string {
    // Built here rather than imported so the verifier is tested against an
    // independent signer, not against itself.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createPrivateKey, sign: edSign } = require("node:crypto") as typeof import("node:crypto");
    const key = createPrivateKey({
      key: Buffer.concat([
        Buffer.from("302e020100300506032b657004220420", "hex"),
        Buffer.from("rdoc-suite-discord-mock-seed-01!", "utf8"),
      ]),
      format: "der",
      type: "pkcs8",
    });
    return edSign(null, Buffer.from(timestamp + rawBody), key).toString("hex");
  }

  it("accepts a correctly signed payload", () => {
    const ts = "1700000000";
    const raw = JSON.stringify({ type: 1 });
    expect(verifyDiscordInteraction(raw, sign(ts, raw), ts)).toBe(true);
  });

  it("rejects a tampered body, a bad signature and missing headers", () => {
    const ts = "1700000000";
    const raw = JSON.stringify({ type: 1 });
    expect(verifyDiscordInteraction(raw, sign(ts, "{}"), ts)).toBe(false);
    expect(verifyDiscordInteraction(raw, "zz", ts)).toBe(false);
    expect(verifyDiscordInteraction(raw, "", ts)).toBe(false);
    expect(verifyDiscordInteraction(raw, sign(ts, raw), "")).toBe(false);
  });
});
