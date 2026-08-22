import { vi, describe, it, expect, beforeEach } from "vitest";

// Mock the Prisma client — cqb.ts is thin DB logic, so we assert the calls it
// builds. The manual bundling helpers (bundleSquad/autoBundle/unbundle/
// assignToSquad) went with routes/api.ts on 2026-08-22: teams are materialised
// from the CQB need now, and /api/v1 drives them through the cqb-teams routes.
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
      updateMany: vi.fn(),
    },
    crewAssignmentRequest: {
      deleteMany: vi.fn(),
    },
    // Slot allocation (formations.nextFreeSlot) reads both member tables to find
    // the lowest free place in a group.
    fleetUnit: {
      findMany: vi.fn(),
    },
  },
}));

import { createSignup, withdrawSignup, placeInSquad, renameSquad } from "../../services/cqb.js";
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
  // Empty group by default → the next free slot is 0 (the Captain seat).
  p.cqbSignup.findMany.mockResolvedValue([]);
  p.fleetUnit.findMany.mockResolvedValue([]);
  p.compositionGroup.updateMany.mockResolvedValue({ count: 1 });
  p.crewAssignmentRequest.deleteMany.mockResolvedValue({ count: 0 });
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

describe("placeInSquad", () => {
  it("slots the player into the group and drops their flexible request", async () => {
    await placeInSquad("op1", "u1", "grp");
    expect(p.cqbSignup.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId_userId: { operationId: "op1", userId: "u1" } },
        update: expect.objectContaining({ assignedGroupId: "grp", status: "accepted" }),
      }),
    );
    // A person who now holds a seat must not stay in the flexible pool.
    expect(p.crewAssignmentRequest.deleteMany).toHaveBeenCalledWith({
      where: { operationId: "op1", userId: "u1" },
    });
  });

  it("does nothing when the group belongs to another operation", async () => {
    p.compositionGroup.findFirst.mockResolvedValueOnce(null);
    await placeInSquad("op1", "u1", "foreign");
    expect(p.cqbSignup.upsert).not.toHaveBeenCalled();
  });
});

describe("renameSquad", () => {
  it("renames a squad of this operation only", async () => {
    await renameSquad("op1", "grp", "  Bravo  ");
    expect(p.compositionGroup.updateMany).toHaveBeenCalledWith({
      where: { id: "grp", operationId: "op1", kind: "squad" },
      data: { name: "Bravo" },
    });
  });

  it("ignores an empty name", async () => {
    await renameSquad("op1", "grp", "   ");
    expect(p.compositionGroup.updateMany).not.toHaveBeenCalled();
  });
});
