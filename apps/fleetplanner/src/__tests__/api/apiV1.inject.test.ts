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
  it("is gone — Swagger UI moved to the SPA; backend renders no HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/docs" });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /api/v1/roadmap", () => {
  it("public → 200 with items", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/roadmap" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.items)).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.items[0]).toHaveProperty("status");
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

describe("GET /api/v1/account", () => {
  it("anonymous → 401 envelope + documented", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/account" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/account"].get).toBeTruthy();
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

describe("POST /api/v1/hangar/import", () => {
  it("anonymous → 401, empty body → 400, documented", async () => {
    const anon = await app.inject({ method: "POST", url: "/api/v1/hangar/import", headers: { "content-type": "application/json", "x-forwarded-for": "10.17.1.1" }, payload: JSON.stringify({ fleetJson: "[]" }) });
    expect(anon.statusCode).toBe(401);
    expect(anon.json().error.code).toBe("unauthenticated");
    const bad = await app.inject({ method: "POST", url: "/api/v1/hangar/import", headers: { "content-type": "application/json", "x-forwarded-for": "10.17.1.2" }, payload: JSON.stringify({ fleetJson: "" }) });
    expect(bad.statusCode).toBe(400);
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/hangar/import"].post).toBeTruthy();
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

describe("public orgs panel", () => {
  it("is registered, documented and needs no session", async () => {
    // This harness has no database, so the handler itself cannot be exercised
    // here (the DB suite covers the filtering). What matters at this level: the
    // route exists and is NOT behind a session — a landing page is read by
    // signed-out visitors.
    const res = await app.inject({ method: "GET", url: "/api/v1/public/orgs" });
    expect(res.statusCode).not.toBe(404);
    expect(res.statusCode).not.toBe(401);

    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    const spec = doc.paths["/api/v1/public/orgs"].get;
    expect(spec).toBeTruthy();
    expect(spec.security).toBeUndefined();
  });
});

describe("doc content", () => {
  it("serves every handbook/legal slug and 404s an unknown one", async () => {
    // The SPA's Handbuch + Rechtliches hubs render exactly these slugs; a typo
    // in the registry would only show up as an empty page in the browser.
    const slugs = [
      "whatis", "whatis-tech", "architecture", "how-to",
      "changelog", "why-unsigned", "sc-tools", "license", "impressum", "datenschutz",
    ];
    for (const slug of slugs) {
      const res = await app.inject({ method: "GET", url: `/api/v1/content/${slug}` });
      expect(res.statusCode, slug).toBe(200);
      const body = res.json();
      expect(body.title, slug).toBeTruthy();
      expect(body.html.length, slug).toBeGreaterThan(200);
    }
    const missing = await app.inject({ method: "GET", url: "/api/v1/content/does-not-exist" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("the architecture page ships diagrams as inline SVG, never as script", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/content/architecture" });
    const html = res.json().html as string;
    // A diagram renderer would need inline script, which the app CSP forbids —
    // so the diagrams have to be markup.
    expect((html.match(/<svg/g) ?? []).length).toBe(3);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/ on[a-z]+=/i); // no inline event handlers either
  });
});

describe("feedback", () => {
  it("anonymous → 401, invalid body → 400, documented", async () => {
    const anon = await app.inject({ method: "POST", url: "/api/v1/feedback", headers: { "content-type": "application/json", "x-forwarded-for": "10.6.6.1" }, payload: JSON.stringify({ subject: "Hi", message: "test" }) });
    expect(anon.statusCode).toBe(401);
    const bad = await app.inject({ method: "POST", url: "/api/v1/feedback", headers: { "content-type": "application/json", "x-forwarded-for": "10.6.6.2" }, payload: JSON.stringify({ subject: "" }) });
    // Auth is checked BEFORE the body, so an anonymous caller cannot probe the
    // schema: a malformed anonymous request is still a 401.
    expect(bad.statusCode).toBe(401);
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

describe("operation editor lifecycle — gates + validation", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";

  it.each([
    ["PATCH", `/api/v1/operations/${opId}`, { title: "New" }],
    ["POST", `/api/v1/operations/${opId}/status`, { status: "open" }],
    ["DELETE", `/api/v1/operations/${opId}`, undefined],
  ] as const)("%s %s without session → 401 envelope", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      headers: { "x-forwarded-for": `10.12.12.${url.length}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("PATCH invalid op id → 400 before auth", async () => {
    const res = await app.inject({ method: "PATCH", url: "/api/v1/operations/..%2Fetc", headers: { "content-type": "application/json", "x-forwarded-for": "10.12.13.1" }, payload: JSON.stringify({ title: "x" }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("PATCH invalid visibility → 400", async () => {
    const res = await app.inject({ method: "PATCH", url: `/api/v1/operations/${opId}`, headers: { "content-type": "application/json", "x-forwarded-for": "10.12.13.2" }, payload: JSON.stringify({ visibility: "secret" }) });
    expect(res.statusCode).toBe(400);
  });

  it("POST status with invalid status → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/operations/${opId}/status`, headers: { "content-type": "application/json", "x-forwarded-for": "10.12.13.3" }, payload: JSON.stringify({ status: "obliterated" }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("openapi documents the lifecycle routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/operations/{id}"].patch).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/status"].post).toBeTruthy();
  });
});

describe("operation editor — publish-template + recurrence", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";

  it.each([
    ["POST", `/api/v1/operations/${opId}/publish-template`, { name: "Blueprint" }],
    ["POST", `/api/v1/operations/${opId}/recurrence`, { freq: "weekly" }],
    ["POST", `/api/v1/operations/${opId}/recurrence/stop`, {}],
  ] as const)("%s %s without session → 401 envelope", async (method, url, body) => {
    const res = await app.inject({ method, url, headers: { "content-type": "application/json", "x-forwarded-for": `10.15.0.${url.length}` }, payload: JSON.stringify(body) });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("publish-template invalid op id → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/operations/..%2Fetc/publish-template", headers: { "content-type": "application/json", "x-forwarded-for": "10.15.1.1" }, payload: JSON.stringify({}) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("publish-template invalid visibility → 400", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/operations/${opId}/publish-template`, headers: { "content-type": "application/json", "x-forwarded-for": "10.15.1.2" }, payload: JSON.stringify({ visibility: "private" }) });
    expect(res.statusCode).toBe(400);
  });

  it("recurrence create with invalid freq → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/operations/${opId}/recurrence`, headers: { "content-type": "application/json", "x-forwarded-for": "10.15.2.1" }, payload: JSON.stringify({ freq: "hourly" }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("openapi documents the publish/recurrence routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/operations/{id}/publish-template"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/recurrence"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/recurrence/stop"].post).toBeTruthy();
  });
});

describe("operation needs editor — gates + validation", () => {
  const opId = "cmqaaaaaaaaaaaaaaaaaa1";
  const reqId = "cmqcccccccccccccccccc3";

  it.each([
    ["GET", `/api/v1/operations/${opId}/needs`, undefined],
    ["POST", `/api/v1/operations/${opId}/needs/ships`, { shipTypes: ["capital"] }],
    ["PATCH", `/api/v1/operations/${opId}/needs/${reqId}`, { name: "Tank" }],
    ["DELETE", `/api/v1/operations/${opId}/needs/${reqId}`, undefined],
    ["PUT", `/api/v1/operations/${opId}/needs/fighters`, { count: 3 }],
    ["PUT", `/api/v1/operations/${opId}/needs/cqb`, { count: 2, size: 5 }],
  ] as const)("%s %s without session → 401 envelope", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      headers: { "x-forwarded-for": `10.14.0.${url.length}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("add ship needs with empty list → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/operations/${opId}/needs/ships`, headers: { "content-type": "application/json", "x-forwarded-for": "10.14.1.1" }, payload: JSON.stringify({ shipTypes: [] }) });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("set fighters with negative count → 400", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/operations/${opId}/needs/fighters`, headers: { "content-type": "application/json", "x-forwarded-for": "10.14.1.2" }, payload: JSON.stringify({ count: -3 }) });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents the needs routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/operations/{id}/needs"].get).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/needs/ships"].post).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/needs/{reqId}"].patch).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/needs/{reqId}"].delete).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/needs/fighters"].put).toBeTruthy();
    expect(doc.paths["/api/v1/operations/{id}/needs/cqb"].put).toBeTruthy();
  });
});

describe("superadmin guild management — gates", () => {
  const gid = "123456789012345678";

  it("GET admin/guilds anonymous → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/guilds" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it.each([
    ["ban", `/api/v1/admin/guilds/${gid}/ban`],
    ["unban", `/api/v1/admin/guilds/${gid}/unban`],
  ] as const)("POST %s without session → 401", async (_name, url) => {
    const res = await app.inject({ method: "POST", url, headers: { "x-forwarded-for": `10.18.0.${url.length}` } });
    expect(res.statusCode).toBe(401);
  });

  it("ban with invalid guild id → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/guilds/nope/ban", headers: { "x-forwarded-for": "10.18.1.1" } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("openapi documents the admin guild routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/admin/guilds"].get).toBeTruthy();
    expect(doc.paths["/api/v1/admin/guilds/{id}/ban"].post).toBeTruthy();
    expect(doc.paths["/api/v1/admin/guilds/{id}/unban"].post).toBeTruthy();
  });
});

describe("superadmin instance settings — gates", () => {
  it("GET admin/settings anonymous → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/settings" });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ["POST", "/api/v1/admin/maintenance", { enabled: true }],
    ["PUT", "/api/v1/admin/settings/feedback", { channelId: "123456789012345678" }],
    ["POST", "/api/v1/admin/ships/sync", undefined],
    ["POST", "/api/v1/admin/locations/sync", undefined],
    ["PUT", "/api/v1/admin/ships/config", { intervalDays: 7 }],
    ["PUT", "/api/v1/admin/locations/config", { intervalDays: 14 }],
  ] as const)("%s %s without session → 401", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      headers: { "x-forwarded-for": `10.20.0.${url.length}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    expect(res.statusCode).toBe(401);
  });

  it("maintenance with non-boolean → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/admin/maintenance", headers: { "content-type": "application/json", "x-forwarded-for": "10.20.1.1" }, payload: JSON.stringify({ enabled: "yes" }) });
    expect(res.statusCode).toBe(400);
  });

  it("catalog config with out-of-range interval → 400", async () => {
    const res = await app.inject({ method: "PUT", url: "/api/v1/admin/ships/config", headers: { "content-type": "application/json", "x-forwarded-for": "10.20.1.2" }, payload: JSON.stringify({ intervalDays: 999 }) });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents the admin settings routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/admin/settings"].get).toBeTruthy();
    expect(doc.paths["/api/v1/admin/maintenance"].post).toBeTruthy();
    expect(doc.paths["/api/v1/admin/settings/feedback"].put).toBeTruthy();
    expect(doc.paths["/api/v1/admin/ships/sync"].post).toBeTruthy();
    expect(doc.paths["/api/v1/admin/locations/sync"].post).toBeTruthy();
    expect(doc.paths["/api/v1/admin/ships/config"].put).toBeTruthy();
    expect(doc.paths["/api/v1/admin/locations/config"].put).toBeTruthy();
  });
});

describe("superadmin user management — gates", () => {
  const uid = "cmqffffffffffffffffff6";

  it("GET admin/users anonymous → 401", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it.each([
    ["PUT", `/api/v1/admin/users/${uid}/role`, { role: "crew" }],
    ["POST", `/api/v1/admin/users/${uid}/active`, undefined],
  ] as const)("%s %s without session → 401", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      headers: { "x-forwarded-for": `10.19.0.${url.length}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    expect(res.statusCode).toBe(401);
  });

  it("set role with invalid role → 400", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/admin/users/${uid}/role`, headers: { "content-type": "application/json", "x-forwarded-for": "10.19.1.1" }, payload: JSON.stringify({ role: "emperor" }) });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents the admin user routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/admin/users"].get).toBeTruthy();
    expect(doc.paths["/api/v1/admin/users/{id}/role"].put).toBeTruthy();
    expect(doc.paths["/api/v1/admin/users/{id}/active"].post).toBeTruthy();
  });
});

describe("guild partnerships — gates + validation", () => {
  const gid = "123456789012345678";
  const partnerGid = "987654321098765432";
  const cuid = "cmqcccccccccccccccccc3";

  it("GET partnerships anonymous → 401", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/guilds/${gid}/partnerships` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("GET partnerships invalid guild id → 400", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/guilds/nope/partnerships" });
    expect(res.statusCode).toBe(400);
  });

  it.each([
    ["POST", `/api/v1/guilds/${gid}/partnerships/invite`, { label: "Ally" }],
    ["POST", `/api/v1/guilds/${gid}/partnerships/accept`, { token: "abc123" }],
    ["PUT", `/api/v1/guilds/${gid}/partnerships/${partnerGid}/auto-share`, { autoShare: true }],
    ["POST", `/api/v1/guilds/${gid}/partnerships/${cuid}/revoke`, undefined],
    ["POST", `/api/v1/guilds/${gid}/partnerships/events/${cuid}/approve`, undefined],
    ["POST", `/api/v1/guilds/${gid}/partnerships/events/${cuid}/decline`, undefined],
  ] as const)("%s %s without session → 401", async (method, url, body) => {
    const res = await app.inject({
      method,
      url,
      headers: { "x-forwarded-for": `10.16.0.${url.length}`, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
      ...(body !== undefined ? { payload: JSON.stringify(body) } : {}),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("invite with empty label → 400 before auth", async () => {
    const res = await app.inject({ method: "POST", url: `/api/v1/guilds/${gid}/partnerships/invite`, headers: { "content-type": "application/json", "x-forwarded-for": "10.16.1.1" }, payload: JSON.stringify({ label: "" }) });
    expect(res.statusCode).toBe(400);
  });

  it("auto-share with invalid partner id → 400", async () => {
    const res = await app.inject({ method: "PUT", url: `/api/v1/guilds/${gid}/partnerships/not-a-snowflake/auto-share`, headers: { "content-type": "application/json", "x-forwarded-for": "10.16.1.2" }, payload: JSON.stringify({ autoShare: true }) });
    expect(res.statusCode).toBe(400);
  });

  it("openapi documents the partnership routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships"].get).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/invite"].post).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/accept"].post).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/{partnerGuildId}/auto-share"].put).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/{partnershipId}/revoke"].post).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/events/{eventId}/approve"].post).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/partnerships/events/{eventId}/decline"].post).toBeTruthy();
  });
});

describe("guild settings — gates + validation", () => {
  const gid = "123456789012345678"; // valid Discord snowflake
  const uid = "cmqffffffffffffffffff6";

  it("GET diagnostics anonymous → 401; bad id → 400; documented", async () => {
    const anon = await app.inject({ method: "GET", url: `/api/v1/guilds/${gid}/diagnostics` });
    expect(anon.statusCode).toBe(401);
    const bad = await app.inject({ method: "GET", url: "/api/v1/guilds/nope/diagnostics" });
    expect(bad.statusCode).toBe(400);
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/guilds/{id}/diagnostics"].get).toBeTruthy();
  });

  it("GET settings anonymous → 401 envelope", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/guilds/${gid}/settings` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("GET settings invalid guild id → 400 before auth/DB", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/guilds/not-a-snowflake/settings" });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("PATCH settings anonymous → 401 envelope", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/guilds/${gid}/settings`,
      headers: { "content-type": "application/json", "x-forwarded-for": "10.11.11.1" },
      payload: JSON.stringify({ orgName: "Test Org" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("PATCH settings invalid body → 400 before auth", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/v1/guilds/${gid}/settings`,
      headers: { "content-type": "application/json", "x-forwarded-for": "10.11.11.2" },
      payload: JSON.stringify({ orgName: 123 }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("PUT member role anonymous → 401 envelope", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/guilds/${gid}/members/${uid}/role`,
      headers: { "content-type": "application/json", "x-forwarded-for": "10.11.11.3" },
      payload: JSON.stringify({ role: "crew" }),
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("PUT member role invalid role → 400 before auth", async () => {
    const res = await app.inject({
      method: "PUT",
      url: `/api/v1/guilds/${gid}/members/${uid}/role`,
      headers: { "content-type": "application/json", "x-forwarded-for": "10.11.11.4" },
      payload: JSON.stringify({ role: "superadmin" }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("openapi documents the guild settings routes", async () => {
    const doc = (await app.inject({ method: "GET", url: "/api/v1/openapi.json" })).json();
    expect(doc.paths["/api/v1/guilds/{id}/settings"].get).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/settings"].patch).toBeTruthy();
    expect(doc.paths["/api/v1/guilds/{id}/members/{userId}/role"].put).toBeTruthy();
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

describe("e2e test-login seam", () => {
  it("is disabled (404) when E2E_TEST_LOGIN_SECRET is unset", async () => {
    const res = await app.inject({ method: "POST", url: "/e2e/login", headers: { "content-type": "application/json" }, payload: JSON.stringify({ username: "e2e-op" }) });
    expect(res.statusCode).toBe(404);
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
