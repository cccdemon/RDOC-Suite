import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 5000,
    // DB-backed route tests run via a separate config (vitest.db.config.ts)
    // because they spin a real Postgres in Docker. Keep the unit run fast.
    exclude: ["**/node_modules/**", "**/dist/**", "src/__tests__/db/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/db.ts",
      ],
    },
  },
});
