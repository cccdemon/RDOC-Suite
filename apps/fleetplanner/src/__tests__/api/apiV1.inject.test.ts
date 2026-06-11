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

describe("GET /api/v1/docs", () => {
  it("serves the Swagger UI page referencing openapi.json", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/docs" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("swagger-ui");
    expect(res.body).toContain("openapi.json");
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

describe("GET /api/v1/hangar", () => {
  it("anonymous → 401 JSON envelope", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/hangar" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("add/remove reject anonymous + invalid ids; documented", async () => {
    const add = await app.inject({ method: "POST", url: "/api/v1/hangar", headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.1" }, payload: JSON.stringify({ shipId: "cmqaaaaaaaaaaaaaaaaaa1" }) });
    expect(add.statusCode).toBe(401);
    const del = await app.inject({ method: "DELETE", url: "/api/v1/hangar/cmqaaaaaaaaaaaaaaaaaa1", headers: { "x-forwarded-for": "10.7.7.2" } });
    expect(del.statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/v1/hangar", headers: { "content-type": "application/json", "x-forwarded-for": "10.7.7.3" }, payload: JSON.stringify({ shipId: "x" }) });
    expect(bad.statusCode).toBe(400);
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/hangar"].post).toBeTruthy();
    expect(doc.paths["/api/v1/hangar/{shipId}"].delete).toBeTruthy();
  });
});

describe("GET /api/v1/operations/:id", () => {
  it("invalid id format → 400 JSON without hitting the database", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/operations/..%2Fetc" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });
});

describe("templates marketplace", () => {
  it("list/apply reject anonymous + validate; documented", async () => {
    const list = await app.inject({ method: "GET", url: "/api/v1/templates?guildId=g1" });
    expect(list.statusCode).toBe(401);
    const apply = await app.inject({ method: "POST", url: "/api/v1/templates/cmqaaaaaaaaaaaaaaaaaa1/apply", headers: { "content-type": "application/json", "x-forwarded-for": "10.5.5.1" }, payload: JSON.stringify({ guildId: "g1", scheduledAt: "2026-07-01T18:00:00.000Z" }) });
    expect(apply.statusCode).toBe(401);
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/templates"].get).toBeTruthy();
    expect(doc.paths["/api/v1/templates/{id}/apply"].post).toBeTruthy();
  });
});

describe("feedback", () => {
  it("anonymous → 401, invalid body → 400, documented", async () => {
    const anon = await app.inject({ method: "POST", url: "/api/v1/feedback", headers: { "content-type": "application/json", "x-forwarded-for": "10.6.6.1" }, payload: JSON.stringify({ subject: "Hi", message: "test" }) });
    expect(anon.statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/v1/feedback", headers: { "content-type": "application/json", "x-forwarded-for": "10.6.6.2" }, payload: JSON.stringify({ subject: "" }) });
    expect(bad.statusCode).toBe(400);
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/feedback"].post).toBeTruthy();
  });
});

describe("create operation", () => {
  it("anonymous → 401 envelope", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/operations",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.8.8.1" },
      payload: JSON.stringify({ guildId: "g1", title: "Op", scheduledAt: "2026-07-01T18:00:00.000Z" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("invalid body → 400", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/operations",
      headers: { "content-type": "application/json", "x-forwarded-for": "10.8.8.2" },
      payload: JSON.stringify({ title: "no guild, no date" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents POST /operations", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(res.json().paths["/api/v1/operations"].post).toBeTruthy();
  });
});

describe("mutations (phase 5 slice 1) — auth/CSRF gates", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";
  const seatId = "cmqbbbbbbbbbbbbbbbbbb2";

  it.each([
    ["POST", `/api/v1/operations/${opId}/seats/${seatId}/claim`],
    ["DELETE", `/api/v1/operations/${opId}/seats/${seatId}/claim`],
    ["POST", `/api/v1/operations/${opId}/cqb/signup`],
    ["DELETE", `/api/v1/operations/${opId}/cqb/signup`],
    ["PUT", `/api/v1/operations/${opId}/hangar-share`],
  ] as const)("%s %s without session → 401 JSON envelope", async (method, url) => {
    const res = await app.inject({
      method,
      url,
      ...(method === "PUT"
        ? { headers: { "content-type": "application/json" }, payload: JSON.stringify({ allow: true }) }
        : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("invalid ids → 400 before any auth/DB work", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/operations/bad/seats/also-bad/claim",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("hangar-share with invalid body → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/operations/${opId}/hangar-share`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ allow: "yes-please" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents the mutation routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const doc = res.json();
    expect(doc.paths["/api/v1/operations/{id}/seats/{seatId}/claim"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/seats/{seatId}/claim"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/cqb/signup"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/hangar-share"].put).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/units"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/units/{unitId}"].patch).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/units/{unitId}"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/resource-links"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/resource-links/{linkId}"].delete).toBeTruthy();
  });
});

describe("mutations (phase 5 slice 2) — units + resource-links gates", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";
  const unitId = "cmqcccccccccccccccccc3";
  const linkId = "cmqdddddddddddddddddd4";

  it.each([
    ["POST", `/api/v1/operations/${opId}/units`, { unitType: "squad", squadName: "A", squadSize: 4 }],
    ["PATCH", `/api/v1/operations/${opId}/units/${unitId}`, { captainNote: "x" }],
    ["DELETE", `/api/v1/operations/${opId}/units/${unitId}`, undefined],
    ["POST", `/api/v1/operations/${opId}/resource-links`, { url: "https://example.com" }],
    ["DELETE", `/api/v1/operations/${opId}/resource-links/${linkId}`, undefined],
  ] as const)("%s %s without session → 401 JSON envelope", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }
        : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("register unit with invalid body → 400 before auth", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/operations/${opId}/units`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ unitType: "battlestation" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("squad size out of bounds → 400 (schema-level)", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/operations/${opId}/units`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ unitType: "squad", squadName: "A", squadSize: 99 }),
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("operator API — gates", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";
  const unitId = "cmqcccccccccccccccccc3";
  const seatId = "cmqbbbbbbbbbbbbbbbbbb2";
  const qid = "cmqeeeeeeeeeeeeeeeeee5";

  it.each([
    ["GET", `/api/v1/operations/${opId}/operator`, undefined],
    ["POST", `/api/v1/operations/${opId}/units/${unitId}/accept`, {}],
    ["POST", `/api/v1/operations/${opId}/units/${unitId}/reject`, {}],
    ["PUT", `/api/v1/operations/${opId}/seats/${seatId}/assignment`, { userId: "cmqffffffffffffffffff6" }],
    ["DELETE", `/api/v1/operations/${opId}/seats/${seatId}/assignment`, undefined],
    ["POST", `/api/v1/operations/${opId}/questions/${qid}/answer`, { answer: "x" }],
  ] as const)("%s %s without session → 401 envelope", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      ...(body !== undefined
        ? { headers: { "content-type": "application/json" }, payload: JSON.stringify(body) }
        : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("assignment with invalid body → 400", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/operations/${opId}/seats/${seatId}/assignment`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ userId: "nope" }),
    });
    expect(res.statusCode).toBe(400);
  });

  it("leader routes reject anonymous callers (401)", async () => {
    // distinct x-forwarded-for so these requests get their own rate buckets
    // (trustProxy is on) and don't trip the shared anon ip:m budget.
    const add = await app.inject({ method: "POST", url: `/api/v1/operations/${opId}/leaders`, headers: { "content-type": "application/json", "x-forwarded-for": "10.9.9.1" }, payload: JSON.stringify({ userId: "cmqffffffffffffffffff6" }) });
    expect(add.statusCode).toBe(401);
    const del = await app.inject({ method: "DELETE", url: `/api/v1/operations/${opId}/leaders/cmqffffffffffffffffff6`, headers: { "x-forwarded-for": "10.9.9.2" } });
    expect(del.statusCode).toBe(401);
  });

  it("openapi documents the operator routes", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    const doc = res.json();
    expect(doc.paths["/api/v1/operations/{id}/operator"].get).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/leaders"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/leaders/{userId}"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/units/{unitId}/accept"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/units/{unitId}/reject"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/seats/{seatId}/assignment"].put).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/seats/{seatId}/assignment"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/questions/{qid}/answer"].post).toBeTruthy();
  });
});

describe("rate limiting", () => {
  it("blocks a mutation key after the budget with a 429 envelope + retry-after", async () => {
    // Invalid op id → the handler answers 400 BEFORE any auth/DB work, so the
    // loop is fast and DB-free; the limiter hook still counts every request.
    // Distinct cookie = distinct bucket (never validated against the DB).
    const url = "/api/v1/operations/not-a-valid-id/cqb/signup";
    const headers = { cookie: "fp_sid=rate-limit-test-bucket" };
    let last: { statusCode: number; headers: Record<string, unknown>; body: string } | null = null;
    for (let i = 0; i < 21; i++) {
      last = await app.inject({ method: "DELETE", url, headers });
      if (i < 20) expect(last.statusCode).toBe(400);
    }
    expect(last!.statusCode).toBe(429);
    expect(String(last!.headers["content-type"])).toContain("application/json");
    expect(JSON.parse(last!.body).error.code).toBe("rate_limited");
    expect(Number(last!.headers["retry-after"])).toBeGreaterThanOrEqual(1);
  });

  it("read endpoints stay unlimited", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await app.inject({ method: "GET", url: "/api/v1/health" });
      expect(res.statusCode).toBe(200);
    }
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
