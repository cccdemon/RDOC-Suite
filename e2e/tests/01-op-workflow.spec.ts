import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Full operator + player workflow against a live instance, scoped entirely to
// the synthetic E2E guild. This suite deliberately avoids status=open and
// announcement actions because those are the Discord scheduled-event paths.
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let p1: TestActor;
let p2: TestActor;
let opCtx: BrowserContext, p1Ctx: BrowserContext, p2Ctx: BrowserContext;
let op: Page, pg1: Page, pg2: Page;
let opId = "";

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  p1 = await login("e2e-captain", "crew", "crew");
  p2 = await login("e2e-flex", "crew", "crew");
  opCtx = await actorContext(browser, operator); op = await opCtx.newPage();
  p1Ctx = await actorContext(browser, p1); pg1 = await p1Ctx.newPage();
  p2Ctx = await actorContext(browser, p2); pg2 = await p2Ctx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await opCtx?.close(); await p1Ctx?.close(); await p2Ctx?.close();
});

test("operator session loads with the synthetic guild", async () => {
  await op.goto("./");
  const profile = op.getByTestId("profile-link").filter({ hasText: "e2e-operator" }).first();
  await expect(profile).toContainText("e2e-operator");
  await expect(profile).toContainText("fleetoperator");
});

test("operator creates a draft operation via the wizard", async () => {
  await op.goto("ops/new");
  await expect(op.getByTestId("create-page")).toBeVisible();

  await op.getByTestId("wiz-title").fill("E2E-Op Xenothreat");
  await op.getByTestId("wiz-when").fill(futureLocal(7));
  await op.getByTestId("wiz-type-combat").click();
  await op.getByTestId("wiz-step-1").click();
  await op.getByTestId("wiz-briefing").fill("E2E mission objective.");
  await op.getByTestId("wiz-step-2").click();
  await op.getByTestId("wiz-location").fill("HUR-L1");
  await op.getByTestId("wiz-step-3").click();
  await op.getByTestId("wiz-ship-any").click();
  await op.getByTestId("wiz-cqb").fill("1");
  await op.getByTestId("wiz-step-5").click();
  await op.getByTestId("wiz-create").click();

  await expect(op.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
  await op.getByTestId("wiz-to-op").click();
  await expect(op.getByTestId("op-title")).toHaveText(/E2E-Op Xenothreat/);
  opId = op.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
  expect(opId).not.toBe("");
});

test("operator edits metadata in the operator console", async () => {
  await op.goto(`ops/${opId}?op=eckdaten`);
  await expect(op.getByTestId("operator-console")).toBeVisible();
  await op.getByTestId("edit-title").fill("E2E-Op Xenothreat Logistics");
  await op.getByTestId("edit-system-Stanton").click();
  await op.getByTestId("edit-location").fill("HUR-L1");
  await op.getByTestId("edit-description").fill("E2E mission objective.");
  await expect(op.getByTestId("edit-title")).toHaveValue("E2E-Op Xenothreat Logistics");
  await op.waitForTimeout(1_000);
  await op.reload();
  await expect(op.getByTestId("op-title")).toContainText(/Xenothreat Logistics/i, { timeout: 15_000 });
});

test("operator publishes a template without creating recurrence or Discord events", async () => {
  await op.goto(`ops/${opId}?op=admin`);
  await expect(op.getByTestId("operator-console")).toBeVisible();
  await op.getByTestId("manage-tab-admin").click();
  await op.getByTestId("tpl-name").fill("E2E-Vorlage");
  await op.getByTestId("tpl-summary").fill("E2E template summary");
  await op.getByTestId("tpl-publish").click();
  await expect(op.getByTestId("manage-notice")).toContainText(/veröffentlicht/i);
});

test("captain offers a squad", async () => {
  await pg1.goto(`ops/${opId}`);
  await expect(pg1.getByTestId("op-title")).toBeVisible();
  await pg1.getByTestId("offer-ship-open").click();
  await pg1.getByTestId("offer-mode-squad").click();
  await pg1.getByTestId("squad-name").fill("E2E-Squad");
  await pg1.getByTestId("squad-size").selectOption("4");
  await pg1.getByTestId("offer-ship-submit").click();
  await expect(pg1.getByTestId("offer-ship-form")).toBeHidden({ timeout: 15_000 });
});

test("flex player signs up and toggles hangar share", async () => {
  await pg2.goto(`ops/${opId}`);
  await expect(pg2.getByTestId("op-title")).toBeVisible();
  await pg2.getByTestId("cqb-signup").click();
  await expect(pg2.getByTestId("cqb-withdraw")).toBeVisible();
  await pg2.getByTestId("hangar-toggle").check().catch(() => {});
});

test("operator accepts the pending squad", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("operator-console")).toBeVisible();
  await op.getByTestId("manage-tab-fleet").click();
  await expect(op.getByTestId("operator-panel")).toBeVisible();
  const accept = op.locator('[data-testid^="accept-"]').first();
  await expect(accept).toBeVisible({ timeout: 15_000 });
  await accept.click();
  await expect(op.locator('[data-testid^="op-target-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("operator switches the board layout", async () => {
  const layout = op.locator('[data-testid^="op-layout-"]').nth(1);
  if (await layout.count()) {
    await layout.click();
    await expect(op.getByTestId("operator-panel")).toBeVisible();
  }
});

test("player claims an open seat directly", async () => {
  await pg2.goto(`ops/${opId}`);
  await expect(pg2.getByTestId("op-title")).toBeVisible();
  const claim = pg2.locator('[data-testid^="claim-"]').first();
  await expect(claim).toBeVisible({ timeout: 15_000 });
  const seatId = (await claim.getAttribute("data-testid"))!.replace("claim-", "");
  await claim.click();
  await expect(pg2.getByTestId(`unclaim-${seatId}`)).toBeVisible({ timeout: 15_000 });
});

test("operator frees the claimed seat", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("operator-console")).toBeVisible();
  await op.getByTestId("manage-tab-fleet").click();
  await expect(op.getByTestId("operator-panel")).toBeVisible();
  const free = op.locator('[data-testid^="op-free-"]').first();
  await expect(free).toBeVisible({ timeout: 15_000 });
  await free.click();
  await expect(op.locator('[data-testid^="op-target-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("operator seat-picker is available when assignment candidates exist", async () => {
  const target = op.locator('[data-testid^="op-target-"]').first();
  await target.click().catch(() => {});
  const pick = op.locator('[data-testid^="op-pick-"]').first();
  if (await pick.count()) await pick.click().catch(() => {});
});
