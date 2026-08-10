// FR-P2 — Discord scheduled-event "Interested" → auto needs-assignment.
//
// The Fleetplanner bot is REST-only, so we POLL each open op's scheduled-event
// interested-user list (5-min tick) and diff it against EventInterest rows:
//   - new interested  → upsert status="interested" (resolve userId via an
//                       existing Discord identity, else a shadow row)
//   - no longer there → status="withdrawn"; if the linked user holds a seat in
//                       this op, free it (decision 2 — the Discord RSVP is the
//                       source of truth for bare interest)
// Shadows are claimed on the pilot's first Discord login (claimInterestShadows).

import { prisma } from "../db.js";
import { listScheduledEventUsers } from "./discord.js";

type Logger = { info: (msg: string) => void; error: (e: unknown, msg: string) => void };

/** Map a Discord snowflake → Fleetplanner userId if an identity (or legacy id) exists. */
async function resolveUserId(discordUserId: string): Promise<string | null> {
  const identity = await prisma.userIdentity.findUnique({
    where: { provider_providerId: { provider: "discord", providerId: discordUserId } },
    select: { userId: true },
  });
  if (identity?.userId) return identity.userId;
  const legacy = await prisma.user.findUnique({
    where: { id: discordUserId },
    select: { id: true },
  });
  return legacy?.id ?? null;
}

/** Free every active seat held by userId within operationId (decision 2). */
async function freeSeatsForUserInOp(operationId: string, userId: string): Promise<void> {
  await prisma.seatAssignment.updateMany({
    where: { userId, active: true, fleetUnit: { operationId } },
    data: { userId: null },
  });
}

/**
 * Reconcile one op's EventInterest rows against the live Discord interested
 * list. Idempotent. Returns counts for logging.
 */
export async function syncOpInterest(op: {
  id: string;
  guildId: string;
  discordEventId: string;
}): Promise<{ added: number; withdrawn: number; total: number }> {
  const live = await listScheduledEventUsers(op.guildId, op.discordEventId);
  const liveIds = new Set(live.map((u) => u.discordUserId));

  let added = 0;
  let withdrawn = 0;

  // Upsert everyone currently interested.
  for (const u of live) {
    const existing = await prisma.eventInterest.findUnique({
      where: {
        operationId_discordUserId: { operationId: op.id, discordUserId: u.discordUserId },
      },
    });
    if (!existing) {
      const userId = await resolveUserId(u.discordUserId);
      await prisma.eventInterest.create({
        data: {
          operationId: op.id,
          discordUserId: u.discordUserId,
          userId,
          displayName: u.displayName,
          status: "interested",
        },
      });
      added++;
    } else if (existing.status === "withdrawn") {
      // Re-clicked Interested after withdrawing — revive (keep a converted row as-is).
      await prisma.eventInterest.update({
        where: { id: existing.id },
        data: { status: "interested", displayName: u.displayName },
      });
    } else {
      // Refresh display name (nick can change). Resolve userId if still a shadow.
      const userId = existing.userId ?? (await resolveUserId(u.discordUserId));
      await prisma.eventInterest.update({
        where: { id: existing.id },
        data: { displayName: u.displayName, userId },
      });
    }
  }

  // Anyone we tracked as interested who is no longer in the list → withdrawn.
  const tracked = await prisma.eventInterest.findMany({
    where: { operationId: op.id, status: "interested" },
  });
  for (const row of tracked) {
    if (liveIds.has(row.discordUserId)) continue;
    await prisma.eventInterest.update({
      where: { id: row.id },
      data: { status: "withdrawn" },
    });
    if (row.userId) await freeSeatsForUserInOp(op.id, row.userId);
    withdrawn++;
  }

  return { added, withdrawn, total: live.length };
}

/**
 * On a pilot's first Discord login, attach any shadow EventInterest rows
 * (userId null) for their snowflake to the now-known Fleetplanner user.
 */
export async function claimInterestShadows(
  userId: string,
  discordUserId: string,
): Promise<void> {
  await prisma.eventInterest.updateMany({
    where: { discordUserId, userId: null },
    data: { userId },
  });
}

/**
 * Counts for the manage board: linked interested users vs. ones the system
 * doesn't know yet ("Dem System bisher unbekannte Nutzer").
 */
export async function interestSummary(
  operationId: string,
): Promise<{ linked: number; unknown: number }> {
  const [linked, unknown] = await Promise.all([
    prisma.eventInterest.count({
      where: { operationId, status: "interested", userId: { not: null } },
    }),
    prisma.eventInterest.count({
      where: { operationId, status: "interested", userId: null },
    }),
  ]);
  return { linked, unknown };
}

// ── Scheduler (5-min tick) ─────────────────────────────────────────
let running = false;

export async function runInterestSync(log: Logger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const ops = await prisma.operation.findMany({
      where: {
        status: { in: ["open", "locked", "in_progress"] },
        discordEventId: { not: null },
      },
      select: { id: true, guildId: true, discordEventId: true },
    });
    for (const op of ops) {
      if (!op.discordEventId) continue;
      try {
        const r = await syncOpInterest({
          id: op.id,
          guildId: op.guildId,
          discordEventId: op.discordEventId,
        });
        if (r.added || r.withdrawn) {
          log.info(
            `[interest] op ${op.id}: +${r.added} interested, ${r.withdrawn} withdrawn (${r.total} live)`,
          );
        }
      } catch (e) {
        log.error(e, `[interest] sync failed for op ${op.id}`);
      }
    }
  } finally {
    running = false;
  }
}

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000;
const MIN_INTERVAL_MS = 2000;

/**
 * Poll interval. Tunable via EVENT_INTEREST_INTERVAL_MS so the local test stack
 * can watch a Discord RSVP land within a test's lifetime instead of five
 * minutes. Floored at 2s and defaulted to the production 5 min.
 */
export function interestSyncIntervalMs(): number {
  const raw = Number(process.env.EVENT_INTEREST_INTERVAL_MS);
  if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_INTERVAL_MS;
  return Math.max(MIN_INTERVAL_MS, Math.floor(raw));
}

export function startEventInterestScheduler(log: Logger): void {
  const interval = interestSyncIntervalMs();
  setTimeout(() => {
    void runInterestSync(log);
    setInterval(() => void runInterestSync(log), interval);
  }, Math.min(15000, interval));
}
