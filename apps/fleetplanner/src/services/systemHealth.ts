// Admin "System & Logs" — service health aggregation. Scope (decided with the
// user): DB + scheduler + the two catalog syncs. No cross-service pings
// (bridge/livekit/discord) — those are out of scope for this panel.

import { prisma } from "../db.js";
import { getSyncState } from "./shipSync.js";
import { getLocationSyncState } from "./locations.js";

export type HealthStatus = "ok" | "warn" | "error" | "down";

// Mirror of the sync runners' stale-claim threshold: a run still flagged running
// but untouched for longer than this is stuck (crashed without releasing).
const STALE_RUN_MS = 30 * 60 * 1000;

export type ServiceHealth = {
  key: string;
  name: string;
  status: HealthStatus;
  detail: string;
};

export type SyncHealth = {
  key: "ship" | "location";
  name: string;
  enabled: boolean;
  running: boolean;
  stale: boolean;
  lastRun: string | null;
  lastResult: string | null;
  intervalDays: number;
  count: number;
  status: HealthStatus;
};

export type SystemHealth = {
  checkedAt: string;
  services: ServiceHealth[];
  syncs: SyncHealth[];
};

type SyncRow = {
  enabled: boolean;
  running: boolean;
  lastRunAt: Date | null;
  lastResult: string | null;
  intervalDays: number;
  updatedAt: Date;
};

function toSyncHealth(key: "ship" | "location", name: string, s: SyncRow, count: number): SyncHealth {
  const now = Date.now();
  const stale = s.running && now - s.updatedAt.getTime() > STALE_RUN_MS;
  const failed = (s.lastResult ?? "").includes("ERROR");
  const status: HealthStatus = stale || failed ? "error" : s.running ? "warn" : "ok";
  return {
    key,
    name,
    enabled: s.enabled,
    running: s.running,
    stale,
    lastRun: s.lastRunAt ? s.lastRunAt.toISOString() : null,
    lastResult: s.lastResult,
    intervalDays: s.intervalDays,
    count,
    status,
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const services: ServiceHealth[] = [];

  // DB connectivity — a trivial round-trip.
  let dbOk = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  services.push({
    key: "db",
    name: "Datenbank (PostgreSQL)",
    status: dbOk ? "ok" : "down",
    detail: dbOk ? "Verbindung ok" : "Keine Verbindung",
  });

  // Catalog syncs.
  const [ship, loc] = await Promise.all([getSyncState(), getLocationSyncState()]);
  const syncs: SyncHealth[] = [
    toSyncHealth("ship", "Schiffskatalog-Sync", ship, ship.shipCount),
    toSyncHealth("location", "Standortkatalog-Sync", loc, loc.locationCount),
  ];

  // Scheduler — derived from the syncs: a stuck (stale) lock means the scheduler
  // can't make progress on that catalog.
  const anyStale = syncs.some((s) => s.stale);
  const anyDisabled = syncs.some((s) => !s.enabled);
  services.push({
    key: "scheduler",
    name: "Katalog-Scheduler",
    status: anyStale ? "error" : anyDisabled ? "warn" : "ok",
    detail: anyStale
      ? "Ein Sync hängt (stale lock)"
      : anyDisabled
        ? "Auto-Refresh für einen Katalog deaktiviert"
        : "Stündlicher Tick aktiv",
  });

  // Operations + per-Discord event metrics moved to the Admin-Konsole
  // (AdminSettings.operations + AdminGuild.eventCount) — not part of this panel.

  return { checkedAt: new Date().toISOString(), services, syncs };
}
