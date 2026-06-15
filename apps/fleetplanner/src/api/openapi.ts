// FR-P2 Phase 1 — OpenAPI 3.1 document generated from the zod contracts.
//
// No extra dependency: zod v4's z.toJSONSchema() emits JSON Schema 2020-12,
// which OpenAPI 3.1 consumes natively. The document is built once at module
// load and served by GET /api/v1/openapi.json.
//
// Security note (FR-P2 §API Docs): no secrets, no example tokens, no internal
// URLs. The only security scheme is the browser cookie session.
import { toOpenApiJsonSchema } from "@rdoc-suite/fleetplanner-contracts";
import {
  AnswerQuestionRequestSchema,
  ApiErrorSchema,
  AssignSeatRequestSchema,
  ApplyTemplateRequestSchema,
  CreateOperationRequestSchema,
  CreateOperationResponseSchema,
  FleetImportRequestSchema,
  FleetImportResponseSchema,
  EditOperationRequestSchema,
  SetStatusRequestSchema,
  AddShipNeedsRequestSchema,
  PublishTemplateRequestSchema,
  PartnershipsResponseSchema,
  AdminGuildsResponseSchema,
  AdminUsersResponseSchema,
  SetUserRoleRequestSchema,
  AdminSettingsResponseSchema,
  MaintenanceRequestSchema,
  FeedbackChannelRequestSchema,
  CatalogConfigRequestSchema,
  MintInviteRequestSchema,
  MintInviteResponseSchema,
  AcceptTokenRequestSchema,
  SetAutoShareRequestSchema,
  SetRecurrenceRequestSchema,
  NeedsResponseSchema,
  RenameNeedRequestSchema,
  SetCqbTeamsRequestSchema,
  SetFighterSquadsRequestSchema,
  FeedbackRequestSchema,
  HangarShipRequestSchema,
  OperatorViewSchema,
  RoadmapResponseSchema,
  TemplateListResponseSchema,
  UnitDecisionRequestSchema,
  ClaimSeatResponseSchema,
  CqbSignupRequestSchema,
  GuildListResponseSchema,
  AccountResponseSchema,
  DiagnosticsResponseSchema,
  GuildSettingsResponseSchema,
  SetMemberRoleRequestSchema,
  UpdateGuildSettingsRequestSchema,
  HangarShareRequestSchema,
  HealthResponseSchema,
  MutationOkSchema,
  OperationDetailSchema,
  OperationListResponseSchema,
  PatchUnitRequestSchema,
  RegisterUnitRequestSchema,
  RegisterUnitResponseSchema,
  ResourceLinkRequestSchema,
  ResourceLinkResponseSchema,
  SessionResponseSchema,
  ShipSearchResponseSchema,
  OrgFleetResponseSchema,
  AssignCqbRequestSchema,
  FormationRequestSchema,
  AssignFormationRequestSchema,
  AssignCarrierRequestSchema,
  AnnounceRequestSchema,
  PollSummarySchema,
  PollOptionResultSchema,
  PollListResponseSchema,
  PollDetailSchema,
  CreatePollRequestSchema,
  CreatePollResponseSchema,
  UpdatePollRequestSchema,
  VotePollRequestSchema,
  AddPollOptionRequestSchema,
} from "./contracts/index.js";

type JsonObject = Record<string, unknown>;

const SCHEMAS = {
  ApiError: ApiErrorSchema,
  HealthResponse: HealthResponseSchema,
  SessionResponse: SessionResponseSchema,
  GuildListResponse: GuildListResponseSchema,
  AccountResponse: AccountResponseSchema,
  DiagnosticsResponse: DiagnosticsResponseSchema,
  GuildSettingsResponse: GuildSettingsResponseSchema,
  UpdateGuildSettingsRequest: UpdateGuildSettingsRequestSchema,
  SetMemberRoleRequest: SetMemberRoleRequestSchema,
  OperationListResponse: OperationListResponseSchema,
  OperationDetail: OperationDetailSchema,
  ShipSearchResponse: ShipSearchResponseSchema,
  MutationOk: MutationOkSchema,
  ClaimSeatResponse: ClaimSeatResponseSchema,
  CqbSignupRequest: CqbSignupRequestSchema,
  HangarShareRequest: HangarShareRequestSchema,
  RegisterUnitRequest: RegisterUnitRequestSchema,
  RegisterUnitResponse: RegisterUnitResponseSchema,
  PatchUnitRequest: PatchUnitRequestSchema,
  ResourceLinkRequest: ResourceLinkRequestSchema,
  ResourceLinkResponse: ResourceLinkResponseSchema,
  OperatorView: OperatorViewSchema,
  UnitDecisionRequest: UnitDecisionRequestSchema,
  AssignSeatRequest: AssignSeatRequestSchema,
  AnswerQuestionRequest: AnswerQuestionRequestSchema,
  CreateOperationRequest: CreateOperationRequestSchema,
  CreateOperationResponse: CreateOperationResponseSchema,
  EditOperationRequest: EditOperationRequestSchema,
  SetStatusRequest: SetStatusRequestSchema,
  NeedsResponse: NeedsResponseSchema,
  PublishTemplateRequest: PublishTemplateRequestSchema,
  PartnershipsResponse: PartnershipsResponseSchema,
  AdminGuildsResponse: AdminGuildsResponseSchema,
  AdminUsersResponse: AdminUsersResponseSchema,
  SetUserRoleRequest: SetUserRoleRequestSchema,
  AdminSettingsResponse: AdminSettingsResponseSchema,
  MaintenanceRequest: MaintenanceRequestSchema,
  FeedbackChannelRequest: FeedbackChannelRequestSchema,
  CatalogConfigRequest: CatalogConfigRequestSchema,
  MintInviteRequest: MintInviteRequestSchema,
  MintInviteResponse: MintInviteResponseSchema,
  AcceptTokenRequest: AcceptTokenRequestSchema,
  SetAutoShareRequest: SetAutoShareRequestSchema,
  SetRecurrenceRequest: SetRecurrenceRequestSchema,
  AddShipNeedsRequest: AddShipNeedsRequestSchema,
  RenameNeedRequest: RenameNeedRequestSchema,
  SetFighterSquadsRequest: SetFighterSquadsRequestSchema,
  SetCqbTeamsRequest: SetCqbTeamsRequestSchema,
  HangarShipRequest: HangarShipRequestSchema,
  FleetImportRequest: FleetImportRequestSchema,
  FleetImportResponse: FleetImportResponseSchema,
  FeedbackRequest: FeedbackRequestSchema,
  TemplateListResponse: TemplateListResponseSchema,
  ApplyTemplateRequest: ApplyTemplateRequestSchema,
  RoadmapResponse: RoadmapResponseSchema,
  OrgFleetResponse: OrgFleetResponseSchema,
  AssignCqbRequest: AssignCqbRequestSchema,
  FormationRequest: FormationRequestSchema,
  AssignFormationRequest: AssignFormationRequestSchema,
  AssignCarrierRequest: AssignCarrierRequestSchema,
  AnnounceRequest: AnnounceRequestSchema,
  PollSummary: PollSummarySchema,
  PollOptionResult: PollOptionResultSchema,
  PollListResponse: PollListResponseSchema,
  PollDetail: PollDetailSchema,
  CreatePollRequest: CreatePollRequestSchema,
  CreatePollResponse: CreatePollResponseSchema,
  UpdatePollRequest: UpdatePollRequestSchema,
  VotePollRequest: VotePollRequestSchema,
  AddPollOptionRequest: AddPollOptionRequestSchema,
} as const;

function ref(name: keyof typeof SCHEMAS): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schema: JsonObject): JsonObject {
  return { content: { "application/json": { schema } } };
}

// Mission-cover endpoints are hand-described (no zod contract). A stored cover
// pointer …
const coverSchema: JsonObject = {
  type: "object",
  required: ["url", "width", "height", "preset", "format", "updatedAt"],
  properties: {
    url: { type: "string" },
    width: { type: "integer" },
    height: { type: "integer" },
    preset: { type: "string" },
    format: { type: "string" },
    updatedAt: { type: "string", format: "date-time" },
  },
};
// nullable cover (OpenAPI 3.1: union with null).
const coverOrNull: JsonObject = { oneOf: [coverSchema, { type: "null" }] };
// … and the optional format/preset selection body shared by generate + edit-link.
const coverSelectionSchema: JsonObject = {
  type: "object",
  properties: {
    format: { type: "string", enum: ["16:9", "1:1", "9:16", "4:3"] },
    preset: { type: "string", enum: ["fleet-ops", "black-ops", "exploration", "outlaw"] },
  },
};

const errorResponses: Record<string, JsonObject> = {
  "400": { description: "Validation error", ...jsonContent(ref("ApiError")) },
  "401": { description: "Unauthenticated", ...jsonContent(ref("ApiError")) },
  "403": { description: "Forbidden", ...jsonContent(ref("ApiError")) },
  "404": { description: "Not found", ...jsonContent(ref("ApiError")) },
};

function buildComponentSchemas(): JsonObject {
  const out: JsonObject = {};
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const js = toOpenApiJsonSchema(schema) as JsonObject;
    delete js.$schema;
    delete js.id;
    // zod emits sub-schemas that carry a .meta({id}) (SessionUser, Seat, …)
    // as local $defs with $ref:"#/$defs/X". Swagger UI resolves $refs against
    // the DOCUMENT root, so those break. Hoist every $def into
    // components/schemas instead; the $refs are rewritten below.
    const defs = js.$defs as Record<string, JsonObject> | undefined;
    if (defs) {
      for (const [defName, defSchema] of Object.entries(defs)) {
        delete (defSchema as JsonObject).id;
        out[defName] ??= defSchema;
      }
      delete js.$defs;
    }
    out[name] = js;
  }
  // Rewrite all local $defs references to the hoisted component location.
  return JSON.parse(
    JSON.stringify(out).replaceAll('"#/$defs/', '"#/components/schemas/'),
  ) as JsonObject;
}

export function buildOpenApiDocument(): JsonObject {
  return {
    openapi: "3.1.0",
    info: {
      title: "RDOC Fleetplanner API",
      version: "1.0.0",
      description:
        "Read API for the RDOC-Suite Fleetplanner (FR-P2 strangler slice). " +
        "Browser clients authenticate with the same-origin HttpOnly session cookie; " +
        "anonymous access is limited to public data.",
    },
    servers: [{ url: "/fleetplanner", description: "Suite base path" }],
    components: {
      securitySchemes: {
        cookieSession: {
          type: "apiKey",
          in: "cookie",
          name: "fp_sid",
          description: "HttpOnly browser session cookie set by the OAuth login flow.",
        },
      },
      schemas: buildComponentSchemas(),
    },
    paths: {
      "/api/v1/health": {
        get: {
          operationId: "getHealth",
          summary: "API health probe",
          tags: ["meta"],
          responses: { "200": { description: "OK", ...jsonContent(ref("HealthResponse")) } },
        },
      },
      "/api/v1/openapi.json": {
        get: {
          operationId: "getOpenApi",
          summary: "This document",
          tags: ["meta"],
          responses: { "200": { description: "OpenAPI 3.1 document" } },
        },
      },
      "/api/v1/session": {
        get: {
          operationId: "getSession",
          summary: "Current session, memberships and CSRF token",
          description:
            "Anonymous callers receive { user: null }. The CSRF token is only " +
            "returned to authenticated sessions.",
          tags: ["auth"],
          security: [{}, { cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("SessionResponse")) } },
        },
      },
      "/api/v1/operations": {
        get: {
          operationId: "listOperations",
          summary: "Operations visible to the caller",
          description:
            "Anonymous: public operations only. Authenticated: own-guild + partner " +
            "+ public operations with the caller's signup state.",
          tags: ["operations"],
          security: [{}, { cookieSession: [] }],
          parameters: [
            {
              name: "past",
              in: "query",
              required: false,
              schema: { type: "boolean", default: false },
              description: "Include operations older than the 3h grace cutoff.",
            },
          ],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("OperationListResponse")) },
          },
        },
        post: {
          operationId: "createOperation",
          summary: "Create a draft operation (fleet operator only)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("CreateOperationRequest")) },
          responses: {
            "200": { description: "Created", ...jsonContent(ref("CreateOperationResponse")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}": {
        get: {
          operationId: "getOperation",
          summary: "Operation detail read model",
          description:
            "Object-level authorization: private/guild operations return 401/404 " +
            "for callers without access; no details are leaked.",
          tags: ["operations"],
          security: [{}, { cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("OperationDetail")) },
            ...errorResponses,
          },
        },
        patch: {
          operationId: "editOperation",
          summary: "Edit operation meta (fleet operator only)",
          description: "Updates title/description/opType/schedule/meeting/visibility; keeps an open op's Discord + partner events in sync.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("EditOperationRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
        delete: {
          operationId: "deleteOperation",
          summary: "Delete an operation (fleet operator only)",
          description: "Destructive. Tears down distributed partner events and the Discord scheduled event.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Deleted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/status": {
        post: {
          operationId: "setOperationStatus",
          summary: "Change operation status (fleet operator only)",
          description: "draft → open creates the Discord event + distributes; → cancelled tears them down.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetStatusRequest")) },
          responses: { "200": { description: "Updated", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/cover": {
        get: {
          operationId: "getOperationCover",
          summary: "Mission-cover state (fleet operator or op leader)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "OK",
              ...jsonContent({
                type: "object",
                required: ["serviceConfigured", "cover"],
                properties: { serviceConfigured: { type: "boolean" }, cover: coverOrNull },
              }),
            },
            ...errorResponses,
          },
        },
        delete: {
          operationId: "deleteOperationCover",
          summary: "Remove the operation's mission cover (fleet operator or op leader)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Deleted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/cover/generate": {
        post: {
          operationId: "generateOperationCover",
          summary: "Render a mission cover from op data (fleet operator or op leader)",
          description: "Calls the mission-cover microservice; 502 on render failure, 503 if the service is not configured.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: false, ...jsonContent(coverSelectionSchema) },
          responses: {
            "200": {
              description: "Rendered",
              ...jsonContent({
                type: "object",
                required: ["ok", "cover"],
                properties: { ok: { type: "boolean" }, cover: coverOrNull },
              }),
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/cover/edit-link": {
        post: {
          operationId: "operationCoverEditLink",
          summary: "Mint an editor token and return the external editor URL (fleet operator or op leader)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: false, ...jsonContent(coverSelectionSchema) },
          responses: {
            "200": {
              description: "OK",
              ...jsonContent({ type: "object", required: ["editorUrl"], properties: { editorUrl: { type: "string" } } }),
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/publish-template": {
        post: {
          operationId: "publishTemplate",
          summary: "Publish this operation as a marketplace template (fleet operator only)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("PublishTemplateRequest")) },
          responses: { "200": { description: "Published", ...jsonContent(ref("CreateOperationResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/recurrence": {
        post: {
          operationId: "createRecurrence",
          summary: "Make an operation recurring (fleet operator only)",
          description: "Derives the pattern from the op's own date; the operator only picks a frequency (+ optional end/count). 409 if already recurring.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetRecurrenceRequest")) },
          responses: { "200": { description: "Series created", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Already recurring", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/operations/{id}/recurrence/stop": {
        post: {
          operationId: "stopRecurrence",
          summary: "Stop a recurring series (fleet operator only)",
          description: "Deactivates the series; already-spawned operations stay. No-op if the op is not recurring.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Stopped", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/needs": {
        get: {
          operationId: "getOperationNeeds",
          summary: "Fleet requirements (Bedarfe) read model (fleet operator only)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", ...jsonContent(ref("NeedsResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/needs/ships": {
        post: {
          operationId: "addShipNeeds",
          summary: "Add ship-hull needs (one hull per picked type)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AddShipNeedsRequest")) },
          responses: { "200": { description: "Added", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/needs/{reqId}": {
        patch: {
          operationId: "renameShipNeed",
          summary: "Rename a ship need (empty name resets to the type label)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "reqId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("RenameNeedRequest")) },
          responses: { "200": { description: "Renamed", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
        delete: {
          operationId: "removeShipNeed",
          summary: "Remove a ship need",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "reqId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Removed", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/needs/fighters": {
        put: {
          operationId: "setFighterSquads",
          summary: "Set the number of requested fighter squads (2 pilots each)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetFighterSquadsRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/needs/cqb": {
        put: {
          operationId: "setCqbTeams",
          summary: "Set the number and size of requested CQB teams (4–8 soldiers)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetCqbTeamsRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/account": {
        get: {
          operationId: "getAccount",
          summary: "The current user's linked OAuth logins",
          tags: ["auth"],
          security: [{ cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("AccountResponse")) }, "401": errorResponses["401"] },
        },
      },
      "/api/v1/profile": {
        patch: {
          operationId: "updateProfile",
          summary: "Update own profile preferences (UI language, org-fleet opt-in)",
          description:
            "Partial update. `locale` (de|en) sets the UI language that follows the account; " +
            "`shareHangarWithOrg` opts your ships into the guild Org-Fleet roster.",
          tags: ["auth"],
          security: [{ cookieSession: [] }],
          requestBody: {
            required: true,
            ...jsonContent({
              type: "object",
              properties: {
                locale: { type: "string", enum: ["de", "en"] },
                shareHangarWithOrg: { type: "boolean" },
              },
            }),
          },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds": {
        get: {
          operationId: "listGuilds",
          summary: "Guild memberships of the current user",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("GuildListResponse")) },
            "401": errorResponses["401"],
          },
        },
      },
      "/api/v1/guilds/{id}/settings": {
        get: {
          operationId: "getGuildSettings",
          summary: "Guild settings + members (fleet operator of that guild)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("GuildSettingsResponse")) },
            ...errorResponses,
          },
        },
        patch: {
          operationId: "updateGuildSettings",
          summary: "Update non-voice guild settings (org name, timezone, invite, admiral role)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("UpdateGuildSettingsRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/fleet": {
        get: {
          operationId: "getOrgFleet",
          summary: "Org-Fleet roster: who in the guild owns which ship (orgamember only)",
          description:
            "Restricted to members with the guild's orgamember role (admiralRoleId → fleetoperator) " +
            "or the instance superadmin; lists only opted-in members' ships. 403 otherwise.",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", ...jsonContent(ref("OrgFleetResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/channels": {
        get: {
          operationId: "listGuildChannels",
          summary: "Guild text/announcement channels for the wizard share picker (fleet operator only)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "OK",
              ...jsonContent({
                type: "object",
                required: ["channels"],
                properties: {
                  channels: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["id", "name"],
                      properties: { id: { type: "string" }, name: { type: "string" } },
                    },
                  },
                },
              }),
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/guilds/{id}/members/{userId}/role": {
        put: {
          operationId: "setMemberRole",
          summary: "Set a guild member's role (fleet operator / crew)",
          description: "The guild owner is protected and stays a fleet operator (409 on demote).",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetMemberRoleRequest")) },
          responses: {
            "200": { description: "Updated", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "409": { description: "Owner protected", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/admin/guilds": {
        get: {
          operationId: "listAdminGuilds",
          summary: "All guilds incl. inactive/banned (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("AdminGuildsResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/guilds/{id}/ban": {
        post: {
          operationId: "banGuild",
          summary: "Ban a Discord server (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Banned", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/guilds/{id}/unban": {
        post: {
          operationId: "unbanGuild",
          summary: "Unban a Discord server (stays inactive until re-added; superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Unbanned", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/settings": {
        get: {
          operationId: "getAdminSettings",
          summary: "Instance settings: maintenance + feedback channel (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("AdminSettingsResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/maintenance": {
        post: {
          operationId: "setMaintenance",
          summary: "Toggle maintenance mode (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("MaintenanceRequest")) },
          responses: { "200": { description: "Set", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/settings/feedback": {
        put: {
          operationId: "setFeedbackChannel",
          summary: "Set the feedback Discord channel id (empty to clear; superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("FeedbackChannelRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/ships/sync": {
        post: {
          operationId: "syncShipCatalog",
          summary: "Trigger a manual ship-catalog sync (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Started", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/locations/sync": {
        post: {
          operationId: "syncLocationCatalog",
          summary: "Trigger a manual location-catalog sync (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "Started", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/ships/config": {
        put: {
          operationId: "setShipCatalogConfig",
          summary: "Set ship-catalog auto-sync interval (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("CatalogConfigRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/locations/config": {
        put: {
          operationId: "setLocationCatalogConfig",
          summary: "Set location-catalog auto-sync interval (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("CatalogConfigRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/users": {
        get: {
          operationId: "listAdminUsers",
          summary: "All instance users (superadmin only)",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("AdminUsersResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/admin/users/{id}/role": {
        put: {
          operationId: "setUserRole",
          summary: "Set an instance user's role (superadmin only)",
          description: "Guards: no self-demote; the last active superadmin can't be demoted (409).",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetUserRoleRequest")) },
          responses: { "200": { description: "Updated", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Guarded", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/admin/users/{id}/active": {
        post: {
          operationId: "toggleUserActive",
          summary: "Toggle an instance user's active flag (superadmin only)",
          description: "Guards: can't disable yourself or the last active superadmin (409).",
          tags: ["admin"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Toggled", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Guarded", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/guilds/{id}/diagnostics": {
        get: {
          operationId: "getGuildDiagnostics",
          summary: "Discord install diagnostics for a guild (fleet operator only)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", ...jsonContent(ref("DiagnosticsResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/partnerships": {
        get: {
          operationId: "listPartnerships",
          summary: "Guild partnerships + incoming shared-event inbox (fleet operator only)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", ...jsonContent(ref("PartnershipsResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/partnerships/invite": {
        post: {
          operationId: "mintPartnerInvite",
          summary: "Mint a single-use partner invite token (returned once)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("MintInviteRequest")) },
          responses: { "200": { description: "Minted", ...jsonContent(ref("MintInviteResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/partnerships/accept": {
        post: {
          operationId: "acceptPartnerToken",
          summary: "Redeem a partner invite token (activates the partnership)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AcceptTokenRequest")) },
          responses: { "200": { description: "Partnered", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Cannot accept", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/guilds/{id}/partnerships/{partnerGuildId}/auto-share": {
        put: {
          operationId: "setPartnerAutoShare",
          summary: "Toggle auto-sharing of an active partner's events into this guild",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "partnerGuildId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("SetAutoShareRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/partnerships/{partnershipId}/revoke": {
        post: {
          operationId: "revokePartnership",
          summary: "Revoke / withdraw a partnership (permanent)",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "partnershipId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Revoked", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/guilds/{id}/partnerships/events/{eventId}/approve": {
        post: {
          operationId: "approveSharedEvent",
          summary: "Approve an incoming shared event into this guild's Discord",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "eventId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Approved", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Already decided", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/guilds/{id}/partnerships/events/{eventId}/decline": {
        post: {
          operationId: "declineSharedEvent",
          summary: "Decline an incoming shared event",
          tags: ["guilds"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "eventId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Declined", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Already decided", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/operations/{id}/seats/{seatId}/claim": {
        post: {
          operationId: "claimSeat",
          summary: "Claim a free seat for the current user",
          description:
            "Requires the cookie session AND the x-csrf-token header (token from " +
            "GET /api/v1/session). Side effects: seat assignment, audit entry. " +
            "Conflicts (seat taken, already seated in this category) return 409.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "seatId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Claimed", ...jsonContent(ref("ClaimSeatResponse")) },
            ...errorResponses,
            "409": { description: "Conflict", ...jsonContent(ref("ApiError")) },
          },
        },
        delete: {
          operationId: "unclaimSeat",
          summary: "Release the current user's seat",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "seatId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Released", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "409": { description: "Conflict", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/operations/{id}/cqb/signup": {
        post: {
          operationId: "cqbSignup",
          summary: "Flexible CQB/personnel signup for the operation",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: false, ...jsonContent(ref("CqbSignupRequest")) },
          responses: {
            "200": { description: "Signed up", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
          },
        },
        delete: {
          operationId: "cqbWithdraw",
          summary: "Withdraw the current user's CQB signup",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Withdrawn", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/hangar-share": {
        put: {
          operationId: "setHangarShare",
          summary: "Allow/deny operator hangar visibility for this operation",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("HangarShareRequest")) },
          responses: {
            "200": { description: "Saved", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/units": {
        post: {
          operationId: "registerUnit",
          summary: "Offer a ship / squad / vehicle for the operation",
          description:
            "Same validation chain as the SSR flow: ship/vehicle units need a catalog or " +
            "hangar ship, vehicles need a carrier, squads need a unique name and size 2–8. " +
            "Optional requirement binding is checked against the fleet composition.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("RegisterUnitRequest")) },
          responses: {
            "200": { description: "Registered", ...jsonContent(ref("RegisterUnitResponse")) },
            ...errorResponses,
            "409": { description: "Conflict", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/operations/{id}/units/{unitId}": {
        patch: {
          operationId: "patchUnit",
          summary: "Edit a unit (captain note, squad rename)",
          description:
            "Subset edit — full ship-swap / seat-rebuild editing stays on the SSR flow " +
            "until the FE reaches parity. Captain, op leaders or fleetoperators only.",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("PatchUnitRequest")) },
          responses: {
            "200": { description: "Updated", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "409": { description: "Conflict", ...jsonContent(ref("ApiError")) },
          },
        },
        delete: {
          operationId: "deleteUnit",
          summary: "Withdraw/delete a unit (captain or fleetoperator)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Deleted", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/resource-links": {
        post: {
          operationId: "addResourceLink",
          summary: "Add an operator briefing/resource link",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("ResourceLinkRequest")) },
          responses: {
            "200": { description: "Added", ...jsonContent(ref("ResourceLinkResponse")) },
            ...errorResponses,
            "409": { description: "Invalid URL or limit reached", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/operations/{id}/resource-links/{linkId}": {
        delete: {
          operationId: "removeResourceLink",
          summary: "Remove an operator resource link",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "linkId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Removed", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/operator": {
        get: {
          operationId: "getOperatorView",
          summary: "Operator read model (flexible signups, questions, hangar shares, activity)",
          description: "Operator-only (fleetoperator or op leader). Hangar shares are never exposed elsewhere.",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("OperatorView")) },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/units/{unitId}/accept": {
        post: {
          operationId: "acceptUnit",
          summary: "Accept an offered unit (optionally slotting it into a requirement)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: false, ...jsonContent(ref("UnitDecisionRequest")) },
          responses: { "200": { description: "Accepted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/units/{unitId}/reject": {
        post: {
          operationId: "rejectUnit",
          summary: "Reject an offered unit (frees its seats)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: false, ...jsonContent(ref("UnitDecisionRequest")) },
          responses: { "200": { description: "Rejected", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/seats/{seatId}/assignment": {
        put: {
          operationId: "assignSeat",
          summary: "Operator: assign a player to an open seat",
          description: "Clears the player's flexible request and notifies them via DM (best-effort).",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "seatId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignSeatRequest")) },
          responses: {
            "200": { description: "Assigned", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "409": { description: "Seat taken / player already seated", ...jsonContent(ref("ApiError")) },
          },
        },
        delete: {
          operationId: "unassignSeat",
          summary: "Operator: free an occupied seat (captain seat protected)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "seatId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": { description: "Freed", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "409": { description: "Captain seat", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/operations/{id}/questions/{qid}/answer": {
        post: {
          operationId: "answerQuestion",
          summary: "Operator: answer a player question",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "qid", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AnswerQuestionRequest")) },
          responses: { "200": { description: "Answered", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/leaders": {
        post: {
          operationId: "addLeader",
          summary: "Appoint an operation leader (fleet operator only)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignSeatRequest")) },
          responses: { "200": { description: "Added", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/leaders/{userId}": {
        delete: {
          operationId: "removeLeader",
          summary: "Remove an operation leader (fleet operator only)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "userId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Removed", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/seats/{seatId}": {
        patch: {
          operationId: "editSeat",
          summary: "Enable/disable or rename a seat (unit captain or operator)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "seatId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            ...jsonContent({
              type: "object",
              properties: { active: { type: "boolean" }, label: { type: "string", maxLength: 80 } },
            }),
          },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/questions": {
        post: {
          operationId: "askQuestion",
          summary: "Ask a question on an operation (any member, or anyone on a public op)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            ...jsonContent({
              type: "object",
              required: ["body"],
              properties: { body: { type: "string", minLength: 1, maxLength: 1000 } },
            }),
          },
          responses: {
            "200": {
              description: "Asked",
              ...jsonContent({ type: "object", required: ["ok", "id"], properties: { ok: { type: "boolean" }, id: { type: "string" } } }),
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/cqb/{signupId}/assign": {
        post: {
          operationId: "assignCqbSoldier",
          summary: "Operator: place/move a CQB soldier into a squad (null groupId unassigns)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "signupId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignCqbRequest")) },
          responses: { "200": { description: "Assigned", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/cqb-teams/{groupId}": {
        patch: {
          operationId: "renameCqbTeam",
          summary: "Operator: rename a CQB squad",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "groupId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("FormationRequest")) },
          responses: { "200": { description: "Renamed", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/cqb-teams/{groupId}/carrier": {
        put: {
          operationId: "setCqbTeamCarrier",
          summary: "Operator: embed a CQB squad in a carrier ship (null detaches)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "groupId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignCarrierRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/formations": {
        post: {
          operationId: "createFormation",
          summary: "Operator: create a ship formation (Verband)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("FormationRequest")) },
          responses: {
            "200": {
              description: "Created",
              ...jsonContent({ type: "object", required: ["ok", "id"], properties: { ok: { type: "boolean" }, id: { type: "string" } } }),
            },
            ...errorResponses,
          },
        },
      },
      "/api/v1/operations/{id}/formations/{fid}": {
        patch: {
          operationId: "renameFormation",
          summary: "Operator: rename a formation",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "fid", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("FormationRequest")) },
          responses: { "200": { description: "Renamed", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
        delete: {
          operationId: "deleteFormation",
          summary: "Operator: delete a formation (its ships become unassigned)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "fid", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Deleted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/operations/{id}/units/{unitId}/formation": {
        put: {
          operationId: "assignUnitFormation",
          summary: "Operator: assign/detach a ship to a formation (only ships; null detaches)",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignFormationRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Only ships can join a formation", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/operations/{id}/units/{unitId}/carrier": {
        put: {
          operationId: "setUnitCarrier",
          summary: "Operator: load a ground vehicle into a carrier ship (null detaches)",
          description: "Validates structural rules only (carrier is a ship in this op, no self-carry); the carried unit inherits the carrier's accept/reject status.",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "unitId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AssignCarrierRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Self-carry not allowed", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/operations/{id}/announce": {
        post: {
          operationId: "announceOperation",
          summary: "Operator: post an op announcement to a Discord text channel of this op's guild",
          tags: ["operator"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AnnounceRequest")) },
          responses: {
            "200": { description: "Posted", ...jsonContent(ref("MutationOk")) },
            ...errorResponses,
            "502": { description: "Discord post failed", ...jsonContent(ref("ApiError")) },
          },
        },
      },
      "/api/v1/content/{slug}": {
        get: {
          operationId: "getContent",
          summary: "Static info/legal page content as data (public)",
          description: "Returns first-party HTML for a known slug (e.g. whatis, how-to, impressum, datenschutz, changelog, sc-tools, why-unsigned). 404 on unknown slug.",
          tags: ["meta"],
          parameters: [
            { name: "slug", in: "path", required: true, schema: { type: "string" } },
            { name: "lang", in: "query", required: false, schema: { type: "string", enum: ["de", "en"] } },
          ],
          responses: {
            "200": {
              description: "OK",
              ...jsonContent({ type: "object", required: ["title", "html"], properties: { title: { type: "string" }, html: { type: "string" } } }),
            },
            "404": errorResponses["404"],
          },
        },
      },
      "/api/v1/hangar": {
        get: {
          operationId: "getHangar",
          summary: "The current user's own ships (hangar)",
          tags: ["ships"],
          security: [{ cookieSession: [] }],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("ShipSearchResponse")) },
            "401": errorResponses["401"],
          },
        },
        post: {
          operationId: "addHangarShip",
          summary: "Add a catalog ship to the current user's hangar",
          tags: ["ships"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("HangarShipRequest")) },
          responses: { "200": { description: "Added", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/hangar/import": {
        post: {
          operationId: "importFleet",
          summary: "Bulk-import owned ships from a CCU-Game JSON export",
          tags: ["ships"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("FleetImportRequest")) },
          responses: { "200": { description: "Imported", ...jsonContent(ref("FleetImportResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/hangar/{shipId}": {
        delete: {
          operationId: "removeHangarShip",
          summary: "Remove a ship from the current user's hangar",
          tags: ["ships"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "shipId", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Removed", ...jsonContent(ref("MutationOk")) }, "401": errorResponses["401"] },
        },
      },
      "/api/v1/roadmap": {
        get: {
          operationId: "getRoadmap",
          summary: "Player-facing roadmap (public)",
          tags: ["meta"],
          responses: { "200": { description: "OK", ...jsonContent(ref("RoadmapResponse")) } },
        },
      },
      "/api/v1/templates": {
        get: {
          operationId: "listTemplates",
          summary: "Operation templates visible to a guild",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "guildId", in: "query", required: true, schema: { type: "string" } },
            { name: "q", in: "query", required: false, schema: { type: "string" } },
            { name: "opType", in: "query", required: false, schema: { type: "string" } },
          ],
          responses: { "200": { description: "OK", ...jsonContent(ref("TemplateListResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/templates/{id}/apply": {
        post: {
          operationId: "applyTemplate",
          summary: "Create a draft operation from a template (fleet operator only)",
          tags: ["operations"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("ApplyTemplateRequest")) },
          responses: { "200": { description: "Created", ...jsonContent(ref("CreateOperationResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/feedback": {
        post: {
          operationId: "sendFeedback",
          summary: "Send feedback to the configured Discord channel",
          tags: ["meta"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("FeedbackRequest")) },
          responses: { "200": { description: "Sent", ...jsonContent(ref("MutationOk")) }, ...errorResponses, "409": { description: "Send failed", ...jsonContent(ref("ApiError")) } },
        },
      },
      "/api/v1/ships/search": {
        get: {
          operationId: "searchShips",
          summary: "Ship catalog search",
          tags: ["ships"],
          security: [{}, { cookieSession: [] }],
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 80 } },
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 100, default: 20 },
            },
          ],
          responses: {
            "200": { description: "OK", ...jsonContent(ref("ShipSearchResponse")) },
            "400": errorResponses["400"],
          },
        },
      },
      "/api/v1/locations/search": {
        get: {
          operationId: "searchLocations",
          summary: "Rendezvous autocomplete: man-made locations from the synced catalog",
          tags: ["meta"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "q", in: "query", required: false, schema: { type: "string", maxLength: 80 } },
            { name: "system", in: "query", required: false, schema: { type: "string" }, description: "Scope to a star system (e.g. stanton)." },
          ],
          responses: {
            "200": {
              description: "OK",
              ...jsonContent({
                type: "object",
                required: ["locations"],
                properties: {
                  locations: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["name", "system"],
                      properties: { name: { type: "string" }, system: { type: "string" } },
                    },
                  },
                },
              }),
            },
            "401": errorResponses["401"],
          },
        },
      },
      "/api/v1/polls": {
        get: {
          operationId: "listPolls",
          summary: "Polls visible to the viewer (own guild + active partners + public)",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          responses: { "200": { description: "OK", ...jsonContent(ref("PollListResponse")) } },
        },
        post: {
          operationId: "createPoll",
          summary: "Create a poll (member; partner/public scope needs fleet operator)",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } }],
          requestBody: { required: true, ...jsonContent(ref("CreatePollRequest")) },
          responses: { "201": { description: "Created", ...jsonContent(ref("CreatePollResponse")) }, ...errorResponses },
        },
      },
      "/api/v1/polls/{id}": {
        get: {
          operationId: "getPoll",
          summary: "Poll detail incl. options, viewer's votes and gated results",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK", ...jsonContent(ref("PollDetail")) }, ...errorResponses },
        },
        patch: {
          operationId: "updatePoll",
          summary: "Edit a poll — title/description/status/options/… (creator / fleet operator)",
          description: "Partial update. Closing is `{status:\"closed\"}`. Option edits are rejected once voting has started.",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("UpdatePollRequest")) },
          responses: { "200": { description: "Saved", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
        delete: {
          operationId: "deletePoll",
          summary: "Delete a poll (creator / fleet operator / superadmin)",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Deleted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/polls/{id}/vote": {
        post: {
          operationId: "votePoll",
          summary: "Cast or replace the viewer's vote(s) (validated against mode/maxChoices)",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("VotePollRequest")) },
          responses: { "200": { description: "Voted", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
        delete: {
          operationId: "withdrawVote",
          summary: "Withdraw the viewer's vote(s) while the poll is open",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: { "200": { description: "Withdrawn", ...jsonContent(ref("MutationOk")) }, ...errorResponses },
        },
      },
      "/api/v1/polls/{id}/options": {
        post: {
          operationId: "addPollOption",
          summary: "Suggest an option (only when the poll allows it)",
          tags: ["polls"],
          security: [{ cookieSession: [] }],
          parameters: [
            { name: "id", in: "path", required: true, schema: { type: "string" } },
            { name: "x-csrf-token", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: { required: true, ...jsonContent(ref("AddPollOptionRequest")) },
          responses: { "201": { description: "Added", ...jsonContent(ref("CreatePollResponse")) }, ...errorResponses },
        },
      },
    },
  };
}

/** Built once at startup; the contract is static per release. */
export const openApiDocument = buildOpenApiDocument();
