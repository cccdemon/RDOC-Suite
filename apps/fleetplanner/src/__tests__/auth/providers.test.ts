import { describe, it, expect, beforeEach, vi } from "vitest";

// Fleetplanner web login uses the RDOC-Fleetplanner app (with a legacy
// DISCORD_CLIENT_ID alias as fallback).
const FLEETPLANNER_ID = "1509191397264064689";

const DISCORD_KEYS = [
  "DISCORD_FLEETPLANNER_CLIENT_ID",
  "DISCORD_FLEETPLANNER_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
] as const;

function clearDiscordEnv(): void {
  for (const k of DISCORD_KEYS) delete process.env[k];
}

// getEnv() caches its parsed env at module scope, so re-import after
// resetModules to pick up the per-test process.env.
async function loadProviders() {
  vi.resetModules();
  return import("../../auth/providers.js");
}

beforeEach(() => {
  clearDiscordEnv();
});

describe("discordOAuthClientId — Fleetplanner web login", () => {
  it("uses the Fleetplanner client", async () => {
    process.env.DISCORD_FLEETPLANNER_CLIENT_ID = FLEETPLANNER_ID;
    const { discordOAuthClientId } = await loadProviders();
    expect(discordOAuthClientId()).toBe(FLEETPLANNER_ID);
  });

  it("falls back to the DISCORD_CLIENT_ID legacy alias when no Fleetplanner id", async () => {
    process.env.DISCORD_CLIENT_ID = FLEETPLANNER_ID;
    const { discordOAuthClientId } = await loadProviders();
    expect(discordOAuthClientId()).toBe(FLEETPLANNER_ID);
  });

  it("is undefined when no Fleetplanner/legacy client id is set", async () => {
    const { discordOAuthClientId } = await loadProviders();
    expect(discordOAuthClientId()).toBeUndefined();
  });
});

describe("discordOAuthClientSecret", () => {
  it("prefers the Fleetplanner secret over the legacy alias", async () => {
    process.env.DISCORD_FLEETPLANNER_CLIENT_SECRET = "fleet-secret";
    process.env.DISCORD_CLIENT_SECRET = "legacy-secret";
    const { discordOAuthClientSecret } = await loadProviders();
    expect(discordOAuthClientSecret()).toBe("fleet-secret");
  });
});

describe("discordEnabled", () => {
  it("is true when the Fleetplanner client id + secret are set", async () => {
    process.env.DISCORD_FLEETPLANNER_CLIENT_ID = FLEETPLANNER_ID;
    process.env.DISCORD_FLEETPLANNER_CLIENT_SECRET = "fleet-secret";
    const { discordEnabled } = await loadProviders();
    expect(discordEnabled()).toBe(true);
  });

  it("is false when nothing is configured", async () => {
    const { discordEnabled } = await loadProviders();
    expect(discordEnabled()).toBe(false);
  });
});

describe("safeReturnTo — post-login redirect target", () => {
  it("accepts a same-site relative path, query included", async () => {
    const { safeReturnTo } = await loadProviders();
    expect(safeReturnTo("/ops/cmtg4auvn0041nn07695h17hu")).toBe("/ops/cmtg4auvn0041nn07695h17hu");
    expect(safeReturnTo("/ops/abc?op=roster")).toBe("/ops/abc?op=roster");
  });

  it("refuses anything a browser could read as another origin", async () => {
    const { safeReturnTo } = await loadProviders();
    for (const bad of ["https://evil.example", "//evil.example", "/\evil.example", "evil", "", "/ops/\nx", "/ops/\tx"]) {
      expect(safeReturnTo(bad)).toBeUndefined();
    }
  });

  it("refuses non-strings, oversized input and the auth routes themselves", async () => {
    const { safeReturnTo } = await loadProviders();
    expect(safeReturnTo(undefined)).toBeUndefined();
    expect(safeReturnTo(["/ops/a"])).toBeUndefined();
    expect(safeReturnTo("/" + "a".repeat(600))).toBeUndefined();
    expect(safeReturnTo("/auth/discord/start")).toBeUndefined();
  });

  it("carries returnTo through the OAuth state exactly once", async () => {
    const { issueState, consumeState } = await loadProviders();
    const state = issueState("discord", "/ops/abc");
    expect(consumeState(state)).toEqual({ provider: "discord", returnTo: "/ops/abc" });
    expect(consumeState(state)).toBeNull();
  });
});
