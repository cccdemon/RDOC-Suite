import { describe, expect, it } from "vitest";
import {
  presentGuild,
  presentOperationDetail,
  presentOperationSummary,
  presentSession,
  presentShip,
  presentUnit,
} from "../../api/presenters.js";
import {
  GuildSummarySchema,
  OperationDetailSchema,
  OperationSummarySchema,
  SessionResponseSchema,
  ShipSummarySchema,
} from "../../api/contracts/index.js";

const opRow = {
  id: "op_1",
  title: "Op",
  opType: "combat",
  status: "open",
  visibility: "public",
  scheduledAt: new Date("2026-06-20T18:00:00.000Z"),
  meetingSystem: "Stanton",
  meetingLocation: "Everus",
  minParticipants: 5,
  maxParticipants: 24,
  guild: { id: "g1", name: "RDOC", iconHash: null, timezone: "Europe/Berlin" },
  units: [
    {
      id: "u1",
      unitType: "ship",
      status: "accepted",
      squadName: null,
      captainNote: "note",
      carrierUnitId: null,
      ship: { name: "Perseus" },
      captain: { id: "c1", username: "Cap" },
      seats: [
        { id: "s1", label: "Pilot", order: 0, active: true, userId: "c1", user: { id: "c1", username: "Cap" } },
        { id: "s2", label: "Gunner", order: 1, active: true, userId: null, user: null },
        { id: "s3", label: "Disabled", order: 2, active: false, userId: null, user: null },
      ],
    },
  ],
  description: "desc",
  leaders: [{ user: { id: "l1", username: "Lead" } }],
  resourceLinks: [
    { id: "r1", title: "Briefing", url: "https://example.com", kind: "link", sortOrder: 0 },
  ],
};

describe("presenters", () => {
  it("operation summary matches the contract, counts accepted units + seats", () => {
    const out = presentOperationSummary({
      ...opRow,
      units: [
        { id: "u1", status: "accepted", seats: [{ userId: "a" }, { userId: null }] },
        { id: "u2", status: "pending", seats: [{ userId: "b" }] },
      ],
    });
    expect(OperationSummarySchema.safeParse(out).success).toBe(true);
    expect(out.acceptedUnitCount).toBe(1);
    expect(out.filledSeats).toBe(1);
    expect(out.totalSeats).toBe(2);
    expect(out.scheduledAt).toBe("2026-06-20T18:00:00.000Z");
  });

  it("operation detail matches the contract; inactive seats are included with the active flag (FR-B1)", () => {
    const out = presentOperationDetail(opRow, { role: "crew", canManage: false, signupState: "joined" });
    expect(OperationDetailSchema.safeParse(out).success).toBe(true);
    // All seats are returned (the operator board needs inactive ones to re-activate);
    // the player board filters on `active` client-side. Inactive seats don't count
    // toward totals though.
    expect(out.units[0].seats).toHaveLength(3);
    expect(out.units[0].seats[2].active).toBe(false);
    expect(out.totalSeats).toBe(2);
    expect(out.units[0].seats[0].claimedBy).toEqual({ id: "c1", username: "Cap" });
    expect(out.units[0].seats[1].claimedBy).toBeNull();
    expect(out.signupState).toBe("joined");
  });

  it("redacts player identities for anonymous viewers (role null)", () => {
    const out = presentOperationDetail(opRow, { role: null, canManage: false, signupState: null });
    // Claimed seats show only "occupied", never a username; captain + leaders hidden.
    expect(out.units[0].seats[0].claimedBy).toEqual({ id: "", username: "Belegt" });
    expect(out.units[0].captain).toBeNull();
    expect(out.leaders).toHaveLength(0);
    expect(JSON.stringify(out)).not.toContain("Cap");
  });

  it("emits no HTML-ish or secret-ish fields", () => {
    const out = presentOperationDetail(opRow, { role: null, canManage: false, signupState: null });
    const json = JSON.stringify(out);
    // NB: `questions` IS a legit op-detail field (FR-B7, public Q&A thread); the
    // operator-only `auditLogs`/`hangarShares` stay out of the player payload.
    for (const banned of ["tokenCiphertext", "rawJson", "auditLogs", "hangarShares", "<div", "style="]) {
      expect(json).not.toContain(banned);
    }
  });

  it("unit name falls back ship → squad → Unit", () => {
    expect(presentUnit({ ...opRow.units[0], ship: null, squadName: "Alpha" }).name).toBe("Alpha");
    expect(presentUnit({ ...opRow.units[0], ship: null, squadName: null }).name).toBe("Unit");
  });

  it("session presenter handles anonymous and authenticated", () => {
    expect(SessionResponseSchema.safeParse(presentSession(null, [])).success).toBe(true);
    const out = presentSession(
      { user: { id: "u1", username: "X", role: "crew", locale: null }, csrfToken: "t" },
      [{ guildId: "g1", guild: { name: "RDOC" }, role: "crew" }],
    );
    expect(SessionResponseSchema.safeParse(out).success).toBe(true);
    expect(out.csrfToken).toBe("t");
  });

  it("guild + ship presenters match contracts", () => {
    expect(
      GuildSummarySchema.safeParse(
        presentGuild({ guildId: "g1", role: "crew", guild: { name: "RDOC", iconHash: null, timezone: null } }),
      ).success,
    ).toBe(true);
    expect(
      ShipSummarySchema.safeParse(
        presentShip({ id: "s1", slug: "perseus", name: "Perseus", manufacturer: "RSI", size: "Large", role: "Gunship", minCrew: 2, maxCrew: 6 }),
      ).success,
    ).toBe(true);
  });
});
