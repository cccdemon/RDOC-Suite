import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    appSetting: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import { getSetting, setSetting } from "../../services/settings.js";
import {
  isMaintenanceForcedByEnv,
  isMaintenanceOn,
  loadMaintenance,
  setMaintenance,
} from "../../services/maintenance.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const originalEnv = process.env.MAINTENANCE_MODE;

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.MAINTENANCE_MODE;
  db.appSetting.findUnique.mockResolvedValue(null);
});

afterEach(async () => {
  if (originalEnv === undefined) delete process.env.MAINTENANCE_MODE;
  else process.env.MAINTENANCE_MODE = originalEnv;
  // Reset the in-memory flag so tests stay order-independent.
  db.appSetting.findUnique.mockResolvedValue({ value: "0" });
  await loadMaintenance();
});

describe("settings", () => {
  it("returns an empty string for a missing key rather than null", async () => {
    db.appSetting.findUnique.mockResolvedValue(null);
    expect(await getSetting("nope")).toBe("");
  });

  it("returns the stored value", async () => {
    db.appSetting.findUnique.mockResolvedValue({ value: "12345" });
    expect(await getSetting("feedback.discordChannelId")).toBe("12345");
  });

  it("upserts on write so the first write does not need a seed row", async () => {
    await setSetting("k", "v");
    expect(db.appSetting.upsert).toHaveBeenCalledWith({
      where: { key: "k" },
      create: { key: "k", value: "v" },
      update: { value: "v" },
    });
  });
});

describe("maintenance mode", () => {
  it("is off by default", async () => {
    db.appSetting.findUnique.mockResolvedValue(null);
    await loadMaintenance();
    expect(isMaintenanceOn()).toBe(false);
    expect(isMaintenanceForcedByEnv()).toBe(false);
  });

  it("reads the persisted toggle at boot", async () => {
    db.appSetting.findUnique.mockResolvedValue({ value: "1" });
    await loadMaintenance();
    expect(isMaintenanceOn()).toBe(true);
    expect(isMaintenanceForcedByEnv()).toBe(false);
  });

  it("updates the in-memory cache immediately when toggled", async () => {
    await setMaintenance(true);
    // The per-request gate reads memory, so a stale cache would keep serving
    // the app during maintenance.
    expect(isMaintenanceOn()).toBe(true);
    expect(db.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { key: "maintenance.enabled" }, update: { value: "1" } }),
    );
    await setMaintenance(false);
    expect(isMaintenanceOn()).toBe(false);
  });

  it.each(["1", "true", "TRUE", "on", "yes", " on "])("treats env %s as forced on", async (value) => {
    process.env.MAINTENANCE_MODE = value;
    await setMaintenance(false);
    expect(isMaintenanceOn()).toBe(true);
    // The toggle cannot switch off an env-forced maintenance window.
    expect(isMaintenanceForcedByEnv()).toBe(true);
  });

  it.each(["", "0", "false", "off", "no"])("treats env %s as not forced", async (value) => {
    process.env.MAINTENANCE_MODE = value;
    await setMaintenance(false);
    expect(isMaintenanceForcedByEnv()).toBe(false);
    expect(isMaintenanceOn()).toBe(false);
  });
});
