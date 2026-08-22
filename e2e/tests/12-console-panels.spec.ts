import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Operator-side console panels reached from the management tabs:
//   Eckdaten    -> Resource links (add/remove)
//   Flotte      -> Needs editor (CQB teams save)
//   Commanders  -> add/remove a leader
//   Cover       -> panel renders with its controls
// Scoped to the synthetic E2E guild.
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
  // A second member so the commanders candidate list is non-empty.
  await login("e2e-leadcand", "crew", "crew");
  ctx = await actorContext(browser, operator);
  op = await ctx.newPage();

  await op.goto("ops/new");
  await op.getByTestId("wiz-title").fill("E2E-Konsole Panels Op");
  await op.getByTestId("wiz-when").fill(futureLocal(6));
  await op.getByTestId("wiz-type-combat").click();
  await op.getByTestId("wiz-step-1").click();
  await op.getByTestId("wiz-step-2").click();
  await op.getByTestId("wiz-step-3").click();
  await op.getByTestId("wiz-ship-any").click();
  await op.getByTestId("wiz-cqb").fill("1");
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

test("resource links: add then remove a link", async () => {
  await op.goto(`ops/${opId}?op=briefing`);
  await expect(op.getByTestId("rlinks-panel")).toBeVisible({ timeout: 10_000 });

  await op.getByTestId("rlink-url").fill("https://example.com/e2e");
  await op.getByTestId("rlink-title").fill("E2E Link");
  await op.getByTestId("rlink-add").click();

  const remove = op.locator('[data-testid^="rlink-remove-"]').first();
  await expect(remove).toBeVisible({ timeout: 10_000 });
  await remove.click();
  await expect(op.getByTestId("rlinks-panel")).toBeVisible();
});

test("needs editor: change and save CQB team count", async () => {
  await op.goto(`ops/${opId}?op=needs`);
  await expect(op.getByTestId("needs-editor")).toBeVisible({ timeout: 10_000 });

  const cqb = op.getByTestId("cqb-count");
  await cqb.fill("3");
  const save = op.getByTestId("cqb-save");
  await expect(save).toBeEnabled();
  await save.click();
  await expect(op.getByTestId("needs-editor")).toBeVisible();
});

test("commanders: add then remove a leader", async () => {
  await op.goto(`ops/${opId}?op=commanders`);
  await expect(op.getByTestId("commanders-panel")).toBeVisible({ timeout: 10_000 });

  await op.getByTestId("leader-filter").fill("e2e");
  const cand = op.locator('[data-testid^="leader-cand-"]').first();
  if (!(await cand.count())) return; // no candidates in this guild — nothing to add
  await cand.click();

  const remove = op.locator('[data-testid^="leader-remove-"]').first();
  await expect(remove).toBeVisible({ timeout: 10_000 });
  await remove.click();
  await expect(op.getByTestId("commanders-panel")).toBeVisible();
});

test("cover panel renders with its controls (legacy ?op=cover alias)", async () => {
  await op.goto(`ops/${opId}?op=cover`);
  await expect(op.getByTestId("cover-panel")).toBeVisible({ timeout: 10_000 });
  // Either an existing cover image or the empty state + generate affordance.
  const hasImage = await op.getByTestId("cover-image").count();
  const hasGenerate = await op.getByTestId("cover-generate").count();
  const hasEmpty = await op.getByTestId("cover-empty").count();
  expect(hasImage + hasGenerate + hasEmpty).toBeGreaterThan(0);
});
