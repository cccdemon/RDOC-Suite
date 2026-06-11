// FR-P2 §Abuse-Schutz — tiny in-memory sliding-window rate limiter for the
// /api/v1 surface. One fleetplanner container serves all traffic, so a
// process-local store is sufficient; if the service ever scales out this
// moves to Redis. No dependency on purpose.

type Bucket = { windowStart: number; count: number };

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();
  private lastSweep = Date.now();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  /** Returns null when allowed, otherwise seconds until the window resets. */
  hit(key: string, now = Date.now()): number | null {
    // Opportunistic sweep so abandoned keys don't accumulate forever.
    if (now - this.lastSweep > this.windowMs * 4) {
      for (const [k, b] of this.buckets) if (now - b.windowStart > this.windowMs) this.buckets.delete(k);
      this.lastSweep = now;
    }
    const b = this.buckets.get(key);
    if (!b || now - b.windowStart > this.windowMs) {
      this.buckets.set(key, { windowStart: now, count: 1 });
      return null;
    }
    b.count += 1;
    if (b.count > this.limit) {
      return Math.max(1, Math.ceil((b.windowStart + this.windowMs - now) / 1000));
    }
    return null;
  }
}

/** Mutations: 20 per minute per session/IP. */
export const mutationLimiter = new RateLimiter(20, 60_000);
/** Catalog search: 60 per minute per session/IP. */
export const searchLimiter = new RateLimiter(60, 60_000);
