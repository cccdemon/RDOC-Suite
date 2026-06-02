import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operation: {
      findUnique: vi.fn(),
    },
    operationLeader: {
      findUnique: vi.fn(),
    },
    fleetUnit: {
      findFirst: vi.fn(),
    },
    missionVoiceParticipant: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import { isMissionCommander, listMissionCommanders } from "../../services/missionCommanders.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("listMissionCommanders", () => {
  it("includes accepted unit captains, operation leaders, and manual participants once", async () => {
    db.operation.findUnique.mockResolvedValue({
      units: [
        { captainId: "captain-1", captain: { id: "captain-1", username: "Captain One" } },
        { captainId: "leader-1", captain: { id: "leader-1", username: "Leader Captain" } },
      ],
      leaders: [
        { userId: "leader-1", user: { id: "leader-1", username: "Leader Captain" } },
        { userId: "leader-2", user: { id: "leader-2", username: "Leader Two" } },
      ],
    });
    db.missionVoiceParticipant.findMany.mockResolvedValue([
      {
        userId: "participant-1",
        globalVoice: false,
        user: { id: "participant-1", username: "Participant One" },
      },
      {
        userId: "captain-1",
        globalVoice: true,
        user: { id: "captain-1", username: "Captain One" },
      },
    ]);

    const commanders = await listMissionCommanders("op-1");

    expect(commanders).toEqual([
      { userId: "captain-1", username: "Captain One", kind: "squadleader", globalVoice: true },
      { userId: "leader-1", username: "Leader Captain", kind: "squadleader", globalVoice: true },
      { userId: "leader-2", username: "Leader Two", kind: "participant", globalVoice: true },
      {
        userId: "participant-1",
        username: "Participant One",
        kind: "participant",
        globalVoice: false,
      },
    ]);
  });
});

describe("isMissionCommander", () => {
  it("accepts accepted unit captains, leaders, and participants", async () => {
    db.fleetUnit.findFirst.mockResolvedValueOnce({ id: "unit-1" });
    await expect(isMissionCommander("op-1", "captain-1")).resolves.toBe(true);

    db.fleetUnit.findFirst.mockResolvedValueOnce(null);
    db.operationLeader.findUnique.mockResolvedValueOnce({ id: "leader-1" });
    await expect(isMissionCommander("op-1", "leader-1")).resolves.toBe(true);

    db.fleetUnit.findFirst.mockResolvedValueOnce(null);
    db.operationLeader.findUnique.mockResolvedValueOnce(null);
    db.missionVoiceParticipant.findFirst.mockResolvedValueOnce({ id: "participant-1" });
    await expect(isMissionCommander("op-1", "participant-1")).resolves.toBe(true);
  });
});
