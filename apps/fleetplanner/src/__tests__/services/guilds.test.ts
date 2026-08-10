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
    guildPartnership: { findMany: vi.fn() },
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
  listPublicOrgs,
  resolveActiveGuild,
} from "../../services/guilds.js";

const db = prisma as {
  operation: { findUnique: ReturnType<typeof vi.fn> };
  guildMembership: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  guildPartnership: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => vi.clearAllMocks());

// ── guildRoleAtLeast ─────────────────────────────────────────────────

describe("guildRoleAtLeast", () => {
  const cases: [string, string, boolean][] = [
    ["crew", "crew", true],
    ["fleetoperator", "crew", true],
    ["crew", "fleetoperator", false],
    ["fleetoperator", "fleetoperator", true],
  ];

  for (const [role, min, expected] of cases) {
    it(`${role} >= ${min} → ${expected}`, () => {
      expect(guildRoleAtLeast(role, min as "crew" | "fleetoperator")).toBe(expected);
    });
  }

  it("unknown role → false for any minimum", () => {
    expect(guildRoleAtLeast("superadmin", "crew")).toBe(false);
    expect(guildRoleAtLeast("captain", "crew")).toBe(false);
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

  it("superadmin is NOT auto-granted — resolves their real membership role", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });
    const role = await effectiveOpRole("user-1", "superadmin", "op-1");
    expect(role).toBe("crew");
    expect(db.guildMembership.findUnique).toHaveBeenCalled();
  });

  it("superadmin with no membership in a private op's guild gets null", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1", visibility: "private" });
    db.guildMembership.findUnique.mockResolvedValue(null);
    expect(await effectiveOpRole("user-1", "superadmin", "op-1")).toBeNull();
  });

  it("returns null when user has no membership in the op's guild", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue(null);
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBeNull();
  });

  it("returns the member's guild role (crew)", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBe("crew");
  });

  it("returns fleetoperator for fleetoperator member", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBe("fleetoperator");
  });

  it("returns crew for crew member", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });
    expect(await effectiveOpRole("user-1", "crew", "op-1")).toBe("crew");
  });

  it("grants crew to any non-member when the op is public", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1", visibility: "public" });
    db.guildMembership.findUnique.mockResolvedValue(null);
    expect(await effectiveOpRole("outsider", "crew", "op-1")).toBe("crew");
  });

  it("grants crew to a partner-guild member when the op is partner-visible", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1", visibility: "partners" });
    db.guildMembership.findUnique.mockResolvedValue(null); // not a member of the host guild
    db.guildPartnership.findMany.mockResolvedValue([{ guildAId: "guild-1", guildBId: "guild-2" }]);
    db.guildMembership.findFirst.mockResolvedValue({ id: "m-1" }); // member of partner guild-2
    expect(await effectiveOpRole("partner-user", "crew", "op-1")).toBe("crew");
  });

  it("denies a non-member when partner-visible but user is in no partner guild", async () => {
    db.operation.findUnique.mockResolvedValue({ guildId: "guild-1", visibility: "partners" });
    db.guildMembership.findUnique.mockResolvedValue(null);
    db.guildPartnership.findMany.mockResolvedValue([{ guildAId: "guild-1", guildBId: "guild-2" }]);
    db.guildMembership.findFirst.mockResolvedValue(null);
    expect(await effectiveOpRole("stranger", "crew", "op-1")).toBeNull();
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
      role: "crew",
      guild: { active: true, name: "Cookie Guild" },
    });
    const result = await resolveActiveGuild("user-1", "guild-cookie");
    expect(result).toMatchObject({
      guildId: "guild-cookie",
      role: "crew",
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
      role: "crew",
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

describe("listPublicOrgs", () => {
  it("only asks for guilds that consented, are live and have an invite", async () => {
    db.guild.findMany.mockResolvedValue([]);
    await listPublicOrgs();
    const where = db.guild.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      landingOptIn: true,
      active: true,
      bannedAt: null,
      discordInviteUrl: { not: null },
    });
    // Synthetic test guilds must never reach a public page.
    expect(where.id.notIn).toContain("100000000000000001");
  });

  it("prefers the org name over the Discord server name", async () => {
    db.guild.findMany.mockResolvedValue([
      { id: "1", name: "Server", orgName: "Voidforge Armaments", iconHash: null, discordInviteUrl: "https://discord.gg/a" },
      { id: "2", name: "Nur Server", orgName: null, iconHash: null, discordInviteUrl: "https://discord.gg/b" },
      { id: "3", name: "Leer", orgName: "   ", iconHash: null, discordInviteUrl: "https://discord.gg/c" },
    ]);
    const orgs = await listPublicOrgs();
    expect(orgs.map((o) => o.name)).toEqual(["Voidforge Armaments", "Nur Server", "Leer"]);
  });

  it("builds an icon URL only when the guild has an icon", async () => {
    db.guild.findMany.mockResolvedValue([
      { id: "42", name: "A", orgName: null, iconHash: "abc", discordInviteUrl: "https://discord.gg/a" },
      { id: "43", name: "B", orgName: null, iconHash: null, discordInviteUrl: "https://discord.gg/b" },
    ]);
    const orgs = await listPublicOrgs();
    expect(orgs[0].iconUrl).toBe("https://cdn.discordapp.com/icons/42/abc.png?size=64");
    expect(orgs[1].iconUrl).toBeNull();
  });

  it("drops a row whose invite vanished between query and mapping", async () => {
    // Defensive: the column is nullable, so a null must never become a card
    // that links nowhere.
    db.guild.findMany.mockResolvedValue([
      { id: "1", name: "A", orgName: null, iconHash: null, discordInviteUrl: null },
    ]);
    expect(await listPublicOrgs()).toEqual([]);
  });
});
