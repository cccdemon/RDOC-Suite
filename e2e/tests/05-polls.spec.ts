import { test, expect, type BrowserContext, type Page } from "@playwright/test";
import { actorContext, login, type TestActor } from "../helpers/auth.js";

test.describe.configure({ mode: "serial" });

let creator: TestActor;
let voter: TestActor;
let creatorCtx: BrowserContext;
let voterCtx: BrowserContext;
let creatorPage: Page;
let voterPage: Page;
let pollId = "";

const title = `E2E Poll ${Date.now()}`;

test.beforeAll(async ({ browser }) => {
  creator = await login("e2e-poll-creator", "crew", "crew");
  voter = await login("e2e-poll-voter", "crew", "crew");
  creatorCtx = await actorContext(browser, creator);
  voterCtx = await actorContext(browser, voter);
  creatorPage = await creatorCtx.newPage();
  voterPage = await voterCtx.newPage();
});

test.afterAll(async () => {
  await creatorCtx?.close();
  await voterCtx?.close();
});

test("creator creates a private guild poll", async () => {
  await creatorPage.goto("polls");
  await expect(creatorPage.getByTestId("polls-page")).toBeVisible();
  await creatorPage.getByTestId("poll-new-link").or(creatorPage.getByRole("link", { name: /Neue Umfrage/i })).click();
  await expect(creatorPage.getByTestId("poll-create-page")).toBeVisible();

  await creatorPage.getByRole("textbox", { name: /Worüber wird abgestimmt/i }).fill(title);
  await creatorPage.getByText("Beschreibung (optional)").locator("..").getByRole("textbox").fill("E2E production poll lifecycle.");
  await creatorPage.getByRole("textbox", { name: "Option 1" }).fill("Option Alpha");
  await creatorPage.getByRole("textbox", { name: "Option 2" }).fill("Option Bravo");
  await creatorPage.getByRole("button", { name: /Umfrage erstellen/i }).click();

  await expect(creatorPage.getByTestId("poll-detail-page")).toBeVisible({ timeout: 15_000 });
  await expect(creatorPage.getByTestId("poll-title-display")).toHaveText(title);
  pollId = creatorPage.url().match(/polls\/([^/?]+)/)?.[1] ?? "";
  expect(pollId).not.toBe("");
});

test("another guild member can find and vote in the poll", async () => {
  await voterPage.goto("polls");
  await expect(voterPage.getByTestId("polls-page")).toBeVisible();
  await voterPage.getByTestId("poll-filter-open").click();
  await voterPage.getByTestId(`poll-card-${pollId}`).or(voterPage.getByRole("link", { name: new RegExp(title) })).click();
  await expect(voterPage.getByTestId("poll-title-display")).toHaveText(title);

  await voterPage.locator('[data-testid^="poll-option-"]').first().click();
  await voterPage.getByTestId("poll-vote-submit").click();
  await expect(voterPage.getByTestId("poll-vote-withdraw")).toBeVisible({ timeout: 10_000 });
});

test("creator closes and deletes the poll", async () => {
  await creatorPage.goto(`polls/${pollId}`);
  await expect(creatorPage.getByTestId("poll-detail-page")).toBeVisible();
  await creatorPage.getByTestId("poll-close").click();
  await expect(creatorPage.getByText("Geschlossen")).toBeVisible({ timeout: 10_000 });

  creatorPage.once("dialog", (dialog) => dialog.accept());
  await creatorPage.getByTestId("poll-delete").click();
  await expect(creatorPage.getByTestId("polls-page")).toBeVisible({ timeout: 10_000 });
  await expect(creatorPage.getByText(title)).toHaveCount(0);
});
