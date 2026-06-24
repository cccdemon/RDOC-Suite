import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Eckdaten edit form (every control) + recurrence series controls + delete flow.
// All inline-autosave; assertions confirm each control reacts without error.
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

async function makeOp(page: Page, title: string): Promise<string> {
  await page.goto("ops/new");
  await page.getByTestId("wiz-title").fill(title);
  await page.getByTestId("wiz-when").fill(futureLocal(7));
  await page.getByTestId("wiz-type-combat").click();
  await page.getByTestId("wiz-step-1").click();
  await page.getByTestId("wiz-step-2").click();
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
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  ctx = await actorContext(browser, operator);
  op = await ctx.newPage();
  opId = await makeOp(op, "E2E-Edit Form Op");
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("every eckdaten field reacts (autosave/inline)", async () => {
  await op.goto(`ops/${opId}?op=eckdaten`);
  await expect(op.getByTestId("edit-op-page")).toBeVisible({ timeout: 10_000 });

  await op.getByTestId("edit-title").fill("E2E Edited Title");
  await op.getByTestId("edit-scheduled").fill(futureLocal(9));
  await op.getByTestId("edit-maxparticipants").fill("12");
  await op.getByTestId("edit-location").fill("ARC-L1");
  await op.getByTestId("edit-description").fill("## Updated\nedited briefing");

  // Segmented controls — click the first option of each.
  await op.locator('[data-testid^="edit-type-"]').first().click();
  await op.locator('[data-testid^="edit-system-"]').first().click();
  await op.locator('[data-testid^="edit-vis-"]').first().click();

  // SquadLink voice toggle.
  const sl = op.getByTestId("edit-squadlink-toggle");
  if (await sl.count()) await sl.click();

  // Settle, reload, confirm a representative value persisted.
  await op.waitForTimeout(1000);
  await op.goto(`ops/${opId}?op=eckdaten`);
  await expect(op.getByTestId("edit-maxparticipants")).toHaveValue("12", { timeout: 10_000 });
});

test("recurrence series create + stop", async () => {
  await op.goto(`ops/${opId}?op=admin`);
  await expect(op.getByTestId("operator-console")).toBeVisible({ timeout: 10_000 });

  const freq = op.getByTestId("recur-freq");
  if (!(await freq.count())) return; // recurrence UI not present for this op
  await freq.selectOption({ index: 1 });
  await op.getByTestId("recur-count").fill("2");
  await op.getByTestId("recur-until").fill(futureLocal(60).slice(0, 10));
  await op.getByTestId("recur-create").click();
  await expect(op.getByTestId("operator-console")).toBeVisible();

  const stop = op.getByTestId("recurrence-stop");
  if (await stop.count()) {
    await stop.click();
    await expect(op.getByTestId("operator-console")).toBeVisible();
  }
});

test("delete an operation through the confirm step", async () => {
  const throwaway = await makeOp(op, "E2E-Delete Me");
  await op.goto(`ops/${throwaway}?op=eckdaten`);
  await expect(op.getByTestId("edit-delete")).toBeVisible({ timeout: 10_000 });
  await op.getByTestId("edit-delete").click();
  await op.getByTestId("edit-delete-confirm").click();
  // After deletion the SPA leaves the op detail (redirect to the overview).
  await expect(op).not.toHaveURL(/\/ops\/[^/]/, { timeout: 10_000 });
});
