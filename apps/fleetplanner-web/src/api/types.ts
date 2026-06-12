// API v1 response types — re-exported (type-only) from the shared contract
// package @rdoc-suite/fleetplanner-contracts, the single source of truth for
// both the backend and this SPA. Type-only, so zod is never bundled here.
export type {
  ApiError as ApiErrorBody,
  SessionUser,
  SessionResponse,
  OperationSummary,
  Seat,
  FleetUnit,
  ResourceLink,
  OperationDetail,
  ShipSummary,
  OperatorView,
  TemplateSummary,
  RoadmapItem,
  GuildSettings,
  GuildSettingsMember,
  GuildSettingsResponse,
  NeedsResponse,
  ShipNeed,
  Partnership,
  IncomingDistribution,
  PartnershipsResponse,
  FleetImportResponse,
} from "@rdoc-suite/fleetplanner-contracts";

// The error code union is referenced directly by the client; mirror it from
// the ApiError contract shape.
export type ApiErrorCode = import("@rdoc-suite/fleetplanner-contracts").ApiError["error"]["code"];
