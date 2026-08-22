// Test fixtures — shapes match docs/api/fleetplanner-v1.md (FR-P2 §Mockups).
import type { OperationDetail, OperationSummary, SessionResponse } from "../api/types";

// The overview hides past operations by default, so a hard-coded date turns every
// list/agenda assertion into a time bomb. Late today: still the current month (the
// calendar views are month-scoped) and still upcoming.
function laterToday(): string {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate(), 23, 59, 0).toISOString();
}

export const sessionGuest: SessionResponse = { user: null, memberships: [], csrfToken: null };

export const sessionCrew: SessionResponse = {
  user: { id: "user_crew", username: "Crew One", role: "crew", locale: "de", shareHangarWithOrg: false, fleetyardsUsername: null },
  memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "crew" }],
  csrfToken: "csrf-test-token",
};

export const opSummaryFixture: OperationSummary = {
  id: "op_1",
  title: "Xenothreat Logistics",
  opType: "combat",
  status: "open",
  visibility: "public",
  scheduledAt: laterToday(),
  meetingSystem: "Stanton",
  meetingLocation: "Everus Harbor",
  minParticipants: 8,
  guild: { id: "guild_1", name: "RDOC", iconHash: null, discordInviteUrl: "https://discord.gg/example" },
  signupState: null,
  acceptedUnitCount: 1,
  filledSeats: 1,
  totalSeats: 2,
  isStreamEvent: false,
  isRecurring: false,
};

export const opDetailFixture: OperationDetail = {
  ...opSummaryFixture,
  recurrence: null,
  description: "Bring quant. Stay sharp.",
  maxParticipants: null,
  guild: { id: "guild_1", name: "RDOC", iconHash: null, timezone: "Europe/Berlin", discordInviteUrl: "https://discord.gg/example" },
  leaders: [{ id: "user_lead", username: "Lead" }],
  units: [
    {
      id: "unit_1",
      unitType: "ship",
      status: "accepted",
      name: "Perseus",
      shipName: "Perseus",
      shipClass: "Capital",
      squadName: null,
      captain: { id: "user_lead", username: "Lead" },
      captainNote: null,
      carrierUnitId: null,
      requirementId: null,
      formationId: null,
      roleOverride: null,
      formationSlot: null,
      lateEta: null,
      seats: [
        { id: "seat_1", label: "Pilot", order: 0, active: true, claimedBy: { id: "user_lead", username: "Lead" }, lateEta: null },
        { id: "seat_2", label: "Gunner", order: 1, active: true, claimedBy: null, lateEta: null },
      ],
    },
  ],
  resourceLinks: [
    { id: "link_1", title: "Briefing", url: "https://example.com/briefing", kind: "link", sortOrder: 0 },
  ],
  documents: [],
  streams: [],
  questions: [],
  auditLogs: [],
  cqbTeams: [],
  fighterSquads: [],
  formations: [],
  coverUrl: null,
  viewerRole: null,
  canManage: false,
  viewerCqbSignedUp: false,
  viewerHangarShared: false,
  viewerPrimaryUnitId: null,
  squadLinkVoiceEnabled: false,
};
