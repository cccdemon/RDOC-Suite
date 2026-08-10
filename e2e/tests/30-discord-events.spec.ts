import { test, expect, type BrowserContext } from "@playwright/test";
import { API, actorContext, cleanup, login, E2E_GUILD_ID, type TestActor } from "../helpers/auth.js";
import {
  clearDiscordCalls,
  clearFaults,
  discordCalls,
  discordMockAvailable,
  disposeDiscordMock,
  injectFaults,
  resetDiscord,
  scheduledEvents,
  waitFor,
} from "../helpers/discordMock.js";

// Op lifecycle ↔ Discord scheduled event. Every assertion is against what the
// app actually sent to Discord (recorded by the simulator), not against the
// app's own view of the world.
//
// Requires the local test stack (Discord simulator). Against a live instance
// these specs skip rather than fail.
test.describe.configure({ mode: "serial" });
test.skip(!discordMockAvailable(), "needs the Discord simulator (local test stack)");

let operator: TestActor;
let ctx: BrowserContext;
let opId = "";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

async function createOp(body: Record<string, unknown>): Promise<string> {
  const res = await ctx.request.post(`${API}/operations`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { guildId: E2E_GUILD_ID, opType: "combat", scheduledAt: future(7), ...body },
  });
  await expect(res).toBeOK();
  return (await res.json()).id as string;
}

async function setStatus(id: string, status: string) {
  const res = await ctx.request.post(`${API}/operations/${id}/status`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { status },
  });
  await expect(res).toBeOK();
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await resetDiscord();
  operator = await login("e2e-discord-op", "fleetoperator", "fleetoperator");
  ctx = await actorContext(browser, operator);
});

test.afterAll(async () => {
  await clearFaults();
  await cleanup();
  await disposeDiscordMock();
  await ctx?.close();
});

test("publishing an op creates a Discord scheduled event with the op link", async () => {
  await clearDiscordCalls();
  opId = await createOp({ title: "E2E Discord Xenothreat", description: "Assault on the Vanduul." });
  await setStatus(opId, "open");

  const events = await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list.length === 1,
    { what: "one scheduled event in the E2E guild" },
  );
  const event = events[0];

  expect(event.name).toBe("E2E Discord Xenothreat");
  // No voice channel configured → EXTERNAL event pointing at the op page.
  expect(event.entity_type).toBe(3);
  expect(event.entity_metadata?.location).toContain(`/ops/${opId}`);
  expect(event.scheduled_end_time).toBeTruthy();
  // The follow-up PATCH prepends the Fleetplanner link to the description.
  expect(event.description).toContain(`/ops/${opId}`);
  expect(event.description).toContain("Assault on the Vanduul.");

  // The call itself must be bot-authenticated — a Bearer token here would mean
  // the app used a user credential for a bot action.
  const posts = await discordCalls({ method: "POST", path: "/scheduled-events" });
  expect(posts.length).toBe(1);
  expect(posts[0].auth).toBe("bot");
});

test("editing a published op patches the same Discord event", async () => {
  await clearDiscordCalls();
  const res = await ctx.request.patch(`${API}/operations/${opId}`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { title: "E2E Discord Xenothreat II" },
  });
  await expect(res).toBeOK();

  const events = await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list[0]?.name === "E2E Discord Xenothreat II",
    { what: "the scheduled event to carry the new title" },
  );
  // Patched in place — no second event was created.
  expect(events.length).toBe(1);
  const posts = await discordCalls({ method: "POST", path: "/scheduled-events" });
  expect(posts.length).toBe(0);
});

test("a stream op is marked in the Discord event name", async () => {
  const streamId = await createOp({ title: "E2E Stream Night", isStreamEvent: true });
  await setStatus(streamId, "open");

  const events = await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list.some((e) => e.name.includes("E2E Stream Night")),
    { what: "the stream event" },
  );
  const stream = events.find((e) => e.name.includes("E2E Stream Night"))!;
  // FR-P3: Discord has no per-event icon, so a stream op carries a name prefix.
  expect(stream.name).toBe("\u{1F7E3} E2E Stream Night");

  await setStatus(streamId, "cancelled");
});

test("cancelling an op deletes its Discord event", async () => {
  await clearDiscordCalls();
  await setStatus(opId, "cancelled");

  await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list.every((e) => !e.name.startsWith("E2E Discord Xenothreat")),
    { what: "the cancelled op's Discord event to disappear" },
  );
  const deletes = await discordCalls({ method: "DELETE", path: "/scheduled-events" });
  expect(deletes.length).toBeGreaterThanOrEqual(1);
});

test("a Discord outage does not block publishing an op", async () => {
  // Discord rate-limits the create call. The op must still open — the Discord
  // event is best-effort, and losing it must never lose the operation.
  await injectFaults([
    { method: "POST", path: "/api/v10/guilds/*/scheduled-events", status: 429, body: { message: "rate limited", retry_after: 5 }, times: 1 },
  ]);
  const flakyId = await createOp({ title: "E2E Discord Outage" });
  await setStatus(flakyId, "open");

  const res = await ctx.request.get(`${API}/operations/${flakyId}`);
  await expect(res).toBeOK();
  expect((await res.json()).status).toBe("open");

  // No event was created for it, and the app did not retry itself into a loop.
  const events = await scheduledEvents(E2E_GUILD_ID);
  expect(events.some((e) => e.name === "E2E Discord Outage")).toBe(false);
  await clearFaults();
});

test("deleting an op tears its Discord event down", async () => {
  const doomedId = await createOp({ title: "E2E Discord Doomed" });
  await setStatus(doomedId, "open");
  await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list.some((e) => e.name === "E2E Discord Doomed"),
    { what: "the doomed op's event" },
  );

  const res = await ctx.request.delete(`${API}/operations/${doomedId}`, {
    headers: { "x-csrf-token": operator.csrfToken },
  });
  await expect(res).toBeOK();

  await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => !list.some((e) => e.name === "E2E Discord Doomed"),
    { what: "the doomed op's event to be deleted" },
  );
});
