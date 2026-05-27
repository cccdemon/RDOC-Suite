import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Read companion package.json version (semver, manually bumped on
 *  release). Falls back to "0.0.0" if reading fails for any reason. */
function readPackageVersion(): string {
  try {
    const json = JSON.parse(readFileSync(path.join(here, "package.json"), "utf8")) as {
      version?: string;
    };
    return json.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Build number = git commit count on the current branch. Advances
 *  monotonically with every commit, so each release artifact is
 *  trivially identifiable. */
function readGitBuildNumber(): string {
  try {
    return execSync("git rev-list --count HEAD", { cwd: here, encoding: "utf8" }).trim();
  } catch {
    return "0";
  }
}

/** Short git hash for traceability — pin a build to the exact source. */
function readGitShortHash(): string {
  try {
    return execSync("git rev-parse --short HEAD", { cwd: here, encoding: "utf8" }).trim();
  } catch {
    return "0000000";
  }
}

/** ISO-ish UTC build timestamp — useful when comparing two EXEs from
 *  the same commit (rare but does happen during dev). */
function buildTimestamp(): string {
  return new Date().toISOString().replace(/\..+/, "Z");
}

const APP_VERSION = readPackageVersion();
const APP_BUILD = readGitBuildNumber();
const APP_HASH = readGitShortHash();
const APP_BUILT_AT = buildTimestamp();

// Log to dev console so the developer sees what was baked in.
console.log(`[companion] v${APP_VERSION} build ${APP_BUILD} (${APP_HASH}) @ ${APP_BUILT_AT}`);

// Tauri expects a fixed port (1420 is its default) and uses 1421 for HMR.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(APP_VERSION),
    __APP_BUILD__: JSON.stringify(APP_BUILD),
    __APP_HASH__: JSON.stringify(APP_HASH),
    __APP_BUILT_AT__: JSON.stringify(APP_BUILT_AT),
  },
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    hmr: {
      protocol: "ws",
      host: "127.0.0.1",
      port: 1421,
    },
    watch: {
      // Avoid double-rebuilds when src-tauri changes.
      ignored: ["**/src-tauri/**"],
    },
  },
  envPrefix: ["VITE_", "TAURI_"],
  build: {
    target: "es2022",
    outDir: "dist",
    sourcemap: true,
  },
});
