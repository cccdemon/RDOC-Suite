import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operation: { findUnique: vi.fn() },
    guildMembership: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    guild: { findMany: vi.fn() },
  },
}));

// guilds.ts also imports discord service functions — mock them so no HTTP calls
vi.mock("../../services/discord.js", () => ({
  discordUserIdForFleetplannerUser: vi.fn(),
  fetchGuildBasic: vi.fn(),
  fetchGuildMemberRoles: vi.fn(),
}));

import { prisma } from "../../db.js";
import {
  guildRoleAtLeast,
  effectiveOpRole,
  resolveActiveGuild,
} from "../../services/guilds.js";

const db = prisma as {
  operation: { findUnique: ReturnType<typeof vi.fn> };
  guildMembership: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => vi.clearAllMocks());

// ── guildRoleAtLeast ─────────────────────────────────────────────────

describe("guildRoleAtLeast", () => {
  const cases: [string, string, boolean][] = [
    ["crew", "crew", true],
    ["captain", "crew", true],
    ["fleetoperator", "crew", true],
    ["crew", "captain", false],
    ["captain", "captain", true],
    ["fleetoperator", "captain", true],
    ["crew", "fleetoperator", false],
    ["captain", "fleetoperator", false],
    ["fleetoperator", "fleetoperator", true],
  ];

  for (const [role, min, expected] of cases) {
    it(`${role} >= ${min} → ${expected}`, () => {
      expect(guildRoleAtLeast(role, min as "crew" | "captain" | "fleetoperator")).toBe(expected);
    });
  }

  it("unknown role → false for any minimum", () => {
    expect(guildRoleAtLeast("superadmin", "crew")).toBe(false);
    expect(guildRoleAtLeast("admin", "crew")).toBe(false);
    expect(guildRoleAtLeast("", "crew")).toBe(false);
  });
});

// ── effectiveOpRole ──────────────────────────────────────────────────

describe("effectiveOpRole", () => {
  it("returns null when operation not found", async () => {
    db.operation.findUnique.mockResolvedValue(null);
    expect(await effectiveOpRole("user-1", "crew", "op-999")).toBeNull();
  });

  it("superadmin bypasses membership check and returns fleetoperator", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    const role = await effectiveOpRole("user-1", "superadmin", "op-1");
    expect(role).toBe("fleetoperator");
    expect(db.guildMembership.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when user has no membership in the op's guild", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue(null);
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBeNull();
  });

  it("returns the member's guild role (captain)", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "captain" });
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBe("captain");
  });

  it("returns fleetoperator for fleetoperator member", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });
    expect(await effectiveOpRole("user-1", "captain", "op-1")).toBe("fleetoperator");
  });

  it("returns crew for crew member", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBe("crew");
  });
});

// ── resolveActiveGuild ───────────────────────────────────────────────

describe("resolveActiveGuild", () => {
  it("returns null when user has no guild memberships", async () => {
    db.guildMembership.findUnique.mockResolvedValue(null);
    db.guildMembership.findFirst.mockResolvedValue(null);
    expect(await resolveActiveGuild("user-1", undefined)).toBeNull();
  });

  it("uses cookie guild when valid active membership exists", async () => {
    db.guildMembership.findUnique.mockResolvedValue({
      guildId: "guild-cookie",
      role: "captain",
      guild: { active: true, name: "Cookie Guild" },
    });
    const result = await resolveActiveGuild("user-1", "guild-cookie");
    expect(result).toMatchObject({
      guildId: "guild-cookie",
      role: "captain",
      guildName: "Cookie Guild",
    });
  });

  it("falls back to first guild when no cookie provided", async () => {
    db.guildMembership.findFirst.mockResolvedValue({
      guildId: "guild-first",
      role: "crew",
      guild: { active: true, name: "First Guild" },
    });
    const result = await resolveActiveGuild("user-1", undefined);
    expect(result).toMatchObject({ guildId: "guild-first", role: "crew", guildName: "First Guild" });
  });

  it("falls back to first guild when cookie guild is inactive", async () => {
    db.guildMembership.findUnique.mockResolvedValue({
      guildId: "guild-cookie",
      role: "captain",
      guild: { active: false, name: "Inactive Guild" },
    });
    db.guildMembership.findFirst.mockResolvedValue({
      guildId: "guild-first",
      role: "fleetoperator",
      guild: { active: true, name: "Active Guild" },
    });
    const result = await resolveActiveGuild("user-1", "guild-cookie");
    expect(result).toMatchObject({ guildId: "guild-first", role: "fleetoperator" });
  });

  it("falls back to first guild when cookie guild membership not found", async () => {
    db.guildMembership.findUnique.mockResolvedValue(null);
    db.guildMembership.findFirst.mockResolvedValue({
      guildId: "guild-first",
      role: "crew",
      guild: { active: true, name: "First Guild" },
    });
    const result = await resolveActiveGuild("user-1", "guild-unknown");
    expect(result).toMatchObject({ guildId: "guild-first" });
  });
});
