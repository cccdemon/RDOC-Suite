import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

// FR-P3 Polls — route-level tests via app.inject(). Like the rest of the
// /api/v1 inject suite these run without a database: covered cases either
// reject before any DB access (bad id → 400, no session → 401) or must fail
// CLOSED with the JSON error envelope, never HTML.
let app: FastifyInstance;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("OpenAPI documents the poll routes", () => {
  it("includes the polls paths", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/openapi.json" });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.paths["/api/v1/polls"]).toBeTruthy();
    expect(doc.paths["/api/v1/polls"].get).toBeTruthy();
    expect(doc.paths["/api/v1/polls"].post).toBeTruthy();
    expect(doc.paths["/api/v1/polls/{id}"]).toBeTruthy();
    expect(doc.paths["/api/v1/polls/{id}/vote"]).toBeTruthy();
    expect(doc.paths["/api/v1/polls/{id}/options"]).toBeTruthy();
    expect(doc.components.schemas.PollDetail).toBeTruthy();
    expect(doc.components.schemas.CreatePollRequest).toBeTruthy();
  });
});

describe("GET /api/v1/polls/:id", () => {
  it("rejects a malformed id with a 400 envelope (no DB hit)", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/polls/not-a-valid-id!" });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json().error.code).toBe("bad_request");
    expect(res.body).not.toContain("<html");
  });
});

describe("mutations require a session", () => {
  it("POST /api/v1/polls without a session → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/v1/polls",
      payload: { guildId: "123456789012345678", title: "x", options: ["a", "b"] },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("POST /api/v1/polls/:id/vote rejects a bad id before auth → 400", async () => {
    const res = await app.inject({ method: "POST", url: "/api/v1/polls/bad!/vote", payload: { optionIds: ["x"] } });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe("bad_request");
  });

  it("DELETE /api/v1/polls/:id without a session → 401", async () => {
    const res = await app.inject({ method: "DELETE", url: "/api/v1/polls/aaaaaaaaaaaaaaaaaaaaaa" });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });
});

describe("GET /api/v1/polls (list)", () => {
  it("always answers JSON, never HTML", async () => {
    const res = await app.inject({ method: "GET", url: "/api/v1/polls" });
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.body).not.toContain("<html");
    // 200 with a (possibly empty) list when the DB is up, or a fail-closed
    // 500 envelope when it is not — never a leak, never HTML.
    expect([200, 500]).toContain(res.statusCode);
  });
});
