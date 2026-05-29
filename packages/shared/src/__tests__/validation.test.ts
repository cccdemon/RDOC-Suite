import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "../validation.js";

const GUILD_ID = "123456789012345678";
const CHANNEL_ID = "987654321098765432";
const USER_ID = "111122223333444455";

describe("parseClientMessage", () => {
  it("accepts ptt:start with optional voiceChannelId", () => {
    expect(
      parseClientMessage({
        type: "ptt:start",
        guildId: GUILD_ID,
        voiceChannelId: CHANNEL_ID,
      }),
    ).toEqual({
      ok: true,
      value: {
        type: "ptt:start",
        guildId: GUILD_ID,
        voiceChannelId: CHANNEL_ID,
      },
    });
  });

  it("accepts ptt:start without voiceChannelId", () => {
    expect(parseClientMessage({ type: "ptt:start", guildId: GUILD_ID })).toMatchObject({
      ok: true,
    });
  });

  it("accepts ptt:stop", () => {
    expect(parseClientMessage({ type: "ptt:stop", guildId: GUILD_ID })).toMatchObject({ ok: true });
  });

  it("accepts heartbeat", () => {
    expect(parseClientMessage({ type: "heartbeat", timestamp: Date.now() })).toMatchObject({
      ok: true,
    });
  });

  it("accepts device:update", () => {
    expect(
      parseClientMessage({
        type: "device:update",
        inputDeviceId: "default-input",
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects an unknown message type", () => {
    expect(parseClientMessage({ type: "unknown", guildId: GUILD_ID })).toMatchObject({ ok: false });
  });

  it("rejects a non-snowflake guildId", () => {
    expect(parseClientMessage({ type: "ptt:start", guildId: "not-an-id" })).toMatchObject({
      ok: false,
    });
  });

  it("rejects entirely invalid input", () => {
    expect(parseClientMessage("garbage")).toMatchObject({ ok: false });
    expect(parseClientMessage(null)).toMatchObject({ ok: false });
    expect(parseClientMessage(42)).toMatchObject({ ok: false });
  });
});

describe("parseServerMessage", () => {
  it("accepts bridge:joined with commanders and livekit creds", () => {
    expect(
      parseServerMessage({
        type: "bridge:joined",
        roomId: "room-1",
        roomMode: "guild",
        activeCommanders: [{ userId: USER_ID, active: true, speaking: false }],
        livekitUrl: "ws://localhost:7880",
        livekitToken: "fake.jwt.token",
      }),
    ).toMatchObject({ ok: true });
  });

  it("accepts bridge:left", () => {
    expect(parseServerMessage({ type: "bridge:left", roomId: "room-1" })).toMatchObject({
      ok: true,
    });
  });

  it("accepts commander:list (empty list)", () => {
    expect(
      parseServerMessage({ type: "commander:list", roomId: "room-1", commanders: [] }),
    ).toMatchObject({ ok: true });
  });

  it("accepts error messages", () => {
    expect(
      parseServerMessage({
        type: "error",
        code: "forbidden",
        message: "not a commander",
      }),
    ).toMatchObject({ ok: true });
  });

  it("rejects bridge:joined with bad commander entry", () => {
    expect(
      parseServerMessage({
        type: "bridge:joined",
        roomId: "room-1",
        activeCommanders: [{ userId: "nope", active: true }],
        livekitUrl: "ws://localhost:7880",
        livekitToken: "fake.jwt.token",
      }),
    ).toMatchObject({ ok: false });
  });
});
