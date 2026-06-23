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
