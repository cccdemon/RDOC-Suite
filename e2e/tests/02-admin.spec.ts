import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, login, type TestActor } from "../helpers/auth.js";

// Admin console against a live instance. STRICTLY non-destructive to real data:
//   - NO maintenance toggle (would lock the whole instance).
//   - NO feedback-channel change (real instance config).
//   - NO catalog sync trigger (hits external APIs).
//   - destructive actions ONLY on the synthetic E2E guild + e2e-* users.
test.describe.configure({ mode: "serial" });

const E2E_GUILD = "100000000000000001";
let admin: TestActor;
let target: TestActor;
let ctx: BrowserContext, page: Page;

test.beforeAll(async ({ browser }) => {
  admin = await login("e2e-admin", "superadmin", "fleetoperator");
  target = await login("e2e-roletarget", "crew", "crew"); // safe e2e user to re-role
  ctx = await actorContext(browser, admin); page = await ctx.newPage();
});
test.afterAll(async () => { await ctx?.close(); });

test("admin console renders the dense dashboard", async () => {
  await page.goto("admin");
  await expect(page.getByTestId("admin-page")).toBeVisible();
  // KPI strip + at least one catalog card + both tables present
  await expect(page.getByTestId("admin-settings")).toBeVisible();
  await expect(page.getByText("ADMIN // SYSTEMSTEUERUNG")).toBeVisible();
  await expect(page.getByText("SCHIFFSKATALOG")).toBeVisible();
  await expect(page.getByText("NUTZER", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("DISCORD-SERVER").first()).toBeVisible();
});

test("maintenance toggle + catalog buttons are present (NOT clicked)", async () => {
  await expect(page.getByTestId("maint-toggle")).toBeVisible();
  await expect(page.getByTestId("sync-ships")).toBeVisible();
  await expect(page.getByTestId("sync-locations")).toBeVisible();
  await expect(page.getByTestId("feedback-channel")).toBeVisible();
});

test("synthetic e2e players are hidden from the user table", async () => {
  // The admin list filters out `e2e-*` usernames by design (routes/apiV1.ts), so
  // a test player must never be listed — and the role controls that used to be
  // exercised here are unreachable for them on purpose.
  await expect(page.getByTestId(`admin-user-${target.userId}`)).toHaveCount(0);
  await expect(page.getByText("e2e-roletarget")).toHaveCount(0);
});

test("user search filters the table", async () => {
  const search = page.getByTestId("user-search");
  const rowsBefore = await page.locator('[data-testid^="admin-user-"]').count();
  await search.fill("zzz-no-such-user-zzz");
  await expect
    .poll(() => page.locator('[data-testid^="admin-user-"]').count(), { timeout: 10_000 })
    .toBe(0);
  await search.fill("");
  await expect
    .poll(() => page.locator('[data-testid^="admin-user-"]').count(), { timeout: 10_000 })
    .toBe(rowsBefore);
});

test("synthetic E2E guilds never appear in the admin guild table", async () => {
  // listAllGuildsForAdmin() excludes the E2E guild ids by design, so the ban
  // controls cannot be aimed at test data — which is exactly the point. Ban and
  // unban of a REAL guild is deliberately not exercised from an E2E run.
  await expect(page.getByTestId(`admin-guild-${E2E_GUILD}`)).toHaveCount(0);
  await expect(page.getByTestId(`admin-ban-${E2E_GUILD}`)).toHaveCount(0);
});
