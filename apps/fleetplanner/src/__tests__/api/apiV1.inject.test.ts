import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

// FR-P2 Phase 2 — route-level tests for the /api/v1 slice via app.inject().
// Runs without a database: covered routes either skip the DB (health, openapi,
// anonymous session) or must fail CLOSED with the stable JSON error envelope
// and zero internal detail when the DB is unreachable.
let app: FastifyInstance;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("GET /api/v1/health", () => {
  it("returns 200 JSON, never HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json();
    expect(body.status).toBe("ok");
    expect(body.service).toBe("fleetplanner-api");
    expect(res.body).not.toContain("<html");
  });
});

describe("GET /api/v1/openapi.json", () => {
  it("serves the OpenAPI document", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    const doc = res.json();
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/api/v1/operations/{id}"]).toBeTruthy();
  });
});

describe("GET /api/v1/session", () => {
  it("anonymous → 200 { user: null }, no redirect to a login page", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/session" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toEqual({ user: null, memberships: [], csrfToken: null });
  });
});

describe("GET /api/v1/guilds", () => {
  it("anonymous → 401 JSON error envelope (not a 302 login redirect)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/guilds" });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json();
    expect(body.error.code).toBe("unauthenticated");
    expect(typeof body.error.requestId).toBe("string");
  });
});

describe("GET /api/v1/operations/:id", () => {
  it("invalid id format → 400 JSON without hitting the database", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/operations/..%2Fetc" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });
});

describe("error envelope hygiene", () => {
  it("a DB-touching route without a database fails closed: 500 JSON, no internals", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/operations" });
    // Local test env has no Postgres → the route must answer with the stable
    // envelope and leak neither stack traces nor Prisma/connection details.
    expect(res.statusCode).toBe(500);
    expect(res.headers["content-type"]).toContain("application/json");
    const body = res.json();
    expect(body.error.code).toBe("internal");
    expect(typeof body.error.requestId).toBe("string");
    for (const banned of ["Prisma", "localhost:5432", "stack", "Invalid `prisma"]) {
      expect(res.body).not.toContain(banned);
    }
  });
});
