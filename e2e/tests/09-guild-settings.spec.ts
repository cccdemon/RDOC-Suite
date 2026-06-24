import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Guild settings surface, scoped to the synthetic E2E guild. Covers the org-name
// save round-trip (edit -> save -> success notice -> reload persists), that the
// member list renders, and that the cross-links to diagnostics/partnerships route.
test.describe.configure({ mode: "serial" });

let admin: TestActor;
let ctx: BrowserContext;
let pg: Page;

test.beforeAll(async ({ browser }) => {
  await cleanup();
  admin = await login("e2e-guildadmin", "fleetoperator", "fleetoperator");
  ctx = await actorContext(browser, admin);
  pg = await ctx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("org-name save round-trips and persists", async () => {
  await pg.goto("guilds/settings");
  await expect(pg.getByTestId("guild-settings-page")).toBeVisible({ timeout: 10_000 });

  const orgName = pg.getByTestId("guild-orgname");
  await expect(orgName).toBeVisible();
  const value = `E2E Org ${Date.now()}`;
  await orgName.fill(value);
  await pg.getByTestId("guild-save").click();
  await expect(pg.getByTestId("guild-notice")).toContainText(/gespeichert/i, { timeout: 10_000 });

  await pg.reload();
  await expect(pg.getByTestId("guild-orgname")).toHaveValue(value, { timeout: 10_000 });
});

test("member list renders for the synthetic guild", async () => {
  await pg.goto("guilds/settings");
  await expect(pg.getByTestId("guild-settings-page")).toBeVisible({ timeout: 10_000 });
  // At least the admin themselves is a member row.
  await expect(pg.locator('[data-testid^="member-row-"]').first()).toBeVisible({ timeout: 10_000 });
});

test("cross-links route to diagnostics and partnerships", async () => {
  await pg.goto("guilds/settings");
  await pg.getByTestId("diagnostics-link").click();
  await expect(pg.getByTestId("diagnostics-page")).toBeVisible({ timeout: 10_000 });

  await pg.goto("guilds/settings");
  await pg.getByTestId("partnerships-link").click();
  await expect(pg.getByTestId("partnerships-page")).toBeVisible({ timeout: 10_000 });
});
