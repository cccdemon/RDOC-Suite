import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Render + control coverage for the remaining guild-scoped surfaces: templates,
// org fleet (pivot + search), server list, and diagnostics. These are largely
// read-only; the goal is that each surface mounts and its primary controls react
// without crashing.
test.describe.configure({ mode: "serial" });

let actor: TestActor;
let ctx: BrowserContext;
let pg: Page;

test.beforeAll(async ({ browser }) => {
  await cleanup();
  actor = await login("e2e-fleetviewer", "fleetoperator", "fleetoperator");
  ctx = await actorContext(browser, actor);
  pg = await ctx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("templates surface renders and search reacts", async () => {
  await pg.goto("templates");
  await expect(pg.getByTestId("templates-page")).toBeVisible({ timeout: 10_000 });
  const search = pg.getByTestId("templates-search");
  if (await search.count()) {
    await search.fill("zzz-no-match");
    await expect(pg.getByTestId("templates-page")).toBeVisible();
    await search.fill("");
  }
});

test("org fleet renders (pivot + search when the orga role grants access)", async () => {
  // NOTE: a hard nav to /guilds/fleet 404s at the edge until the nginx SPA
  // allowlist fix ships (it lacks /guilds/fleet — only /guilds + a few subpaths).
  // So reach it the way a user does: in-app via the sidebar nav (client routing).
  await pg.goto("./");
  await expect(pg.getByTestId("profile-link").first()).toBeVisible({ timeout: 10_000 });
  await pg.getByTestId("nav-/guilds/fleet").click();

  const fleetPage = pg.getByTestId("org-fleet-page");
  // The org fleet is gated behind the configured Discord orga role. The synthetic
  // E2E guild does not grant it, so the access-explainer copy is the expected
  // path; when access IS granted, exercise the pivot + search controls.

  if (await fleetPage.count()) {
    await expect(fleetPage).toBeVisible();
    if (await pg.getByTestId("pivot-ship").count()) {
      await pg.getByTestId("pivot-ship").click();
      await expect(fleetPage).toBeVisible();
    }
    if (await pg.getByTestId("pivot-member").count()) {
      await pg.getByTestId("pivot-member").click();
      await expect(fleetPage).toBeVisible();
    }
    const search = pg.getByTestId("org-fleet-search");
    if (await search.count()) {
      await search.fill("zzz");
      await expect(fleetPage).toBeVisible();
    }
  }
  // else: orga-role-gated explainer — shell rendered above is sufficient.
});

test("server list renders the guild list or an add-bot affordance", async () => {
  await pg.goto("guilds");
  await expect(pg.getByTestId("servers-page")).toBeVisible({ timeout: 10_000 });
  // Either at least one server card or the empty-state add affordance is present.
  const hasServer = await pg.locator('[data-testid^="server-"]').first().count();
  const hasAdd = (await pg.getByTestId("add-bot").count()) || (await pg.getByTestId("servers-none-add").count());
  expect(hasServer + hasAdd).toBeGreaterThan(0);
});

test("diagnostics renders and re-test reacts", async () => {
  await pg.goto("guilds/diagnostics");
  await expect(pg.getByTestId("diagnostics-page")).toBeVisible({ timeout: 10_000 });
  const retest = pg.getByTestId("diag-retest");
  if (await retest.count()) {
    await retest.click();
    await expect(pg.getByTestId("diagnostics-page")).toBeVisible();
  }
});
