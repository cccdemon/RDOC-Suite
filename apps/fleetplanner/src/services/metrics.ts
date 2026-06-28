import { Registry, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import type { FastifyInstance } from "fastify";
import { prisma } from "../db.js";
import { OP_VISIBILITIES } from "./operations.js";

/**
 * Prometheus registry for the fleetplanner. Exposes:
 *  - default process metrics (prefix fleetplanner_)
 *  - HTTP request duration histogram
 *  - an operations-by-status gauge (computed at scrape time via Prisma)
 *
 * Scraped only over the internal docker network. The /metrics route would be
 * reachable as /fleetplanner/metrics through Caddy, so Caddy blocks that path
 * (see deploy/caddy-rdoc/Caddyfile).
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "fleetplanner_" });

const httpRequestDuration = new Histogram({
  name: "fleetplanner_http_request_duration_seconds",
  help: "Fleetplanner HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// Operations grouped by lifecycle status. Async collect — prom-client awaits
// the promise during registry.metrics(). Failures are swallowed so a DB hiccup
// never breaks the scrape.
const KNOWN_STATUSES = [
  "draft",
  "open",
  "locked",
  "in_progress",
  "completed",
  "cancelled",
];

new Gauge({
  name: "fleetplanner_operations",
  help: "Number of operations by lifecycle status",
  labelNames: ["status"],
  registers: [registry],
  async collect() {
    try {
      const grouped = await prisma.operation.groupBy({
        by: ["status"],
        _count: { _all: true },
      });
      const counts = new Map(grouped.map((g) => [g.status, g._count._all]));
      // Reset known statuses to 0 so a status that drops to zero is reported
      // as 0 rather than going stale.
      for (const status of KNOWN_STATUSES) {
        this.set({ status }, counts.get(status) ?? 0);
      }
      for (const [status, count] of counts) {
        if (!KNOWN_STATUSES.includes(status)) this.set({ status }, count);
      }
    } catch {
      // leave previous values in place on error
    }
  },
});

// Operations grouped by visibility (private | partners | public) plus a grand
// total. Same async-collect + swallow-on-error pattern as the status gauge.
new Gauge({
  name: "fleetplanner_operations_visibility",
  help: "Number of operations by visibility (private/partners/public)",
  labelNames: ["visibility"],
  registers: [registry],
  async collect() {
    try {
      const grouped = await prisma.operation.groupBy({
        by: ["visibility"],
        _count: { _all: true },
      });
      const counts = new Map(grouped.map((g) => [g.visibility, g._count._all]));
      for (const visibility of OP_VISIBILITIES) {
        this.set({ visibility }, counts.get(visibility) ?? 0);
      }
      for (const [visibility, count] of counts) {
        if (!(OP_VISIBILITIES as readonly string[]).includes(visibility))
          this.set({ visibility }, count);
      }
    } catch {
      // leave previous values in place on error
    }
  },
});

new Gauge({
  name: "fleetplanner_operations_total",
  help: "Total number of operations (all visibilities and statuses)",
  registers: [registry],
  async collect() {
    try {
      this.set(await prisma.operation.count());
    } catch {
      // leave previous value in place on error
    }
  },
});

/** Wire the HTTP histogram + /metrics route onto the fleetplanner app. */
export function registerMetrics(app: FastifyInstance): void {
  app.addHook("onResponse", async (request, reply) => {
    const route = request.routeOptions?.url ?? "unmatched";
    if (route === "/metrics") return;
    httpRequestDuration
      .labels(request.method, route, String(reply.statusCode))
      .observe(reply.elapsedTime / 1000);
  });

  app.get("/metrics", async (_req, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
}
