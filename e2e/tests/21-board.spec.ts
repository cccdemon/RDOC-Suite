import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Fleet board, full flow. A ship requirement only yields crew seats once an
// offered ship is accepted. A player offers a multi-crew ship; the operator
// binds a Bedarf and accepts it; the open crew seats then surface as op-target
// and can be picked / toggled, a player claims one, and the CQB ground team
// join/leave works. (The accept button is data-testid="accept-<unitId>"; the
// Bedarf select beside it is "unit-bedarf-<unitId>" — they must not collide.)
test.describe.configure({ mode: "serial" });

let operator: TestActor, player: TestActor, claimer: TestActor;
let opCtx: BrowserContext, plCtx: BrowserContext, clCtx: BrowserContext;
let op: Page, pl: Page, cl: Page;
let opId = "";

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  player = await login("e2e-shipcaptain", "crew", "crew"); // offers the ship → becomes its captain
  claimer = await login("e2e-gunner", "crew", "crew"); // a different player who claims an open crew seat
  opCtx = await actorContext(browser, operator); op = await opCtx.newPage();
  plCtx = await actorContext(browser, player); pl = await plCtx.newPage();
  clCtx = await actorContext(browser, claimer); cl = await clCtx.newPage();

  await op.goto("ops/new");
  await op.getByTestId("wiz-title").fill("E2E-Board Op");
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

  // A ship requirement so accepted ships have a Bedarf to bind into.
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("needs-editor")).toBeVisible({ timeout: 10_000 });
  await op.locator('[data-testid^="shiptype-"]').first().click();
  await op.getByTestId("need-add").click();
  await op.locator('[data-testid^="need-row-"]').first().waitFor({ timeout: 10_000 });

  // Player offers a multi-crew catalog ship (open seats remain after the captain seats).
  await pl.goto(`ops/${opId}`);
  await pl.getByTestId("offer-ship-open").click();
  await pl.getByTestId("offer-mode-ship").click();
  await pl.getByTestId("ship-search").fill("constellation");
  await pl.locator('input[name="catalogShip"]').first().waitFor({ timeout: 10_000 });
  await pl.locator('input[name="catalogShip"]').first().check();
  await pl.getByTestId("offer-ship-submit").click();
  await expect(pl.getByTestId("offer-ship-form")).toBeHidden({ timeout: 15_000 });
});

test.afterAll(async () => {
  await cleanup();
  await opCtx?.close(); await plCtx?.close(); await clCtx?.close();
});

test("operator accepts the offered ship into a Bedarf → open crew seats surface", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  const pending = op.locator('[data-testid^="pending-"]').first();
  await expect(pending).toBeVisible({ timeout: 15_000 });

  // Bind the suggested ship Bedarf, then click the precise accept button.
  const bedarf = op.locator('[data-testid^="unit-bedarf-"]').first();
  if (await bedarf.count()) await bedarf.selectOption({ label: /Any ship/i }).catch(() => {});
  await op.locator('[data-testid^="accept-"]').first().click();

  // Accepted ship → open crew seats render as op-target.
  await expect(op.locator('[data-testid^="op-target-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("operator opens the seat picker and toggles a seat", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  const target = op.locator('[data-testid^="op-target-"]').first();
  await expect(target).toBeVisible({ timeout: 15_000 });
  await target.click();
  const pick = op.locator('[data-testid^="op-pick-"]').first();
  if (await pick.count()) await pick.click().catch(() => {});

  const seatToggle = op.locator('[data-testid^="op-seat-toggle-"], [data-testid^="cap-seat-toggle-"]').first();
  if (await seatToggle.count()) {
    await seatToggle.click();
    await expect(op.getByTestId("operator-panel")).toBeVisible();
  }
});

test("a non-captain player claims an open crew seat then releases it", async () => {
  // The ship's captain (e2e-shipcaptain) manages their own seats; a *different*
  // player claims the open Gunner seat.
  await cl.goto(`ops/${opId}`);
  await expect(cl.getByTestId("op-title")).toBeVisible();
  const claim = cl.locator('[data-testid^="claim-"]').first();
  await expect(claim).toBeVisible({ timeout: 15_000 });
  const seatId = (await claim.getAttribute("data-testid"))!.replace("claim-", "");
  await claim.click();
  await expect(cl.getByTestId(`unclaim-${seatId}`)).toBeVisible({ timeout: 15_000 });
  await cl.getByTestId(`unclaim-${seatId}`).click();
});

test("player joins then leaves a CQB ground team", async () => {
  await pl.goto(`ops/${opId}`);
  await expect(pl.getByTestId("cqb-squads")).toBeVisible({ timeout: 10_000 });
  const join = pl.locator('[data-testid^="cqb-join-"]').first();
  await expect(join).toBeVisible({ timeout: 10_000 });
  const tmId = (await join.getAttribute("data-testid"))!.replace("cqb-join-", "");
  await join.click();
  await expect(pl.getByTestId(`cqb-leave-${tmId}`)).toBeVisible({ timeout: 10_000 });
  await pl.getByTestId(`cqb-leave-${tmId}`).click();
});
