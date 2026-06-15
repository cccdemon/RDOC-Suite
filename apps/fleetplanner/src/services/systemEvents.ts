// Admin "System & Logs" — persisted system events for the superadmin panel.
// Observability must never break the action it observes, so recordEvent() is
// strictly fire-and-forget and swallows its own failures. Retention is 10 days;
// pruneSystemEvents() is called from the catalog scheduler ticks.

import { prisma } from "../db.js";

export type EventLevel = "info" | "warn" | "error";

export const SYSTEM_EVENT_RETENTION_DAYS = 10;
const RETENTION_MS = SYSTEM_EVENT_RETENTION_DAYS * 24 * 60 * 60 * 1000;

function safeJson(v: unknown): string {
  if (v === undefined) return "";
  if (typeof v === "string") return v;
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

/** Record one system event. Never throws — logging must not break the caller. */
export async function recordEvent(
  level: EventLevel,
  category: string,
  message: string,
  detail?: unknown,
): Promise<void> {
  try {
    await prisma.systemEvent.create({
      data: {
        level,
        category,
        message: message.slice(0, 500),
        detail: safeJson(detail).slice(0, 4000),
      },
    });
  } catch {
    // intentionally swallowed
  }
}

export type SystemEventDto = {
  id: string;
  ts: string;
  level: string;
  category: string;
  message: string;
  detail: string;
};

/** List events within the retention window, newest first. `since` is clamped to
 *  the retention cutoff so the query can never scan beyond what we keep. */
export async function listSystemEvents(opts: {
  since?: Date;
  level?: EventLevel;
  category?: string;
  limit?: number;
}): Promise<SystemEventDto[]> {
  const limit = Math.min(Math.max(opts.limit ?? 200, 1), 1000);
  const cutoff = new Date(Date.now() - RETENTION_MS);
  const since = opts.since && opts.since > cutoff ? opts.since : cutoff;
  const rows = await prisma.systemEvent.findMany({
    where: {
      createdAt: { gte: since },
      ...(opts.level ? { level: opts.level } : {}),
      ...(opts.category ? { category: opts.category } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map((r) => ({
    id: r.id,
    ts: r.createdAt.toISOString(),
    level: r.level,
    category: r.category,
    message: r.message,
    detail: r.detail,
  }));
}

/** Delete events older than the retention window. Best-effort; returns count. */
export async function pruneSystemEvents(): Promise<number> {
  try {
    const r = await prisma.systemEvent.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - RETENTION_MS) } },
    });
    return r.count;
  } catch {
    return 0;
  }
}
