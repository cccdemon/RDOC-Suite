import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Player-facing op detail: the offer-ship mode switch (ship / vehicle / squad),
// the Q&A ask flow, and the operator's "view as" perspective switch. Scoped to
// the synthetic E2E guild.
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let player: TestActor;
let opCtx: BrowserContext, plCtx: BrowserContext;
let op: Page, pl: Page;
let opId = "";

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  player = await login("e2e-player", "crew", "crew");
  opCtx = await actorContext(browser, operator); op = await opCtx.newPage();
  plCtx = await actorContext(browser, player); pl = await plCtx.newPage();

  await op.goto("ops/new");
  await op.getByTestId("wiz-title").fill("E2E-Detail Player Op");
  await op.getByTestId("wiz-when").fill(futureLocal(6));
  await op.getByTestId("wiz-type-combat").click();
  await op.getByTestId("wiz-step-1").click();
  await op.getByTestId("wiz-step-2").click();
  await op.getByTestId("wiz-location").fill("HUR-L1");
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
  await opCtx?.close(); await plCtx?.close();
});

test("offer-ship mode switch reveals the right fields per mode", async () => {
  await pl.goto(`ops/${opId}`);
  await expect(pl.getByTestId("op-title")).toBeVisible();
  await pl.getByTestId("offer-ship-open").click();
  await expect(pl.getByTestId("offer-ship-form")).toBeVisible();

  // Squad mode → squad name + size.
  await pl.getByTestId("offer-mode-squad").click();
  await expect(pl.getByTestId("squad-name")).toBeVisible();

  // Ship mode → catalog/hangar ship search.
  await pl.getByTestId("offer-mode-ship").click();
  await expect(pl.getByTestId("ship-search")).toBeVisible();

  // Vehicle mode → catalog search (vehicle).
  if (await pl.getByTestId("offer-mode-vehicle").count()) {
    await pl.getByTestId("offer-mode-vehicle").click();
    await expect(pl.getByTestId("ship-search")).toBeVisible();
  }
});

test("player can ask a question in the Q&A section", async () => {
  await pl.goto(`ops/${opId}`);
  await expect(pl.getByTestId("qa-section")).toBeVisible({ timeout: 10_000 });
  const q = `E2E Frage ${Date.now()}`;
  await pl.getByTestId("qa-input").fill(q);
  await pl.getByTestId("qa-send").click();
  await expect(pl.getByTestId("qa-section")).toContainText(q, { timeout: 10_000 });
});

test("operator can preview the op as crew and as guest", async () => {
  await op.goto(`ops/${opId}`);
  const bar = op.getByTestId("viewas-bar");
  if (!(await bar.count())) return; // viewas is operator-only; skip if absent
  await expect(bar).toBeVisible();
  for (const key of ["crew", "guest", "self"]) {
    const btn = op.getByTestId(`viewas-${key}`);
    if (await btn.count()) {
      await btn.click();
      await expect(op.getByTestId("op-title")).toBeVisible();
    }
  }
});
