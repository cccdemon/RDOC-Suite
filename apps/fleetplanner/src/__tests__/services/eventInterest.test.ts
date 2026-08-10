import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    userIdentity: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    eventInterest: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      count: vi.fn(),
    },
    seatAssignment: { updateMany: vi.fn() },
    operation: { findMany: vi.fn() },
  },
}));

vi.mock("../../services/discord.js", () => ({
  listScheduledEventUsers: vi.fn(),
}));

import { prisma } from "../../db.js";
import { listScheduledEventUsers } from "../../services/discord.js";
import {
  claimInterestShadows,
  interestSummary,
  interestSyncIntervalMs,
  runInterestSync,
  syncOpInterest,
} from "../../services/eventInterest.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const discord = listScheduledEventUsers as any;

const OP = { id: "op1", guildId: "g1", discordEventId: "e1" };
const log = { info: vi.fn(), error: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  db.eventInterest.findUnique.mockResolvedValue(null);
  db.eventInterest.findMany.mockResolvedValue([]);
  db.userIdentity.findUnique.mockResolvedValue(null);
  db.user.findUnique.mockResolvedValue(null);
});

describe("syncOpInterest — new interest", () => {
  it("links an interested Discord user to their Fleetplanner account", async () => {
    discord.mockResolvedValue([{ discordUserId: "d1", displayName: "Pilot" }]);
    db.userIdentity.findUnique.mockResolvedValue({ userId: "u1" });

    const result = await syncOpInterest(OP);

    expect(result).toEqual({ added: 1, withdrawn: 0, total: 1 });
    expect(db.eventInterest.create).toHaveBeenCalledWith({
      data: { operationId: "op1", discordUserId: "d1", userId: "u1", displayName: "Pilot", status: "interested" },
    });
  });

  it("keeps an unknown Discord user as a shadow row instead of dropping them", async () => {
    discord.mockResolvedValue([{ discordUserId: "d9", displayName: "Outsider" }]);

    await syncOpInterest(OP);

    expect(db.eventInterest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: null, displayName: "Outsider" }) }),
    );
  });

  it("resolves a legacy install where the user id IS the snowflake", async () => {
    discord.mockResolvedValue([{ discordUserId: "123456789012345678", displayName: "Legacy" }]);
    db.user.findUnique.mockResolvedValue({ id: "123456789012345678" });

    await syncOpInterest(OP);

    expect(db.eventInterest.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: "123456789012345678" }) }),
    );
  });
});

describe("syncOpInterest — existing rows", () => {
  it("revives a withdrawn row instead of creating a duplicate", async () => {
    discord.mockResolvedValue([{ discordUserId: "d1", displayName: "Pilot" }]);
    db.eventInterest.findUnique.mockResolvedValue({ id: "i1", status: "withdrawn", userId: "u1" });

    const result = await syncOpInterest(OP);

    expect(db.eventInterest.create).not.toHaveBeenCalled();
    expect(db.eventInterest.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { status: "interested", displayName: "Pilot" },
    });
    expect(result.added).toBe(0);
  });

  it("refreshes a changed nickname and upgrades a shadow once the user is known", async () => {
    discord.mockResolvedValue([{ discordUserId: "d1", displayName: "New Nick" }]);
    db.eventInterest.findUnique.mockResolvedValue({ id: "i1", status: "interested", userId: null });
    db.userIdentity.findUnique.mockResolvedValue({ userId: "u1" });

    await syncOpInterest(OP);

    expect(db.eventInterest.update).toHaveBeenCalledWith({
      where: { id: "i1" },
      data: { displayName: "New Nick", userId: "u1" },
    });
  });
});

describe("syncOpInterest — withdrawal", () => {
  it("marks a vanished user withdrawn and frees the seat they held", async () => {
    discord.mockResolvedValue([]);
    db.eventInterest.findMany.mockResolvedValue([{ id: "i1", discordUserId: "d1", userId: "u1" }]);

    const result = await syncOpInterest(OP);

    expect(db.eventInterest.update).toHaveBeenCalledWith({ where: { id: "i1" }, data: { status: "withdrawn" } });
    // Decision 2 — the Discord RSVP owns bare interest, so the seat goes back.
    expect(db.seatAssignment.updateMany).toHaveBeenCalledWith({
      where: { userId: "u1", active: true, fleetUnit: { operationId: "op1" } },
      data: { userId: null },
    });
    expect(result.withdrawn).toBe(1);
  });

  it("does not touch seats for a shadow row that has no account", async () => {
    discord.mockResolvedValue([]);
    db.eventInterest.findMany.mockResolvedValue([{ id: "i1", discordUserId: "d9", userId: null }]);

    await syncOpInterest(OP);

    expect(db.seatAssignment.updateMany).not.toHaveBeenCalled();
  });

  it("leaves users who are still interested alone", async () => {
    discord.mockResolvedValue([{ discordUserId: "d1", displayName: "Pilot" }]);
    db.eventInterest.findUnique.mockResolvedValue({ id: "i1", status: "interested", userId: "u1" });
    db.eventInterest.findMany.mockResolvedValue([{ id: "i1", discordUserId: "d1", userId: "u1" }]);

    const result = await syncOpInterest(OP);

    expect(result.withdrawn).toBe(0);
    expect(db.seatAssignment.updateMany).not.toHaveBeenCalled();
  });
});

describe("claimInterestShadows", () => {
  it("attaches every shadow row of a snowflake on first Discord login", async () => {
    await claimInterestShadows("u1", "d1");
    expect(db.eventInterest.updateMany).toHaveBeenCalledWith({
      where: { discordUserId: "d1", userId: null },
      data: { userId: "u1" },
    });
  });
});

describe("interestSummary", () => {
  it("counts linked and unknown interested pilots separately", async () => {
    db.eventInterest.count.mockResolvedValueOnce(3).mockResolvedValueOnce(2);
    expect(await interestSummary("op1")).toEqual({ linked: 3, unknown: 2 });
  });
});

describe("runInterestSync", () => {
  it("only polls ops that are live and actually have a Discord event", async () => {
    db.operation.findMany.mockResolvedValue([]);
    await runInterestSync(log);
    expect(db.operation.findMany).toHaveBeenCalledWith({
      where: { status: { in: ["open", "locked", "in_progress"] }, discordEventId: { not: null } },
      select: { id: true, guildId: true, discordEventId: true },
    });
  });

  it("keeps polling the remaining ops when one op's sync throws", async () => {
    db.operation.findMany.mockResolvedValue([
      { id: "op1", guildId: "g1", discordEventId: "e1" },
      { id: "op2", guildId: "g1", discordEventId: "e2" },
    ]);
    discord.mockRejectedValueOnce(new Error("Discord 403")).mockResolvedValueOnce([]);

    await runInterestSync(log);

    expect(discord).toHaveBeenCalledTimes(2);
    expect(log.error).toHaveBeenCalledTimes(1);
  });
});

describe("interestSyncIntervalMs", () => {
  const original = process.env.EVENT_INTEREST_INTERVAL_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.EVENT_INTEREST_INTERVAL_MS;
    else process.env.EVENT_INTEREST_INTERVAL_MS = original;
  });

  it("defaults to the production 5 minutes", () => {
    delete process.env.EVENT_INTEREST_INTERVAL_MS;
    expect(interestSyncIntervalMs()).toBe(5 * 60 * 1000);
  });

  it("accepts a shorter interval for the local test stack", () => {
    process.env.EVENT_INTEREST_INTERVAL_MS = "3000";
    expect(interestSyncIntervalMs()).toBe(3000);
  });

  it("floors absurd values so a typo cannot hammer Discord", () => {
    process.env.EVENT_INTEREST_INTERVAL_MS = "1";
    expect(interestSyncIntervalMs()).toBe(2000);
    process.env.EVENT_INTEREST_INTERVAL_MS = "not-a-number";
    expect(interestSyncIntervalMs()).toBe(5 * 60 * 1000);
    process.env.EVENT_INTEREST_INTERVAL_MS = "-5";
    expect(interestSyncIntervalMs()).toBe(5 * 60 * 1000);
  });
});
