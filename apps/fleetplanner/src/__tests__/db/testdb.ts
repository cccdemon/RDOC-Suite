// Shared constants for the Docker-Postgres test harness. A fixed port keeps
// globalSetup (container + schema push) and setup-env (per-worker DATABASE_URL)
// in agreement.
export const PG_PORT = 55433;
export const PG_CONTAINER = "fp-vitest-pg";
export const TEST_DATABASE_URL = `postgresql://test:test@127.0.0.1:${PG_PORT}/fleetplanner_test`;
