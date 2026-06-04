import { Registry, Histogram, Gauge, collectDefaultMetrics } from "prom-client";
import { rooms } from "./rooms.js";

/**
 * Central Prometheus registry for the bridge. Exposes:
 *  - default process metrics (prefix bridge_)
 *  - HTTP request duration histogram
 *  - a live WebSocket-connection gauge
 *  - the legacy dccc_* room gauges (computed at scrape time)
 *
 * Scraped only over the internal docker network; Caddy blocks /metrics on
 * the public host (see deploy/caddy-rdoc/Caddyfile).
 */
export const registry = new Registry();

collectDefaultMetrics({ register: registry, prefix: "bridge_" });

export const httpRequestDuration = new Histogram({
  name: "bridge_http_request_duration_seconds",
  help: "Bridge HTTP request duration in seconds",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

const wsConnections = new Gauge({
  name: "bridge_ws_connections",
  help: "Currently open commander WebSocket connections",
  registers: [registry],
});

export function wsConnectionOpened(): void {
  wsConnections.inc();
}

export function wsConnectionClosed(): void {
  wsConnections.dec();
}

// Legacy room metrics — kept under their original dccc_ names so existing
// dashboards/queries keep working. Computed lazily on each scrape.
new Gauge({
  name: "dccc_rooms_active",
  help: "Number of guild bridge rooms with at least one connected commander",
  registers: [registry],
  collect() {
    this.set(rooms.globalMetrics().activeRooms);
  },
});

new Gauge({
  name: "dccc_commanders_active",
  help: "Total commanders connected via WebSocket",
  registers: [registry],
  collect() {
    this.set(rooms.globalMetrics().activeCommanders);
  },
});

new Gauge({
  name: "dccc_commanders_speaking",
  help: "Commanders currently transmitting audio (PTT active)",
  registers: [registry],
  collect() {
    this.set(rooms.globalMetrics().speakingCommanders);
  },
});
