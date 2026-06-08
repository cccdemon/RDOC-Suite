import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";

// Route-level smoke tests via Fastify .inject() — exercises the real app
// wiring (plugins, route registration, render pipeline) for endpoints that
// don't touch the database. (Prio 3 starter; DB-backed routes need a test DB.)
let app: FastifyInstance;

beforeAll(async () => {
  app = (await buildApp()) as unknown as FastifyInstance;
  await app.ready();
});
afterAll(async () => {
  await app.close();
});

describe("static pages", () => {
  for (const path of ["/privacy", "/license", "/impressum", "/how-to", "/changelog"]) {
    it(`GET ${path} → 200 html`, async () => {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body.length).toBeGreaterThan(0);
    });
  }
});

describe("unknown route", () => {
  it("GET /does-not-exist-xyz → 404", async () => {
    const res = await app.inject({ method: "GET", url: "/does-not-exist-xyz" });
    expect(res.statusCode).toBe(404);
  });
});

describe("csrf gate", () => {
  it("POST without auth is rejected (redirect to login or 4xx, never a 2xx success)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ops/new",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: "title=x",
    });
    // Unauthenticated → redirect to login (302) or an auth error; never a 2xx success.
    expect(res.statusCode).toBeGreaterThanOrEqual(300);
  });
});
