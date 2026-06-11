// FR-P2 Phase 2 — presenters: DB models → API response models.
//
// Pure functions, no prisma/fastify/web imports. They take the row shapes the
// existing services already load and emit exactly the contract types — no
// HTML-flavored fields, no secrets (tokens, ciphertexts, audit details stay
// server-side).
import type {
  FleetUnit,
  GuildSummary,
  OperationDetail,
  OperationSummary,
  Seat,
  SessionResponse,
  ShipSummary,
} from "./contracts/index.js";

// Structural row types — match what services/operations.ts &co. select today.
type UserRow = { id: string; username: string };
type SeatRow = {
  id: string;
  label: string;
  order: number;
  active: boolean;
  userId: string | null;
  user?: UserRow | null;
};
type UnitRow = {
  id: string;
  unitType: string;
  status: string;
  squadName: string | null;
  captainNote: string | null;
  carrierUnitId: string | null;
  ship?: { name: string } | null;
  captain?: UserRow | null;
  seats: SeatRow[];
};
type OpListRow = {
  id: string;
  title: string;
  opType: string;
  status: string;
  visibility: string;
  scheduledAt: Date;
  meetingSystem: string;
  meetingLocation: string;
  minParticipants: number;
  guild: { id: string; name: string; iconHash: string | null };
  units?: Array<{ id: string; status: string }>;
};
type OpDetailRow = OpListRow & {
  description: string;
  guild: { id: string; name: string; iconHash: string | null; timezone: string | null };
  leaders: Array<{ user: UserRow }>;
  units: UnitRow[];
  resourceLinks?: Array<{
    id: string;
    title: string;
    url: string;
    kind: string;
    sortOrder: number;
  }>;
};

export function presentSeat(s: SeatRow): Seat {
  return {
    id: s.id,
    label: s.label,
    order: s.order,
    active: s.active,
    claimedBy: s.userId && s.user ? { id: s.user.id, username: s.user.username } : null,
  };
}

export function presentUnit(u: UnitRow): FleetUnit {
  return {
    id: u.id,
    unitType: u.unitType,
    status: u.status,
    name: u.ship?.name ?? u.squadName ?? "Unit",
    shipName: u.ship?.name ?? null,
    squadName: u.squadName,
    captain: u.captain ? { id: u.captain.id, username: u.captain.username } : null,
    captainNote: u.captainNote,
    carrierUnitId: u.carrierUnitId,
    seats: u.seats.filter((s) => s.active).map(presentSeat),
  };
}

export function presentOperationSummary(
  op: OpListRow,
  signupState: "joined" | "waitlist" | null = null,
): OperationSummary {
  return {
    id: op.id,
    title: op.title,
    opType: op.opType,
    status: op.status,
    visibility: op.visibility as OperationSummary["visibility"],
    scheduledAt: op.scheduledAt.toISOString(),
    meetingSystem: op.meetingSystem,
    meetingLocation: op.meetingLocation,
    minParticipants: op.minParticipants,
    guild: { id: op.guild.id, name: op.guild.name, iconHash: op.guild.iconHash },
    signupState,
    acceptedUnitCount: (op.units ?? []).filter((u) => u.status === "accepted").length,
  };
}

export function presentOperationDetail(
  op: OpDetailRow,
  viewer: { role: string | null; canManage: boolean; signupState: "joined" | "waitlist" | null },
): OperationDetail {
  return {
    ...presentOperationSummary(op, viewer.signupState),
    description: op.description,
    guild: {
      id: op.guild.id,
      name: op.guild.name,
      iconHash: op.guild.iconHash,
      timezone: op.guild.timezone,
    },
    leaders: op.leaders.map((l) => ({ id: l.user.id, username: l.user.username })),
    units: op.units.map(presentUnit),
    resourceLinks: (op.resourceLinks ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      url: l.url,
      kind: l.kind,
      sortOrder: l.sortOrder,
    })),
    viewerRole: viewer.role,
    canManage: viewer.canManage,
  };
}

export function presentSession(
  ctx: {
    user: { id: string; username: string; role: string; locale: string | null };
    csrfToken: string;
  } | null,
  memberships: Array<{ guildId: string; guild: { name: string }; role: string }>,
): SessionResponse {
  if (!ctx) return { user: null, memberships: [], csrfToken: null };
  return {
    user: {
      id: ctx.user.id,
      username: ctx.user.username,
      role: ctx.user.role as "superadmin" | "fleetoperator" | "crew",
      locale: ctx.user.locale,
    },
    memberships: memberships.map((m) => ({
      guildId: m.guildId,
      guildName: m.guild.name,
      role: m.role,
    })),
    csrfToken: ctx.csrfToken,
  };
}

export function presentGuild(m: {
  guildId: string;
  role: string;
  guild: { name: string; iconHash: string | null; timezone: string | null };
}): GuildSummary {
  return {
    id: m.guildId,
    name: m.guild.name,
    iconHash: m.guild.iconHash,
    timezone: m.guild.timezone,
    role: m.role,
  };
}

export function presentShip(s: {
  id: string;
  slug: string;
  name: string;
  manufacturer: string;
  size: string;
  role: string;
  minCrew: number;
  maxCrew: number;
}): ShipSummary {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    manufacturer: s.manufacturer,
    size: s.size,
    role: s.role,
    minCrew: s.minCrew,
    maxCrew: s.maxCrew,
  };
}
