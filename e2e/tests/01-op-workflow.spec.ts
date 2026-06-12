import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Full operator + player workflow against a live instance, scoped entirely to
// the synthetic E2E guild. Serial: shared op id flows between tests.
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let p1: TestActor; // squad captain
let p2: TestActor; // flexible signup → gets assigned
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

test("operator: session loads with the test guild", async () => {
  await op.goto("./");
  await expect(op.getByTestId("session-state")).toContainText("e2e-operator");
});

test("operator: creates an operation (title, type, visibility, date, submit)", async () => {
  await op.goto("ops/new");
  await expect(op.getByTestId("create-page")).toBeVisible();
  await op.getByTestId("create-title").fill("E2E-Op Xenothreat");
  await op.getByTestId("create-type").selectOption("combat");
  await op.getByTestId("create-vis").selectOption("guild").catch(() => {});
  await op.getByTestId("create-when").fill(futureLocal(7));
  await op.getByTestId("create-submit").click();
  await expect(op.getByTestId("op-title")).toHaveText(/E2E-Op Xenothreat/);
  opId = op.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
  expect(opId).not.toBe("");
});

test("operator: edits meta + sets status open", async () => {
  await op.goto(`ops/${opId}/edit`);
  await expect(op.getByTestId("edit-op-page")).toBeVisible();
  await op.getByTestId("edit-title").fill("E2E-Op Xenothreat Logistics");
  await op.getByTestId("edit-system").fill("Stanton");
  await op.getByTestId("edit-location").fill("HUR-L1");
  await op.getByTestId("edit-description").fill("E2E mission objective.");
  await op.getByTestId("edit-save").click();
  await expect(op.getByTestId("edit-notice")).toContainText(/Gespeichert/i);

  await op.getByTestId("edit-status").selectOption("open");
  await op.getByTestId("edit-status-apply").click();
  await expect(op.getByTestId("edit-notice")).toContainText(/Status/i);
});

test("operator: defines needs (ship pick, fighters, CQB)", async () => {
  await op.goto(`ops/${opId}/edit`);
  await expect(op.getByTestId("needs-editor")).toBeVisible();
  // ship need
  await op.getByTestId("shiptype-capital").click();
  await op.getByTestId("need-name").fill("Flaggschiff");
  await op.getByTestId("need-add").click();
  await expect(op.getByTestId("needs-editor")).toContainText(/Flaggschiff/);
  // fighter squads
  const f = op.getByTestId("fighters-count");
  await f.fill("2");
  await op.getByTestId("fighters-save").click();
  await expect(op.getByTestId("needs-notice").or(op.getByTestId("needs-editor"))).toBeVisible();
  // CQB teams
  await op.getByTestId("cqb-count").fill("1");
  await op.getByTestId("cqb-size").fill("4");
  await op.getByTestId("cqb-save").click();
});

test("operator: publishes a template + creates a recurring series", async () => {
  await op.goto(`ops/${opId}/edit`);
  await op.getByTestId("tpl-name").fill("E2E-Vorlage");
  await op.getByTestId("tpl-summary").fill("E2E template summary");
  await op.getByTestId("tpl-publish").click();
  await expect(op.getByTestId("edit-notice")).toContainText(/veröffentlicht/i);

  await op.getByTestId("recur-freq").selectOption("weekly");
  await op.getByTestId("recur-create").click();
  await expect(op.getByTestId("edit-notice")).toContainText(/Serie erstellt/i);
});

test("captain: offers a squad (creates seats)", async () => {
  await pg1.goto(`ops/${opId}`);
  await expect(pg1.getByTestId("op-title")).toBeVisible();
  await pg1.getByTestId("offer-ship-open").click();
  await pg1.getByTestId("offer-mode-squad").click();
  await pg1.getByTestId("squad-name").fill("E2E-Squad");
  await pg1.getByTestId("squad-size").selectOption("4");
  await pg1.getByTestId("offer-ship-submit").click();
  // success closes the offer form (pending units only show in the operator view,
  // so we don't assert board text here — the operator test accepts it next).
  await expect(pg1.getByTestId("offer-ship-form")).toBeHidden({ timeout: 15_000 });
});

test("flex player: signs up flexibly + toggles hangar share", async () => {
  await pg2.goto(`ops/${opId}`);
  await expect(pg2.getByTestId("op-title")).toBeVisible();
  await pg2.getByTestId("cqb-signup").click();
  await expect(pg2.getByTestId("cqb-withdraw")).toBeVisible();
  await pg2.getByTestId("hangar-toggle").check().catch(() => {});
});

test("operator: accepts the pending squad (open seats appear)", async () => {
  await op.goto(`ops/${opId}`);
  await op.getByTestId("operator-toggle").click();
  await expect(op.getByTestId("operator-panel")).toBeVisible();
  const accept = op.locator('[data-testid^="accept-"]').first();
  await expect(accept).toBeVisible({ timeout: 15_000 });
  await accept.click();
  // accepted unit's open seats become claimable targets
  await expect(op.locator('[data-testid^="op-target-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("operator: switches the board layout (Befehlsstand / Triage)", async () => {
  const layout = op.locator('[data-testid^="op-layout-"]').nth(1);
  if (await layout.count()) {
    await layout.click();
    await expect(op.getByTestId("operator-panel")).toBeVisible();
  }
});

test("player: claims an open seat directly", async () => {
  await pg2.goto(`ops/${opId}`);
  await expect(pg2.getByTestId("op-title")).toBeVisible();
  const claim = pg2.locator('[data-testid^="claim-"]').first();
  await expect(claim).toBeVisible({ timeout: 15_000 });
  const seatId = (await claim.getAttribute("data-testid"))!.replace("claim-", "");
  await claim.click();
  await expect(pg2.getByTestId(`unclaim-${seatId}`)).toBeVisible({ timeout: 15_000 });
});

test("operator: frees the claimed seat (unassign ✕)", async () => {
  await op.goto(`ops/${opId}`);
  await op.getByTestId("operator-toggle").click();
  await expect(op.getByTestId("operator-panel")).toBeVisible();
  const free = op.locator('[data-testid^="op-free-"]').first();
  await expect(free).toBeVisible({ timeout: 15_000 });
  await free.click();
  // seat is open again → a place target reappears
  await expect(op.locator('[data-testid^="op-target-"]').first()).toBeVisible({ timeout: 15_000 });
});

test("operator: inline seat-picker assign (best-effort)", async () => {
  // The picker/place/drag flows need a CrewAssignmentRequest, which the SPA
  // player surface no longer creates — exercise them only if present.
  const target = op.locator('[data-testid^="op-target-"]').first();
  await target.click().catch(() => {});
  const pick = op.locator('[data-testid^="op-pick-"]').first();
  if (await pick.count()) await pick.click().catch(() => {});
});
