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

test("user search filters the table", async () => {
  const search = page.getByTestId("user-search");
  await search.fill("e2e-roletarget");
  await expect(page.getByTestId(`admin-user-${target.userId}`)).toBeVisible();
  await search.fill("");
});

test("change an e2e test user's instance role (safe test data)", async () => {
  const sel = page.getByTestId(`admin-user-role-${target.userId}`);
  await expect(sel).toBeVisible();
  await sel.selectOption("fleetoperator");
  await expect(page.getByTestId("admin-notice")).toBeVisible();
  // revert
  await page.getByTestId(`admin-user-role-${target.userId}`).selectOption("crew");
});

test("ban + unban the synthetic E2E guild only", async () => {
  const row = page.getByTestId(`admin-guild-${E2E_GUILD}`);
  await expect(row).toBeVisible();
  await page.getByTestId(`admin-ban-${E2E_GUILD}`).click();
  await expect(page.getByTestId(`admin-unban-${E2E_GUILD}`)).toBeVisible({ timeout: 10_000 });
  await page.getByTestId(`admin-unban-${E2E_GUILD}`).click();
  await page.reload();
  await expect(page.getByTestId("admin-page")).toBeVisible();
  await expect(page.getByTestId(`admin-unban-${E2E_GUILD}`)).toHaveCount(0);
});
