import { describe, expect, it } from "vitest";
import { buildOpenApiDocument } from "../../api/openapi.js";

const V1_PATHS = [
  "/api/v1/health",
  "/api/v1/openapi.json",
  "/api/v1/session",
  "/api/v1/operations",
  "/api/v1/operations/{id}",
  "/api/v1/guilds",
  "/api/v1/ships/search",
];

describe("openapi document", () => {
  const doc = buildOpenApiDocument() as Record<string, unknown> & {
    paths: Record<string, unknown>;
    components: { schemas: Record<string, unknown> };
  };

  it("is JSON-serializable OpenAPI 3.1 with all v1 routes", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(() => JSON.stringify(doc)).not.toThrow();
    for (const p of V1_PATHS) expect(doc.paths[p], `missing path ${p}`).toBeTruthy();
  });

  it("contains all referenced component schemas", () => {
    const json = JSON.stringify(doc);
    const refs = [...json.matchAll(/#\/components\/schemas\/(\w+)/g)].map((m) => m[1]);
    for (const name of new Set(refs)) {
      expect(doc.components.schemas[name], `unresolved $ref ${name}`).toBeTruthy();
    }
  });

  it("leaks no secret env names or token examples (FR-P2 docs hygiene)", () => {
    const json = JSON.stringify(doc);
    for (const banned of [
      "DISCORD_RDOCRTC_BOT_TOKEN",
      "DISCORD_FLEETPLANNER_BOT_TOKEN",
      "FLEETPLANNER_DB_PASSWORD",
      "LIVEKIT_API_SECRET",
      "SESSION_SECRET",
      "client_secret",
      "Bearer ey",
      "postgresql://",
      "10.10.10.",
    ]) {
      expect(json).not.toContain(banned);
    }
  });

  it("describes only the cookie session security scheme", () => {
    const schemes = (doc.components as Record<string, unknown>).securitySchemes as Record<string, unknown>;
    expect(Object.keys(schemes)).toEqual(["cookieSession"]);
  });
});
