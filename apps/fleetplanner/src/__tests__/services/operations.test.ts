import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operation: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    operationLeader: {
      upsert: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import {
  createOperation,
  setStatus,
  addLeader,
  removeLeader,
  listAllUserOperations,
  deleteOperation,
} from "../../services/operations.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
beforeEach(() => vi.clearAllMocks());

// ── createOperation ───────────────────────────────────────────────────────────

describe("createOperation", () => {
  const baseInput = {
    guildId: "guild-1",
    title: "Op Fury",
    scheduledAt: new Date("2026-07-01T20:00:00Z"),
  };

  it("creates operation with provided fields", async () => {
    db.operation.create.mockResolvedValue({ id: "op-1" });
    await createOperation("user-1", { ...baseInput, description: "Big op", opType: "pve" });
    expect(db.operation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          guildId: "guild-1",
          title: "Op Fury",
          description: "Big op",
          opType: "pve",
          createdById: "user-1",
        }),
      }),
    );
  });

  it("defaults status to 'draft'", async () => {
    db.operation.create.mockResolvedValue({});
    await createOperation("user-1", baseInput);
    const { data } = db.operation.create.mock.calls[0][0];
    expect(data.status).toBe("draft");
  });

  it("defaults opType to 'combat' when omitted", async () => {
    db.operation.create.mockResolvedValue({});
    await createOperation("user-1", baseInput);
    const { data } = db.operation.create.mock.calls[0][0];
    expect(data.opType).toBe("combat");
  });

  it("defaults meetingSystem to 'stanton' when omitted", async () => {
    db.operation.create.mockResolvedValue({});
    await createOperation("user-1", baseInput);
    const { data } = db.operation.create.mock.calls[0][0];
    expect(data.meetingSystem).toBe("stanton");
  });

  it("defaults description to empty string when omitted", async () => {
    db.operation.create.mockResolvedValue({});
    await createOperation("user-1", baseInput);
    const { data } = db.operation.create.mock.calls[0][0];
    expect(data.description).toBe("");
  });

  it("passes scheduledAt and meetingLocation when provided", async () => {
    db.operation.create.mockResolvedValue({});
    const scheduledAt = new Date("2026-08-15T18:00:00Z");
    await createOperation("user-1", { ...baseInput, scheduledAt, meetingLocation: "Ruin Station" });
    const { data } = db.operation.create.mock.calls[0][0];
    expect(data.scheduledAt).toEqual(scheduledAt);
    expect(data.meetingLocation).toBe("Ruin Station");
  });
});

// ── setStatus ─────────────────────────────────────────────────────────────────

describe("setStatus", () => {
  it("updates operation to 'open'", async () => {
    db.operation.update.mockResolvedValue({ status: "open" });
    await setStatus("op-1", "open");
    expect(db.operation.update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: { status: "open" },
    });
  });

  it("updates operation to 'cancelled'", async () => {
    db.operation.update.mockResolvedValue({});
    await setStatus("op-1", "cancelled");
    expect(db.operation.update).toHaveBeenCalledWith({
      where: { id: "op-1" },
      data: { status: "cancelled" },
    });
  });

  it("updates operation to 'in_progress'", async () => {
    db.operation.update.mockResolvedValue({});
    await setStatus("op-1", "in_progress");
    const { data } = db.operation.update.mock.calls[0][0];
    expect(data.status).toBe("in_progress");
  });
});

// ── addLeader ─────────────────────────────────────────────────────────────────

describe("addLeader", () => {
  it("upserts with 'raid_leader' as default role", async () => {
    db.operationLeader.upsert.mockResolvedValue({});
    await addLeader("op-1", "user-1");
    expect(db.operationLeader.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { operationId_userId: { operationId: "op-1", userId: "user-1" } },
        create: expect.objectContaining({ leaderRole: "raid_leader" }),
        update: expect.objectContaining({ leaderRole: "raid_leader" }),
      }),
    );
  });

  it("upserts with provided leader role", async () => {
    db.operationLeader.upsert.mockResolvedValue({});
    await addLeader("op-1", "user-1", "fleet_commander");
    expect(db.operationLeader.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ leaderRole: "fleet_commander" }),
        update: expect.objectContaining({ leaderRole: "fleet_commander" }),
      }),
    );
  });

  it("includes operationId and userId in create data", async () => {
    db.operationLeader.upsert.mockResolvedValue({});
    await addLeader("op-42", "user-99");
    const { create } = db.operationLeader.upsert.mock.calls[0][0];
    expect(create).toMatchObject({ operationId: "op-42", userId: "user-99" });
  });
});

// ── removeLeader ──────────────────────────────────────────────────────────────

describe("removeLeader", () => {
  it("deletes the leader row by composite key", async () => {
    db.operationLeader.delete.mockResolvedValue({});
    await removeLeader("op-1", "user-1");
    expect(db.operationLeader.delete).toHaveBeenCalledWith({
      where: { operationId_userId: { operationId: "op-1", userId: "user-1" } },
    });
  });

  it("silently ignores not-found errors", async () => {
    db.operationLeader.delete.mockRejectedValue(new Error("Record not found"));
    await expect(removeLeader("op-1", "user-1")).resolves.not.toThrow();
  });
});

// ── listAllUserOperations ─────────────────────────────────────────────────────

describe("listAllUserOperations", () => {
  it("returns [] immediately for empty guildIds (no DB call)", async () => {
    const result = await listAllUserOperations([]);
    expect(result).toEqual([]);
    expect(db.operation.findMany).not.toHaveBeenCalled();
  });

  it("queries all provided guilds", async () => {
    db.operation.findMany.mockResolvedValue([]);
    await listAllUserOperations(["guild-1", "guild-2", "guild-3"]);
    const { where } = db.operation.findMany.mock.calls[0][0];
    expect(where.guildId).toEqual({ in: ["guild-1", "guild-2", "guild-3"] });
  });

  it("filters out past operations by default (scheduledAt cutoff ~3h ago)", async () => {
    db.operation.findMany.mockResolvedValue([]);
    const before = Date.now();
    await listAllUserOperations(["guild-1"]);
    const { where } = db.operation.findMany.mock.calls[0][0];
    expect(where.scheduledAt).toBeDefined();
    expect(where.scheduledAt.gte).toBeInstanceOf(Date);
    // Cutoff should be 3 hours before now (within a few ms tolerance)
    const cutoffMs = where.scheduledAt.gte.getTime();
    expect(cutoffMs).toBeGreaterThan(before - 3 * 60 * 60 * 1000 - 100);
    expect(cutoffMs).toBeLessThan(before - 3 * 60 * 60 * 1000 + 1000);
  });

  it("includes past operations when includePast=true", async () => {
    db.operation.findMany.mockResolvedValue([]);
    await listAllUserOperations(["guild-1"], true);
    const { where } = db.operation.findMany.mock.calls[0][0];
    expect(where.scheduledAt).toBeUndefined();
  });

  it("returns findMany results", async () => {
    const ops = [{ id: "op-1" }, { id: "op-2" }];
    db.operation.findMany.mockResolvedValue(ops);
    const result = await listAllUserOperations(["guild-1"]);
    expect(result).toEqual(ops);
  });
});

// ── deleteOperation ───────────────────────────────────────────────────────────

describe("deleteOperation", () => {
  it("deletes the operation by id", async () => {
    db.operation.delete.mockResolvedValue({});
    await deleteOperation("op-1");
    expect(db.operation.delete).toHaveBeenCalledWith({ where: { id: "op-1" } });
  });
});
