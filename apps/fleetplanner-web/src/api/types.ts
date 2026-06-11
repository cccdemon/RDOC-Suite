// API v1 response types — mirror of the server contracts in
// apps/fleetplanner/src/api/contracts/index.ts (single source of truth there;
// the OpenAPI diff test on the server side guards the wire format). The FE
// keeps its own copy on purpose: FR-P2 forbids importing server code, and a
// shared contracts package is a later refactor (Phase 6 candidate).

export type ApiErrorCode =
  | "bad_request"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal";

export interface ApiErrorBody {
  error: { code: ApiErrorCode; message: string; requestId: string };
}

export interface SessionUser {
  id: string;
  username: string;
  role: "superadmin" | "fleetoperator" | "crew";
  locale: string | null;
}

export interface SessionResponse {
  user: SessionUser | null;
  memberships: Array<{ guildId: string; guildName: string; role: string }>;
  csrfToken: string | null;
}

export interface OperationSummary {
  id: string;
  title: string;
  opType: string;
  status: string;
  visibility: "private" | "guild" | "partners" | "public";
  scheduledAt: string;
  meetingSystem: string;
  meetingLocation: string;
  minParticipants: number;
  guild: { id: string; name: string; iconHash: string | null };
  signupState: "joined" | "waitlist" | null;
  acceptedUnitCount: number;
}

export interface Seat {
  id: string;
  label: string;
  order: number;
  active: boolean;
  claimedBy: { id: string; username: string } | null;
}

export interface FleetUnit {
  id: string;
  unitType: string;
  status: string;
  name: string;
  shipName: string | null;
  squadName: string | null;
  captain: { id: string; username: string } | null;
  captainNote: string | null;
  carrierUnitId: string | null;
  seats: Seat[];
}

export interface ResourceLink {
  id: string;
  title: string;
  url: string;
  kind: string;
  sortOrder: number;
}

export interface OperationDetail extends Omit<OperationSummary, "guild"> {
  description: string;
  guild: { id: string; name: string; iconHash: string | null; timezone: string | null };
  leaders: Array<{ id: string; username: string }>;
  units: FleetUnit[];
  resourceLinks: ResourceLink[];
  viewerRole: string | null;
  canManage: boolean;
}
