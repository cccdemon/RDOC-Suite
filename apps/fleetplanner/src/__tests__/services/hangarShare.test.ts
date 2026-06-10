import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the Prisma client — hangarShare.ts is thin DB logic; we assert the calls
// + the join/filter logic in listSharedHangars and the pure canViewHangars gate.
vi.mock("../../db.js", () => ({
  prisma: {
    operationHangarShare: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
    },
    userShip: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import {
  canViewHangars,
  setHangarShare,
  listSharedHangars,
} from "../../services/hangarShare.js";

const p = prisma as unknown as {
  operationHangarShare: { upsert: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  userShip: { findMany: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("canViewHangars", () => {
  it("allows fleetoperator, superadmin, or a leader", () => {
    expect(canViewHangars("fleetoperator")).toBe(true);
    expect(canViewHangars("superadmin")).toBe(true);
    expect(canViewHangars("crew", true)).toBe(true);
  });

  it("denies plain crew / captain / null", () => {
    expect(canViewHangars("crew")).toBe(false);
    expect(canViewHangars("captain")).toBe(false);
    expect(canViewHangars(null)).toBe(false);
    expect(canViewHangars(undefined)).toBe(false);
  });
});

describe("setHangarShare", () => {
  it("upserts the viewer's own share row, trimming the note", async () => {
    p.operationHangarShare.upsert.mockResolvedValue({});
    await setHangarShare("op1", "u1", { allow: true, note: "  pls pick a tank  " });
    expect(p.operationHangarShare.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId_userId: { operationId: "op1", userId: "u1" } },
        create: expect.objectContaining({ allowOperatorHangarView: true, note: "pls pick a tank" }),
        update: expect.objectContaining({ allowOperatorHangarView: true, note: "pls pick a tank" }),
      }),
    );
  });

  it("stores null for an empty note", async () => {
    p.operationHangarShare.upsert.mockResolvedValue({});
    await setHangarShare("op1", "u1", { allow: false, note: "   " });
    const arg = p.operationHangarShare.upsert.mock.calls[0][0];
    expect(arg.create.note).toBeNull();
    expect(arg.create.allowOperatorHangarView).toBe(false);
  });
});

describe("listSharedHangars", () => {
  it("returns nothing when no one shared", async () => {
    p.operationHangarShare.findMany.mockResolvedValue([]);
    expect(await listSharedHangars("op1")).toEqual([]);
    expect(p.userShip.findMany).not.toHaveBeenCalled();
  });

  it("joins each sharer to their UserShip list", async () => {
    p.operationHangarShare.findMany.mockResolvedValue([
      { userId: "u1", note: "tank pls", user: { username: "Alice" } },
      { userId: "u2", note: null, user: { username: "Bob" } },
    ]);
    p.userShip.findMany.mockResolvedValue([
      { userId: "u1", shipId: "s1", nickname: "Tanky", ship: { name: "Ironclad" } },
      { userId: "u1", shipId: "s2", nickname: null, ship: { name: "Gladius" } },
    ]);
    const out = await listSharedHangars("op1");
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ userId: "u1", username: "Alice", note: "tank pls" });
    expect(out[0].ships.map((s) => s.name)).toEqual(["Ironclad", "Gladius"]);
    // a sharer with no ships still appears (empty hangar)
    expect(out[1]).toMatchObject({ userId: "u2", username: "Bob", ships: [] });
  });

  it("only queries shares flagged allowOperatorHangarView", async () => {
    p.operationHangarShare.findMany.mockResolvedValue([]);
    await listSharedHangars("op1");
    expect(p.operationHangarShare.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId: "op1", allowOperatorHangarView: true },
      }),
    );
  });
});
