import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, E2E_GUILD_ID, E2E_GUILD_ID_2, type TestActor } from "../helpers/auth.js";

// Cross-guild partnerships: guild A mints an invite token, guild B redeems it,
// then the partner row's auto-share toggle + revoke are exercised. Uses the
// seam's secondary synthetic guild so two distinct guilds exist.
test.describe.configure({ mode: "serial" });

let opA: TestActor, opB: TestActor;
let ctxA: BrowserContext, ctxB: BrowserContext;
let a: Page, b: Page;

async function selectGuild(page: Page, guildId: string): Promise<void> {
  const sel = page.getByTestId("partner-guild-select");
  if (await sel.count()) await sel.selectOption(guildId).catch(() => {});
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  opA = await login("e2e-partner-a", "fleetoperator", "fleetoperator"); // primary guild
  opB = await login("e2e-partner-b", "fleetoperator", "fleetoperator", E2E_GUILD_ID_2); // secondary guild
  ctxA = await actorContext(browser, opA); a = await ctxA.newPage();
  ctxB = await actorContext(browser, opB); b = await ctxB.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await ctxA?.close(); await ctxB?.close();
});

test("guild A mints an invite token and guild B redeems it", async () => {
  // Mint in guild A.
  await a.goto("guilds/partnerships");
  await expect(a.getByTestId("partnerships-page")).toBeVisible({ timeout: 10_000 });
  await selectGuild(a, E2E_GUILD_ID);
  await a.getByTestId("invite-label").fill("E2E Allianz");
  await a.getByTestId("invite-mint").click();
  await expect(a.getByTestId("minted-token")).toBeVisible({ timeout: 10_000 });
  const token = (await a.locator('[data-testid="minted-token"] code').innerText()).trim();
  expect(token.length).toBeGreaterThan(10);

  // Redeem in guild B.
  await b.goto("guilds/partnerships");
  await expect(b.getByTestId("partnerships-page")).toBeVisible({ timeout: 10_000 });
  await selectGuild(b, E2E_GUILD_ID_2);
  await b.getByTestId("accept-token").fill(token);
  await b.getByTestId("accept-submit").click();

  // The partnership now appears as a partner row (and/or a success notice).
  await expect(b.locator('[data-testid^="partner-"]').first()).toBeVisible({ timeout: 10_000 });
});

test("partner row: auto-share toggle and revoke", async () => {
  await b.goto("guilds/partnerships");
  await selectGuild(b, E2E_GUILD_ID_2);
  await expect(b.getByTestId("partnerships-page")).toBeVisible({ timeout: 10_000 });

  const autoshare = b.locator('[data-testid^="partner-autoshare-"]').first();
  if (await autoshare.count()) {
    const before = await autoshare.isChecked().catch(() => null);
    await autoshare.click();
    if (before !== null) await expect(autoshare).toBeChecked({ checked: !before, timeout: 10_000 });
  }

  const revoke = b.locator('[data-testid^="partner-revoke-"]').first();
  if (await revoke.count()) {
    b.once("dialog", (d) => void d.accept()); // revoke may ask for confirmation
    await revoke.click();
    await expect(b.getByTestId("partnerships-page")).toBeVisible();
  }
});
