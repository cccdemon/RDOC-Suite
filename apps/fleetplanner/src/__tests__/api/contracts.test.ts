import { describe, expect, it } from "vitest";
import {
  ApiErrorSchema,
  IdParamSchema,
  OperationDetailSchema,
  OperationListQuerySchema,
  OperationSummarySchema,
  SessionResponseSchema,
  ShipSearchQuerySchema,
} from "../../api/contracts/index.js";

const summaryFixture = {
  id: "op_1",
  title: "Xenothreat Logistics",
  opType: "combat",
  status: "open",
  visibility: "guild" as const,
  scheduledAt: "2026-06-20T18:00:00.000Z",
  meetingSystem: "Stanton",
  meetingLocation: "Everus Harbor",
  minParticipants: 8,
  guild: { id: "guild_1", name: "RDOC", iconHash: null },
  signupState: null,
  acceptedUnitCount: 2,
};

describe("contracts", () => {
  it("accepts a valid OperationSummary fixture", () => {
    expect(OperationSummarySchema.safeParse(summaryFixture).success).toBe(true);
  });

  it("rejects an OperationSummary without required fields", () => {
    const { title: _title, ...missingTitle } = summaryFixture;
    expect(OperationSummarySchema.safeParse(missingTitle).success).toBe(false);
  });

  it("rejects an invalid visibility value", () => {
    expect(
      OperationSummarySchema.safeParse({ ...summaryFixture, visibility: "secret" }).success,
    ).toBe(false);
  });

  it("accepts a full OperationDetail fixture", () => {
    const detail = {
      ...summaryFixture,
      description: "Bring quant.",
      guild: { ...summaryFixture.guild, timezone: "Europe/Berlin" },
      leaders: [{ id: "user_1", username: "Lead" }],
      units: [
        {
          id: "unit_1",
          unitType: "ship",
          status: "accepted",
          name: "Perseus",
          shipName: "Perseus",
          squadName: null,
          captain: { id: "user_1", username: "Lead" },
          captainNote: null,
          carrierUnitId: null,
          seats: [
            { id: "seat_1", label: "Pilot", order: 0, active: true, claimedBy: null },
            {
              id: "seat_2",
              label: "Gunner",
              order: 1,
              active: true,
              claimedBy: { id: "user_2", username: "Mira" },
            },
          ],
        },
      ],
      resourceLinks: [
        { id: "link_1", title: "Briefing", url: "https://example.com/briefing", kind: "link", sortOrder: 0 },
      ],
      viewerRole: "crew",
      canManage: false,
      viewerCqbSignedUp: false,
      viewerHangarShared: true,
    };
    const parsed = OperationDetailSchema.safeParse(detail);
    expect(parsed.success).toBe(true);
  });

  it("error envelope requires code, message and requestId", () => {
    expect(
      ApiErrorSchema.safeParse({
        error: { code: "forbidden", message: "no", requestId: "req-1" },
      }).success,
    ).toBe(true);
    expect(ApiErrorSchema.safeParse({ error: { code: "forbidden" } }).success).toBe(false);
    expect(ApiErrorSchema.safeParse({ error: { code: "weird", message: "x", requestId: "r" } }).success).toBe(false);
  });

  it("session response models anonymous and authenticated callers", () => {
    expect(
      SessionResponseSchema.safeParse({ user: null, memberships: [], csrfToken: null }).success,
    ).toBe(true);
    expect(
      SessionResponseSchema.safeParse({
        user: { id: "u1", username: "Crew", role: "crew", locale: "de" },
        memberships: [{ guildId: "g1", guildName: "RDOC", role: "crew" }],
        csrfToken: "tok",
      }).success,
    ).toBe(true);
  });

  it("query schemas coerce and bound inputs", () => {
    expect(OperationListQuerySchema.parse({}).past).toBe(false);
    expect(OperationListQuerySchema.parse({ past: "true" }).past).toBe(true);
    expect(ShipSearchQuerySchema.parse({}).limit).toBe(20);
    expect(ShipSearchQuerySchema.safeParse({ limit: "1000" }).success).toBe(false);
    expect(ShipSearchQuerySchema.safeParse({ q: "x".repeat(200) }).success).toBe(false);
  });

  it("id param rejects path traversal / exotic input", () => {
    expect(IdParamSchema.safeParse({ id: "cmbvalidcuidvalue12345" }).success).toBe(true);
    expect(IdParamSchema.safeParse({ id: "../etc/passwd" }).success).toBe(false);
    expect(IdParamSchema.safeParse({ id: "x" }).success).toBe(false);
  });
});
