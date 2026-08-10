import { execSync } from "node:child_process";
import type { GlobalSetupContext } from "vitest/node";
import { PG_CONTAINER, PG_PORT, TEST_DATABASE_URL, USE_EXTERNAL_DB } from "./testdb.js";

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
  // An external Postgres was handed to us (the test stack's `fleetplanner_test`
  // database). Push the schema onto it and stay out of container management —
  // this is the path that works inside a container.
  if (USE_EXTERNAL_DB) {
    await ensureExternalDatabase();
    pushSchema();
    provide("dbReady", true);
    return;
  }

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

  pushSchema();

  provide("dbReady", true);
}

function pushSchema(): void {
  // A throwaway container starts empty every time. An external database does
  // not, and these tests create fixed ids — so reset it to get the same
  // guarantee. Guarded on the database name: never reset something that is not
  // obviously a test database.
  const dbName = new URL(TEST_DATABASE_URL).pathname.replace(/^\//, "");
  if (USE_EXTERNAL_DB && !/test/i.test(dbName)) {
    throw new Error(
      `refusing to reset "${dbName}": TEST_DATABASE_URL must point at a database whose name contains "test".`,
    );
  }
  const reset = USE_EXTERNAL_DB ? " --force-reset" : "";
  execSync(`node node_modules/prisma/build/index.js db push --skip-generate --accept-data-loss${reset}`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
}

/**
 * Wait for an externally provided Postgres and make sure the test database
 * exists. Creating it here (rather than via a docker-entrypoint init script)
 * means the suite also works against a stack that is already running — init
 * scripts only ever run on a fresh data directory.
 */
async function ensureExternalDatabase(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const redacted = TEST_DATABASE_URL.replace(/:[^:@/]*@/, ":***@");
  const target = new URL(TEST_DATABASE_URL);
  const dbName = target.pathname.replace(/^\//, "");
  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = "/postgres";

  const admin = new PrismaClient({ datasources: { db: { url: adminUrl.toString() } } });
  try {
    let up = false;
    for (let i = 0; i < 60; i++) {
      try {
        await admin.$queryRawUnsafe("SELECT 1");
        up = true;
        break;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    if (!up) throw new Error(`test postgres at ${redacted} never became reachable`);

    try {
      // Identifier is ours (from TEST_DATABASE_URL), but quote it anyway.
      await admin.$executeRawUnsafe(`CREATE DATABASE "${dbName.replace(/"/g, '""')}"`);
    } catch {
      /* already exists — fine */
    }
  } finally {
    await admin.$disconnect().catch(() => {});
  }
}

export async function teardown(): Promise<void> {
  // An external database is not ours to remove.
  if (USE_EXTERNAL_DB) return;
  try {
    sh(`docker rm -f ${PG_CONTAINER}`);
  } catch {
    /* already gone or no docker */
  }
}
