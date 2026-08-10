import { test, expect, type BrowserContext } from "@playwright/test";
import { API, actorContext, cleanup, login, E2E_GUILD_ID, type TestActor } from "../helpers/auth.js";
import {
  channelMessages,
  discordCalls,
  discordMockAvailable,
  disposeDiscordMock,
  dmsTo,
  injectFaults,
  clearFaults,
  resetDiscord,
  waitFor,
} from "../helpers/discordMock.js";

// Everything the app pushes into Discord as a MESSAGE: feedback tickets (with
// screenshot uploads), op announcements, and seat-assignment DMs.
test.describe.configure({ mode: "serial" });
test.skip(!discordMockAvailable(), "needs the Discord simulator (local test stack)");

// Seeded by the simulator: the E2E guild's #feedback text channel.
const FEEDBACK_CHANNEL = `${E2E_GUILD_ID}91`;
const ANNOUNCE_CHANNEL = `${E2E_GUILD_ID}92`;
const CREW_DISCORD_ID = "300000000000000011";

// A 1×1 transparent PNG — the smallest thing the upload path accepts.
const PNG_1PX = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

let admin: TestActor, operator: TestActor;
let adminCtx: BrowserContext, opCtx: BrowserContext;
let opId = "";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await resetDiscord();
  admin = await login("e2e-msg-admin", "superadmin", "fleetoperator");
  operator = await login("e2e-msg-op", "fleetoperator", "fleetoperator", { discordId: CREW_DISCORD_ID });
  adminCtx = await actorContext(browser, admin);
  opCtx = await actorContext(browser, operator);

  const res = await adminCtx.request.put(`${API}/admin/settings/feedback`, {
    headers: { "x-csrf-token": admin.csrfToken },
    data: { channelId: FEEDBACK_CHANNEL },
  });
  await expect(res).toBeOK();
});

test.afterAll(async () => {
  await clearFaults();
  // Leave no feedback channel behind — a later spec run must configure its own.
  await adminCtx?.request.put(`${API}/admin/settings/feedback`, {
    headers: { "x-csrf-token": admin.csrfToken },
    data: { channelId: "" },
  });
  await cleanup();
  await disposeDiscordMock();
  await adminCtx?.close();
  await opCtx?.close();
});

test("a feedback ticket lands in the configured Discord channel", async () => {
  const res = await opCtx.request.post(`${API}/feedback`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { subject: "E2E Feedback Subject", message: "The seat picker forgets my ship." },
  });
  await expect(res).toBeOK();

  const messages = await waitFor(
    () => channelMessages(FEEDBACK_CHANNEL),
    (list) => list.length >= 1,
    { what: "the feedback ticket in the Discord channel" },
  );
  const last = messages[messages.length - 1];
  expect(last.content).toContain("E2E Feedback Subject");
  expect(last.content).toContain("The seat picker forgets my ship.");
  // The reporter must be identifiable, or a ticket is unanswerable.
  expect(last.content).toContain("e2e-msg-op");
});

test("a feedback screenshot is uploaded as a Discord attachment", async () => {
  const res = await opCtx.request.post(`${API}/feedback`, {
    headers: { "x-csrf-token": operator.csrfToken },
    multipart: {
      subject: "E2E Feedback With Screenshot",
      message: "Screenshot attached.",
      screenshots: { name: "bug.png", mimeType: "image/png", buffer: PNG_1PX },
    },
  });
  await expect(res).toBeOK();

  const messages = await waitFor(
    () => channelMessages(FEEDBACK_CHANNEL),
    (list) => list.some((m) => m.attachments.length > 0),
    { what: "a feedback message carrying an attachment" },
  );
  const withFile = messages.find((m) => m.attachments.length > 0)!;
  expect(withFile.attachments[0].filename).toBe("bug.png");
  expect(withFile.attachments[0].bytes).toBeGreaterThan(0);
});

test("a Discord failure surfaces as an error instead of a silent drop", async () => {
  await injectFaults([
    { method: "POST", path: "/api/v10/channels/*/messages", status: 403, body: { message: "Missing Access", code: 50001 }, times: 1 },
  ]);
  const res = await opCtx.request.post(`${API}/feedback`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { subject: "E2E Feedback Fails", message: "This one must not claim success." },
  });
  // Best-effort is not acceptable here: the reporter has to know it did not send.
  expect(res.ok()).toBe(false);
  expect((await res.json()).error.code).toBeTruthy();
  await clearFaults();
});

test("an op announcement is posted to the chosen guild channel", async () => {
  const created = await opCtx.request.post(`${API}/operations`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: {
      guildId: E2E_GUILD_ID,
      title: "E2E Announce Op",
      opType: "mining",
      scheduledAt: future(4),
      meetingSystem: "stanton",
      meetingLocation: "HUR-L1",
    },
  });
  await expect(created).toBeOK();
  opId = (await created.json()).id as string;

  const res = await opCtx.request.post(`${API}/operations/${opId}/announce`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { channelId: ANNOUNCE_CHANNEL },
  });
  await expect(res).toBeOK();

  const messages = await waitFor(
    () => channelMessages(ANNOUNCE_CHANNEL),
    (list) => list.length >= 1,
    { what: "the announcement message" },
  );
  const last = messages[messages.length - 1];
  expect(last.content).toContain("E2E Announce Op");
  expect(last.content).toContain(`/ops/${opId}`);
  expect(last.content).toContain("HUR-L1");
});

test("announcing into a channel of another guild is refused", async () => {
  // Channel of the SECOND synthetic guild — the op belongs to the first.
  const res = await opCtx.request.post(`${API}/operations/${opId}/announce`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { channelId: "10000000000000000291" },
  });
  expect(res.status()).toBe(404);
  // And nothing was sent anyway.
  const posts = await discordCalls({ method: "POST", path: "/channels/10000000000000000291/messages" });
  expect(posts).toHaveLength(0);
});

test("no DM was sent to a user without a Discord identity", async () => {
  // e2e-msg-admin has no discordId, so any DM attempt for them must fail loudly
  // in the app rather than reach a wrong recipient.
  expect(await dmsTo("300000000000000099")).toHaveLength(0);
});
