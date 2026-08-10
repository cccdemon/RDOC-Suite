import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { API, actorContext, cleanup, login, SPA, type TestActor } from "../helpers/auth.js";

// Logged-out gates, public doc surfaces, the login page, and shell controls
// (theme, footer, nav, logout). No mutations.
test.describe.configure({ mode: "serial" });

let anon: BrowserContext;
let pg: Page;

test.beforeAll(async ({ browser }) => {
  anon = await browser.newContext({ baseURL: `${SPA}/`, ignoreHTTPSErrors: true });
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

test("the start page describes only features that exist", async () => {
  await pg.goto("start");
  const page = pg.getByTestId("start-page");
  await expect(page).toBeVisible({ timeout: 10_000 });
  const text = await page.innerText();

  // Removed with the voice stack (2026-06/08): there are no relay bots, and the
  // bot never grants Discord roles — it only reads the configured one.
  for (const gone of ["Funkrelais", "Relais", "LiveKit", "Companion", "vergibt Sprachrollen", "relay bot"]) {
    expect(text, `start page still claims "${gone}"`).not.toContain(gone);
  }

  // Voice is a link into a separate app, and it says so.
  const voice = pg.getByTestId("start-feature-voice");
  await expect(voice).toContainText("SquadLink");

  // Every feature block must render a title and a body — a missing translation
  // key would show up as the raw key.
  const blocks = pg.locator('[data-testid^="start-feature-"]');
  const count = await blocks.count();
  expect(count).toBeGreaterThanOrEqual(15);
  for (let i = 0; i < count; i++) {
    const t = await blocks.nth(i).innerText();
    expect(t.length, `feature block ${i} is empty`).toBeGreaterThan(40);
    expect(t, `feature block ${i} shows a raw i18n key`).not.toMatch(/start\.f\./);
  }
});

test("the used-by panel shows consented orgs, or nothing at all", async () => {
  const res = await pg.request.get(`${API}/public/orgs`);
  await expect(res).toBeOK();
  const orgs = (await res.json()).orgs as Array<{ name: string; inviteUrl: string }>;

  await pg.goto("start");
  const panel = pg.getByTestId("start-usedby");

  if (orgs.length === 0) {
    // A fresh instance must not render an empty box.
    await expect(panel).toHaveCount(0);
    return;
  }

  await expect(panel).toBeVisible();
  const cards = pg.getByTestId("start-usedby-org");
  await expect(cards).toHaveCount(orgs.length);

  // Every card carries a mark: the guild icon, or the neutral fallback when the
  // stored icon hash has gone stale on Discord's CDN. Never a broken image.
  for (let i = 0; i < orgs.length; i++) {
    const card = cards.nth(i);
    const marks = (await card.locator("img").count()) + (await card.locator("svg").count());
    expect(marks, `org card ${i} has no logo and no fallback`).toBeGreaterThan(0);
    // Deliberately no assertion on the pixels: the icon comes from Discord's
    // CDN, and this suite must pass without internet access. Whether the image
    // loads is exactly what the onError fallback is for.
  }
  for (const org of orgs) {
    await expect(panel).toContainText(org.name);
    // Every card links somewhere, and outbound links carry noopener.
    const link = pg.locator(`[data-testid="start-usedby-org"][href="${org.inviteUrl}"]`);
    await expect(link).toHaveCount(1);
    expect(await link.getAttribute("rel")).toContain("noopener");
  }
});

test("the architecture section renders its diagrams and stays inside the viewport", async () => {
  await pg.goto("handbuch/architektur");
  const doc = pg.getByTestId("doc-architecture");
  await expect(doc).toBeVisible({ timeout: 10_000 });
  // Inline SVG, because the app CSP forbids the inline script a diagram
  // renderer would need. Three diagrams: runtime, data model, flow chart.
  expect(await doc.locator("svg").count()).toBe(3);
  expect(await doc.locator("table").count()).toBeGreaterThanOrEqual(4);

  // Wide content (diagrams, tables) must scroll inside its own container — the
  // page itself must never scroll sideways, least of all on a phone.
  const noPageScroll = () =>
    pg.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
  expect(await noPageScroll()).toBe(true);
  await pg.setViewportSize({ width: 390, height: 800 });
  await expect(doc).toBeVisible();
  expect(await noPageScroll()).toBe(true);
  await pg.setViewportSize({ width: 1280, height: 900 });
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
