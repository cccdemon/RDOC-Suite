import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { sendDiscordDm } from "./discord.js";

type Logger = { info: (msg: string) => void; error: (e: unknown, msg: string) => void };

// Broad upper-bound pre-filter: fetch all ops within this window, then
// narrow per-guild by their own reminderOffsetMin.
const MAX_OFFSET_MIN = 120;

let running = false;

async function sendReminderForOp(
  op: { id: string; title: string; scheduledAt: Date },
  recipientUserIds: string[],
  log: Logger,
): Promise<void> {
  const env = getEnv();
  const opUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`;
  const minutesUntil = Math.round((op.scheduledAt.getTime() - Date.now()) / 60000);
  const timeStr = minutesUntil <= 0 ? "now" : `in ${minutesUntil} minute${minutesUntil === 1 ? "" : "s"}`;
  const message = [`Reminder: "${op.title}" starts ${timeStr}.`, `Operation: ${opUrl}`].join("\n");

  for (const userId of recipientUserIds) {
    try {
      await sendDiscordDm(userId, message);
    } catch (e) {
      log.error(e, `[reminder] DM failed for user ${userId} op ${op.id}`);
    }
  }
}

export async function runReminderCheck(log: Logger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const upperBound = new Date(now.getTime() + MAX_OFFSET_MIN * 60 * 1000);

    const ops = await prisma.operation.findMany({
      where: {
        status: { in: ["open", "locked", "in_progress"] },
        reminderSentAt: null,
        scheduledAt: { lte: upperBound },
      },
      include: {
        guild: { select: { reminderOffsetMin: true } },
        units: {
          where: { status: "accepted" },
          select: {
            captainId: true,
            seats: {
              where: { active: true, userId: { not: null } },
              select: { userId: true },
            },
          },
        },
      },
    });

    for (const op of ops) {
      const offsetMs = op.guild.reminderOffsetMin * 60 * 1000;
      if (op.scheduledAt.getTime() - now.getTime() > offsetMs) continue;

      const userIds = new Set<string>();
      for (const unit of op.units) {
        userIds.add(unit.captainId);
        for (const seat of unit.seats) {
          if (seat.userId) userIds.add(seat.userId);
        }
      }

      if (userIds.size > 0) {
        await sendReminderForOp(op, [...userIds], log);
        log.info(`[reminder] Sent reminder for op ${op.id} to ${userIds.size} users`);
      }

      await prisma.operation.update({
        where: { id: op.id },
        data: { reminderSentAt: now },
      });
    }
  } finally {
    running = false;
  }
}

export function startReminderScheduler(log: Logger): void {
  setTimeout(() => {
    void runReminderCheck(log);
    setInterval(() => void runReminderCheck(log), 60 * 1000);
  }, 5000);
}
