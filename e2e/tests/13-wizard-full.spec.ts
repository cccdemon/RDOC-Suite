import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Full op-creation wizard: every field across all five steps, the back/next and
// direct step buttons, and the non-operator "create denied" gate.
test.describe.configure({ mode: "serial" });

let operator: TestActor, crew: TestActor;
let opCtx: BrowserContext, crewCtx: BrowserContext;
let op: Page, cr: Page;

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T20:00`;
}

test.beforeAll(async ({ browser }) => {
  await cleanup();
  operator = await login("e2e-operator", "fleetoperator", "fleetoperator");
  crew = await login("e2e-nonop", "crew", "crew");
  opCtx = await actorContext(browser, operator); op = await opCtx.newPage();
  crewCtx = await actorContext(browser, crew); cr = await crewCtx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await opCtx?.close(); await crewCtx?.close();
});

test("wizard accepts every field across all steps and creates the op", async () => {
  await op.goto("ops/new");
  await expect(op.getByTestId("create-page")).toBeVisible();

  // Step 0 — basics. The guild picker only appears when the operator manages
  // more than one guild; the synthetic E2E operator has exactly one.
  const guild = op.getByTestId("wiz-guild");
  if (await guild.count()) await expect(guild).toBeVisible();
  await op.getByTestId("wiz-title").fill("E2E-Wizard Full");
  await op.getByTestId("wiz-when").fill(futureLocal(8));
  await op.getByTestId("wiz-recur").selectOption({ index: 0 });
  await op.locator('[data-testid^="wiz-type-"]').first().click();

  // Step 1 — briefing (via the Next button).
  await op.getByTestId("wiz-next").click();
  await op.getByTestId("wiz-briefing").fill("## Ziel\nFull-coverage briefing.");

  // Step 2 — meeting point + visibility.
  await op.getByTestId("wiz-next").click();
  await op.getByTestId("wiz-system").selectOption({ index: 0 });
  await op.getByTestId("wiz-location").fill("HUR-L1");
  await op.locator('[data-testid^="wiz-vis-"]').first().click();

  // Step 3 — ships + composition counts (fighters / CQB teams / team size).
  await op.getByTestId("wiz-next").click();
  await op.locator('[data-testid^="wiz-ship-"]').first().click();
  await op.getByTestId("wiz-fighters").fill("1");
  await op.getByTestId("wiz-cqb").fill("1");
  await op.getByTestId("wiz-cqbsize").fill("4");

  // Back then forward to exercise the nav buttons.
  await op.getByTestId("wiz-back").click();
  await op.getByTestId("wiz-next").click();

  // Direct step-rail jumps incl. step 4, then create on step 5.
  await op.getByTestId("wiz-step-4").click();
  await op.getByTestId("wiz-step-5").click();
  await op.getByTestId("wiz-create").click();
  await expect(op.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
  await op.getByTestId("wiz-to-op").click();
  await expect(op.getByTestId("op-title")).toHaveText(/E2E-Wizard Full/);
});

test("wiz-back is disabled on the first step", async () => {
  await op.goto("ops/new");
  await expect(op.getByTestId("wiz-back")).toBeDisabled();
});

test("a non-operator is shown the create-denied gate", async () => {
  await cr.goto("ops/new");
  await expect(cr.getByTestId("create-denied")).toBeVisible({ timeout: 10_000 });
});
