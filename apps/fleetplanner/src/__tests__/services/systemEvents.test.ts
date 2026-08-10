import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    systemEvent: { create: vi.fn(), findMany: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import {
  listSystemEvents,
  pruneSystemEvents,
  recordEvent,
  SYSTEM_EVENT_RETENTION_DAYS,
} from "../../services/systemEvents.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
const RETENTION_MS = SYSTEM_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  db.systemEvent.findMany.mockResolvedValue([]);
  db.systemEvent.deleteMany.mockResolvedValue({ count: 0 });
});

describe("recordEvent", () => {
  it("stores level, category, message and a JSON detail", async () => {
    await recordEvent("warn", "discord", "Event creation failed", { status: 429 });
    expect(db.systemEvent.create).toHaveBeenCalledWith({
      data: { level: "warn", category: "discord", message: "Event creation failed", detail: '{"status":429}' },
    });
  });

  it("passes a string detail through unchanged", async () => {
    await recordEvent("info", "sync", "done", "42 ships");
    expect(db.systemEvent.create.mock.calls[0][0].data.detail).toBe("42 ships");
  });

  it("truncates message and detail instead of failing the write", async () => {
    await recordEvent("error", "c", "m".repeat(2000), "d".repeat(9000));
    const data = db.systemEvent.create.mock.calls[0][0].data;
    expect(data.message).toHaveLength(500);
    expect(data.detail).toHaveLength(4000);
  });

  it("survives a detail that cannot be serialised", async () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    await expect(recordEvent("info", "c", "m", cyclic)).resolves.toBeUndefined();
    expect(db.systemEvent.create).toHaveBeenCalled();
  });

  it("never throws when the database write fails", async () => {
    db.systemEvent.create.mockRejectedValue(new Error("db down"));
    // Observability must not be able to break the action it observes.
    await expect(recordEvent("error", "c", "m")).resolves.toBeUndefined();
  });
});

describe("listSystemEvents", () => {
  it("clamps the limit into 1…1000 and defaults to 200", async () => {
    await listSystemEvents({});
    expect(db.systemEvent.findMany.mock.calls[0][0].take).toBe(200);
    await listSystemEvents({ limit: 99_999 });
    expect(db.systemEvent.findMany.mock.calls[1][0].take).toBe(1000);
    await listSystemEvents({ limit: 0 });
    expect(db.systemEvent.findMany.mock.calls[2][0].take).toBe(1);
  });

  it("never queries beyond the retention window", async () => {
    const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
    await listSystemEvents({ since: ancient });
    const since = db.systemEvent.findMany.mock.calls[0][0].where.createdAt.gte as Date;
    expect(since.getTime()).toBeGreaterThan(Date.now() - RETENTION_MS - 5000);
  });

  it("honours a `since` that is inside the window", async () => {
    const recent = new Date(Date.now() - 60_000);
    await listSystemEvents({ since: recent });
    expect(db.systemEvent.findMany.mock.calls[0][0].where.createdAt.gte).toBe(recent);
  });

  it("applies level and category filters only when given", async () => {
    await listSystemEvents({ level: "error", category: "discord" });
    expect(db.systemEvent.findMany.mock.calls[0][0].where).toMatchObject({ level: "error", category: "discord" });
    await listSystemEvents({});
    const where = db.systemEvent.findMany.mock.calls[1][0].where;
    expect(where.level).toBeUndefined();
    expect(where.category).toBeUndefined();
  });

  it("serialises timestamps as ISO strings", async () => {
    const createdAt = new Date("2026-08-01T10:00:00.000Z");
    db.systemEvent.findMany.mockResolvedValue([
      { id: "e1", createdAt, level: "info", category: "c", message: "m", detail: "d" },
    ]);
    expect(await listSystemEvents({})).toEqual([
      { id: "e1", ts: "2026-08-01T10:00:00.000Z", level: "info", category: "c", message: "m", detail: "d" },
    ]);
  });
});

describe("pruneSystemEvents", () => {
  it("deletes everything older than the retention window", async () => {
    db.systemEvent.deleteMany.mockResolvedValue({ count: 7 });
    expect(await pruneSystemEvents()).toBe(7);
    const cutoff = db.systemEvent.deleteMany.mock.calls[0][0].where.createdAt.lt as Date;
    expect(cutoff.getTime()).toBeLessThanOrEqual(Date.now() - RETENTION_MS + 5000);
  });

  it("reports 0 rather than throwing when the delete fails", async () => {
    db.systemEvent.deleteMany.mockRejectedValue(new Error("db down"));
    expect(await pruneSystemEvents()).toBe(0);
  });
});
