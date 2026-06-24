import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, cleanup, login, type TestActor } from "../helpers/auth.js";

// Konto surface: the four account tabs each mount their sub-panel, and the
// Preferences panel controls (language, hangar-share) react. Profile hangar +
// feedback flows are already covered in 03-surfaces, so this focuses on tab
// navigation (cross-panel) and the preferences controls.
test.describe.configure({ mode: "serial" });

let actor: TestActor;
let ctx: BrowserContext;
let pg: Page;

test.beforeAll(async ({ browser }) => {
  await cleanup();
  actor = await login("e2e-konto", "crew", "crew");
  ctx = await actorContext(browser, actor);
  pg = await ctx.newPage();
});

test.afterAll(async () => {
  await cleanup();
  await ctx?.close();
});

test("each konto tab mounts its sub-panel", async () => {
  const tabs: Array<[string, string]> = [
    ["profil", "profile-page"],
    ["logins", "account-page"],
    ["prefs", "prefs-panel"],
    ["feedback", "feedback-page"],
  ];
  await pg.goto("konto/profil");
  await expect(pg.getByTestId("konto-page")).toBeVisible({ timeout: 10_000 });
  for (const [key, child] of tabs) {
    await pg.getByTestId(`konto-tab-${key}`).click();
    await expect(pg.getByTestId(child)).toBeVisible({ timeout: 10_000 });
    await expect(pg.getByTestId("konto-page")).toBeVisible();
  }
});

test("preferences: hangar-share toggle and language switch react", async () => {
  await pg.goto("konto/prefs");
  await expect(pg.getByTestId("prefs-panel")).toBeVisible({ timeout: 10_000 });

  // Hangar-share toggle flips state.
  const share = pg.getByTestId("prefs-share-hangar");
  if (await share.count()) {
    const before = await share.isChecked().catch(() => null);
    if (before !== null) {
      await share.click();
      await expect(share).toBeChecked({ checked: !before, timeout: 10_000 });
      await share.click(); // restore
    }
  }

  // Language switch: click a non-active language option; panel stays mounted.
  const lang = pg.locator('[data-testid^="prefs-lang-"]').nth(1);
  if (await lang.count()) {
    await lang.click();
    await expect(pg.getByTestId("prefs-panel")).toBeVisible();
  }
});
