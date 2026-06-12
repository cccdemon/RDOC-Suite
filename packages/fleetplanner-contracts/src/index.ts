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
    squadName: z.string().nullable(),
    captain: z.object({ id: z.string(), username: z.string() }).nullable(),
    captainNote: z.string().nullable(),
    carrierUnitId: z.string().nullable(),
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
  guild: z.object({
    id: z.string(),
    name: z.string(),
    iconHash: z.string().nullable(),
    timezone: z.string().nullable(),
  }),
  leaders: z.array(z.object({ id: z.string(), username: z.string() })),
  units: z.array(FleetUnitSchema),
  resourceLinks: z.array(ResourceLinkSchema),
  /** Caller's effective role on this op (null = anonymous public viewer). */
  viewerRole: z.string().nullable(),
  canManage: z.boolean(),
  /** Caller has an active flexible (CQB/personnel) signup. */
  viewerCqbSignedUp: z.boolean(),
  /** Caller shares their hangar with the operators for this op. */
  viewerHangarShared: z.boolean(),
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
  })
  .meta({ id: "ShipSummary" });
export type ShipSummary = z.infer<typeof ShipSummarySchema>;

export const ShipSearchResponseSchema = z
  .object({ ships: z.array(ShipSummarySchema) })
  .meta({ id: "ShipSearchResponse" });

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
  .object({ note: z.string().max(280).optional() })
  .meta({ id: "CqbSignupRequest" });

export const HangarShareRequestSchema = z
  .object({ allow: z.boolean(), note: z.string().max(280).optional() })
  .meta({ id: "HangarShareRequest" });

const cuid = z.string().regex(/^[a-z0-9]{20,32}$/i);

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
export const LeaderParamSchema = z.object({ id: cuid, userId: cuid });
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
  })
  .meta({ id: "OperatorView" });
export type OperatorView = z.infer<typeof OperatorViewSchema>;

export const UnitDecisionRequestSchema = z
  .object({ note: z.string().max(280).optional(), requirementId: cuid.optional() })
  .meta({ id: "UnitDecisionRequest" });

export const AssignSeatRequestSchema = z
  .object({ userId: cuid })
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
  })
  .meta({ id: "EditOperationRequest" });
export type EditOperationRequest = z.infer<typeof EditOperationRequestSchema>;

export const OP_STATUSES = ["draft", "open", "locked", "starting", "in_progress", "completed", "cancelled"] as const;

export const SetStatusRequestSchema = z
  .object({ status: z.enum(OP_STATUSES) })
  .meta({ id: "SetStatusRequest" });
export type SetStatusRequest = z.infer<typeof SetStatusRequestSchema>;

export const GuildIdParamSchema = z.object({ id: z.string().regex(/^\d{16,25}$/) });
export const GuildMemberParamSchema = z.object({
  id: z.string().regex(/^\d{16,25}$/),
  userId: cuid,
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
