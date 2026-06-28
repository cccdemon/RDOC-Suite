// FR-P2 Phase 6 — shared API v1 contract package.
//
// Single source of truth for every /api/v1 request/response shape, shared by
// the Fastify backend (validation + OpenAPI generation) and the SPA (types).
// Uses zod 4. The SPA imports only the inferred TYPES (type-only), so zod is
// never bundled into the frontend.
import { z } from "zod";

// ── Common ────────────────────────────────────────────────────────────

/** Stable error envelope. Internal details stay in the server log. */
export const ApiErrorSchema = z
  .object({
    error: z.object({
      code: z.enum([
        "bad_request",
        "unauthenticated",
        "forbidden",
        "not_found",
        "conflict",
        "rate_limited",
        "internal",
      ]),
      message: z.string(),
      requestId: z.string(),
    }),
  })
  .meta({ id: "ApiError" });
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthResponseSchema = z
  .object({
    status: z.literal("ok"),
    service: z.literal("fleetplanner-api"),
    version: z.string(),
    time: z.iso.datetime(),
  })
  .meta({ id: "HealthResponse" });
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// ── Session ───────────────────────────────────────────────────────────

export const SessionUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    role: z.enum(["superadmin", "fleetoperator", "crew"]),
    locale: z.string().nullable(),
    /** FR-P3: opt-in to list one's owned ships in the guild Org-Flotte. */
    shareHangarWithOrg: z.boolean(),
  })
  .meta({ id: "SessionUser" });
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const MembershipSchema = z
  .object({
    guildId: z.string(),
    guildName: z.string(),
    role: z.string(),
  })
  .meta({ id: "Membership" });

/** GET /api/v1/session — anonymous callers get { user: null }. The CSRF token
 *  is only present for authenticated browser sessions (FR-P2 §CSRF). */
export const SessionResponseSchema = z
  .object({
    user: SessionUserSchema.nullable(),
    memberships: z.array(MembershipSchema),
    csrfToken: z.string().nullable(),
  })
  .meta({ id: "SessionResponse" });
export type SessionResponse = z.infer<typeof SessionResponseSchema>;

// ── Account (linked logins) ─────────────────────────────────────────────

export const AccountIdentitySchema = z
  .object({ provider: z.string(), username: z.string().nullable(), since: z.iso.datetime() })
  .meta({ id: "AccountIdentity" });

export const AccountResponseSchema = z
  .object({ identities: z.array(AccountIdentitySchema) })
  .meta({ id: "AccountResponse" });
export type AccountResponse = z.infer<typeof AccountResponseSchema>;

// ── Discord install diagnostics ─────────────────────────────────────────

export const DiagnosticsPermSchema = z.object({ key: z.string(), label: z.string() }).meta({ id: "DiagnosticsPerm" });

export const DiagnosticsBotSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    severity: z.enum(["ok", "warn", "error"]),
    configured: z.boolean(),
    installed: z.boolean(),
    username: z.string().nullable(),
    note: z.string(),
    inviteUrl: z.string().nullable(),
    requiredPermissions: z.array(DiagnosticsPermSchema),
    missingPermissions: z.array(DiagnosticsPermSchema),
  })
  .meta({ id: "DiagnosticsBot" });

export const DiagnosticsResponseSchema = z
  .object({
    guild: z.object({ id: z.string(), name: z.string() }),
    canInspectPermissions: z.boolean(),
    summary: z.object({ ok: z.number(), warn: z.number(), error: z.number() }),
    bots: z.array(DiagnosticsBotSchema),
  })
  .meta({ id: "DiagnosticsResponse" });
export type DiagnosticsResponse = z.infer<typeof DiagnosticsResponseSchema>;

// ── Guilds ────────────────────────────────────────────────────────────

export const GuildSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    iconHash: z.string().nullable(),
    timezone: z.string().nullable(),
    role: z.string(),
  })
  .meta({ id: "GuildSummary" });
export type GuildSummary = z.infer<typeof GuildSummarySchema>;

export const GuildListResponseSchema = z
  .object({ guilds: z.array(GuildSummarySchema) })
  .meta({ id: "GuildListResponse" });

// ── Operations ────────────────────────────────────────────────────────

export const OperationSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    opType: z.string(),
    status: z.string(),
    visibility: z.enum(["private", "guild", "partners", "public"]),
    scheduledAt: z.iso.datetime(),
    meetingSystem: z.string(),
    meetingLocation: z.string(),
    minParticipants: z.number().int(),
    guild: z.object({
      id: z.string(),
      name: z.string(),
      iconHash: z.string().nullable(),
      /** Guild's Discord invite URL (server settings); null when unset. Drives
       *  the "Join on Discord" link on op panels/cards. */
      discordInviteUrl: z.string().nullable(),
    }),
    /** Current user's signup state for the op; null when anonymous/none. */
    signupState: z.enum(["joined", "waitlist"]).nullable(),
    acceptedUnitCount: z.number().int(),
    /** Claimed seats across accepted units (calendar occupancy bar). */
    filledSeats: z.number().int(),
    /** Total seats across accepted units. */
    totalSeats: z.number().int(),
  })
  .meta({ id: "OperationSummary" });
export type OperationSummary = z.infer<typeof OperationSummarySchema>;

export const OperationListResponseSchema = z
  .object({ operations: z.array(OperationSummarySchema) })
  .meta({ id: "OperationListResponse" });
export type OperationListResponse = z.infer<typeof OperationListResponseSchema>;

export const SeatSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    order: z.number().int(),
    active: z.boolean(),
    claimedBy: z.object({ id: z.string(), username: z.string() }).nullable(),
  })
  .meta({ id: "Seat" });
export type Seat = z.infer<typeof SeatSchema>;

export const FleetUnitSchema = z
  .object({
    id: z.string(),
    unitType: z.string(),
    status: z.string(),
    name: z.string(),
    shipName: z.string().nullable(),
    /** Derived ship class (Fighter/Capital/Transport…) for board grouping; null
     *  for non-ship units. Lets the board split fighters into their own lane. */
    shipClass: z.string().nullable(),
    squadName: z.string().nullable(),
    captain: z.object({ id: z.string(), username: z.string() }).nullable(),
    captainNote: z.string().nullable(),
    carrierUnitId: z.string().nullable(),
    /** Fleet-requirement (Bedarf) this offered unit is bound to, if any. */
    requirementId: z.string().nullable(),
    /** FR-B2: formation (Verband) this ship belongs to, if any. */
    formationId: z.string().nullable(),
    seats: z.array(SeatSchema),
  })
  .meta({ id: "FleetUnit" });
export type FleetUnit = z.infer<typeof FleetUnitSchema>;

export const ResourceLinkSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    url: z.url(),
    kind: z.string(),
    sortOrder: z.number().int(),
  })
  .meta({ id: "ResourceLink" });
export type ResourceLink = z.infer<typeof ResourceLinkSchema>;

export const OperationDetailSchema = OperationSummarySchema.extend({
  description: z.string(),
  /** Optional participant cap (null = no cap). */
  maxParticipants: z.number().int().nullable(),
  guild: z.object({
    id: z.string(),
    name: z.string(),
    iconHash: z.string().nullable(),
    timezone: z.string().nullable(),
    /** Guild's Discord invite URL (server settings); null when unset. */
    discordInviteUrl: z.string().nullable(),
  }),
  leaders: z.array(z.object({ id: z.string(), username: z.string() })),
  units: z.array(FleetUnitSchema),
  resourceLinks: z.array(ResourceLinkSchema),
  /** Q&A thread — askers see answers; operators answer in the console. */
  questions: z.array(
    z.object({
      id: z.string(),
      asker: z.string(),
      body: z.string(),
      answer: z.string().nullable(),
      answeredBy: z.string().nullable(),
    }),
  ),
  /** CQB squads as joinable slot groups — a squad IS a need, so crew can take a
   *  slot directly (like a seat). `members` excludes rejected signups. */
  cqbTeams: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      targetSize: z.number().int().nullable(),
      members: z.array(z.object({ id: z.string(), username: z.string() })),
    }),
  ),
  /** Mission-cover image URL (banner) if generated; null → client uses the
   *  default asset. Visible to all viewers of the op (not operator-gated). */
  coverUrl: z.string().nullable(),
  /** Caller's effective role on this op (null = anonymous public viewer). */
  viewerRole: z.string().nullable(),
  canManage: z.boolean(),
  /** Caller has an active flexible (CQB/personnel) signup. */
  viewerCqbSignedUp: z.boolean(),
  /** Caller shares their hangar with the operators for this op. */
  viewerHangarShared: z.boolean(),
  /** FR SquadLink-CommandNet: op has the SquadLink Lite voice deep-link enabled. */
  squadLinkVoiceEnabled: z.boolean(),
}).meta({ id: "OperationDetail" });
export type OperationDetail = z.infer<typeof OperationDetailSchema>;

// ── Ships ─────────────────────────────────────────────────────────────

export const ShipSearchQuerySchema = z.object({
  q: z.string().max(80).default(""),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const ShipSummarySchema = z
  .object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    manufacturer: z.string(),
    size: z.string(),
    role: z.string(),
    minCrew: z.number().int(),
    maxCrew: z.number().int(),
    /** FR-D1: player's custom name from the CCU import (hangar only; null/absent
     *  in the catalog + search where ships have no owner-given nickname). */
    nickname: z.string().nullable().optional(),
    /** Ship artwork (star-citizen.wiki media); null when the catalog has none. */
    imageUrl: z.string().nullable().optional(),
  })
  .meta({ id: "ShipSummary" });
export type ShipSummary = z.infer<typeof ShipSummarySchema>;

export const ShipSearchResponseSchema = z
  .object({ ships: z.array(ShipSummarySchema) })
  .meta({ id: "ShipSearchResponse" });

// ── Org Fleet (FR-P3) — guild ship roster ─────────────────────────────
// Flat owner×ship rows; the SPA pivots by ship or by member off one dataset.
export const OrgFleetEntrySchema = z
  .object({
    user: z.object({
      id: z.string(),
      username: z.string(),
      /** Discord snowflake (string) + handle for the contact deep link; null when
       *  the member never linked a Discord identity. */
      discordId: z.string().nullable(),
      discordHandle: z.string().nullable(),
    }),
    shipId: z.string(),
    shipName: z.string(),
    manufacturer: z.string(),
    /** Ship size band (Small/Medium/Large/Capital/Vehicle) — used as the class column. */
    shipClass: z.string(),
    /** Owner-given name from the CCU import, if any. */
    nickname: z.string().nullable(),
    /** Hulls of this model the member owns. */
    quantity: z.number().int(),
    /** External source link (Fleetyards) for the model; null if unmatched. */
    sourceUrl: z.string().nullable(),
    /** Locally-cached ship image (lazy-downloaded); null when none available. */
    imageUrl: z.string().nullable(),
  })
  .meta({ id: "OrgFleetEntry" });
export type OrgFleetEntry = z.infer<typeof OrgFleetEntrySchema>;

export const OrgFleetResponseSchema = z
  .object({
    entries: z.array(OrgFleetEntrySchema),
    totals: z.object({
      hulls: z.number().int(),
      models: z.number().int(),
      membersWithHangar: z.number().int(),
    }),
  })
  .meta({ id: "OrgFleetResponse" });
export type OrgFleetResponse = z.infer<typeof OrgFleetResponseSchema>;

// ── Polls / Umfragen (FR-P3) ──────────────────────────────────────────
// Scoped like an Operation: private | partners | public. Single or multiple
// choice; results gated by resultsVisibility.
export const PollVisibilityEnum = z.enum(["private", "partners", "public"]);
export const PollModeEnum = z.enum(["single", "multiple"]);
export const PollStatusEnum = z.enum(["draft", "open", "closed"]);
export const PollResultsVisibilityEnum = z.enum(["always", "after_vote", "after_close"]);

export const PollSummarySchema = z
  .object({
    id: z.string(),
    title: z.string(),
    description: z.string().nullable(),
    visibility: PollVisibilityEnum,
    mode: PollModeEnum,
    maxChoices: z.number().int().nullable(),
    status: PollStatusEnum,
    anonymous: z.boolean(),
    resultsVisibility: PollResultsVisibilityEnum,
    closesAt: z.string().nullable(),
    createdAt: z.string(),
    createdBy: z.object({ id: z.string(), username: z.string() }),
    guild: z.object({ id: z.string(), name: z.string() }),
    optionCount: z.number().int(),
    totalVotes: z.number().int(),
    /** Whether the viewer has already cast at least one vote. */
    viewerHasVoted: z.boolean(),
  })
  .meta({ id: "PollSummary" });
export type PollSummary = z.infer<typeof PollSummarySchema>;

export const PollListResponseSchema = z
  .object({ polls: z.array(PollSummarySchema) })
  .meta({ id: "PollListResponse" });
export type PollListResponse = z.infer<typeof PollListResponseSchema>;

export const PollOptionResultSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    /** Vote count. 0 when results are hidden for this viewer (see showResults). */
    votes: z.number().int(),
  })
  .meta({ id: "PollOptionResult" });
export type PollOptionResult = z.infer<typeof PollOptionResultSchema>;

export const PollDetailSchema = PollSummarySchema.extend({
  allowAddOptions: z.boolean(),
  options: z.array(PollOptionResultSchema),
  /** Whether vote counts in `options` are meaningful for this viewer. */
  showResults: z.boolean(),
  /** Option ids the viewer has voted for. */
  yourOptionIds: z.array(z.string()),
  /** Viewer may vote (in audience, poll open, not the creator's own closed poll). */
  canVote: z.boolean(),
  /** Viewer may close/delete (creator or guild fleet operator / superadmin). */
  canManage: z.boolean(),
}).meta({ id: "PollDetail" });
export type PollDetail = z.infer<typeof PollDetailSchema>;

export const CreatePollRequestSchema = z
  .object({
    guildId: z.string().min(1),
    title: z.string().min(1).max(200),
    description: z.string().max(4000).optional(),
    options: z.array(z.string().min(1).max(200)).min(2).max(30),
    mode: PollModeEnum.default("single"),
    maxChoices: z.coerce.number().int().min(2).max(30).optional(),
    visibility: PollVisibilityEnum.default("private"),
    anonymous: z.boolean().default(false),
    resultsVisibility: PollResultsVisibilityEnum.default("always"),
    allowAddOptions: z.boolean().default(false),
    closesAt: z.iso.datetime().optional(),
    status: z.enum(["draft", "open"]).default("open"),
  })
  .meta({ id: "CreatePollRequest" });
export type CreatePollRequest = z.infer<typeof CreatePollRequestSchema>;

export const CreatePollResponseSchema = z
  .object({ ok: z.literal(true), id: z.string() })
  .meta({ id: "CreatePollResponse" });
export type CreatePollResponse = z.infer<typeof CreatePollResponseSchema>;

export const VotePollRequestSchema = z
  .object({ optionIds: z.array(z.string().min(1)).min(1).max(30) })
  .meta({ id: "VotePollRequest" });
export type VotePollRequest = z.infer<typeof VotePollRequestSchema>;

export const AddPollOptionRequestSchema = z
  .object({ label: z.string().min(1).max(200) })
  .meta({ id: "AddPollOptionRequest" });
export type AddPollOptionRequest = z.infer<typeof AddPollOptionRequestSchema>;

export const ClosePollRequestSchema = z
  .object({ status: z.literal("closed") })
  .meta({ id: "ClosePollRequest" });
export type ClosePollRequest = z.infer<typeof ClosePollRequestSchema>;

// Edit an existing poll (manager). All fields optional → partial update. Option
// edits (labels/add/remove) are only accepted while the poll has no votes.
export const UpdatePollOptionSchema = z
  .object({ id: z.string().optional(), label: z.string().min(1).max(200) })
  .meta({ id: "UpdatePollOption" });
export type UpdatePollOption = z.infer<typeof UpdatePollOptionSchema>;

export const UpdatePollRequestSchema = z
  .object({
    title: z.string().min(1).max(200).optional(),
    description: z.string().max(4000).nullable().optional(),
    status: PollStatusEnum.optional(),
    closesAt: z.iso.datetime().nullable().optional(),
    allowAddOptions: z.boolean().optional(),
    resultsVisibility: PollResultsVisibilityEnum.optional(),
    maxChoices: z.coerce.number().int().min(2).max(30).nullable().optional(),
    options: z.array(UpdatePollOptionSchema).min(2).max(30).optional(),
  })
  .meta({ id: "UpdatePollRequest" });
export type UpdatePollRequest = z.infer<typeof UpdatePollRequestSchema>;

export const CreateOperationRequestSchema = z
  .object({
    guildId: z.string().min(1),
    title: z.string().min(1).max(160),
    opType: z.enum(["combat", "mining", "salvage", "explore", "transport", "training", "social"]).default("combat"),
    description: z.string().max(4000).optional(),
    meetingSystem: z.string().max(80).optional(),
    meetingLocation: z.string().max(160).optional(),
    scheduledAt: z.iso.datetime(),
    minParticipants: z.coerce.number().int().min(0).max(1000).default(0),
    visibility: z.enum(["private", "guild", "partners", "public"]).default("guild"),
  })
  .meta({ id: "CreateOperationRequest" });
export type CreateOperationRequest = z.infer<typeof CreateOperationRequestSchema>;

export const CreateOperationResponseSchema = z
  .object({ ok: z.literal(true), id: z.string() })
  .meta({ id: "CreateOperationResponse" });

export const HangarShipRequestSchema = z
  .object({ shipId: z.string().regex(/^[a-z0-9]{20,32}$/i, "invalid ship id") })
  .meta({ id: "HangarShipRequest" });

export const FleetImportRequestSchema = z
  .object({ fleetJson: z.string().min(1).max(200000) })
  .meta({ id: "FleetImportRequest" });

export const FleetImportResponseSchema = z
  .object({
    ok: z.literal(true),
    total: z.number(),
    added: z.number(),
    already: z.number(),
    unmatched: z.array(z.string()),
  })
  .meta({ id: "FleetImportResponse" });
export type FleetImportResponse = z.infer<typeof FleetImportResponseSchema>;

export const FeedbackRequestSchema = z
  .object({ subject: z.string().min(1).max(120), message: z.string().min(1).max(1800) })
  .meta({ id: "FeedbackRequest" });

export const RoadmapItemSchema = z
  .object({
    title: z.string(),
    status: z.enum(["planned", "blocked", "rejected", "done"]),
    desc: z.string(),
    note: z.string().optional(),
    reason: z.string().optional(),
  })
  .meta({ id: "RoadmapItem" });
export type RoadmapItem = z.infer<typeof RoadmapItemSchema>;

export const RoadmapResponseSchema = z
  .object({ items: z.array(RoadmapItemSchema) })
  .meta({ id: "RoadmapResponse" });

export const TemplateSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    summary: z.string(),
    opType: z.string(),
    visibility: z.string(),
    usageCount: z.number().int(),
    ownerGuildName: z.string(),
  })
  .meta({ id: "TemplateSummary" });
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

export const TemplateListResponseSchema = z
  .object({ templates: z.array(TemplateSummarySchema) })
  .meta({ id: "TemplateListResponse" });

export const ApplyTemplateRequestSchema = z
  .object({
    guildId: z.string().min(1),
    scheduledAt: z.iso.datetime(),
    title: z.string().max(160).optional(),
  })
  .meta({ id: "ApplyTemplateRequest" });

// ── Query schemas ─────────────────────────────────────────────────────

export const OperationListQuerySchema = z.object({
  /** Include ops older than the 3h grace cutoff. */
  past: z.coerce.boolean().default(false),
});

/** Prisma cuid ids — length-bounded, no exotic characters (FR-P2 §Validation). */
export const IdParamSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{20,32}$/i, "invalid id format"),
});

export const SeatParamSchema = z.object({
  id: z.string().regex(/^[a-z0-9]{20,32}$/i, "invalid id format"),
  seatId: z.string().regex(/^[a-z0-9]{20,32}$/i, "invalid id format"),
});

// ── Mutations (Phase 5, slice 1) ──────────────────────────────────────

export const MutationOkSchema = z
  .object({ ok: z.literal(true) })
  .meta({ id: "MutationOk" });
export type MutationOk = z.infer<typeof MutationOkSchema>;

export const ClaimSeatResponseSchema = z
  .object({ ok: z.literal(true), seatId: z.string() })
  .meta({ id: "ClaimSeatResponse" });
export type ClaimSeatResponse = z.infer<typeof ClaimSeatResponseSchema>;

export const CqbSignupRequestSchema = z
  .object({
    note: z.string().max(280).optional(),
    /** Join a specific CQB squad directly (self-service slot); omit = flex pool. */
    groupId: z.string().regex(/^[a-z0-9]{20,32}$/i).optional(),
  })
  .meta({ id: "CqbSignupRequest" });

export const HangarShareRequestSchema = z
  .object({ allow: z.boolean(), note: z.string().max(280).optional() })
  .meta({ id: "HangarShareRequest" });

const cuid = z.string().regex(/^[a-z0-9]{20,32}$/i);

/** A user id is EITHER a Prisma cuid (new accounts) OR a legacy Discord snowflake
 *  (17–20 digits) — early/seeded User rows use the Discord id as their primary key.
 *  The strict `cuid` (≥20 chars) rejected snowflakes, so assigning/promoting those
 *  users 400'd. The DB lookup stays the real guard; this just allows both shapes. */
const userIdLike = z.string().regex(/^([a-z0-9]{20,32}|\d{17,20})$/i, "invalid user id");

export const RegisterUnitRequestSchema = z
  .object({
    unitType: z.enum(["ship", "squad", "vehicle"]),
    /** Catalog ship id (ship/vehicle units). */
    shipId: cuid.optional(),
    /** Alternative: pick from the user's hangar. */
    ownedShipId: cuid.optional(),
    /** Persist the picked catalog ship into the user's hangar. */
    storeOwnedShip: z.boolean().optional(),
    squadName: z.string().min(1).max(80).optional(),
    squadSize: z.number().int().min(2).max(8).optional(),
    requirementId: cuid.optional(),
    captainNote: z.string().max(280).optional(),
    carrierUnitId: cuid.optional(),
  })
  .meta({ id: "RegisterUnitRequest" });

export const RegisterUnitResponseSchema = z
  .object({ ok: z.literal(true), unitId: z.string() })
  .meta({ id: "RegisterUnitResponse" });

/** PATCH subset — full ship-swap/seat-rebuild editing stays on the SSR flow
 *  until the FE reaches parity (documented in fleetplanner-v1.md). */
export const PatchUnitRequestSchema = z
  .object({
    captainNote: z.string().max(280).nullable().optional(),
    squadName: z.string().min(1).max(80).optional(),
    /** Rebind the unit to a different Fleet Requirement (Bedarf); null detaches. */
    requirementId: cuid.nullable().optional(),
  })
  .meta({ id: "PatchUnitRequest" });

export const ResourceLinkRequestSchema = z
  .object({
    url: z.string().max(500),
    title: z.string().max(120).optional(),
    kind: z.string().max(20).optional(),
  })
  .meta({ id: "ResourceLinkRequest" });

export const ResourceLinkResponseSchema = z
  .object({ ok: z.literal(true), link: ResourceLinkSchema })
  .meta({ id: "ResourceLinkResponse" });

export const UnitParamSchema = z.object({ id: cuid, unitId: cuid });
export const LinkParamSchema = z.object({ id: cuid, linkId: cuid });
export const QuestionParamSchema = z.object({ id: cuid, qid: cuid });
export const LeaderParamSchema = z.object({ id: cuid, userId: userIdLike });
export const HangarShipParamSchema = z.object({ shipId: cuid });

// ── Operator (read model + mutations) ─────────────────────────────────

export const OperatorViewSchema = z
  .object({
    crewRequests: z.array(
      z.object({
        userId: z.string(),
        username: z.string(),
        note: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
    questions: z.array(
      z.object({
        id: z.string(),
        asker: z.string(),
        body: z.string(),
        answer: z.string().nullable(),
        answeredBy: z.string().nullable(),
        createdAt: z.iso.datetime(),
      }),
    ),
    hangarShares: z.array(
      z.object({
        userId: z.string(),
        username: z.string(),
        note: z.string().nullable(),
        ships: z.array(z.object({ id: z.string(), name: z.string(), nickname: z.string().nullable() })),
      }),
    ),
    auditLogs: z.array(
      z.object({
        actor: z.string(),
        action: z.string(),
        detail: z.string(),
        createdAt: z.iso.datetime(),
      }),
    ),
    /** Fleet requirements (Bedarfe) an offered unit can be bound to — used by the
     *  accept dropdown + the rebind control. `filled` excludes rejected units. */
    requirements: z.array(
      z.object({
        id: z.string(),
        label: z.string(),
        needType: z.string(),
        category: z.string(),
        count: z.number().int(),
        filled: z.number().int(),
      }),
    ),
    /** FR-E1: Discord "Interested" RSVPs. `userId` null = shadow (no app account
     *  yet → not directly assignable; counts toward the "unknown" metric). */
    eventInterests: z.array(
      z.object({
        id: z.string(),
        displayName: z.string(),
        userId: z.string().nullable(),
        seated: z.boolean(),
      }),
    ),
    /** FR-B5: CQB teams (materialized squad groups) + the soldier pool. The
     *  operator places each soldier into a team via assignedGroupId. */
    cqbTeams: z.array(
      z.object({
        id: z.string(),
        name: z.string(),
        targetSize: z.number().int().nullable(),
        /** FR-B3: carrier ship this team rides in, if any. */
        carrierUnitId: z.string().nullable(),
      }),
    ),
    cqbSoldiers: z.array(
      z.object({
        id: z.string(),
        username: z.string(),
        assignedGroupId: z.string().nullable(),
        note: z.string().nullable(),
      }),
    ),
    /** FR-B2: operator formations (Verbände) — ships group into these. */
    formations: z.array(z.object({ id: z.string(), name: z.string() })),
  })
  .meta({ id: "OperatorView" });

/** FR-B5: operator places/moves a CQB soldier into a team (null = unassign). */
export const AssignCqbRequestSchema = z
  .object({ groupId: cuid.nullable() })
  .meta({ id: "AssignCqbRequest" });

/** FR-B2: create a formation. */
export const FormationRequestSchema = z
  .object({ name: z.string().min(1).max(80) })
  .meta({ id: "FormationRequest" });

/** FR-B2: assign/detach a ship to a formation (null = detach). */
export const AssignFormationRequestSchema = z
  .object({ formationId: cuid.nullable() })
  .meta({ id: "AssignFormationRequest" });

/** FR-B4: load a vehicle into a carrier ship (null = detach / standalone). */
export const AssignCarrierRequestSchema = z
  .object({ carrierUnitId: cuid.nullable() })
  .meta({ id: "AssignCarrierRequest" });

/** FR-C2: post an op announcement to a Discord text channel (snowflake id). */
export const AnnounceRequestSchema = z
  .object({ channelId: z.string().regex(/^\d{16,25}$/) })
  .meta({ id: "AnnounceRequest" });
export type OperatorView = z.infer<typeof OperatorViewSchema>;

export const UnitDecisionRequestSchema = z
  .object({ note: z.string().max(280).optional(), requirementId: cuid.optional() })
  .meta({ id: "UnitDecisionRequest" });

export const AssignSeatRequestSchema = z
  .object({ userId: userIdLike })
  .meta({ id: "AssignSeatRequest" });

export const AnswerQuestionRequestSchema = z
  .object({ answer: z.string().min(1).max(1000) })
  .meta({ id: "AnswerQuestionRequest" });

// ── Guild settings (admiral console) ────────────────────────────────────

export const GuildSettingsMemberSchema = z
  .object({
    userId: z.string(),
    username: z.string(),
    role: z.enum(["fleetoperator", "crew"]),
    isOwner: z.boolean(),
  })
  .meta({ id: "GuildSettingsMember" });
export type GuildSettingsMember = z.infer<typeof GuildSettingsMemberSchema>;

export const GuildSettingsSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    orgName: z.string().nullable(),
    timezone: z.string(),
    discordInviteUrl: z.string().nullable(),
    admiralRoleId: z.string().nullable(),
    ownerUserId: z.string().nullable(),
    canRemove: z.boolean(),
  })
  .meta({ id: "GuildSettings" });
export type GuildSettings = z.infer<typeof GuildSettingsSchema>;

export const GuildSettingsResponseSchema = z
  .object({
    guild: GuildSettingsSchema,
    members: z.array(GuildSettingsMemberSchema),
  })
  .meta({ id: "GuildSettingsResponse" });
export type GuildSettingsResponse = z.infer<typeof GuildSettingsResponseSchema>;

/** PATCH body — all fields optional; omitted fields are left unchanged. An
 *  explicit null clears orgName/discordInviteUrl/admiralRoleId. */
export const UpdateGuildSettingsRequestSchema = z
  .object({
    orgName: z.string().max(80).nullable().optional(),
    timezone: z.string().optional(),
    discordInviteUrl: z.string().nullable().optional(),
    admiralRoleId: z.string().nullable().optional(),
  })
  .meta({ id: "UpdateGuildSettingsRequest" });
export type UpdateGuildSettingsRequest = z.infer<typeof UpdateGuildSettingsRequestSchema>;

export const SetMemberRoleRequestSchema = z
  .object({ role: z.enum(["fleetoperator", "crew"]) })
  .meta({ id: "SetMemberRoleRequest" });
export type SetMemberRoleRequest = z.infer<typeof SetMemberRoleRequestSchema>;

// ── Superadmin: instance guild management ───────────────────────────────

export const AdminGuildSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    active: z.boolean(),
    bannedAt: z.iso.datetime().nullable(),
    ownerUserId: z.string().nullable(),
    memberCount: z.number(),
  })
  .meta({ id: "AdminGuild" });
export type AdminGuild = z.infer<typeof AdminGuildSchema>;

export const AdminGuildsResponseSchema = z
  .object({ guilds: z.array(AdminGuildSchema) })
  .meta({ id: "AdminGuildsResponse" });
export type AdminGuildsResponse = z.infer<typeof AdminGuildsResponseSchema>;

export const AdminUserGuildSchema = z
  .object({ name: z.string(), role: z.string() })
  .meta({ id: "AdminUserGuild" });

export const AdminUserSchema = z
  .object({
    id: z.string(),
    username: z.string(),
    role: z.enum(["superadmin", "fleetoperator", "crew"]),
    active: z.boolean(),
    discordId: z.string().nullable(),
    discordName: z.string().nullable(),
    guilds: z.array(AdminUserGuildSchema),
    lastSeen: z.iso.datetime(),
  })
  .meta({ id: "AdminUser" });
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminUsersResponseSchema = z
  .object({ users: z.array(AdminUserSchema) })
  .meta({ id: "AdminUsersResponse" });
export type AdminUsersResponse = z.infer<typeof AdminUsersResponseSchema>;

export const SetUserRoleRequestSchema = z
  .object({ role: z.enum(["superadmin", "fleetoperator", "crew"]) })
  .meta({ id: "SetUserRoleRequest" });

export const CatalogStateSchema = z
  .object({
    count: z.number(),
    lastRun: z.iso.datetime().nullable(),
    intervalDays: z.number(),
    running: z.boolean(),
  })
  .meta({ id: "CatalogState" });

export const AdminSettingsResponseSchema = z
  .object({
    maintenanceOn: z.boolean(),
    maintenanceForcedByEnv: z.boolean(),
    feedbackChannelId: z.string(),
    shipCatalog: CatalogStateSchema,
    locationCatalog: CatalogStateSchema,
    operationCount: z.number(),
  })
  .meta({ id: "AdminSettingsResponse" });
export type AdminSettingsResponse = z.infer<typeof AdminSettingsResponseSchema>;

// ── Admin "System & Logs" panel (superadmin observability) ────────────
export const HealthStatusSchema = z.enum(["ok", "warn", "error", "down"]);

export const ServiceHealthSchema = z
  .object({
    key: z.string(),
    name: z.string(),
    status: HealthStatusSchema,
    detail: z.string(),
  })
  .meta({ id: "ServiceHealth" });
export type ServiceHealth = z.infer<typeof ServiceHealthSchema>;

export const SyncHealthSchema = z
  .object({
    key: z.enum(["ship", "location"]),
    name: z.string(),
    enabled: z.boolean(),
    running: z.boolean(),
    /** running flag set but untouched past the stale threshold → stuck. */
    stale: z.boolean(),
    lastRun: z.iso.datetime().nullable(),
    lastResult: z.string().nullable(),
    intervalDays: z.number().int(),
    count: z.number().int(),
    status: HealthStatusSchema,
  })
  .meta({ id: "SyncHealth" });
export type SyncHealth = z.infer<typeof SyncHealthSchema>;

export const OperationsMetricSchema = z
  .object({
    total: z.number().int(),
    private: z.number().int(),
    partners: z.number().int(),
    public: z.number().int(),
  })
  .meta({ id: "OperationsMetric" });
export type OperationsMetric = z.infer<typeof OperationsMetricSchema>;

export const SystemHealthResponseSchema = z
  .object({
    checkedAt: z.iso.datetime(),
    services: z.array(ServiceHealthSchema),
    syncs: z.array(SyncHealthSchema),
    operations: OperationsMetricSchema,
  })
  .meta({ id: "SystemHealthResponse" });
export type SystemHealthResponse = z.infer<typeof SystemHealthResponseSchema>;

export const SystemEventSchema = z
  .object({
    id: z.string(),
    ts: z.iso.datetime(),
    level: z.enum(["info", "warn", "error"]),
    category: z.string(),
    message: z.string(),
    detail: z.string(),
  })
  .meta({ id: "SystemEvent" });
export type SystemEvent = z.infer<typeof SystemEventSchema>;

export const SystemEventsResponseSchema = z
  .object({
    events: z.array(SystemEventSchema),
    retentionDays: z.number().int(),
  })
  .meta({ id: "SystemEventsResponse" });
export type SystemEventsResponse = z.infer<typeof SystemEventsResponseSchema>;

export const MaintenanceRequestSchema = z
  .object({ enabled: z.boolean() })
  .meta({ id: "MaintenanceRequest" });

export const FeedbackChannelRequestSchema = z
  .object({ channelId: z.string().max(40) })
  .meta({ id: "FeedbackChannelRequest" });

export const CatalogConfigRequestSchema = z
  .object({
    intervalDays: z.coerce.number().int().min(1).max(90),
    enabled: z.boolean().optional(),
  })
  .meta({ id: "CatalogConfigRequest" });

// ── Operation editor (lifecycle) ────────────────────────────────────────

/** PATCH /api/v1/operations/:id — every field optional; only present fields
 *  are updated. Mirrors the SSR /ops/:id/edit + /ops/:id/visibility forms. */
export const EditOperationRequestSchema = z
  .object({
    title: z.string().min(1).max(160).optional(),
    description: z.string().max(4000).optional(),
    opType: z.enum(["combat", "mining", "salvage", "explore", "transport", "training", "social"]).optional(),
    meetingSystem: z.string().max(80).optional(),
    meetingLocation: z.string().max(160).optional(),
    scheduledAt: z.iso.datetime().optional(),
    visibility: z.enum(["private", "guild", "partners", "public"]).optional(),
    maxParticipants: z.number().int().min(0).max(10000).nullable().optional(),
    /** FR SquadLink-CommandNet: offer commanders the SquadLink Lite voice deep-link. */
    squadLinkVoiceEnabled: z.boolean().optional(),
  })
  .meta({ id: "EditOperationRequest" });
export type EditOperationRequest = z.infer<typeof EditOperationRequestSchema>;

export const OP_STATUSES = ["draft", "open", "locked", "starting", "in_progress", "completed", "cancelled"] as const;

export const SetStatusRequestSchema = z
  .object({ status: z.enum(OP_STATUSES) })
  .meta({ id: "SetStatusRequest" });
export type SetStatusRequest = z.infer<typeof SetStatusRequestSchema>;

// ── Operation editor: Bedarfe / needs ───────────────────────────────────

export const ShipTypeOptionSchema = z
  .object({ slug: z.string(), label: z.string() })
  .meta({ id: "ShipTypeOption" });

export const ShipNeedSchema = z
  .object({
    id: z.string(),
    shipType: z.string(),
    label: z.string(),
    note: z.string().nullable(),
  })
  .meta({ id: "ShipNeed" });
export type ShipNeed = z.infer<typeof ShipNeedSchema>;

export const NeedsResponseSchema = z
  .object({
    shipTypes: z.array(ShipTypeOptionSchema),
    cqbTeamMax: z.number(),
    cqbTeamDefault: z.number(),
    fighterSquadSize: z.number(),
    shipNeeds: z.array(ShipNeedSchema),
    fighterSquads: z.number(),
    cqbTeams: z.object({ count: z.number(), size: z.number() }),
    /** All requirements (ship + fighter_squad + cqb_team) so a player can offer a
     *  unit for a specific need — e.g. a fighter for the fighter-squad need. */
    requirements: z.array(z.object({
      id: z.string(),
      label: z.string(),
      needType: z.string(),
      category: z.string(),
    })),
  })
  .meta({ id: "NeedsResponse" });
export type NeedsResponse = z.infer<typeof NeedsResponseSchema>;

export const AddShipNeedsRequestSchema = z
  .object({
    shipTypes: z.array(z.string()).min(1).max(20),
    name: z.string().max(80).optional(),
    note: z.string().max(280).optional(),
  })
  .meta({ id: "AddShipNeedsRequest" });
export type AddShipNeedsRequest = z.infer<typeof AddShipNeedsRequestSchema>;

export const RenameNeedRequestSchema = z
  .object({ name: z.string().max(80) })
  .meta({ id: "RenameNeedRequest" });

export const SetFighterSquadsRequestSchema = z
  .object({ count: z.coerce.number().int().min(0).max(50) })
  .meta({ id: "SetFighterSquadsRequest" });

export const SetCqbTeamsRequestSchema = z
  .object({
    count: z.coerce.number().int().min(0).max(50),
    size: z.coerce.number().int().min(1).max(8).default(4),
  })
  .meta({ id: "SetCqbTeamsRequest" });

export const NeedParamSchema = z.object({ id: cuid, reqId: cuid });

// ── Operation editor: publish-as-template + recurrence ──────────────────

export const PublishTemplateRequestSchema = z
  .object({
    name: z.string().max(120).optional(),
    summary: z.string().max(500).optional(),
    visibility: z.enum(["guild", "partners", "public"]).default("guild"),
  })
  .meta({ id: "PublishTemplateRequest" });
export type PublishTemplateRequest = z.infer<typeof PublishTemplateRequestSchema>;

export const SetRecurrenceRequestSchema = z
  .object({
    freq: z.enum(["weekly", "biweekly", "monthly_nth", "yearly"]),
    seriesCount: z.coerce.number().int().min(1).max(365).optional(),
    seriesEnd: z.iso.datetime().optional(),
  })
  .meta({ id: "SetRecurrenceRequest" });
export type SetRecurrenceRequest = z.infer<typeof SetRecurrenceRequestSchema>;

// ── Guild partnerships ──────────────────────────────────────────────────

export const PartnershipSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    status: z.string(),
    partnerGuildId: z.string().nullable(),
    partnerGuildName: z.string().nullable(),
    isInitiator: z.boolean(),
    activatedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    autoShare: z.boolean(),
  })
  .meta({ id: "Partnership" });
export type Partnership = z.infer<typeof PartnershipSchema>;

export const IncomingDistributionSchema = z
  .object({
    id: z.string(),
    opId: z.string(),
    opTitle: z.string(),
    scheduledAt: z.iso.datetime(),
    meetingSystem: z.string().nullable(),
    meetingLocation: z.string().nullable(),
    hostGuildName: z.string(),
    hostOrgName: z.string().nullable(),
  })
  .meta({ id: "IncomingDistribution" });
export type IncomingDistribution = z.infer<typeof IncomingDistributionSchema>;

export const PartnershipsResponseSchema = z
  .object({
    partnerships: z.array(PartnershipSchema),
    incoming: z.array(IncomingDistributionSchema),
  })
  .meta({ id: "PartnershipsResponse" });
export type PartnershipsResponse = z.infer<typeof PartnershipsResponseSchema>;

export const MintInviteRequestSchema = z
  .object({ label: z.string().min(1).max(80) })
  .meta({ id: "MintInviteRequest" });

export const MintInviteResponseSchema = z
  .object({ ok: z.literal(true), token: z.string(), label: z.string() })
  .meta({ id: "MintInviteResponse" });

export const AcceptTokenRequestSchema = z
  .object({ token: z.string().min(1).max(200) })
  .meta({ id: "AcceptTokenRequest" });

export const SetAutoShareRequestSchema = z
  .object({ autoShare: z.boolean() })
  .meta({ id: "SetAutoShareRequest" });

export const GuildIdParamSchema = z.object({ id: z.string().regex(/^\d{16,25}$/) });
export const GuildMemberParamSchema = z.object({
  id: z.string().regex(/^\d{16,25}$/),
  userId: userIdLike,
});

// ── OpenAPI helper ────────────────────────────────────────────────────
// Kept here so all zod usage (incl. JSON-Schema emission) stays in this
// package and the backend never needs to pin a second zod version.
export function toOpenApiJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const js = z.toJSONSchema(schema, {
    target: "draft-2020-12",
    reused: "inline",
    io: "output",
  }) as Record<string, unknown>;
  return js;
}
