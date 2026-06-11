import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// FR-P2 Phase 3 — FE skeleton. The asset base is configurable so the same
// build serves the Phase-4 shadow path (/fleetplanner-next/) and, later, the
// final /fleetplanner/ entry point.
export default defineConfig({
  base: process.env.BASE_PATH ?? "/",
  plugins: [react()],
  build: { outDir: "dist", sourcemap: false },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    globals: false,
  },
});
