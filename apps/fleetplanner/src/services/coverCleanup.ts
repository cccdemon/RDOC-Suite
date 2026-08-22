import { prisma } from "../db.js";
import { coverServiceConfigured, deleteCover } from "./coverService.js";

type Logger = { info: (msg: string) => void; error: (e: unknown, msg: string) => void };

// Mission covers are kept only while an op is live/relevant. Once an op is
// finished (completed) or cancelled AND its event date is older than this many
// days, the rendered image is purged from the mission-cover service and the
// OpCover pointer row is dropped.
const RETENTION_DAYS = 14;
const CLEANUP_STATUSES = ["completed", "cancelled"];
const INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h

let running = false;

async function runCoverCleanup(log: Logger): Promise<void> {
  if (running || !coverServiceConfigured()) return;
  running = true;
  try {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const stale = await prisma.opCover.findMany({
      where: {
        operation: { status: { in: CLEANUP_STATUSES }, scheduledAt: { lt: cutoff } },
      },
      select: { opId: true, coverId: true },
    });
    if (stale.length === 0) return;

    let purged = 0;
    for (const row of stale) {
      try {
        await deleteCover(row.coverId);
        await prisma.opCover.delete({ where: { opId: row.opId } });
        purged++;
      } catch (e) {
        log.error(e, `[cover-cleanup] failed to purge cover for op ${row.opId}`);
      }
    }
    if (purged > 0) log.info(`[cover-cleanup] purged ${purged} cover(s) for closed/cancelled ops`);
  } finally {
    running = false;
  }
}

export function startCoverCleanupScheduler(log: Logger): void {
  // Initial run shortly after boot, then on a fixed interval.
  setTimeout(() => {
    void runCoverCleanup(log);
    setInterval(() => void runCoverCleanup(log), INTERVAL_MS);
  }, 30_000);
}
