import { describe, it, expect, vi, beforeEach } from "vitest";

process.env.WEB_PUBLIC_URL = "http://app.test";
process.env.PUBLIC_BASE_PATH = "";

vi.mock("../../db.js", () => ({
  prisma: {
    eventDistribution: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
    partnerSharePolicy: { findUnique: vi.fn(), upsert: vi.fn() },
    guildMembership: { findMany: vi.fn(), findUnique: vi.fn() },
    operation: { findUnique: vi.fn() },
  },
}));

vi.mock("../../services/partnerships.js", () => ({
  getActivePartnerGuildIds: vi.fn(),
}));

vi.mock("../../services/discord.js", () => ({
  createPartnerScheduledEvent: vi.fn(),
  updatePartnerScheduledEvent: vi.fn(),
  deleteScheduledEvent: vi.fn(),
  sendDiscordDmComponents: vi.fn(),
}));

import { prisma } from "../../db.js";
import { getActivePartnerGuildIds } from "../../services/partnerships.js";
import {
  createPartnerScheduledEvent,
  deleteScheduledEvent,
  sendDiscordDmComponents,
  updatePartnerScheduledEvent,
} from "../../services/discord.js";
import {
  approveDistribution,
  countIncomingDistributions,
  declineDistribution,
  deleteDistributedEvents,
  distributeOperation,
  getTargetFleetoperators,
  isTargetFleetoperator,
  updateDistributedEvents,
} from "../../services/eventDistribution.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;
const partners = getActivePartnerGuildIds as any;
const createPartnerEvent = createPartnerScheduledEvent as any;
const updatePartnerEvent = updatePartnerScheduledEvent as any;
const deleteEvent = deleteScheduledEvent as any;
const dm = sendDiscordDmComponents as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

const OP = {
  id: "op1",
  guildId: "host",
  title: "Joint Op",
  description: "Together.",
  scheduledAt: new Date("2026-09-01T18:00:00.000Z"),
  meetingSystem: "stanton",
  meetingLocation: "HUR-L1",
  opType: "combat",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.operation.findUnique.mockResolvedValue({ partnerTargetGuildIds: ["partner"] });
  db.eventDistribution.findUnique.mockResolvedValue(null);
  db.eventDistribution.findMany.mockResolvedValue([]);
  db.eventDistribution.upsert.mockResolvedValue({ id: "d1" });
  db.partnerSharePolicy.findUnique.mockResolvedValue(null);
  db.guildMembership.findMany.mockResolvedValue([]);
  partners.mockResolvedValue(["partner"]);
  createPartnerEvent.mockResolvedValue({ id: "pe1" });
  // These are awaited with a trailing .catch() in the service, so they must
  // return real promises, not undefined.
  updatePartnerEvent.mockResolvedValue(undefined);
  deleteEvent.mockResolvedValue(undefined);
  dm.mockResolvedValue(undefined);
});

describe("distributeOperation — targeting", () => {
  it("only reaches partners the host operator actually selected", async () => {
    partners.mockResolvedValue(["partner", "other-partner"]);
    db.operation.findUnique.mockResolvedValue({ partnerTargetGuildIds: ["partner"] });

    const result = await distributeOperation(OP);

    expect(result.pending).toBe(1);
    expect(db.eventDistribution.upsert).toHaveBeenCalledTimes(1);
    expect(db.eventDistribution.upsert.mock.calls[0][0].create.targetGuildId).toBe("partner");
  });

  it("distributes to nobody when the operator selected no partner", async () => {
    db.operation.findUnique.mockResolvedValue({ partnerTargetGuildIds: [] });
    expect(await distributeOperation(OP)).toEqual({ auto: 0, pending: 0, failed: 0 });
    expect(db.eventDistribution.upsert).not.toHaveBeenCalled();
  });

  it("ignores a selected guild that is not an active partner", async () => {
    partners.mockResolvedValue([]);
    db.operation.findUnique.mockResolvedValue({ partnerTargetGuildIds: ["partner"] });
    expect(await distributeOperation(OP)).toEqual({ auto: 0, pending: 0, failed: 0 });
  });
});

describe("distributeOperation — auto-share policy", () => {
  it("posts immediately when the TARGET guild opted into auto-share", async () => {
    db.partnerSharePolicy.findUnique.mockResolvedValue({ autoShare: true, defaultContactUserId: "c1" });

    const result = await distributeOperation(OP);

    expect(result).toEqual({ auto: 1, pending: 0, failed: 0 });
    expect(createPartnerEvent).toHaveBeenCalledWith("partner", expect.objectContaining({ id: "op1" }));
    expect(db.eventDistribution.upsert.mock.calls[0][0].create).toMatchObject({
      status: "auto",
      discordEventId: "pe1",
    });
  });

  it("reads the policy directionally — the target decides, not the host", async () => {
    db.partnerSharePolicy.findUnique.mockResolvedValue({ autoShare: true });
    await distributeOperation(OP);
    expect(db.partnerSharePolicy.findUnique).toHaveBeenCalledWith({
      where: { ownerGuildId_partnerGuildId: { ownerGuildId: "partner", partnerGuildId: "host" } },
    });
  });

  it("counts a failed auto-post as failed instead of claiming success", async () => {
    db.partnerSharePolicy.findUnique.mockResolvedValue({ autoShare: true });
    createPartnerEvent.mockRejectedValue(new Error("Discord 403"));
    expect(await distributeOperation(OP)).toEqual({ auto: 0, pending: 0, failed: 1 });
  });

  it("queues a pending approval and DMs the target's fleet operators", async () => {
    db.guildMembership.findMany.mockResolvedValue([{ userId: "op-a" }, { userId: "op-b" }]);
    db.eventDistribution.findUnique
      .mockResolvedValueOnce(null) // existing lookup during distribute
      .mockResolvedValue({
        id: "d1",
        status: "pending",
        targetGuildId: "partner",
        operation: { ...OP, guild: { name: "Host Guild", orgName: "RDOC" } },
      });

    const result = await distributeOperation(OP);
    // The DM fan-out is fire-and-forget; let it settle.
    await new Promise((r) => setTimeout(r, 0));

    expect(result.pending).toBe(1);
    expect(dm).toHaveBeenCalledTimes(2);
    const payload = dm.mock.calls[0][1];
    const buttons = payload.components[0].components.map((c: { custom_id: string }) => c.custom_id);
    expect(buttons).toEqual(["evt-share:d1", "evt-decline:d1"]);
    expect(payload.embeds[0].url).toBe("http://app.test/ops/op1");
  });

  it("never re-DMs when the pending row already existed", async () => {
    db.eventDistribution.findUnique.mockResolvedValue({ id: "d1", status: "pending", discordEventId: null });
    await distributeOperation(OP);
    await new Promise((r) => setTimeout(r, 0));
    expect(dm).not.toHaveBeenCalled();
  });

  it("skips a partner that already has the event posted", async () => {
    db.eventDistribution.findUnique.mockResolvedValue({ id: "d1", status: "approved", discordEventId: "pe0" });
    expect(await distributeOperation(OP)).toEqual({ auto: 0, pending: 0, failed: 0 });
    expect(createPartnerEvent).not.toHaveBeenCalled();
  });
});

describe("approveDistribution", () => {
  const pending = {
    id: "d1",
    status: "pending",
    targetGuildId: "partner",
    operation: { ...OP, cover: null },
  };

  it("posts the partner event and records who decided", async () => {
    db.eventDistribution.findUnique.mockResolvedValue(pending);
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });

    expect(await approveDistribution("d1", "u1")).toEqual({ ok: true });
    expect(createPartnerEvent).toHaveBeenCalledWith("partner", expect.objectContaining({ id: "op1" }));
    expect(db.eventDistribution.update.mock.calls[0][0].data).toMatchObject({
      status: "approved",
      discordEventId: "pe1",
      decidedByUserId: "u1",
    });
  });

  it("refuses anyone who is not a fleet operator of the TARGET guild", async () => {
    db.eventDistribution.findUnique.mockResolvedValue(pending);
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });

    expect(await approveDistribution("d1", "u1")).toEqual({ ok: false, reason: "forbidden" });
    expect(createPartnerEvent).not.toHaveBeenCalled();
  });

  it("refuses when the user has no membership in the target guild at all", async () => {
    db.eventDistribution.findUnique.mockResolvedValue(pending);
    db.guildMembership.findUnique.mockResolvedValue(null);
    expect(await approveDistribution("d1", "u1")).toEqual({ ok: false, reason: "forbidden" });
  });

  it("cannot decide the same distribution twice", async () => {
    db.eventDistribution.findUnique.mockResolvedValue({ ...pending, status: "approved" });
    expect(await approveDistribution("d1", "u1")).toEqual({ ok: false, reason: "not_pending" });
  });

  it("reports an unknown distribution", async () => {
    db.eventDistribution.findUnique.mockResolvedValue(null);
    expect(await approveDistribution("nope", "u1")).toEqual({ ok: false, reason: "not_found" });
  });

  it("reports post_failed and leaves the row pending when Discord refuses", async () => {
    db.eventDistribution.findUnique.mockResolvedValue(pending);
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });
    createPartnerEvent.mockRejectedValue(new Error("Discord 500"));

    expect(await approveDistribution("d1", "u1")).toEqual({ ok: false, reason: "post_failed" });
    expect(db.eventDistribution.update).not.toHaveBeenCalled();
  });
});

describe("declineDistribution", () => {
  it("marks the row declined without touching Discord", async () => {
    db.eventDistribution.findUnique.mockResolvedValue({ id: "d1", status: "pending", targetGuildId: "partner" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });

    expect(await declineDistribution("d1", "u1")).toEqual({ ok: true });
    expect(createPartnerEvent).not.toHaveBeenCalled();
    expect(db.eventDistribution.update.mock.calls[0][0].data).toMatchObject({
      status: "declined",
      decidedByUserId: "u1",
    });
  });

  it("applies the same operator gate as approve", async () => {
    db.eventDistribution.findUnique.mockResolvedValue({ id: "d1", status: "pending", targetGuildId: "partner" });
    db.guildMembership.findUnique.mockResolvedValue({ role: "crew" });
    expect(await declineDistribution("d1", "u1")).toEqual({ ok: false, reason: "forbidden" });
  });
});

describe("fan-out to already-posted partner events", () => {
  it("updates every posted partner event and survives one failing", async () => {
    db.eventDistribution.findMany.mockResolvedValue([
      { id: "d1", targetGuildId: "p1", discordEventId: "e1" },
      { id: "d2", targetGuildId: "p2", discordEventId: "e2" },
    ]);
    updatePartnerEvent.mockRejectedValueOnce(new Error("Discord 404")).mockResolvedValueOnce(undefined);

    await expect(updateDistributedEvents(OP)).resolves.toBeUndefined();
    expect(updatePartnerEvent).toHaveBeenCalledTimes(2);
  });

  it("deletes partner events and marks the rows revoked", async () => {
    db.eventDistribution.findMany.mockResolvedValue([{ id: "d1", targetGuildId: "p1", discordEventId: "e1" }]);

    await deleteDistributedEvents("op1");

    expect(deleteEvent).toHaveBeenCalledWith("p1", "e1");
    expect(db.eventDistribution.update).toHaveBeenCalledWith({
      where: { id: "d1" },
      data: { discordEventId: null, status: "revoked" },
    });
  });
});

describe("target-guild helpers", () => {
  it("lists the fleet operators of the target guild", async () => {
    db.guildMembership.findMany.mockResolvedValue([{ userId: "a" }, { userId: "b" }]);
    expect(await getTargetFleetoperators("partner")).toEqual(["a", "b"]);
  });

  it("checks the per-guild role, not the global one", async () => {
    db.guildMembership.findUnique.mockResolvedValue({ role: "fleetoperator" });
    expect(await isTargetFleetoperator("u1", "partner")).toBe(true);
    db.guildMembership.findUnique.mockResolvedValue({ role: "captain" });
    expect(await isTargetFleetoperator("u1", "partner")).toBe(false);
  });

  it("counts pending inbox items for the nav badge", async () => {
    db.eventDistribution.count.mockResolvedValue(3);
    expect(await countIncomingDistributions("partner")).toBe(3);
    expect(db.eventDistribution.count).toHaveBeenCalledWith({
      where: { targetGuildId: "partner", status: "pending" },
    });
  });
});
