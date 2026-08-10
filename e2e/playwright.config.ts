import { defineConfig, devices } from "@playwright/test";

// Default target is the LOCAL TEST STACK (docker-compose.test.yml). Pointing the
// suite at a live instance is possible but explicit:
//   E2E_BASE_URL=https://suite.raumdock.org E2E_BASE_PATH=/fleetplanner
const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:8099").replace(/\/+$/, "");
const BASE_PATH = (process.env.E2E_BASE_PATH ?? "").replace(/\/+$/, "");

// The local stack ships a fixed secret in tests/stack/env.test, so the common
// case needs no setup at all. Against any other host the secret must be given.
const IS_LOCAL_STACK = /^https?:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(BASE);
if (!process.env.E2E_TEST_LOGIN_SECRET) {
  if (IS_LOCAL_STACK) {
    process.env.E2E_TEST_LOGIN_SECRET = "test-e2e-login-secret-local-stack-0123456789";
  } else {
    // Fail fast with a clear message rather than cryptic 404s mid-run.
    throw new Error(
      `E2E_TEST_LOGIN_SECRET must be set for ${BASE} (matches the instance's env-gated /e2e seam). ` +
        `For the local stack run ./scripts/test-stack.sh e2e instead.`,
    );
  }
}
// Local stack default for the Discord simulator control plane.
if (!process.env.E2E_DISCORD_MOCK_URL && IS_LOCAL_STACK) {
  process.env.E2E_DISCORD_MOCK_URL = "http://localhost:4400";
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
    baseURL: `${BASE}${BASE_PATH}/`,
    ignoreHTTPSErrors: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
});
