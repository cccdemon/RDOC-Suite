import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, SPA, type TestActor } from "../helpers/auth.js";

// Handoff §16 — the acceptance criteria that are claims rather than judgements.
//
// The manual checklist (docs/REDESIGN-ABNAHME.md) carries phase 6, but most of
// §16 is not a matter of taste: either a guest is offered "Neue Operation" or
// they are not, either an old bookmark lands on its content or it does not.
// Anything that only lives on a paper checklist gets re-checked by hand next
// time, or not at all.
//
// What deliberately stays manual: the eight questions in §19. No spec can say
// whether an operator knows what to do next without the manual.
test.describe.configure({ mode: "serial" });

let anonCtx: BrowserContext;
let anon: Page;

let crew: TestActor;
let crewCtx: BrowserContext;
let cr: Page;

let operator: TestActor;
let opCtx: BrowserContext;
let op: Page;

let admin: TestActor;
let adminCtx: BrowserContext;
let ad: Page;

let opId = "";

/** Local date-time input value, n days out. */
function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function makeOp(page: Page, title: string): Promise<string> {
  await page.goto("ops/new");
  await page.getByTestId("wiz-title").fill(title);
  await page.getByTestId("wiz-when").fill(futureLocal(7));
  await page.getByTestId("wiz-type-combat").click();
  await page.getByTestId("wiz-step-3").click();
  await page.getByTestId("wiz-ship-any").click();
  await page.getByTestId("wiz-step-5").click();
  await page.getByTestId("wiz-create").click();
  await expect(page.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
  await page.getByTestId("wiz-to-op").click();
  return page.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  anonCtx = await browser.newContext({ baseURL: `${SPA}/`, ignoreHTTPSErrors: true });
  anon = await anonCtx.newPage();

  // A crew member with no operator membership anywhere — the case §16 singles
  // out, because a crew member who happens to run another server is not it.
  crew = await login("e2e-plaincrew", "crew", "crew");
  crewCtx = await actorContext(browser, crew);
  cr = await crewCtx.newPage();

  operator = await login("e2e-matrixop", "crew", "fleetoperator");
  opCtx = await actorContext(browser, operator);
  op = await opCtx.newPage();

  admin = await login("e2e-matrixadmin", "superadmin", "fleetoperator");
  adminCtx = await actorContext(browser, admin);
  ad = await adminCtx.newPage();

  opId = await makeOp(op, "E2E-Rollenmatrix Op");
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await Promise.all([anonCtx?.close(), crewCtx?.close(), opCtx?.close(), adminCtx?.close()]);
  await cleanup();
});

/** Which nav entries a page offers. `nav-` is the desktop rail's testid prefix. */
async function navHas(page: Page, to: string): Promise<boolean> {
  return (await page.getByTestId(`nav-${to}`).count()) > 0;
}

/**
 * Wait until the rail reflects the SESSION, not just until it exists.
 *
 * The rail renders before /session answers, so asserting "this role is not
 * offered X" against a freshly loaded page passes for every role — including
 * the ones that should be offered X. The anchor is an entry only this role
 * gets, so its arrival proves the gates have been applied.
 */
async function navReady(page: Page, anchor: string): Promise<void> {
  // `.first()`: some anchors exist in both the rail and the mobile head, and one
  // of them showing up is all this needs to prove.
  await expect(page.getByTestId(anchor).first()).toBeVisible({ timeout: 10_000 });
}

// ── §16: what each role is offered ───────────────────────────────────────────

test("a guest is offered nothing they cannot reach", async () => {
  await anon.goto("start");
  await expect(anon.getByTestId("start-page")).toBeVisible({ timeout: 10_000 });
  // Only a signed-out viewer gets this, so it proves the session resolved.
  await navReady(anon, "login-link");

  // Offering a destination that ends in a rejection screen is the specific
  // failure §2.2 called out.
  for (const gone of ["/ops/new", "/templates", "/konto", "/guilds", "/guilds/settings", "/admin"]) {
    expect(await navHas(anon, gone), `guest is offered ${gone}`).toBe(false);
  }
  // What a guest genuinely can use stays.
  expect(await navHas(anon, "/operationen")).toBe(true);
  expect(await navHas(anon, "/handbuch")).toBe(true);
});

test("a crew member without an operator server gets no operator destinations", async () => {
  await cr.goto("operationen");
  // Konto is login-gated, so it only appears once the session has been applied.
  await navReady(cr, "nav-/konto");

  expect(await navHas(cr, "/ops/new"), "crew is offered Neue Operation").toBe(false);
  expect(await navHas(cr, "/templates"), "crew is offered Vorlagen").toBe(false);
  expect(await navHas(cr, "/guilds/settings"), "crew is offered Servereinstellungen").toBe(false);
  expect(await navHas(cr, "/admin"), "crew is offered the admin console").toBe(false);

  // Their own account and the server list are theirs.
  expect(await navHas(cr, "/konto")).toBe(true);
  expect(await navHas(cr, "/guilds")).toBe(true);
});

test("an operator gets creation and their server's management", async () => {
  await op.goto("operationen");
  await navReady(op, "nav-/ops/new");

  for (const there of ["/ops/new", "/templates", "/guilds/settings", "/guilds/partnerships", "/guilds/diagnostics"]) {
    expect(await navHas(op, there), `operator is missing ${there}`).toBe(true);
  }
  // Instance administration is not a guild role.
  expect(await navHas(op, "/admin"), "operator is offered the admin console").toBe(false);
});

test("a superadmin gets administration, and it is not the same word as event management", async () => {
  await ad.goto("operationen");
  await navReady(ad, "nav-/admin");

  expect(await navHas(ad, "/admin/system")).toBe(true);

  // innerText is the RENDERED text, and the group labels are uppercased in CSS —
  // so this has to be case-insensitive, not "Administration".
  const nav = await ad.getByTestId("sidebar-nav").innerText();
  // §3.4: "Administration" is the instance. Inside an operation the same area is
  // called "Verwaltung", and the rail must not reuse that word for the global
  // one — nor the generic "Admin", which is what it used to say.
  expect(nav).toMatch(/administration/i);
  expect(nav).not.toMatch(/admin \/ system/i);
});

test("desktop and mobile offer the same destinations", async () => {
  // §16: "Desktop und Mobile haben identische fachliche Einträge."
  await op.setViewportSize({ width: 1400, height: 900 });
  await op.goto("operationen");
  await navReady(op, "nav-/ops/new");
  const desktop = await op
    .locator('[data-testid^="nav-/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!).sort());

  await op.setViewportSize({ width: 390, height: 844 });
  await op.goto("operationen");
  await op.getByTestId("mobile-nav-toggle").click();
  await navReady(op, "mnav-/ops/new");
  const mobile = await op
    .locator('[data-testid^="mnav-/"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute("data-testid")!.replace("mnav-", "nav-")).sort());

  expect(mobile).toEqual(desktop);

  await op.setViewportSize({ width: 1400, height: 900 });
});

// ── §16: the management mode is not something a crew member can type ─────────

test("crew sees no manage mode, and cannot conjure one from the URL", async () => {
  await cr.goto(`ops/${opId}`);
  await expect(cr.getByTestId("op-title")).toBeVisible({ timeout: 10_000 });
  expect(await cr.getByTestId("op-mode-manage").count()).toBe(0);

  await cr.goto(`ops/${opId}?mode=manage`);
  await expect(cr.getByTestId("op-title")).toBeVisible({ timeout: 10_000 });
  // The server checks every mutation regardless; this is about not showing an
  // empty console to somebody who cannot use it.
  expect(await cr.getByTestId("operator-console").count()).toBe(0);
});

test("an operator switches modes and the URL remembers which one", async () => {
  await op.goto(`ops/${opId}`);
  await expect(op.getByTestId("op-mode-view")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

  await op.getByTestId("op-mode-manage").click();
  await expect(op.getByTestId("operator-console")).toBeVisible({ timeout: 10_000 });
  await expect(op).toHaveURL(/mode=manage/);

  await op.reload();
  await expect(op.getByTestId("operator-console")).toBeVisible({ timeout: 10_000 });

  await op.goBack();
  await expect(op.getByTestId("op-mode-view")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
});

// ── §16: every old link still lands on its content ───────────────────────────

test("legacy operation links resolve to what they used to open", async () => {
  const cases: Array<[string, string]> = [
    [`ops/${opId}/manage`, "manage-tab-fleet"],
    [`ops/${opId}/edit`, "manage-tab-eckdaten"],
    // The cover joined the other media; the bookmark still has to find it.
    [`ops/${opId}/cover`, "manage-tab-briefing"],
    [`ops/${opId}?op=cover`, "manage-tab-briefing"],
    // Questions moved from Planung to Kommunikation.
    [`ops/${opId}?op=qa`, "manage-tab-qa"],
    [`ops/${opId}?op=needs`, "manage-tab-needs"],
    [`ops/${opId}?op=admin`, "manage-tab-admin"],
  ];
  for (const [url, tab] of cases) {
    await op.goto(url);
    await expect(op.getByTestId(tab), `${url} did not open ${tab}`).toHaveAttribute("aria-selected", "true", {
      timeout: 10_000,
    });
  }
});

test("legacy page links keep their query and land on the right screen", async () => {
  await op.goto("calendar?typ=combat");
  await expect(op).toHaveURL(/view=kalender/, { timeout: 10_000 });
  // §14: a redirect keeps what the caller sent with it.
  await expect(op).toHaveURL(/typ=combat/);

  const pages: Array<[string, string]> = [
    ["profile", "konto/profil"],
    ["account", "konto/logins"],
    ["feedback", "konto/feedback"],
  ];
  for (const [from, to] of pages) {
    await op.goto(from);
    await expect(op, `${from} did not redirect to ${to}`).toHaveURL(new RegExp(to.replace("/", "\\/")), {
      timeout: 10_000,
    });
  }
});
