import { execSync } from "node:child_process";
import type { GlobalSetupContext } from "vitest/node";
import { PG_CONTAINER, PG_PORT, TEST_DATABASE_URL } from "./testdb.js";

declare module "vitest" {
  interface ProvidedContext {
    dbReady: boolean;
  }
}

const sh = (cmd: string, opts: Parameters<typeof execSync>[1] = {}) =>
  execSync(cmd, { stdio: "ignore", ...opts });

function dockerAvailable(): boolean {
  try {
    sh("docker info");
    return true;
  } catch {
    return false;
  }
}

// Vitest globalSetup: bring up a throwaway Postgres in Docker and push the
// Prisma schema. If Docker isn't running, the DB tests are skipped (not failed)
// via the `dbReady` flag — so the harness is safe in any environment.
export async function setup({ provide }: GlobalSetupContext): Promise<void> {
  if (!dockerAvailable()) {
    // eslint-disable-next-line no-console
    console.warn("[db-tests] Docker daemon not reachable — skipping DB-backed tests.");
    provide("dbReady", false);
    return;
  }

  try {
    sh(`docker rm -f ${PG_CONTAINER}`);
  } catch {
    /* not running */
  }
  sh(
    `docker run -d --name ${PG_CONTAINER} -e POSTGRES_USER=test -e POSTGRES_PASSWORD=test ` +
      `-e POSTGRES_DB=fleetplanner_test -p ${PG_PORT}:5432 postgres:16-alpine`,
  );

  let ready = false;
  for (let i = 0; i < 60; i++) {
    try {
      sh(`docker exec ${PG_CONTAINER} pg_isready -U test -d fleetplanner_test`);
      ready = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!ready) throw new Error("test Postgres did not become ready");

  execSync("node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });

  provide("dbReady", true);
}

export async function teardown(): Promise<void> {
  try {
    sh(`docker rm -f ${PG_CONTAINER}`);
  } catch {
    /* already gone or no docker */
  }
}
