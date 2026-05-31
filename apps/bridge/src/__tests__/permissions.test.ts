import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { disconnectPrisma, getPrisma } from "@rdoc-suite/db";
import { checkAllowedVoiceChannel } from "../services/permissions.js";

const GUILD_ID = "987654321098765432";
const USER_ID = "111122223333444499";
const ALLOWED_CHANNEL = "555000000000000001";
const OTHER_CHANNEL = "555000000000000002";

async function setVoiceState(channelId: string | null): Promise<void> {
  await getPrisma().userVoiceState.upsert({
    where: { guildId_userId: { guildId: GUILD_ID, userId: USER_ID } },
    create: { guildId: GUILD_ID, userId: USER_ID, channelId },
    update: { channelId },
  });
}

async function clearVoiceState(): Promise<void> {
  await getPrisma().userVoiceState.deleteMany({
    where: { guildId: GUILD_ID, userId: USER_ID },
  });
}

beforeEach(async () => {
  await clearVoiceState();
});

afterAll(async () => {
  await clearVoiceState();
  await disconnectPrisma();
});

describe("checkAllowedVoiceChannel", () => {
  it("returns ok when allowedIds is empty (no enforcement configured)", async () => {
    // No row in UserVoiceState at all — the empty-list path must not
    // touch the DB. This is the backwards-compat case: existing
    // deployments that never set `/cc channel add` are unaffected.
    const verdict = await checkAllowedVoiceChannel({
      userId: USER_ID,
      guildId: GUILD_ID,
      allowedIds: [],
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("returns ok when user is in one of the allowed voice channels", async () => {
    await setVoiceState(ALLOWED_CHANNEL);
    const verdict = await checkAllowedVoiceChannel({
      userId: USER_ID,
      guildId: GUILD_ID,
      allowedIds: [ALLOWED_CHANNEL, OTHER_CHANNEL],
    });
    expect(verdict).toEqual({ ok: true });
  });

  it("returns outside_allowed_voice_channel when user is in a non-allowed channel", async () => {
    await setVoiceState(OTHER_CHANNEL);
    const verdict = await checkAllowedVoiceChannel({
      userId: USER_ID,
      guildId: GUILD_ID,
      allowedIds: [ALLOWED_CHANNEL],
    });
    expect(verdict).toEqual({
      ok: false,
      reason: "outside_allowed_voice_channel",
    });
  });

  it("returns not_in_voice when user has no voice-state row at all", async () => {
    const verdict = await checkAllowedVoiceChannel({
      userId: USER_ID,
      guildId: GUILD_ID,
      allowedIds: [ALLOWED_CHANNEL],
    });
    expect(verdict).toEqual({ ok: false, reason: "not_in_voice" });
  });

  it("returns not_in_voice when user is tracked but currently disconnected (channelId=null)", async () => {
    await setVoiceState(null);
    const verdict = await checkAllowedVoiceChannel({
      userId: USER_ID,
      guildId: GUILD_ID,
      allowedIds: [ALLOWED_CHANNEL],
    });
    expect(verdict).toEqual({ ok: false, reason: "not_in_voice" });
  });
});
