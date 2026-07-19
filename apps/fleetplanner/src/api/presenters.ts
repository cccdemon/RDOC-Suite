// FR-P2 Phase 2 — presenters: DB models → API response models.
//
// Pure functions, no prisma/fastify/web imports. They take the row shapes the
// existing services already load and emit exactly the contract types — no
// HTML-flavored fields, no secrets (tokens, ciphertexts, audit details stay
// server-side).
import { shipClass } from "../services/composition.js";
import type {
  FleetUnit,
  GuildSettings,
  GuildSettingsMember,
  GuildSummary,
  OperationDetail,
  OperationSummary,
  OrgFleetResponse,
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
  lateEta?: string | null;
};
type UnitRow = {
  id: string;
  unitType: string;
  status: string;
  squadName: string | null;
  captainNote: string | null;
  carrierUnitId: string | null;
  requirementId?: string | null;
  formationId?: string | null;
  ship?: { name: string; size?: string | null; career?: string | null; role?: string | null } | null;
  captain?: UserRow | null;
  seats: SeatRow[];
  lateEta?: string | null;
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
  isStreamEvent?: boolean;
  guild: { id: string; name: string; iconHash: string | null; discordInviteUrl?: string | null };
  units?: Array<{ id?: string; status: string; seats?: Array<{ userId: string | null }> }>;
};
type OpDetailRow = OpListRow & {
  description: string;
  maxParticipants: number | null;
  squadLinkVoiceEnabled?: boolean;
  guild: { id: string; name: string; iconHash: string | null; timezone: string | null; discordInviteUrl?: string | null };
  leaders: Array<{ user: UserRow }>;
  units: UnitRow[];
  resourceLinks?: Array<{
    id: string;
    title: string;
    url: string;
    kind: string;
    sortOrder: number;
  }>;
  streams?: Array<{ id: string; platform: string; url: string; label: string; userId: string | null; user: { id: string; username: string } | null }>;
  questions?: Array<{ id: string; asker: string; body: string; answer: string | null; answeredBy: string | null }>;
  groups?: Array<{ id: string; name: string; kind: string; targetSize: number | null }>;
  cqbSignups?: Array<{ userId: string; status: string; assignedGroupId: string | null; lateEta?: string | null; user: { id: string; username: string } }>;
  cover?: { url: string } | null;
};

// `redact` hides player identities — anonymous (not-logged-in) viewers of a
// public op must never see usernames; a claimed seat shows only "occupied".
export function presentSeat(s: SeatRow, redact = false): Seat {
  const claimed = !!(s.userId && s.user);
  return {
    id: s.id,
    label: s.label,
    order: s.order,
    active: s.active,
    claimedBy: claimed ? (redact ? { id: "", username: "Belegt" } : { id: s.user!.id, username: s.user!.username }) : null,
    lateEta: s.lateEta ?? null,
  };
}

export function presentUnit(u: UnitRow, redact = false): FleetUnit {
  return {
    id: u.id,
    unitType: u.unitType,
    status: u.status,
    name: u.ship?.name ?? u.squadName ?? "Unit",
    shipName: u.ship?.name ?? null,
    // Derived class so the board can split fighters into their own lane; null for
    // non-ship units (squads/vehicles get their own lanes by unitType).
    shipClass: u.unitType === "ship" && u.ship ? shipClass(u.ship) : null,
    squadName: u.squadName,
    captain: u.captain ? (redact ? null : { id: u.captain.id, username: u.captain.username }) : null,
    captainNote: u.captainNote,
    carrierUnitId: u.carrierUnitId,
    requirementId: u.requirementId ?? null,
    formationId: u.formationId ?? null,
    lateEta: u.lateEta ?? null,
    // FR-B1: include inactive seats too (with the active flag) so the operator can
    // re-activate them; the player board filters to active client-side.
    seats: u.seats.map((s) => presentSeat(s, redact)),
  };
}

export function presentOperationSummary(
  op: OpListRow,
  signupState: "joined" | "waitlist" | null = null,
): OperationSummary {
  const acceptedUnits = (op.units ?? []).filter((u) => u.status === "accepted");
  let filledSeats = 0;
  let totalSeats = 0;
  for (const u of acceptedUnits) {
    // FR-B1: deactivated seats don't count toward total/open (operator chose not
    // to fill them). The list loader doesn't select `active` → defaults to active.
    const seats = (u.seats ?? []).filter((s) => (s as { active?: boolean }).active !== false);
    totalSeats += seats.length;
    filledSeats += seats.filter((s) => s.userId).length;
  }
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
    guild: {
      id: op.guild.id,
      name: op.guild.name,
      iconHash: op.guild.iconHash,
      discordInviteUrl: op.guild.discordInviteUrl ?? null,
    },
    signupState,
    acceptedUnitCount: acceptedUnits.length,
    filledSeats,
    totalSeats,
    isStreamEvent: op.isStreamEvent ?? false,
  };
}

export function presentOperationDetail(
  op: OpDetailRow,
  viewer: {
    role: string | null;
    canManage: boolean;
    signupState: "joined" | "waitlist" | null;
    cqbSignedUp?: boolean;
    hangarShared?: boolean;
  },
): OperationDetail {
  // Anonymous viewers (public op, not logged in) never see player identities.
  const redact = viewer.role === null;
  return {
    ...presentOperationSummary(op, viewer.signupState),
    viewerCqbSignedUp: viewer.cqbSignedUp ?? false,
    viewerHangarShared: viewer.hangarShared ?? false,
    description: op.description,
    maxParticipants: op.maxParticipants,
    guild: {
      id: op.guild.id,
      name: op.guild.name,
      iconHash: op.guild.iconHash,
      timezone: op.guild.timezone,
      discordInviteUrl: op.guild.discordInviteUrl ?? null,
    },
    leaders: redact ? [] : op.leaders.map((l) => ({ id: l.user.id, username: l.user.username })),
    units: op.units.map((u) => presentUnit(u as UnitRow, redact)),
    resourceLinks: (op.resourceLinks ?? []).map((l) => ({
      id: l.id,
      title: l.title,
      url: l.url,
      kind: l.kind,
      sortOrder: l.sortOrder,
    })),
    streams: (op.streams ?? []).map((s) => ({
      id: s.id,
      platform: s.platform as "twitch" | "youtube" | "vdo_ninja" | "other",
      url: s.url,
      label: s.label,
      // Anonymous viewers never see who added a stream.
      userId: redact ? null : s.userId,
      username: redact ? null : (s.user?.username ?? null),
    })),
    questions: (op.questions ?? []).map((q) => ({
      id: q.id,
      asker: q.asker,
      body: q.body,
      answer: q.answer,
      answeredBy: q.answeredBy,
    })),
    // CQB squads as joinable slot groups (a squad is a need crew can take directly).
    cqbTeams: (op.groups ?? [])
      .filter((g) => g.kind === "squad")
      .map((g) => ({
        id: g.id,
        name: g.name,
        targetSize: g.targetSize,
        members: (op.cqbSignups ?? [])
          .filter((s) => s.assignedGroupId === g.id && s.status !== "rejected")
          .map((s) => (redact ? { id: "", username: "Belegt", lateEta: null } : { id: s.user.id, username: s.user.username, lateEta: s.lateEta ?? null })),
      })),
    // Fighter squads (Jäger-Staffeln) — `members` are pilots (person signups the
    // operator placed directly); fighter units bind via formationId, grouped
    // client-side. Here we expose the squad groups + slots + person-members.
    fighterSquads: (op.groups ?? [])
      .filter((g) => g.kind === "fighter_squad")
      .map((g) => ({
        id: g.id,
        name: g.name,
        targetSize: g.targetSize,
        members: (op.cqbSignups ?? [])
          .filter((s) => s.assignedGroupId === g.id && s.status !== "rejected")
          .map((s) => (redact ? { id: "", username: "Belegt", lateEta: null } : { id: s.user.id, username: s.user.username, lateEta: s.lateEta ?? null })),
      })),
    formations: (op.groups ?? [])
      .filter((g) => g.kind === "formation")
      .map((g) => ({
        id: g.id,
        name: g.name,
        members: (op.cqbSignups ?? [])
          .filter((s) => s.assignedGroupId === g.id && s.status !== "rejected")
          .map((s) => (redact ? { id: "", username: "Belegt", lateEta: null } : { id: s.user.id, username: s.user.username, lateEta: s.lateEta ?? null })),
      })),
    coverUrl: op.cover?.url ?? null,
    viewerRole: viewer.role,
    canManage: viewer.canManage,
    squadLinkVoiceEnabled: op.squadLinkVoiceEnabled === true,
  };
}

export function presentSession(
  ctx: {
    user: { id: string; username: string; role: string; locale: string | null; shareHangarWithOrg?: boolean };
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
      shareHangarWithOrg: ctx.user.shareHangarWithOrg ?? false,
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

export function presentGuildSettings(g: {
  id: string;
  name: string;
  orgName: string | null;
  timezone: string;
  discordInviteUrl: string | null;
  admiralRoleId: string | null;
  ownerUserId: string | null;
  canRemove: boolean;
}): GuildSettings {
  return {
    id: g.id,
    name: g.name,
    orgName: g.orgName,
    timezone: g.timezone,
    discordInviteUrl: g.discordInviteUrl,
    admiralRoleId: g.admiralRoleId,
    ownerUserId: g.ownerUserId,
    canRemove: g.canRemove,
  };
}

export function presentGuildSettingsMember(m: {
  userId: string;
  username: string;
  role: string;
  isOwner: boolean;
}): GuildSettingsMember {
  return {
    userId: m.userId,
    username: m.username,
    role: m.role === "fleetoperator" ? "fleetoperator" : "crew",
    isOwner: m.isOwner,
  };
}

// FR-P3 org fleet: flat owner×ship rows → entries + roster totals.
type OrgFleetRowLike = {
  userId: string;
  username: string;
  discordId: string | null;
  discordHandle: string | null;
  shipId: string;
  shipName: string;
  manufacturer: string;
  shipClass: string;
  nickname: string | null;
  quantity: number;
  sourceUrl: string | null;
  imageUrl: string | null;
};
export function presentOrgFleet(rows: OrgFleetRowLike[]): OrgFleetResponse {
  const models = new Set<string>();
  const members = new Set<string>();
  let hulls = 0;
  for (const r of rows) {
    models.add(r.shipId);
    members.add(r.userId);
    hulls += r.quantity;
  }
  return {
    entries: rows.map((r) => ({
      user: { id: r.userId, username: r.username, discordId: r.discordId, discordHandle: r.discordHandle },
      shipId: r.shipId,
      shipName: r.shipName,
      manufacturer: r.manufacturer,
      shipClass: r.shipClass,
      nickname: r.nickname,
      quantity: r.quantity,
      sourceUrl: r.sourceUrl,
      imageUrl: r.imageUrl,
    })),
    totals: { hulls, models: models.size, membersWithHangar: members.size },
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
  imageUrl?: string | null;
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
    imageUrl: s.imageUrl ?? null,
  };
}
