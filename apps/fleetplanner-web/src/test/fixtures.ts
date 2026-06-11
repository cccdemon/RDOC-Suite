// Test fixtures — shapes match docs/api/fleetplanner-v1.md (FR-P2 §Mockups).
import type { OperationDetail, OperationSummary, SessionResponse } from "../api/types";

export const sessionGuest: SessionResponse = { user: null, memberships: [], csrfToken: null };

export const sessionCrew: SessionResponse = {
  user: { id: "user_crew", username: "Crew One", role: "crew", locale: "de" },
  memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "crew" }],
  csrfToken: "csrf-test-token",
};

export const opSummaryFixture: OperationSummary = {
  id: "op_1",
  title: "Xenothreat Logistics",
  opType: "combat",
  status: "open",
  visibility: "public",
  scheduledAt: "2026-06-20T18:00:00.000Z",
  meetingSystem: "Stanton",
  meetingLocation: "Everus Harbor",
  minParticipants: 8,
  guild: { id: "guild_1", name: "RDOC", iconHash: null },
  signupState: null,
  acceptedUnitCount: 1,
};

export const opDetailFixture: OperationDetail = {
  ...opSummaryFixture,
  description: "Bring quant. Stay sharp.",
  guild: { id: "guild_1", name: "RDOC", iconHash: null, timezone: "Europe/Berlin" },
  leaders: [{ id: "user_lead", username: "Lead" }],
  units: [
    {
      id: "unit_1",
      unitType: "ship",
      status: "accepted",
      name: "Perseus",
      shipName: "Perseus",
      squadName: null,
      captain: { id: "user_lead", username: "Lead" },
      captainNote: null,
      carrierUnitId: null,
      seats: [
        { id: "seat_1", label: "Pilot", order: 0, active: true, claimedBy: { id: "user_lead", username: "Lead" } },
        { id: "seat_2", label: "Gunner", order: 1, active: true, claimedBy: null },
      ],
    },
  ],
  resourceLinks: [
    { id: "link_1", title: "Briefing", url: "https://example.com/briefing", kind: "link", sortOrder: 0 },
  ],
  viewerRole: null,
  canManage: false,
};
