import { defineConfig, devices } from "@playwright/test";

const BASE = process.env.E2E_BASE_URL ?? "https://suite.raumdock.org";

if (!process.env.E2E_TEST_LOGIN_SECRET) {
  // Fail fast with a clear message rather than cryptic 404s mid-run.
  throw new Error("E2E_TEST_LOGIN_SECRET must be set (matches the instance's env-gated /e2e seam).");
}

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false, // shared test guild — keep specs serial to avoid cross-talk
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: `${BASE}/fleetplanner/`,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
