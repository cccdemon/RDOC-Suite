import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operation: { findUnique: vi.fn() },
    missionVoiceParticipant: { findMany: vi.fn() },
    userIdentity: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import { getMissionParticipants, participantsToCsv } from "../../services/participants.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.missionVoiceParticipant.findMany.mockResolvedValue([]);
  db.userIdentity.findMany.mockResolvedValue([]);
});

describe("getMissionParticipants", () => {
  it("returns empty when op not found", async () => {
    db.operation.findUnique.mockResolvedValue(null);
    expect(await getMissionParticipants("op-1")).toEqual([]);
  });

  it("aggregates leaders, captains, seat-holders and command-net into unique users", async () => {
    db.operation.findUnique.mockResolvedValue({
      leaders: [
        { leaderRole: "raid_leader", user: { id: "u-lead", username: "Lead" } },
      ],
      units: [
        {
          unitType: "ship",
          squadName: null,
          ship: { name: "Carrack" },
          captain: { id: "u-cap", username: "Cap" },
          seats: [
            { label: "Gunner 1", user: { id: "u-crew", username: "Crew" } },
            { label: "Engineer", user: { id: "u-cap", username: "Cap" } },
          ],
        },
      ],
    });
    db.missionVoiceParticipant.findMany.mockResolvedValue([
      { user: { id: "u-manual", username: "Manual" } },
    ]);

    const result = await getMissionParticipants("op-1");
    const byId = Object.fromEntries(result.map((p) => [p.userId, p]));

    expect(result).toHaveLength(4);
    expect(byId["u-lead"].roles).toEqual(["Raid Leader"]);
    // captain is also a seat-holder in the same unit → roles merge, unit listed once
    expect(byId["u-cap"].roles).toEqual(expect.arrayContaining(["Captain", "Engineer"]));
    expect(byId["u-cap"].units).toEqual(["Carrack"]);
    expect(byId["u-crew"].units).toEqual(["Carrack"]);
    expect(byId["u-manual"].roles).toEqual(["Command Net"]);
  });

  it("attaches discord identity when present", async () => {
    db.operation.findUnique.mockResolvedValue({
      leaders: [{ leaderRole: "event_leader", user: { id: "u1", username: "Alice" } }],
      units: [],
    });
    db.userIdentity.findMany.mockResolvedValue([
      { userId: "u1", providerId: "123456789", username: "alice#0" },
    ]);

    const [p] = await getMissionParticipants("op-1");
    expect(p.discordId).toBe("123456789");
    expect(p.discordName).toBe("alice#0");
  });
});

describe("participantsToCsv", () => {
  it("renders header + rows, quotes cells, escapes quotes", async () => {
    const csv = participantsToCsv([
      {
        userId: "u1",
        username: 'Say "Hi"',
        discordId: "42",
        discordName: "say",
        roles: ["Captain", "Command Net"],
        units: ["Carrack"],
      },
    ]);
    const lines = csv.replace(/^﻿/, "").trimEnd().split("\r\n");
    expect(lines[0]).toBe('"Username","Discord","Discord ID","Roles","Units"');
    expect(lines[1]).toBe('"Say ""Hi""","say","42","Captain, Command Net","Carrack"');
  });
});
