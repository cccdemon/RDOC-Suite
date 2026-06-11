// FR-P2 Phase 1 — API v1 contracts.
//
// Single source of truth for every /api/v1 request/response shape. Routes
// validate against these schemas and the OpenAPI document is generated from
// them (src/api/openapi.ts), so the published contract can never drift from
// the runtime behavior.
//
// Uses the zod v4 API (shipped inside the installed zod 3.25.x package as the
// "zod/v4" subpath) because it provides z.toJSONSchema() for OpenAPI output
// without adding a dependency.
import { z } from "zod/v4";

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
