// Admin "System & Logs" — service health aggregation. Scope (decided with the
// user): DB + scheduler + the two catalog syncs. No cross-service pings
// (bridge/livekit/discord) — those are out of scope for this panel.

import { prisma } from "../db.js";
import { getSyncState } from "./shipSync.js";
import { getLocationSyncState } from "./locations.js";
import { E2E_GUILD_IDS } from "./guilds.js";

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

export type OperationsMetric = {
  total: number;
  private: number;
  partners: number;
  public: number;
};

export type GuildEventsMetric = {
  guildId: string;
  name: string;
  events: number;
};

export type SystemHealth = {
  checkedAt: string;
  services: ServiceHealth[];
  syncs: SyncHealth[];
  operations: OperationsMetric;
  guildEvents: GuildEventsMetric[];
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

  // Operations metric: total + per-visibility breakdown (private/partners/public).
  // E2E test guilds are excluded everywhere so synthetic data never inflates the
  // real numbers a superadmin reads.
  const realOps = { guildId: { notIn: E2E_GUILD_IDS } };
  let operations: OperationsMetric = { total: 0, private: 0, partners: 0, public: 0 };
  try {
    // total = ALL real operations (count). The named buckets cover the current
    // visibilities; legacy values (e.g. "guild") are part of total but not
    // shown as their own tile, so the buckets may sum to less than total.
    const [total, grouped] = await Promise.all([
      prisma.operation.count({ where: realOps }),
      prisma.operation.groupBy({ by: ["visibility"], where: realOps, _count: { _all: true } }),
    ]);
    const by = new Map(grouped.map((g) => [g.visibility, g._count._all]));
    operations = {
      total,
      private: by.get("private") ?? 0,
      partners: by.get("partners") ?? 0,
      public: by.get("public") ?? 0,
    };
  } catch {
    // DB hiccup — report zeros rather than failing the whole health payload
  }

  // Events per Discord: op count per active guild (E2E excluded). Guilds with 0
  // ops are kept (count 0) so a superadmin can spot inactive Discords; sorted
  // most-active first → first entry = "most active Discord for events".
  let guildEvents: GuildEventsMetric[] = [];
  try {
    const [guilds, grouped] = await Promise.all([
      prisma.guild.findMany({
        where: { active: true, id: { notIn: E2E_GUILD_IDS } },
        select: { id: true, name: true },
      }),
      prisma.operation.groupBy({ by: ["guildId"], where: realOps, _count: { _all: true } }),
    ]);
    const counts = new Map(grouped.map((g) => [g.guildId, g._count._all]));
    guildEvents = guilds
      .map((g) => ({ guildId: g.id, name: g.name, events: counts.get(g.id) ?? 0 }))
      .sort((a, b) => b.events - a.events || a.name.localeCompare(b.name));
  } catch {
    guildEvents = [];
  }

  return { checkedAt: new Date().toISOString(), services, syncs, operations, guildEvents };
}
