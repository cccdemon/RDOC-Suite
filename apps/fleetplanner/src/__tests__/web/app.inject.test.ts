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

// The backend renders zero HTML for humans (API-only refactor, 2026-06-12): the
// info/legal pages are SPA routes fed by /api/v1/content/:slug, and the only
// server-rendered HTML left is the crawler-facing meta document that nginx
// routes bots to. Both are asserted here — the old /privacy-style SSR routes are
// gone on purpose and must stay gone.
describe("crawler HTML (bot-only, served behind the nginx user-agent switch)", () => {
  for (const path of ["/", "/handbuch", "/rechtliches"]) {
    it(`GET ${path} → 200 html`, async () => {
      const res = await app.inject({ method: "GET", url: path });
      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toContain("text/html");
      expect(res.body.length).toBeGreaterThan(0);
    });
  }

  it("carries only JSON-LD, never executable inline script", async () => {
    // The crawler doc is pure markup plus structured data. A real inline script
    // would be blocked by the app CSP (nginx: script-src 'self') and silently
    // break the page for bots.
    const res = await app.inject({ method: "GET", url: "/" });
    const scripts = res.body.match(/<script[^>]*>/gi) ?? [];
    expect(scripts.every((tag) => /type=["']application\/ld\+json["']/i.test(tag))).toBe(true);
    expect(res.body).toContain('"@context":"https://schema.org"');
  });
});

describe("former SSR page routes are gone", () => {
  for (const path of ["/privacy", "/license", "/impressum", "/how-to", "/changelog"]) {
    it(`GET ${path} → 404 (SPA route, not a backend page)`, async () => {
      expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(404);
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

describe("the legacy form-POST layer is gone", () => {
  // routes/api.ts (45 redirect-answering form POSTs) was removed 2026-08-22: no
  // client called it any more and every action lives under /api/v1. These are
  // the two shapes it served — both must now be unroutable, not merely rejected.
  it.each(["/api/seats/some-seat-id/unassign", "/api/ops/some-op-id/status"])(
    "%s is not routed",
    async (url) => {
      const res = await app.inject({ method: "POST", url, payload: {} });
      expect(res.statusCode).toBe(404);
    },
  );

  it("GET /api/ships is gone — the catalog lives at /api/v1/ships/search", async () => {
    const res = await app.inject({ method: "GET", url: "/api/ships?q=aurora" });
    expect(res.statusCode).toBe(404);
  });
});
