import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Overview/calendar surface (CalendarPage backs both "/" and "/calendar"). Covers
// the list <-> month <-> agenda view switch, month navigation (prev/next/today),
// type filters and the past toggle. View switches are read-only. One draft op is
// created so the list view has content (drafts show in the list view).
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
  ctx = await actorContext(browser, operator);
  pg = await ctx.newPage();

  await pg.goto("ops/new");
  await pg.getByTestId("wiz-title").fill("E2E-Overview Op");
  await pg.getByTestId("wiz-when").fill(futureLocal(5));
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

test("switches between list, month and agenda views", async () => {
  // Force the list view via the URL; the draft op makes op-grid render.
  await pg.goto("./?view=liste");
  await expect(pg.getByTestId("op-grid")).toBeVisible({ timeout: 10_000 });

  // List -> month (month nav bar appears).
  await pg.getByTestId("cal-view-monat").click();
  await expect(pg.getByTestId("cal-today")).toBeVisible({ timeout: 10_000 });

  // Month -> agenda.
  await pg.getByTestId("cal-view-agenda").click();
  await expect(pg.getByTestId("calendar-page")).toBeVisible();

  // Agenda -> list.
  await pg.getByTestId("op-view-liste").click();
  await expect(pg.getByTestId("op-grid")).toBeVisible({ timeout: 10_000 });
});

test("month navigation, filters and past toggle keep the view stable", async () => {
  await pg.goto("./?view=monat");
  await expect(pg.getByTestId("cal-today")).toBeVisible({ timeout: 10_000 });

  for (const id of ["cal-next", "cal-next", "cal-prev", "cal-today"]) {
    await pg.getByTestId(id).click();
    await expect(pg.getByTestId("calendar-page")).toBeVisible();
  }

  const firstFilter = pg.locator('[data-testid^="cal-filter-"]').first();
  if (await firstFilter.count()) {
    await firstFilter.click();
    await expect(pg.getByTestId("calendar-page")).toBeVisible();
  }

  const past = pg.getByTestId("cal-toggle-past");
  if (await past.count()) {
    await past.click();
    await expect(pg.getByTestId("calendar-page")).toBeVisible();
  }
});

test("view, filters, month and day survive reload and Back", async () => {
  await pg.goto("./?view=liste");
  await expect(pg.getByTestId("op-grid")).toBeVisible({ timeout: 10_000 });

  // Every filter dimension lands in the URL (UI audit 5).
  await pg.getByTestId("cal-filter-combat").click();
  await expect(pg).toHaveURL(/typ=combat/);
  await pg.getByTestId("cal-filter-stream").selectOption("only");
  await expect(pg).toHaveURL(/stream=only/);
  await pg.getByTestId("cal-toggle-past").click();
  await expect(pg).toHaveURL(/past=1/);

  // A reload reproduces the same screen from the URL alone.
  await pg.reload();
  await expect(pg.getByTestId("calendar-page")).toBeVisible({ timeout: 10_000 });
  await expect(pg.getByTestId("cal-filter-stream")).toHaveValue("only");
  await expect(pg.getByTestId("cal-toggle-past")).toHaveAttribute("aria-pressed", "true");

  // Switching the view is navigation, so Back undoes it.
  await pg.getByTestId("cal-view-agenda").click();
  await expect(pg).toHaveURL(/view=agenda/);
  await pg.goBack();
  await expect(pg).toHaveURL(/view=liste/);

  // The month view addresses its month and its selected day.
  await pg.goto("./?view=kalender");
  await pg.getByTestId("cal-next").click();
  await expect(pg).toHaveURL(/m=\d{4}-\d{2}/);
  await pg.locator('[data-testid^="cal-day-"]').nth(3).click();
  await expect(pg).toHaveURL(/d=\d+/);
});

test("the view switch is a keyboard-operable tablist", async () => {
  await pg.goto("./?view=liste");
  await expect(pg.getByTestId("op-view-tabs")).toHaveAttribute("role", "tablist");
  const liste = pg.getByTestId("op-view-liste");
  await expect(liste).toHaveAttribute("aria-selected", "true");
  await expect(liste).toHaveAttribute("aria-controls", "op-view-panel");
  await liste.focus();
  await pg.keyboard.press("ArrowRight");
  await expect(pg).toHaveURL(/view=kalender/);
  await pg.keyboard.press("End");
  await expect(pg).toHaveURL(/view=agenda/);
});

test("create link routes to the op wizard", async () => {
  await pg.goto("./?view=liste");
  await pg.getByTestId("create-link").first().click();
  await expect(pg.getByTestId("create-page")).toBeVisible({ timeout: 10_000 });
});
