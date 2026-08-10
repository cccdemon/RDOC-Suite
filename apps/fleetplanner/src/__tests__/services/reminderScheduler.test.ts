import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEB_PUBLIC_URL = "http://app.test";
process.env.PUBLIC_BASE_PATH = "";

vi.mock("../../db.js", () => ({
  prisma: {
    operation: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../../services/discord.js", () => ({
  sendDiscordDm: vi.fn(),
}));

import { prisma } from "../../db.js";
import { sendDiscordDm } from "../../services/discord.js";
import { runReminderCheck } from "../../services/reminderScheduler.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;
const dm = sendDiscordDm as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const log = { info: vi.fn(), error: vi.fn() };

function opIn(minutes: number, overrides: Record<string, unknown> = {}) {
  return {
    id: "op1",
    title: "Xenothreat",
    scheduledAt: new Date(Date.now() + minutes * 60_000),
    guild: { reminderOffsetMin: 30 },
    units: [{ captainId: "cap1", seats: [{ userId: "crew1" }, { userId: "crew2" }] }],
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  dm.mockResolvedValue(undefined);
  db.operation.findMany.mockResolvedValue([]);
});

describe("runReminderCheck — who gets a DM", () => {
  it("reminds the captain and every seated crew member exactly once each", async () => {
    db.operation.findMany.mockResolvedValue([
      opIn(20, { units: [{ captainId: "cap1", seats: [{ userId: "cap1" }, { userId: "crew1" }] }] }),
    ]);

    await runReminderCheck(log);

    // cap1 appears as captain AND as a seat holder — one DM, not two.
    expect(dm).toHaveBeenCalledTimes(2);
    expect(dm.mock.calls.map((c: unknown[]) => c[0]).sort()).toEqual(["cap1", "crew1"]);
  });

  it("includes the op title and its link in the message", async () => {
    db.operation.findMany.mockResolvedValue([opIn(20)]);
    await runReminderCheck(log);
    const message = dm.mock.calls[0][1] as string;
    expect(message).toContain("Xenothreat");
    expect(message).toContain("http://app.test/ops/op1");
    expect(message).toMatch(/in \d+ minutes?/);
  });

  it("says 'now' for an op that is already starting", async () => {
    db.operation.findMany.mockResolvedValue([opIn(0)]);
    await runReminderCheck(log);
    expect(dm.mock.calls[0][1]).toContain("starts now");
  });
});

describe("runReminderCheck — timing gate", () => {
  it("skips an op that is still outside its guild's reminder offset", async () => {
    // Pre-filtered by the 120-min upper bound, then narrowed per guild: 90 min
    // out with a 30-min offset is not due yet.
    db.operation.findMany.mockResolvedValue([opIn(90)]);
    await runReminderCheck(log);
    expect(dm).not.toHaveBeenCalled();
    // And it must stay un-marked, or the reminder is lost forever.
    expect(db.operation.update).not.toHaveBeenCalled();
  });

  it("honours a longer per-guild offset", async () => {
    db.operation.findMany.mockResolvedValue([opIn(90, { guild: { reminderOffsetMin: 120 } })]);
    await runReminderCheck(log);
    expect(dm).toHaveBeenCalled();
  });

  it("only looks at live ops that were not reminded yet", async () => {
    await runReminderCheck(log);
    expect(db.operation.findMany.mock.calls[0][0].where).toMatchObject({
      status: { in: ["open", "locked", "in_progress"] },
      reminderSentAt: null,
    });
  });
});

describe("runReminderCheck — idempotence and resilience", () => {
  it("marks the op as reminded so the next tick skips it", async () => {
    db.operation.findMany.mockResolvedValue([opIn(20)]);
    await runReminderCheck(log);
    expect(db.operation.update).toHaveBeenCalledWith({
      where: { id: "op1" },
      data: { reminderSentAt: expect.any(Date) },
    });
  });

  it("marks an op with no participants as done instead of retrying forever", async () => {
    db.operation.findMany.mockResolvedValue([opIn(20, { units: [] })]);
    await runReminderCheck(log);
    expect(dm).not.toHaveBeenCalled();
    expect(db.operation.update).toHaveBeenCalled();
  });

  it("keeps going when one player's DMs are closed", async () => {
    db.operation.findMany.mockResolvedValue([opIn(20)]);
    dm.mockRejectedValueOnce(new Error("Cannot send messages to this user"));

    await runReminderCheck(log);

    expect(dm).toHaveBeenCalledTimes(3);
    expect(log.error).toHaveBeenCalledTimes(1);
    // One closed DM must not cost everyone else their reminder.
    expect(db.operation.update).toHaveBeenCalled();
  });
});
