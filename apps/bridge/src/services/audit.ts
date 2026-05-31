import { randomBytes } from "node:crypto";
import { getPrisma } from "@rdoc-suite/db";

export type AuditEntryInput = {
  guildId?: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  target?: string | null;
  metadata?: Record<string, unknown>;
};

export async function appendAudit(entry: AuditEntryInput): Promise<void> {
  try {
    await getPrisma().adminAuditLog.create({
      data: {
        id: randomBytes(12).toString("hex"),
        guildId: entry.guildId ?? null,
        actorUserId: entry.actorUserId ?? null,
        actorLabel: entry.actorLabel ?? null,
        action: entry.action,
        target: entry.target ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
      },
    });
  } catch {
    // intentionally swallowed — audit must never interrupt the main flow
  }
}

export async function listRecentAudit(
  guildId: string,
  limit: number = 100,
  offset: number = 0,
) {
  return getPrisma().adminAuditLog.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
    skip: Math.max(offset, 0),
  });
}

export async function countAudit(guildId: string): Promise<number> {
  return getPrisma().adminAuditLog.count({ where: { guildId } });
}
