import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, API, type TestActor } from "../helpers/auth.js";

// Operator-Konsole cross-panel coverage. Verifies that the console's tab buttons
// each mount their panel, and that the relationships BETWEEN panels hold:
//   - the sticky header Voice quick-switch and the Voice tab master-toggle share
//     one state (toggle one, the other reflects it),
//   - Eckdaten autosave round-trips (edit a field, reload, value persisted, and
//     the public op title reflects it),
//   - the sticky-header status control round-trips to the backend.
// Scoped to the synthetic E2E guild. Deliberately never sets status="open"
// (that is the Discord scheduled-event path — see 01-op-workflow).
test.describe.configure({ mode: "serial" });

let operator: TestActor;
let opCtx: BrowserContext;
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
  opCtx = await actorContext(browser, operator);
  op = await opCtx.newPage();

  // Create a draft op via the wizard (mirrors 01) so this file is self-contained.
  await op.goto("ops/new");
  await expect(op.getByTestId("create-page")).toBeVisible();
  await op.getByTestId("wiz-title").fill("E2E-Konsole Cross-Panel");
  await op.getByTestId("wiz-when").fill(futureLocal(7));
  await op.getByTestId("wiz-type-combat").click();
  await op.getByTestId("wiz-step-1").click();
  await op.getByTestId("wiz-briefing").fill("Cross-panel briefing.");
  await op.getByTestId("wiz-step-2").click();
  await op.getByTestId("wiz-location").fill("HUR-L1");
  await op.getByTestId("wiz-step-3").click();
  await op.getByTestId("wiz-ship-any").click();
  await op.getByTestId("wiz-cqb").fill("1");
  await op.getByTestId("wiz-step-5").click();
  await op.getByTestId("wiz-create").click();
  await expect(op.getByTestId("wiz-to-op")).toBeVisible({ timeout: 15_000 });
  await op.getByTestId("wiz-to-op").click();
  await expect(op.getByTestId("op-title")).toHaveText(/E2E-Konsole Cross-Panel/);
  opId = op.url().match(/ops\/([^/?]+)/)?.[1] ?? "";
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await cleanup();
  await opCtx?.close();
});

// ── Every console tab button mounts its panel without crashing ────────────────
test("each console tab button opens its panel", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("operator-console")).toBeVisible();

  // Tabs with a known representative child element. IA 2026-08-21: a tab lives
  // inside a work area, so select the area first — same as a user would.
  const known: Array<[string, string, string]> = [
    ["flotte", "fleet", "operator-panel"],
    ["planung", "eckdaten", "edit-title"],
    ["kommunikation", "voice", "voice-master-toggle"],
  ];
  for (const [area, tab, child] of known) {
    await op.getByTestId(`manage-group-${area}`).click();
    await op.getByTestId(`manage-tab-${tab}`).click();
    await expect(op.getByTestId(child)).toBeVisible({ timeout: 10_000 });
    // The console itself must stay mounted across tab switches.
    await expect(op.getByTestId("operator-console")).toBeVisible();
  }

  // Remaining tabs: reachable via their work area, and clicking must not crash
  // the console (panel content varies). IA 2026-08-21: the nine flat tabs are
  // four work areas now, so select the area first — same as a user would.
  const areas: Array<[string, string[]]> = [
    ["flotte", ["fleet", "formations", "cqb"]],
    ["planung", ["eckdaten", "cover", "commanders"]],
    ["kommunikation", ["voice", "qa"]],
    ["verwaltung", ["admin"]],
  ];
  for (const [area, tabs] of areas) {
    await op.getByTestId(`manage-group-${area}`).click();
    for (const tab of tabs) {
      await op.getByTestId(`manage-tab-${tab}`).click();
      await expect(op.getByTestId("operator-console")).toBeVisible();
      // The tab is the URL: a reload has to come back to the same panel.
      await expect(op).toHaveURL(new RegExp(`op=${tab}`));
    }
  }
});

// ── The work area survives reload and browser-back ───────────────────────────
test("console tabs are addressable: reload and back keep the work area", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("manage-tab-fleet")).toHaveAttribute("aria-selected", "true");

  await op.getByTestId("manage-group-kommunikation").click();
  await expect(op).toHaveURL(/op=voice/);
  await op.reload();
  await expect(op.getByTestId("manage-tab-voice")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  await op.goBack();
  await expect(op.getByTestId("manage-tab-fleet")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
});

// ── Cross-panel: header Voice quick-switch <-> Voice tab master-toggle ─────────
test("voice quick-switch (header) and voice tab master-toggle share one state", async () => {
  await op.goto(`ops/${opId}?op=voice`);
  await expect(op.getByTestId("operator-console")).toBeVisible();

  const headerBtn = op.getByTestId("voice-quickswitch");
  const tabToggle = op.getByTestId("voice-master-toggle");
  await expect(headerBtn).toBeVisible();
  await expect(tabToggle).toBeVisible();

  const before = (await tabToggle.getAttribute("aria-pressed")) === "true";

  // Toggle from the sticky header; the Voice tab toggle must follow.
  await headerBtn.click();
  await expect(tabToggle).toHaveAttribute("aria-pressed", String(!before), { timeout: 10_000 });
  await expect(headerBtn).toContainText(!before ? "VOICE AN" : "VOICE AUS");

  // Toggle back from the Voice tab; the header must follow.
  await tabToggle.click();
  await expect(tabToggle).toHaveAttribute("aria-pressed", String(before), { timeout: 10_000 });
  await expect(headerBtn).toContainText(before ? "VOICE AN" : "VOICE AUS");
});

// ── Cross-panel: Eckdaten autosave persists + propagates to the public title ──
test("eckdaten autosave round-trips and updates the op title", async () => {
  await op.goto(`ops/${opId}?op=eckdaten`);
  const title = op.getByTestId("edit-title");
  await expect(title).toBeVisible();

  const newTitle = `E2E-Konsole Renamed ${Date.now()}`;
  await title.fill(newTitle);
  // Debounced autosave (600ms) drives the global save badge to a settled state.
  await expect(op.getByTestId("global-save-badge")).toBeVisible({ timeout: 10_000 });
  await op.waitForTimeout(1200);

  // Persistence: reload the console, the field keeps the new value.
  await op.goto(`ops/${opId}?op=eckdaten`);
  await expect(op.getByTestId("edit-title")).toHaveValue(newTitle, { timeout: 10_000 });

  // Cross-surface: the public op header reflects the same change.
  await op.goto(`ops/${opId}`);
  await expect(op.getByTestId("op-title")).toHaveText(new RegExp(newTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

// ── Cross-layer: sticky-header status control round-trips to the backend ──────
test("status control changes the operation status (never 'open')", async () => {
  await op.goto(`ops/${opId}?op=eckdaten`);
  await expect(op.getByTestId("manage-status")).toBeVisible();

  // draft -> locked (a non-Discord transition), assert via the API, then back.
  await op.getByTestId("status-seg-locked").click();
  await expect
    .poll(async () => (await (await opCtx.request.get(`${API}/operations/${opId}`)).json())?.status, { timeout: 10_000 })
    .toBe("locked");

  await op.getByTestId("status-seg-draft").click();
  await expect
    .poll(async () => (await (await opCtx.request.get(`${API}/operations/${opId}`)).json())?.status, { timeout: 10_000 })
    .toBe("draft");
});
