import { test, expect, type BrowserContext } from "@playwright/test";
import { API, actorContext, cleanup, login, E2E_GUILD_ID, E2E_GUILD_ID_2, type TestActor } from "../helpers/auth.js";
import {
  discordMockAvailable,
  disposeDiscordMock,
  dmsTo,
  pressButton,
  pressButtonUnsigned,
  resetDiscord,
  scheduledEvents,
  sendPing,
  waitFor,
} from "../helpers/discordMock.js";

// FR-P1 event distribution over Discord: a partner guild's fleet operator gets
// a DM with Share/Decline buttons and decides from Discord. The buttons arrive
// as Ed25519-signed HTTP interactions, so this also covers the signature gate on
// /discord/interactions.
test.describe.configure({ mode: "serial" });
test.skip(!discordMockAvailable(), "needs the Discord simulator (local test stack)");

// Synthetic Discord ids the seam accepts (/^3\d{17}$/).
const HOST_DISCORD_ID = "300000000000000001";
const PARTNER_DISCORD_ID = "300000000000000002";

let host: TestActor, partner: TestActor;
let hostCtx: BrowserContext, partnerCtx: BrowserContext;
let opId = "";
let distributionId = "";

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString();

test.beforeAll(async ({ browser }) => {
  await cleanup();
  await resetDiscord();
  host = await login("e2e-dist-host", "fleetoperator", "fleetoperator", { discordId: HOST_DISCORD_ID });
  partner = await login("e2e-dist-partner", "fleetoperator", "fleetoperator", {
    guildId: E2E_GUILD_ID_2,
    discordId: PARTNER_DISCORD_ID,
  });
  hostCtx = await actorContext(browser, host);
  partnerCtx = await actorContext(browser, partner);
});

test.afterAll(async () => {
  await cleanup();
  await disposeDiscordMock();
  await hostCtx?.close();
  await partnerCtx?.close();
});

test("the interactions endpoint answers Discord's PING handshake", async () => {
  const res = await sendPing();
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ type: 1 }); // PONG
});

test("an interaction with an invalid signature is rejected", async () => {
  // The only thing standing between the internet and approve/decline is this
  // signature check — a forged payload must never reach the handler.
  const res = await pressButtonUnsigned({ customId: "evt-share:whatever", discordUserId: PARTNER_DISCORD_ID });
  expect(res.status).toBe(401);
});

test("host and partner guild become partners", async () => {
  const minted = await hostCtx.request.post(`${API}/guilds/${E2E_GUILD_ID}/partnerships/invite`, {
    headers: { "x-csrf-token": host.csrfToken },
    data: { label: "E2E Discord Allianz" },
  });
  await expect(minted).toBeOK();
  const token = (await minted.json()).token as string;

  const accepted = await partnerCtx.request.post(`${API}/guilds/${E2E_GUILD_ID_2}/partnerships/accept`, {
    headers: { "x-csrf-token": partner.csrfToken },
    data: { token },
  });
  await expect(accepted).toBeOK();

  const partnerships = await partnerCtx.request.get(`${API}/guilds/${E2E_GUILD_ID_2}/partnerships`);
  await expect(partnerships).toBeOK();
  const rows = (await partnerships.json()).partnerships as Array<{ status: string; partnerGuildId: string }>;
  expect(rows.some((r) => r.partnerGuildId === E2E_GUILD_ID && r.status === "active")).toBe(true);
});

test("publishing a partner-visible op DMs the partner operator with buttons", async () => {
  const created = await hostCtx.request.post(`${API}/operations`, {
    headers: { "x-csrf-token": host.csrfToken },
    data: {
      guildId: E2E_GUILD_ID,
      title: "E2E Distributed Op",
      opType: "combat",
      scheduledAt: future(9),
      description: "Joint operation with the partner org.",
      visibility: "partners",
      partnerTargetGuildIds: [E2E_GUILD_ID_2],
    },
  });
  await expect(created).toBeOK();
  opId = (await created.json()).id as string;

  const status = await hostCtx.request.post(`${API}/operations/${opId}/status`, {
    headers: { "x-csrf-token": host.csrfToken },
    data: { status: "open" },
  });
  await expect(status).toBeOK();

  // Auto-share is off by default → a pending distribution + an approval DM.
  const messages = await waitFor(
    () => dmsTo(PARTNER_DISCORD_ID),
    (list) => list.length >= 1,
    { what: "the approval DM to the partner fleet operator" },
  );
  const dm = messages[messages.length - 1];
  const buttons = (dm.components as Array<{ components: Array<{ custom_id: string; label: string }> }>)
    .flatMap((row) => row.components);
  expect(buttons.map((b) => b.custom_id.split(":")[0]).sort()).toEqual(["evt-decline", "evt-share"]);

  distributionId = buttons.find((b) => b.custom_id.startsWith("evt-share:"))!.custom_id.split(":")[1];
  expect(distributionId).toBeTruthy();

  // Nothing is posted into the partner guild before somebody approves.
  expect(await scheduledEvents(E2E_GUILD_ID_2)).toHaveLength(0);
});

test("a stranger cannot approve someone else's distribution", async () => {
  const res = await pressButton({ customId: `evt-share:${distributionId}`, discordUserId: HOST_DISCORD_ID });
  expect(res.status).toBe(200);
  // Ephemeral refusal (type 4), not an update of the original message (type 7).
  expect(res.body).toMatchObject({ type: 4 });
  expect(await scheduledEvents(E2E_GUILD_ID_2)).toHaveLength(0);
});

test("the partner operator approves from Discord and the event is posted", async () => {
  const res = await pressButton({ customId: `evt-share:${distributionId}`, discordUserId: PARTNER_DISCORD_ID });
  expect(res.status).toBe(200);
  // Type 7 = the original DM is edited, which is what a successful decision does.
  expect(res.body).toMatchObject({ type: 7 });

  const events = await waitFor(
    () => scheduledEvents(E2E_GUILD_ID_2),
    (list) => list.length === 1,
    { what: "the distributed event in the partner guild" },
  );
  expect(events[0].name).toBe("E2E Distributed Op");
  // Decision F1.3: a distributed event always links back to the HOST op page.
  expect(events[0].entity_metadata?.location).toContain(`/ops/${opId}`);
  expect(events[0].entity_type).toBe(3);
});

test("the same button cannot be pressed twice", async () => {
  const res = await pressButton({ customId: `evt-share:${distributionId}`, discordUserId: PARTNER_DISCORD_ID });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ type: 4 }); // "already decided", ephemeral
  expect(await scheduledEvents(E2E_GUILD_ID_2)).toHaveLength(1);
});

test("cancelling the host op tears the partner event down", async () => {
  const status = await hostCtx.request.post(`${API}/operations/${opId}/status`, {
    headers: { "x-csrf-token": host.csrfToken },
    data: { status: "cancelled" },
  });
  await expect(status).toBeOK();

  await waitFor(
    () => scheduledEvents(E2E_GUILD_ID_2),
    (list) => list.length === 0,
    { what: "the partner event to be removed" },
  );
});

test("an unknown custom_id is answered, not crashed on", async () => {
  const res = await pressButton({ customId: "evt-share:doesnotexist", discordUserId: PARTNER_DISCORD_ID });
  expect(res.status).toBe(200);
  expect(res.body).toMatchObject({ type: 4 });
});
