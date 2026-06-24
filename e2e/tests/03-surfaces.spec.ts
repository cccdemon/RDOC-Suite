import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, login, type TestActor } from "../helpers/auth.js";

// Player-facing surfaces against a live instance. Mutations only touch the
// e2e-* test user's own data (hangar). Feedback is NOT submitted (it would post
// to the real Discord feedback channel).
test.describe.configure({ mode: "serial" });

let player: TestActor;
let ctx: BrowserContext, page: Page;

test.beforeAll(async ({ browser }) => {
  player = await login("e2e-surfer", "crew", "crew");
  ctx = await actorContext(browser, player); page = await ctx.newPage();
});
test.afterAll(async () => { await ctx?.close(); });

test("overview renders + theme switch works", async () => {
  await page.goto("./");
  await expect(page.getByTestId("profile-link").filter({ hasText: "e2e-surfer" }).first()).toContainText("e2e-surfer");
  const theme = page.getByTestId("theme-select").first();
  await theme.selectOption("terminal");
  await theme.selectOption("raumdock");
});

test("calendar: agenda toggle, past toggle, type filter, day select", async () => {
  await page.goto("calendar");
  await expect(page.getByTestId("calendar-page")).toBeVisible();
  await page.getByTestId("cal-view-agenda").click();
  const past = page.getByTestId("cal-toggle-past");
  if (await past.count()) await past.click();
  await page.getByTestId("cal-view-monat").click();
  await page.getByTestId("cal-filter-combat").click();
  await page.getByTestId("cal-filter-alle").click();
});

test("ships catalog search", async () => {
  await page.goto("ships");
  await expect(page.getByTestId("ships-page")).toBeVisible();
  await page.getByTestId("ships-search").fill("aurora");
  await page.waitForTimeout(600);
});

test("roadmap renders", async () => {
  await page.goto("roadmap");
  await expect(page.getByTestId("handbuch-page")).toBeVisible();
  await expect(page).toHaveURL(/\/handbuch\/roadmap/);
});

test("profile: hangar add + remove + fleet import", async () => {
  await page.goto("konto/profil");
  await expect(page.getByTestId("profile-page")).toBeVisible();
  // add a ship from the catalog search
  await page.getByTestId("profile-search").fill("aurora");
  const add = page.locator('[data-testid^="hangar-add-"]').first();
  if (await add.count()) {
    const id = (await add.getAttribute("data-testid"))!.replace("hangar-add-", "");
    await add.click();
    const remove = page.getByTestId(`hangar-remove-${id}`);
    await expect(remove).toBeVisible({ timeout: 10_000 });
    await remove.click();
  }
  // fleet import (exercises the button; result OR notice either way)
  await page.getByTestId("fleet-json").fill('[{"name":"Aurora MR"},{"name":"Mystery XYZ"}]');
  await page.getByTestId("fleet-import-submit").click();
  await expect(page.getByTestId("import-result").or(page.getByTestId("profile-notice"))).toBeVisible({ timeout: 10_000 });
});

test("feedback form is fillable (NOT submitted — posts to real Discord)", async () => {
  await page.goto("konto/feedback");
  await expect(page.getByTestId("feedback-page")).toBeVisible();
  await page.getByTestId("feedback-subject").fill("E2E-TEST (nicht senden)");
  await page.getByTestId("feedback-message").fill("E2E smoke — form fillable.");
  await expect(page.getByTestId("feedback-submit")).toBeEnabled();
});

test("guild settings + partnerships reachable", async () => {
  // e2e-surfer is crew → server settings show the no-rights state; that's the
  // correct guarded behavior we assert.
  await page.goto("guilds/settings");
  await expect(page.getByTestId("guild-settings-page").or(page.getByTestId("guild-none"))).toBeVisible();
});

test("konto tabs: linked logins and preferences are reachable", async () => {
  await page.goto("konto/logins");
  await expect(page.getByTestId("konto-page")).toBeVisible();
  await expect(page.getByTestId("account-page")).toBeVisible();
  await expect(page.getByTestId("identity-e2e")).toBeVisible();

  await page.getByTestId("konto-tab-prefs").click();
  await expect(page.getByTestId("prefs-panel")).toBeVisible();
  await page.getByTestId("prefs-lang-de").click();
  await expect(page.getByTestId("prefs-share-hangar")).toBeVisible();
});

test("docs, legal and API docs surfaces render", async () => {
  await page.goto("handbuch");
  await expect(page.getByTestId("handbuch-page")).toBeVisible();
  await page.getByTestId("handbuch-sec-anleitung").click();
  await expect(page).toHaveURL(/\/handbuch\/anleitung/);

  await page.goto("rechtliches");
  await expect(page.getByTestId("rechtliches-page")).toBeVisible();
  await page.getByTestId("rechtliches-sec-datenschutz").click();
  await expect(page).toHaveURL(/\/rechtliches\/datenschutz/);

  await page.goto("api-docs");
  await expect(page.getByTestId("api-docs")).toBeVisible();
  await expect(page.locator(".swagger-ui")).toBeVisible({ timeout: 20_000 });
});
