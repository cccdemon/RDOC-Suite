import { describe, expect, it } from "vitest";
import { RateLimiter } from "../../api/rateLimit.js";

describe("RateLimiter", () => {
  it("allows up to the limit inside a window, then blocks with retry seconds", () => {
    const rl = new RateLimiter(3, 60_000);
    const t0 = 1_000_000;
    expect(rl.hit("k", t0)).toBeNull();
    expect(rl.hit("k", t0 + 1)).toBeNull();
    expect(rl.hit("k", t0 + 2)).toBeNull();
    const retry = rl.hit("k", t0 + 30_000);
    expect(retry).not.toBeNull();
    expect(retry!).toBeGreaterThanOrEqual(1);
    expect(retry!).toBeLessThanOrEqual(30);
  });

  it("resets after the window elapses", () => {
    const rl = new RateLimiter(1, 60_000);
    const t0 = 0;
    expect(rl.hit("k", t0)).toBeNull();
    expect(rl.hit("k", t0 + 10)).not.toBeNull();
    expect(rl.hit("k", t0 + 60_001)).toBeNull();
  });

  it("buckets are independent per key", () => {
    const rl = new RateLimiter(1, 60_000);
    expect(rl.hit("a", 0)).toBeNull();
    expect(rl.hit("b", 0)).toBeNull();
    expect(rl.hit("a", 1)).not.toBeNull();
    expect(rl.hit("b", 1)).not.toBeNull();
  });

  it("sweeps stale buckets without affecting fresh ones", () => {
    const rl = new RateLimiter(1, 1_000);
    expect(rl.hit("old", 0)).toBeNull();
    // far in the future → sweep runs, old bucket dropped, key usable again
    expect(rl.hit("old", 10_000)).toBeNull();
  });
});
