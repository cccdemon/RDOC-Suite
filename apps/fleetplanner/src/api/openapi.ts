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
  FeedbackRequestSchema,
  HangarShipRequestSchema,
  OperatorViewSchema,
  RoadmapResponseSchema,
  TemplateListResponseSchema,
  UnitDecisionRequestSchema,
  ClaimSeatResponseSchema,
  CqbSignupRequestSchema,
  GuildListResponseSchema,
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
} from "./contracts/index.js";

type JsonObject = Record<string, unknown>;

const SCHEMAS = {
  ApiError: ApiErrorSchema,
  HealthResponse: HealthResponseSchema,
  SessionResponse: SessionResponseSchema,
  GuildListResponse: GuildListResponseSchema,
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
  HangarShipRequest: HangarShipRequestSchema,
  FeedbackRequest: FeedbackRequestSchema,
  TemplateListResponse: TemplateListResponseSchema,
  ApplyTemplateRequest: ApplyTemplateRequestSchema,
  RoadmapResponse: RoadmapResponseSchema,
} as const;

function ref(name: keyof typeof SCHEMAS): JsonObject {
  return { $ref: `#/components/schemas/${name}` };
}

function jsonContent(schema: JsonObject): JsonObject {
  return { content: { "application/json": { schema } } };
}

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
      "/api/v1/docs": {
        get: {
          operationId: "getDocs",
          summary: "Interactive API documentation (Swagger UI)",
          tags: ["meta"],
          responses: { "200": { description: "HTML documentation page" } },
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
    },
  };
}

/** Built once at startup; the contract is static per release. */
export const openApiDocument = buildOpenApiDocument();
