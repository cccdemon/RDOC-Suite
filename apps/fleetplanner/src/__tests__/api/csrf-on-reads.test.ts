import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A GET must not require a CSRF token.
//
// The SPA's get() helper sends `accept` and nothing else — no x-csrf-token,
// because a read has nothing to forge. Any GET routed through
// requireSessionJson therefore answers 403 "Invalid CSRF token." to every
// signed-in reader, while an anonymous one gets a plausible-looking 401. It
// fails only for the people who are logged in, which is why it survives both
// smoke tests and casual clicking.
//
// This has now happened twice: once on the templates marketplace, once on
// /changelog/unseen. The second one shipped and threw in the console on every
// page load for months. So the guard is structural rather than one more case:
// it reads the route file and refuses the shape, not the instance.

const SRC = readFileSync(fileURLToPath(new URL("../../routes/apiV1.ts", import.meta.url)), "utf8");

/** Every `app.get(...)` and the body up to the next route registration. */
function getRouteBodies(): Array<{ path: string; body: string }> {
  const out: Array<{ path: string; body: string }> = [];
  const re = /app\.get<[^>]*>\(\s*"([^"]+)"|app\.get\(\s*"([^"]+)"/g;
  const starts: Array<{ path: string; at: number }> = [];
  for (let m = re.exec(SRC); m; m = re.exec(SRC)) {
    starts.push({ path: m[1] ?? m[2], at: m.index });
  }
  for (let i = 0; i < starts.length; i++) {
    const from = starts[i].at;
    // Stop at the next route OR at a helper declared between routes. Without the
    // second one, `requireSuperadmin` — which sits between two registrations and
    // legitimately calls requireSessionJson — is blamed on the GET above it.
    const next = /app\.(get|post|put|patch|delete)[<(]|\n {2}(async )?function /g;
    next.lastIndex = from + 8;
    const hit = next.exec(SRC);
    out.push({ path: starts[i].path, body: SRC.slice(from, hit ? hit.index : SRC.length) });
  }
  return out;
}

describe("reads do not demand a CSRF token", () => {
  const routes = getRouteBodies();

  it("finds the GET routes at all, so a parser change cannot silently pass this", () => {
    expect(routes.length).toBeGreaterThan(20);
    expect(routes.map((r) => r.path)).toContain("/api/v1/changelog/unseen");
  });

  it("the changelog read takes a session without a token", () => {
    // The case that shipped: a 403 in the console on every page load for anyone
    // signed in, while an anonymous visitor saw a plausible 401.
    const body = routes.find((r) => r.path === "/api/v1/changelog/unseen")?.body ?? "";
    expect(body).toContain("optionalAuth");
    expect(body).not.toContain("requireSessionJson");
  });

  it("no GET route is guarded by requireSessionJson", () => {
    const offenders = routes
      .filter((r) => /\brequireSessionJson\s*\(/.test(r.body))
      .map((r) => r.path);
    // A GET that needs a session uses optionalAuth and answers 401 — the CSRF
    // check belongs to the state-changing half.
    expect(offenders).toEqual([]);
  });
});
