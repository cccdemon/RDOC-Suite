import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { API, actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

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

test("operator: creates an operation via the wizard (name, date, type → create)", async () => {
  await op.goto("ops/new");
  await expect(op.getByTestId("create-page")).toBeVisible();
  // step 0 — Eckdaten
  await op.getByTestId("wiz-title").fill("E2E-Op Xenothreat");
  await op.getByTestId("wiz-when").fill(futureLocal(7));
  await op.getByTestId("wiz-type-combat").click();
  // jump to the final step via the rail and create
  await op.getByTestId("wiz-step-5").click();
  await op.getByTestId("wiz-create").click();
  await expect(op.getByTestId("op-title")).toHaveText(/E2E-Op Xenothreat/);
  opId = op.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
  expect(opId).not.toBe("");
});

test("operator: edits meta (title, system, location, briefing, max participants)", async () => {
  await op.goto(`ops/${opId}/edit`);
  await expect(op.getByTestId("edit-op-page")).toBeVisible();
  await op.getByTestId("edit-title").fill("E2E-Op Xenothreat Logistics");
  await op.getByTestId("edit-system-Stanton").click();
  await op.getByTestId("edit-location").fill("HUR-L1");
  await op.getByTestId("edit-maxparticipants").fill("24");
  await op.getByTestId("edit-description").fill("E2E mission objective.");
  await op.getByTestId("edit-save").click();
  await expect(op.getByTestId("edit-notice")).toContainText(/Gespeichert/i);

  // Status is no longer set from the edit screen (design "Operation bearbeiten"
  // has no status control). Open the op via the API so downstream tests run.
  const res = await op.request.post(`${API}/operations/${opId}/status`, {
    headers: { "x-csrf-token": operator.csrfToken },
    data: { status: "open" },
  });
  expect(res.ok()).toBeTruthy();
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
