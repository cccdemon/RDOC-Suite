import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

const BASE = process.env.E2E_BASE_URL ?? "https://suite.raumdock.org";

// Logged-out gates, public doc surfaces, the login page, and shell controls
// (theme, footer, nav, logout). No mutations.
test.describe.configure({ mode: "serial" });

let anon: BrowserContext;
let pg: Page;

test.beforeAll(async ({ browser }) => {
  anon = await browser.newContext({ baseURL: `${BASE}/fleetplanner/`, ignoreHTTPSErrors: true });
  pg = await anon.newPage();
});

test.afterAll(async () => {
  await anon?.close();
});

test("protected surfaces show their anonymous gate when logged out", async () => {
  const gates: Array<[string, string]> = [
    ["guilds", "servers-anon"],
    ["guilds/settings", "guild-anon"],
    ["guilds/diagnostics", "diag-anon"],
    ["guilds/partnerships", "partnerships-anon"],
    ["konto/profil", "profile-anon"],
    ["konto/logins", "account-anon"],
    ["konto/feedback", "feedback-anon"],
  ];
  for (const [route, gate] of gates) {
    await pg.goto(route);
    await expect(pg.getByTestId(gate)).toBeVisible({ timeout: 10_000 });
  }
});

test("public doc surfaces render", async () => {
  const docs: Array<[string, string]> = [
    ["handbuch", "handbuch-page"],
    ["rechtliches", "rechtliches-page"],
    ["roadmap", "roadmap-page"],
    ["api-docs", "api-docs"],
    ["login", "login-page"],
  ];
  for (const [route, id] of docs) {
    await pg.goto(route);
    await expect(pg.getByTestId(id)).toBeVisible({ timeout: 10_000 });
  }
});

test("shell controls: theme switch, footer legal, login affordance", async () => {
  await pg.goto("./");
  const theme = pg.getByTestId("theme-select").first();
  if (await theme.count()) {
    await theme.selectOption("terminal");
    await theme.selectOption("raumdock");
  }
  if (await pg.getByTestId("footer-legal").count()) {
    await expect(pg.getByTestId("footer-legal").first()).toBeVisible();
  }
  // A logged-out visitor gets a login call-to-action / link.
  const loginAff = pg.getByTestId("login-cta").or(pg.getByTestId("login-link")).first();
  await expect(loginAff).toBeVisible({ timeout: 10_000 });
});

test("logged-in shell: nav links present and logout works", async ({ browser }) => {
  await cleanup();
  const actor: TestActor = await login("e2e-navuser", "crew", "crew");
  const ctx = await actorContext(browser, actor);
  const p = await ctx.newPage();
  try {
    await p.goto("./");
    await expect(p.getByTestId("profile-link").first()).toBeVisible({ timeout: 10_000 });
    expect(await p.locator('[data-testid^="nav-"]').count()).toBeGreaterThan(0);

    await p.getByTestId("logout-btn").first().click();
    // After logout the landing shows the logged-out CTA again.
    await expect(p.getByTestId("login-cta").or(p.getByTestId("login-link")).first()).toBeVisible({ timeout: 10_000 });
  } finally {
    await ctx.close();
  }
});
