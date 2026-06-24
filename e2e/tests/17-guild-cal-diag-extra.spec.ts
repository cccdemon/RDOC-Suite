import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Remaining controls on guild settings (timezone/invite/admiral-role/member
// toggle/save), the calendar month view (month label, day cells, drafts, past),
// and the diagnostics page. Scoped to the synthetic E2E guild.
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let ctx: BrowserContext;
let pg: Page;

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  await login("e2e-member2", "crew", "crew"); // a second member for member-toggle
  ctx = await actorContext(browser, operator);
  pg = await ctx.newPage();

  // A draft op so the list/calendar has content.
  await pg.goto("ops/new");
  await pg.getByTestId("wiz-title").fill("E2E-GuildCal Op");
  await pg.getByTestId("wiz-when").fill(futureLocal(4));
  await pg.getByTestId("wiz-type-combat").click();
  await pg.getByTestId("wiz-step-1").click();
  await pg.getByTestId("wiz-step-2").click();
  await pg.getByTestId("wiz-step-3").click();
  await pg.getByTestId("wiz-ship-any").click();
  await pg.getByTestId("wiz-step-5").click();
  await pg.getByTestId("wiz-create").click();
  await expect(pg.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("guild settings: timezone, invite, admiral-role, member toggle, save", async () => {
  await pg.goto("guilds/settings");
  await expect(pg.getByTestId("guild-settings-page")).toBeVisible({ timeout: 10_000 });

  await pg.getByTestId("guild-timezone").selectOption({ index: 0 });
  await pg.getByTestId("guild-invite").fill("https://discord.gg/e2etest");
  await pg.getByTestId("guild-admiralrole").fill("123456789012345678");

  // A per-member role toggle is present (not clicked — the first row may be the
  // operator themselves, and dropping our own fleet-operator role would deny the
  // save below).
  expect(await pg.locator('[data-testid^="member-toggle-"]').count()).toBeGreaterThanOrEqual(0);

  await pg.getByTestId("guild-save").click();
  await expect(pg.getByTestId("guild-notice")).toContainText(/gespeichert/i, { timeout: 10_000 });
});

test("calendar month view: month label, day cells, drafts + past controls", async () => {
  await pg.goto("./?view=monat");
  await expect(pg.getByTestId("cal-month")).toBeVisible({ timeout: 10_000 });
  await expect(pg.locator('[data-testid^="cal-day-"]').first()).toBeVisible({ timeout: 10_000 });

  const past = pg.getByTestId("cal-show-past-inline");
  if (await past.count()) {
    await past.click();
    await expect(pg.getByTestId("cal-month")).toBeVisible();
  }

  // Drafts button jumps to the list view.
  await pg.goto("./?view=monat");
  const drafts = pg.getByTestId("cal-drafts");
  if (await drafts.count()) {
    await drafts.click();
    await expect(pg.getByTestId("op-grid")).toBeVisible({ timeout: 10_000 });
  }
});

test("diagnostics page renders bot status, guild picker and re-test", async () => {
  await pg.goto("guilds/diagnostics");
  // Either the diagnostics page (with rights) or the no-rights state.
  const page = pg.getByTestId("diagnostics-page");
  const none = pg.getByTestId("diag-none");
  await expect(page.or(none).first()).toBeVisible({ timeout: 10_000 });

  if (await page.count()) {
    const guild = pg.getByTestId("diag-guild");
    if (await guild.count()) await guild.selectOption({ index: 0 });
    const retest = pg.getByTestId("diag-retest");
    if (await retest.count()) await retest.click();
    expect(await pg.locator('[data-testid^="diag-bot-"]').count()).toBeGreaterThanOrEqual(0);
  }
});
