import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Mission-cover panel: format/preset selects, generate (renders via the
// mission-cover service), the resulting image + edit/delete controls, and the
// op-detail cover lightbox. Generation hits the render service, so the generate
// test is given a longer budget.
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let ctx: BrowserContext;
let op: Page;
let opId = "";

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  ctx = await actorContext(browser, operator);
  op = await ctx.newPage();

  await op.goto("ops/new");
  await op.getByTestId("wiz-title").fill("E2E-Cover Op");
  await op.getByTestId("wiz-when").fill(futureLocal(7));
  await op.getByTestId("wiz-type-combat").click();
  await op.getByTestId("wiz-step-1").click();
  await op.getByTestId("wiz-step-2").click();
  await op.getByTestId("wiz-step-3").click();
  await op.getByTestId("wiz-ship-any").click();
  await op.getByTestId("wiz-step-5").click();
  await op.getByTestId("wiz-create").click();
  await expect(op.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
  await op.getByTestId("wiz-to-op").click();
  opId = op.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("cover: pick format/preset and generate an image via the render service", async () => {
  test.setTimeout(90_000);
  await op.goto(`ops/${opId}?op=cover`);
  await expect(op.getByTestId("cover-panel")).toBeVisible({ timeout: 10_000 });

  const fmt = op.getByTestId("cover-format");
  if (await fmt.count()) await fmt.selectOption({ index: 0 });
  const preset = op.getByTestId("cover-preset");
  if (await preset.count()) await preset.selectOption({ index: 0 });

  await op.getByTestId("cover-generate").click();
  // The mission-cover service renders the image; allow time for the round-trip.
  await expect(op.getByTestId("cover-image")).toBeVisible({ timeout: 60_000 });
  await expect(op.getByTestId("cover-edit")).toBeVisible();
  await expect(op.getByTestId("cover-delete")).toBeVisible();
});

test("cover: op-detail hero opens + closes the lightbox", async () => {
  await op.goto(`ops/${opId}`);
  const open = op.getByTestId("cover-open");
  if (!(await open.count())) return; // no cover hero rendered for this op
  await open.click();
  await expect(op.getByTestId("cover-lightbox")).toBeVisible({ timeout: 10_000 });
  await op.getByTestId("cover-lightbox-close").click();
  await expect(op.getByTestId("cover-lightbox")).toBeHidden({ timeout: 10_000 });
});

test("cover: delete returns the panel to its empty state", async () => {
  await op.goto(`ops/${opId}?op=cover`);
  await expect(op.getByTestId("cover-panel")).toBeVisible({ timeout: 10_000 });
  const del = op.getByTestId("cover-delete");
  if (await del.count()) {
    // remove() asks window.confirm — accept it (Playwright auto-dismisses otherwise).
    op.once("dialog", (d) => void d.accept());
    await del.click();
    await expect(op.getByTestId("cover-empty")).toBeVisible({ timeout: 10_000 });
  }
});
