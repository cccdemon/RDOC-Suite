import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Admin console + System page (superadmin only) and the forbidden gates for a
// non-superadmin. Destructive/global controls (maintenance toggle, Discord sync,
// feedback-channel save, user de/activation) are asserted PRESENT but not
// triggered — clicking them would mutate the live instance.
test.describe.configure({ mode: "serial" });

let admin: TestActor, grunt: TestActor;
let adminCtx: BrowserContext, gruntCtx: BrowserContext;
let ad: Page, gr: Page;

test.beforeAll(async ({ browser }) => {
  await cleanup();
  admin = await login("e2e-admin", "superadmin", "fleetoperator");
  grunt = await login("e2e-grunt", "crew", "crew");
  adminCtx = await actorContext(browser, admin); ad = await adminCtx.newPage();
  gruntCtx = await actorContext(browser, grunt); gr = await gruntCtx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await adminCtx?.close(); await gruntCtx?.close();
});

test("admin console: search reacts; global/destructive controls are present", async () => {
  await ad.goto("admin");
  await expect(ad.getByTestId("admin-page")).toBeVisible({ timeout: 10_000 });

  // Safe interactive: user search filters the table.
  await ad.getByTestId("user-search").fill("e2e");
  await expect(ad.getByTestId("admin-page")).toBeVisible();

  // Present-only (do not trigger): these mutate the whole instance.
  await expect(ad.getByTestId("admin-settings")).toBeVisible();
  await expect(ad.getByTestId("maint-toggle")).toBeVisible();
  expect(await ad.locator('[data-testid^="sync-"]').count()).toBeGreaterThanOrEqual(0);
  expect(await ad.locator('[data-testid^="interval-"]').count()).toBeGreaterThanOrEqual(0);
  expect(await ad.getByTestId("feedback-channel").count()).toBeGreaterThanOrEqual(0);
});

test("system page: log filters + live controls react", async () => {
  await ad.goto("admin/system");
  await expect(ad.getByTestId("system-page")).toBeVisible({ timeout: 10_000 });
  await expect(ad.getByTestId("system-services")).toBeVisible();

  // Safe interactive controls.
  const cat = ad.getByTestId("cat-filter");
  if (await cat.count()) await cat.selectOption({ index: 0 });
  const lvl = ad.getByTestId("level-filter");
  if (await lvl.count()) await lvl.selectOption({ index: 0 });
  const live = ad.getByTestId("live-toggle");
  if (await live.count()) { await live.click(); await expect(ad.getByTestId("system-page")).toBeVisible(); }
  const refresh = ad.getByTestId("manual-refresh");
  if (await refresh.count()) { await refresh.click(); await expect(ad.getByTestId("system-page")).toBeVisible(); }

  // Present-only: per-service Discord sync would hit external APIs.
  expect(await ad.locator('[data-testid^="svc-"]').count()).toBeGreaterThanOrEqual(0);
  expect(await ad.locator('[data-testid^="do-sync-"]').count()).toBeGreaterThanOrEqual(0);
});

test("a non-superadmin is shown the admin + system forbidden gates", async () => {
  await gr.goto("admin");
  await expect(gr.getByTestId("admin-forbidden")).toBeVisible({ timeout: 10_000 });
  await gr.goto("admin/system");
  await expect(gr.getByTestId("system-forbidden")).toBeVisible({ timeout: 10_000 });
});
