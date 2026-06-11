// FR-P2 Phase 1 — OpenAPI 3.1 document generated from the zod contracts.
//
// No extra dependency: zod v4's z.toJSONSchema() emits JSON Schema 2020-12,
// which OpenAPI 3.1 consumes natively. The document is built once at module
// load and served by GET /api/v1/openapi.json.
//
// Security note (FR-P2 §API Docs): no secrets, no example tokens, no internal
// URLs. The only security scheme is the browser cookie session.
import { z } from "zod/v4";
import {
  ApiErrorSchema,
  GuildListResponseSchema,
  HealthResponseSchema,
  OperationDetailSchema,
  OperationListResponseSchema,
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
    const js = z.toJSONSchema(schema, {
      target: "draft-2020-12",
      reused: "inline",
      io: "output",
    }) as JsonObject;
    delete js.$schema;
    delete js.id;
    out[name] = js;
  }
  return out;
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
