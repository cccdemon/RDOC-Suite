// Where the DB-integration tests find their Postgres.
//
// Two modes:
//   1. TEST_DATABASE_URL set  → use that server as-is (the local test stack's
//      `fleetplanner_test` database). Nothing is started or torn down; this is
//      what `./scripts/test-stack.sh db` uses so the suite can run inside a
//      container without Docker-in-Docker.
//   2. unset                  → globalSetup starts a throwaway Postgres via the
//      docker CLI on a fixed port. Host-only, and the historical default.
export const PG_PORT = 55433;
export const PG_CONTAINER = "fp-vitest-pg";

/** True when an external Postgres was provided and we must not manage a container. */
export const USE_EXTERNAL_DB = Boolean(process.env.TEST_DATABASE_URL);

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  `postgresql://test:test@127.0.0.1:${PG_PORT}/fleetplanner_test`;
