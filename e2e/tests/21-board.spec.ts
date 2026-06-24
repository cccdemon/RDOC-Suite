import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Fleet board controls reachable without a ship accept: the operator board
// surface itself, and the CQB ground-team join/leave that a player can drive
// directly (the op is created with one CQB team).
//
// NOTE: ship crew seats (op-target/op-seat/op-pick/op-free + unit/formation
// controls) require accepting an offered ship, but the unit-accept endpoint
// currently returns 403 for the synthetic operator in this flow — the same
// reason the pre-existing 01 "operator accepts the pending squad" test is red.
// That is a server-side gate (canApproveUnits) issue to fix separately, not a
// stale testid; until then those seat controls cannot be surfaced here.
test.describe.configure({ mode: "serial" });

let operator: TestActor, player: TestActor;
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
  player = await login("e2e-seatclaimer", "crew", "crew");
  opCtx = await actorContext(browser, operator); op = await opCtx.newPage();
  plCtx = await actorContext(browser, player); pl = await plCtx.newPage();

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
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await cleanup();
  await opCtx?.close(); await plCtx?.close();
});

test("operator fleet board surface renders with its needs editor", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("operator-panel")).toBeVisible({ timeout: 10_000 });
  await expect(op.getByTestId("needs-editor")).toBeVisible();
});

test("player joins then leaves a CQB ground team", async () => {
  await pl.goto(`ops/${opId}`);
  await expect(pl.getByTestId("op-title")).toBeVisible();
  await expect(pl.getByTestId("cqb-squads")).toBeVisible({ timeout: 10_000 });
  await expect(pl.locator('[data-testid^="cqb-squad-"]').first()).toBeVisible();

  const join = pl.locator('[data-testid^="cqb-join-"]').first();
  await expect(join).toBeVisible({ timeout: 10_000 });
  const tmId = (await join.getAttribute("data-testid"))!.replace("cqb-join-", "");
  await join.click();

  // After joining, the leave control for that team appears.
  await expect(pl.getByTestId(`cqb-leave-${tmId}`)).toBeVisible({ timeout: 10_000 });
  await pl.getByTestId(`cqb-leave-${tmId}`).click();
  await expect(pl.getByTestId(`cqb-join-${tmId}`)).toBeVisible({ timeout: 10_000 });
});
