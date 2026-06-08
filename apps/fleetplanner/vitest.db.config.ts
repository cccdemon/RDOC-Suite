import { defineConfig } from "vitest/config";

// DB-backed route/integration tests. A real Postgres is started in Docker by
// globalSetup, the schema is pushed via Prisma, and tests hit the real app via
// Fastify .inject(). Run with: pnpm --filter @rdoc-suite/fleetplanner test:db
export default defineConfig({
  test: {
    include: ["src/__tests__/db/**/*.test.ts"],
    globalSetup: ["./src/__tests__/db/global-setup.ts"],
    setupFiles: ["./src/__tests__/db/setup-env.ts"],
    testTimeout: 30000,
    hookTimeout: 120000,
    // Tests share one Postgres → run files sequentially in a single process.
    fileParallelism: false,
  },
});
