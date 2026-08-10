import { test, expect, type BrowserContext } from "@playwright/test";
import { API, actorContext, cleanup, login, E2E_GUILD_ID, type TestActor } from "../helpers/auth.js";
import {
  discordMockAvailable,
  disposeDiscordMock,
  resetDiscord,
  scheduledEvents,
  setInterested,
  waitFor,
} from "../helpers/discordMock.js";

// FR-P2 — Discord "Interested" → EventInterest rows. The bot is REST-only, so
// the app polls the scheduled event's interested list. The local stack runs that
// poll every 3s (EVENT_INTEREST_INTERVAL_MS); production keeps 5 minutes.
test.describe.configure({ mode: "serial" });
test.skip(!discordMockAvailable(), "needs the Discord simulator (local test stack)");

const LINKED_DISCORD_ID = "300000000000000021"; // has a Fleetplanner account
const STRANGER_DISCORD_ID = "400000000000000001"; // Discord-only, unknown to us

let operator: TestActor, pilot: TestActor;
let opCtx: BrowserContext;
let opId = "";
let eventId = "";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

/** The operator view's interest rows (manage board "Interessiert"). */
async function interests(): Promise<Array<{ displayName: string; userId: string | null; seated: boolean }>> {
  const res = await opCtx.request.get(`${API}/operations/${opId}/operator`);
  await expect(res).toBeOK();
  const body = await res.json();
  return body.eventInterests ?? [];
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await resetDiscord();
  operator = await login("e2e-interest-op", "fleetoperator", "fleetoperator");
  // A pilot who has logged into the Fleetplanner with this Discord account.
  pilot = await login("e2e-interest-pilot", "crew", "crew", { discordId: LINKED_DISCORD_ID });
  opCtx = await actorContext(browser, operator);

  const created = await opCtx.request.post(`${API}/operations`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { guildId: E2E_GUILD_ID, title: "E2E Interest Op", opType: "combat", scheduledAt: future(5) },
  });
  await expect(created).toBeOK();
  opId = (await created.json()).id as string;

  const status = await opCtx.request.post(`${API}/operations/${opId}/status`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { status: "open" },
  });
  await expect(status).toBeOK();

  const events = await waitFor(
    () => scheduledEvents(E2E_GUILD_ID),
    (list) => list.some((e) => e.name === "E2E Interest Op"),
    { what: "the op's Discord event" },
  );
  eventId = events.find((e) => e.name === "E2E Interest Op")!.id;
});

test.afterAll(async () => {
  await cleanup();
  await disposeDiscordMock();
  await opCtx?.close();
});

test("clicking Interested in Discord shows up on the op", async () => {
  await setInterested(E2E_GUILD_ID, eventId, [
    { id: LINKED_DISCORD_ID, username: "interest-pilot", nick: "Pilot Nick" },
    { id: STRANGER_DISCORD_ID, username: "outsider" },
  ]);

  const rows = await waitFor(() => interests(), (list) => list.length >= 2, {
    timeoutMs: 30_000,
    what: "both interested users to be synced",
  });

  // The linked pilot resolves to a real account …
  const linked = rows.find((r) => r.userId === pilot.userId);
  expect(linked).toBeTruthy();
  // … and the guild nickname wins over the username as the display name.
  expect(linked!.displayName).toBe("Pilot Nick");

  // … while a Discord-only user is kept as an unlinked ("shadow") row rather
  // than dropped — the operator still needs to see them.
  const shadow = rows.find((r) => r.userId === null);
  expect(shadow).toBeTruthy();
  expect(shadow!.displayName).toBe("outsider");
});

test("un-clicking Interested in Discord withdraws the row", async () => {
  await setInterested(E2E_GUILD_ID, eventId, [
    { id: LINKED_DISCORD_ID, username: "interest-pilot", nick: "Pilot Nick" },
  ]);

  // The withdrawn user disappears from the interested list; the remaining one stays.
  const rows = await waitFor(() => interests(), (list) => list.length === 1, {
    timeoutMs: 30_000,
    what: "the withdrawn interest to disappear",
  });
  expect(rows[0].userId).toBe(pilot.userId);
});

test("re-clicking Interested revives the same row", async () => {
  await setInterested(E2E_GUILD_ID, eventId, [
    { id: LINKED_DISCORD_ID, username: "interest-pilot", nick: "Pilot Nick" },
    { id: STRANGER_DISCORD_ID, username: "outsider" },
  ]);

  const rows = await waitFor(() => interests(), (list) => list.length === 2, {
    timeoutMs: 30_000,
    what: "the revived interest row",
  });
  // No duplicate: the shadow row was revived, not created a second time.
  expect(rows.filter((r) => r.userId === null)).toHaveLength(1);
});
