import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Handoff §17, the scenarios that are mechanics rather than judgement:
// 7 (multi-guild, including a guild the viewer is not in), 9 (keyboard) and
// 10 (browser history).
//
// §19 stays out of here on purpose — whether someone knows what to do next
// without the manual is not something a spec can answer.
test.describe.configure({ mode: "serial" });

const GUILD_B = "100000000000000002";

let operator: TestActor;
let ctx: BrowserContext;
let op: Page;
let opId = "";

function futureLocal(days: number): string {
  const d = new Date(Date.now() + days * 86_400_000);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

async function makeOp(page: Page, title: string): Promise<string> {
  await page.goto("ops/new");
  await page.getByTestId("wiz-title").fill(title);
  await page.getByTestId("wiz-when").fill(futureLocal(7));
  await page.getByTestId("wiz-type-combat").click();
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
  // Two memberships for the same person — the multi-guild case. Minting again
  // with a guildId adds a membership, it does not replace the first.
  operator = await login("e2e-kbdop", "crew", "fleetoperator");
  await login("e2e-kbdop", "crew", "fleetoperator", GUILD_B);
  ctx = await actorContext(browser, operator);
  op = await ctx.newPage();
  opId = await makeOp(op, "E2E-Tastatur Op");
  expect(opId).not.toBe("");
});

test.afterAll(async () => {
  await ctx?.close();
  await cleanup();
});

// ── §17.7: multi-guild ───────────────────────────────────────────────────────

test("server screens name which server they are changing", async () => {
  await op.goto("guilds/settings");
  await expect(op.getByTestId("server-scope")).toBeVisible({ timeout: 10_000 });
  // §2: a server-scoped mutation says whose server and in what role.
  await expect(op.getByTestId("server-scope-role")).toContainText(/fleetoperator/i);
  // The URL must carry the server, or a copied link means "whoever's was picked".
  await expect(op).toHaveURL(/guild=1000000000000000\d/);
});

test("a deep link into the other server switches to it and stays switched", async () => {
  await op.goto(`guilds/settings?guild=${GUILD_B}`);
  await expect(op.getByTestId("server-scope")).toContainText("E2E-Testserver-2", { timeout: 10_000 });

  // The choice is context, not a per-page setting: the next server screen opens
  // on the same one.
  await op.goto("guilds/partnerships");
  await expect(op).toHaveURL(new RegExp(`guild=${GUILD_B}`), { timeout: 10_000 });
});

test("a link into a server the viewer is not in says so and does not oscillate", async () => {
  await op.goto("guilds/settings?guild=999999999999999999");
  // Turning the link down silently would leave the operator editing a different
  // server than the one they clicked.
  await expect(op.getByTestId("server-scope-unknown")).toBeVisible({ timeout: 10_000 });

  // The URL is canonicalised to a server they do have...
  await expect(op).toHaveURL(/guild=1000000000000000\d/);
  const settled = op.url();
  // ...and stays there. The old bug flipped between the URL and the fallback.
  await op.waitForTimeout(1200);
  expect(op.url()).toBe(settled);
});

// ── §17.9: keyboard ──────────────────────────────────────────────────────────

test("the mobile drawer traps focus, closes on Escape and gives it back", async () => {
  await op.setViewportSize({ width: 390, height: 844 });
  await op.goto("operationen");

  const toggle = op.getByTestId("mobile-nav-toggle");
  await toggle.click();
  await expect(op.getByTestId("mobile-nav-drawer")).toBeVisible({ timeout: 10_000 });

  // Focus moved into the panel rather than staying behind it.
  const inside = await op.evaluate(() => !!document.querySelector("#mobile-nav-drawer")?.contains(document.activeElement));
  expect(inside, "focus stayed outside the open drawer").toBe(true);

  // Tab does not escape to the page behind.
  for (let i = 0; i < 25; i++) await op.keyboard.press("Tab");
  const stillInside = await op.evaluate(() => !!document.querySelector("#mobile-nav-drawer")?.contains(document.activeElement));
  expect(stillInside, "focus left the drawer while tabbing").toBe(true);

  await op.keyboard.press("Escape");
  await expect(op.getByTestId("mobile-nav-drawer")).toBeHidden({ timeout: 10_000 });

  // Back on the opener — not at the top of the document, where a reader would
  // have to start over.
  const onToggle = await op.evaluate(
    () => document.activeElement?.getAttribute("data-testid") === "mobile-nav-toggle",
  );
  expect(onToggle, "focus did not return to the menu button").toBe(true);

  await op.setViewportSize({ width: 1400, height: 900 });
});

test("the work areas and their tabs move under the arrow keys", async () => {
  await op.goto(`ops/${opId}?op=fleet`);
  await expect(op.getByTestId("manage-tab-fleet")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  // §9: roving tabindex — the selected one is the only tab stop, arrows do the
  // moving.
  await op.getByTestId("manage-group-flotte").focus();
  await op.keyboard.press("ArrowRight");
  await expect(op.getByTestId("manage-group-planung")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

  await op.getByTestId("manage-tab-eckdaten").focus();
  await op.keyboard.press("ArrowRight");
  await expect(op.getByTestId("manage-tab-briefing")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  await op.keyboard.press("End");
  await expect(op.getByTestId("manage-tab-freigabe")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  await op.keyboard.press("Home");
  await expect(op.getByTestId("manage-tab-eckdaten")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });
});

test("deleting is reachable and refused by keyboard alone", async () => {
  await op.goto(`ops/${opId}?op=danger`);
  const arm = op.getByTestId("op-delete");
  await expect(arm).toBeVisible({ timeout: 10_000 });

  await arm.focus();
  await op.keyboard.press("Enter");
  await expect(op.getByTestId("op-delete-name")).toBeVisible({ timeout: 10_000 });
  // Armed is not confirmed: the name has to be typed, and a partial one is not it.
  await expect(op.getByTestId("op-delete-confirm")).toBeDisabled();

  await op.getByTestId("op-delete-name").fill("E2E-Tastatur");
  await expect(op.getByTestId("op-delete-confirm")).toBeDisabled();

  await op.getByTestId("op-delete-cancel").click();
  await expect(op.getByTestId("op-delete-name")).toBeHidden({ timeout: 10_000 });
});

// ── §17.10: the browser's own buttons ────────────────────────────────────────

test("the overview filters live in the URL and survive Back", async () => {
  await op.goto("operationen?view=liste");
  await expect(op.getByTestId("op-view-tabs")).toBeVisible({ timeout: 10_000 });

  // Three names for one thing: the tab id says monat, the testid says
  // cal-view-monat, and the URL says kalender.
  await op.getByTestId("cal-view-monat").click();
  await expect(op).toHaveURL(/view=kalender/, { timeout: 10_000 });

  await op.goBack();
  await expect(op).toHaveURL(/view=liste/, { timeout: 10_000 });
});

test("mode and tab survive reload and Back", async () => {
  await op.goto(`ops/${opId}`);
  await expect(op.getByTestId("op-mode-view")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });

  await op.getByTestId("op-mode-manage").click();
  await expect(op.getByTestId("operator-console")).toBeVisible({ timeout: 10_000 });

  await op.getByTestId("manage-group-kommunikation").click();
  await expect(op.getByTestId("manage-tab-qa")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  await op.reload();
  await expect(op.getByTestId("manage-tab-qa")).toHaveAttribute("aria-selected", "true", { timeout: 10_000 });

  // Back goes to the previous TAB, not out of the workspace — that was the
  // regression the mode parameter caused.
  await op.goBack();
  await expect(op.getByTestId("operator-console")).toBeVisible({ timeout: 10_000 });
  await expect(op.getByTestId("manage-group-flotte")).toHaveAttribute("aria-pressed", "true", { timeout: 10_000 });
});
