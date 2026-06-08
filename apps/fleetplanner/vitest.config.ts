import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    setupFiles: ["./src/__tests__/setup.ts"],
    testTimeout: 5000,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.ts"],
      exclude: [
        "src/__tests__/**",
        "src/index.ts",
        "src/db.ts",
        "src/services/livekit.ts",
        "src/services/*voice*.ts",
        "src/services/*Voice*.ts",
        "src/routes/**/*voice*.ts",
        "src/routes/**/*Voice*.ts",
      ],
    },
  },
});
