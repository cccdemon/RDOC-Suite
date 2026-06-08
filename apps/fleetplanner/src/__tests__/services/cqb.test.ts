import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the Prisma client — cqb.ts is thin DB logic; we assert the calls + the
// one piece of real logic (autoBundle chunking).
vi.mock("../../db.js", () => ({
  prisma: {
    cqbSignup: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      deleteMany: vi.fn(),
    },
    compositionGroup: {
      aggregate: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import {
  createSignup,
  withdrawSignup,
  bundleSquad,
  autoBundle,
  unbundle,
  assignToSquad,
} from "../../services/cqb.js";
import { prisma } from "../../db.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const p = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  p.compositionGroup.aggregate.mockResolvedValue({ _max: { order: 0 } });
  p.compositionGroup.create.mockImplementation((args: { data: unknown }) =>
    Promise.resolve({ id: "grp", ...(args.data as object) }),
  );
  p.compositionGroup.count.mockResolvedValue(0);
  p.compositionGroup.findFirst.mockResolvedValue({ id: "grp" });
  p.cqbSignup.updateMany.mockResolvedValue({ count: 1 });
  p.cqbSignup.deleteMany.mockResolvedValue({ count: 1 });
  p.cqbSignup.upsert.mockResolvedValue({ id: "su" });
});

describe("createSignup", () => {
  it("upserts on (operationId, userId)", async () => {
    await createSignup("op1", "u1", "note");
    expect(p.cqbSignup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId_userId: { operationId: "op1", userId: "u1" } },
        create: { operationId: "op1", userId: "u1", note: "note" },
      }),
    );
  });
});

describe("withdrawSignup", () => {
  it("deletes by operation + user", async () => {
    await withdrawSignup("op1", "u1");
    expect(p.cqbSignup.deleteMany).toHaveBeenCalledWith({
      where: { operationId: "op1", userId: "u1" },
    });
  });
});

describe("bundleSquad", () => {
  it("creates a squad group and assigns the selected signups", async () => {
    await bundleSquad("op1", "Alpha", ["s1", "s2"]);
    expect(p.compositionGroup.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: "Alpha", kind: "squad" }) }),
    );
    expect(p.cqbSignup.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { in: ["s1", "s2"] }, assignedGroupId: null }),
        data: { assignedGroupId: "grp", status: "accepted" },
      }),
    );
  });

  it("skips the assign update when no signups are given", async () => {
    await bundleSquad("op1", "Empty", []);
    expect(p.compositionGroup.create).toHaveBeenCalledTimes(1);
    expect(p.cqbSignup.updateMany).not.toHaveBeenCalled();
  });
});

describe("autoBundle", () => {
  it("chunks the pool into squads of N", async () => {
    p.cqbSignup.findMany.mockResolvedValue([
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" },
    ]);
    const created = await autoBundle("op1", 2);
    expect(created).toBe(3); // 2 + 2 + 1
    expect(p.compositionGroup.create).toHaveBeenCalledTimes(3);
  });

  it("clamps size below 2 to the default of 4", async () => {
    p.cqbSignup.findMany.mockResolvedValue([
      { id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" },
    ]);
    const created = await autoBundle("op1", 0);
    expect(created).toBe(2); // 4 + 1
  });

  it("clamps size above 8", async () => {
    p.cqbSignup.findMany.mockResolvedValue(Array.from({ length: 9 }, (_, i) => ({ id: "x" + i })));
    const created = await autoBundle("op1", 99);
    expect(created).toBe(2); // 8 + 1
  });

  it("creates nothing for an empty pool", async () => {
    p.cqbSignup.findMany.mockResolvedValue([]);
    const created = await autoBundle("op1", 4);
    expect(created).toBe(0);
    expect(p.compositionGroup.create).not.toHaveBeenCalled();
  });
});

describe("unbundle", () => {
  it("frees members then deletes the squad group", async () => {
    await unbundle("op1", "g1");
    expect(p.cqbSignup.updateMany).toHaveBeenCalledWith({
      where: { operationId: "op1", assignedGroupId: "g1" },
      data: { assignedGroupId: null, status: "pending" },
    });
    expect(p.compositionGroup.deleteMany).toHaveBeenCalledWith({
      where: { id: "g1", operationId: "op1", kind: "squad" },
    });
  });
});

describe("assignToSquad", () => {
  it("assigns when the target squad exists", async () => {
    await assignToSquad("op1", "s1", "g1");
    expect(p.cqbSignup.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", operationId: "op1" },
      data: { assignedGroupId: "g1", status: "accepted" },
    });
  });

  it("does nothing when the target squad is missing", async () => {
    p.compositionGroup.findFirst.mockResolvedValue(null);
    await assignToSquad("op1", "s1", "gX");
    expect(p.cqbSignup.updateMany).not.toHaveBeenCalled();
  });
});
