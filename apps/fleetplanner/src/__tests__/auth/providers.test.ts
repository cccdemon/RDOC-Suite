import { describe, it, expect, beforeEach, vi } from "vitest";

// RDOC-Fleetplanner app (web login) vs. Companion/RDOC-RTC app (companion OAuth).
const FLEETPLANNER_ID = "1509191397264064689";
const COMPANION_ID = "1507722962919227452";

const DISCORD_KEYS = [
  "DISCORD_FLEETPLANNER_CLIENT_ID",
  "DISCORD_FLEETPLANNER_CLIENT_SECRET",
  "DISCORD_CLIENT_ID",
  "DISCORD_CLIENT_SECRET",
  "DISCORD_COMPANION_BOT_ID",
  "DISCORD_COMPANION_BOT_KEY",
  "DISCORD_RDOCRTC_CLIENT_ID",
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
  it("uses the Fleetplanner client, never the Companion/RDOC-RTC client", async () => {
    process.env.DISCORD_FLEETPLANNER_CLIENT_ID = FLEETPLANNER_ID;
    process.env.DISCORD_COMPANION_BOT_ID = COMPANION_ID;
    const { discordOAuthClientId } = await loadProviders();
    expect(discordOAuthClientId()).toBe(FLEETPLANNER_ID);
  });

  it("falls back to the DISCORD_CLIENT_ID legacy alias when no Fleetplanner id", async () => {
    process.env.DISCORD_CLIENT_ID = FLEETPLANNER_ID;
    process.env.DISCORD_COMPANION_BOT_ID = COMPANION_ID;
    const { discordOAuthClientId } = await loadProviders();
    expect(discordOAuthClientId()).toBe(FLEETPLANNER_ID);
  });

  it("does NOT fall back to the Companion/RDOC-RTC client id", async () => {
    process.env.DISCORD_COMPANION_BOT_ID = COMPANION_ID;
    process.env.DISCORD_RDOCRTC_CLIENT_ID = COMPANION_ID;
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

  it("is false when only the Companion client is configured", async () => {
    process.env.DISCORD_COMPANION_BOT_ID = COMPANION_ID;
    process.env.DISCORD_COMPANION_BOT_KEY = "companion-secret";
    const { discordEnabled } = await loadProviders();
    expect(discordEnabled()).toBe(false);
  });
});
