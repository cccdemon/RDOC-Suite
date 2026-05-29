// Ship-catalog sync orchestration: the ShipSyncState singleton, the
// run-guard (no overlapping syncs), and the periodic scheduler.

import { prisma } from "../db.js";
import { syncShipCatalog } from "./scwiki.js";

const SINGLETON_ID = "singleton";
// How often the scheduler wakes up to check whether a sync is due. The
// actual cadence is driven by ShipSyncState.intervalDays, not this tick.
const TICK_MS = 60 * 60 * 1000; // hourly

let timer: ReturnType<typeof setInterval> | null = null;

export async function getSyncState() {
  return prisma.shipSyncState.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
}

export async function updateSyncConfig(input: {
  enabled?: boolean;
  intervalDays?: number;
}): Promise<void> {
  await prisma.shipSyncState.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.intervalDays !== undefined && { intervalDays: clampInterval(input.intervalDays) }),
    },
    update: {
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.intervalDays !== undefined && { intervalDays: clampInterval(input.intervalDays) }),
    },
  });
}

function clampInterval(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.min(90, Math.max(1, Math.trunc(days)));
}

function isDue(state: { lastRunAt: Date | null; intervalDays: number }): boolean {
  if (!state.lastRunAt) return true;
  const dueAt = state.lastRunAt.getTime() + state.intervalDays * 24 * 60 * 60 * 1000;
  return Date.now() >= dueAt;
}

/**
 * Run a full catalog sync. Guarded by the `running` flag so the weekly
 * tick and a manual "Sync now" can't overlap. Returns null if a sync was
 * already in flight, otherwise the result summary.
 */
export async function runSync(
  trigger: "manual" | "scheduled",
): Promise<{ fetched: number; failed: number; total: number } | null> {
  // Atomic claim of the running flag: updateMany with running:false guard.
  const claimed = await prisma.shipSyncState.updateMany({
    where: { id: SINGLETON_ID, running: false },
    data: { running: true },
  });
  if (claimed.count === 0) {
    // Either no row yet, or a run is already in flight.
    const existing = await prisma.shipSyncState.findUnique({ where: { id: SINGLETON_ID } });
    if (existing?.running) return null;
    // No row yet → create it already-claimed, then proceed.
    await prisma.shipSyncState.create({ data: { id: SINGLETON_ID, running: true } });
  }

  try {
    const result = await syncShipCatalog();
    const shipCount = await prisma.ship.count();
    await prisma.shipSyncState.update({
      where: { id: SINGLETON_ID },
      data: {
        running: false,
        lastRunAt: new Date(),
        shipCount,
        lastResult: `${trigger}: ${result.fetched}/${result.total} ships (${result.failed} failed)`,
      },
    });
    return result;
  } catch (err) {
    await prisma.shipSyncState
      .update({
        where: { id: SINGLETON_ID },
        data: {
          running: false,
          lastRunAt: new Date(),
          lastResult: `${trigger}: ERROR ${err instanceof Error ? err.message : String(err)}`,
        },
      })
      .catch(() => null);
    throw err;
  }
}

/**
 * Start the periodic scheduler. On each tick (and once shortly after
 * boot) it runs a sync if the catalog is enabled and due. Safe to call
 * once at startup; the timer is unref'd so it never holds the process open.
 */
export function startShipSyncScheduler(log?: { info: (msg: string) => void; error: (e: unknown, msg: string) => void }): void {
  if (timer) return;
  const tick = async () => {
    try {
      const state = await getSyncState();
      if (!state.enabled || state.running) return;
      if (!isDue(state)) return;
      log?.info("[shipSync] catalog refresh due — starting scheduled sync");
      const r = await runSync("scheduled");
      if (r) log?.info(`[shipSync] scheduled sync done: ${r.fetched}/${r.total}`);
    } catch (err) {
      log?.error(err, "[shipSync] scheduled sync failed");
    }
  };
  // Kick a check ~30s after boot (don't block startup), then hourly.
  setTimeout(() => void tick(), 30_000).unref?.();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}

export function stopShipSyncScheduler(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
