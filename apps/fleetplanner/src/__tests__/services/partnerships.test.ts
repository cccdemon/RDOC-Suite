import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    guildPartnership: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import {
  acceptPartnerToken,
  getActivePartnerGuildIds,
  revokePartnership,
} from "../../services/partnerships.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

describe("acceptPartnerToken", () => {
  it("rejects an unknown token", async () => {
    db.guildPartnership.findUnique.mockResolvedValue(null);
    const res = await acceptPartnerToken("nope", "guild-B");
    expect(res).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects an already-active token", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "active",
    });
    const res = await acceptPartnerToken("tok", "guild-B");
    expect(res).toEqual({ ok: false, reason: "already_used" });
  });

  it("rejects a revoked token", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "revoked",
    });
    const res = await acceptPartnerToken("tok", "guild-B");
    expect(res).toEqual({ ok: false, reason: "revoked" });
  });

  it("refuses self-partnering", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "pending",
    });
    const res = await acceptPartnerToken("tok", "guild-A");
    expect(res).toEqual({ ok: false, reason: "self_partner" });
  });

  it("refuses a duplicate active partnership between the same pair", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "pending",
    });
    db.guildPartnership.findFirst.mockResolvedValue({ id: "existing" });
    const res = await acceptPartnerToken("tok", "guild-B");
    expect(res).toEqual({ ok: false, reason: "already_partners" });
  });

  it("activates atomically and reports the partner guild", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "pending",
      label: "Alliance",
    });
    db.guildPartnership.findFirst.mockResolvedValue(null);
    db.guildPartnership.updateMany.mockResolvedValue({ count: 1 });
    const res = await acceptPartnerToken("tok", "guild-B");
    expect(res).toEqual({ ok: true, label: "Alliance", partnerGuildId: "guild-A" });
    expect(db.guildPartnership.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "p1", status: "pending" },
        data: expect.objectContaining({ guildBId: "guild-B", status: "active" }),
      }),
    );
  });

  it("loses the race when the atomic claim updates 0 rows", async () => {
    db.guildPartnership.findUnique.mockResolvedValue({
      id: "p1",
      guildAId: "guild-A",
      status: "pending",
      label: "Alliance",
    });
    db.guildPartnership.findFirst.mockResolvedValue(null);
    db.guildPartnership.updateMany.mockResolvedValue({ count: 0 });
    const res = await acceptPartnerToken("tok", "guild-B");
    expect(res).toEqual({ ok: false, reason: "already_used" });
  });
});

describe("getActivePartnerGuildIds", () => {
  it("returns the OTHER side of each active partnership, deduped", async () => {
    db.guildPartnership.findMany.mockResolvedValue([
      { guildAId: "me", guildBId: "x" },
      { guildAId: "y", guildBId: "me" },
      { guildAId: "me", guildBId: "x" }, // duplicate partner
    ]);
    const ids = await getActivePartnerGuildIds("me");
    expect(ids.sort()).toEqual(["x", "y"]);
  });

  it("returns [] when there are no active partnerships", async () => {
    db.guildPartnership.findMany.mockResolvedValue([]);
    expect(await getActivePartnerGuildIds("me")).toEqual([]);
  });
});

describe("revokePartnership", () => {
  it("revokes only when the requesting guild is a party", async () => {
    db.guildPartnership.updateMany.mockResolvedValue({ count: 1 });
    expect(await revokePartnership("p1", "guild-A")).toBe(true);
    const { where } = db.guildPartnership.updateMany.mock.calls[0][0];
    expect(where.OR).toEqual([{ guildAId: "guild-A" }, { guildBId: "guild-A" }]);
  });

  it("returns false when nothing matched", async () => {
    db.guildPartnership.updateMany.mockResolvedValue({ count: 0 });
    expect(await revokePartnership("p1", "guild-Z")).toBe(false);
  });
});
