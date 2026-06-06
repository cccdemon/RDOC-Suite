// FR-P3 — Recurring operations (Approach A).
// Pure occurrence math (tz/DST-correct, no rrule dependency) for the
// Discord-representable pattern subset + a scheduler that rolling-spawns
// concrete Operation instances from a series template.
import { prisma } from "../db.js";
import { parseDateLocalTz, DEFAULT_TIMEZONE, isValidTimezone } from "../lib/timezone.js";
import { createOperation, type CreateOperationInput } from "./operations.js";

export type RecurrenceFreq = "weekly" | "biweekly" | "monthly_nth" | "yearly";

type Logger = { info: (msg: string) => void; error: (e: unknown, msg: string) => void };

export type RecurrenceLike = {
  freq: string;
  byWeekday: number | null;
  nthWeek: number | null;
  byMonth: number | null;
  byMonthDay: number | null;
  timeOfDay: string; // "HH:MM"
  timezone: string;
  anchorAt: Date;
};

// Civil-date helpers — treat a UTC midnight as a pure calendar date so that
// day arithmetic never drifts across DST boundaries.
function civilParts(d: Date, tz: string): { y: number; mo: number; day: number } {
  const safe = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: safe,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)?.value ?? 0);
  return { y: get("year"), mo: get("month"), day: get("day") };
}

// Mon=0 … Sun=6 for a civil y-m-d.
function weekdayMon0(y: number, mo: number, day: number): number {
  return (new Date(Date.UTC(y, mo - 1, day)).getUTCDay() + 6) % 7;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** The next occurrence strictly after `after`, in the series' timezone. */
export function nextOccurrence(rec: RecurrenceLike, after: Date): Date | null {
  const tz = isValidTimezone(rec.timezone) ? rec.timezone : DEFAULT_TIMEZONE;
  const start = civilParts(after, tz);
  // Anchor civil midnight (UTC carrier) for biweekly parity.
  const a = civilParts(rec.anchorAt, tz);
  const anchorCivil = Date.UTC(a.y, a.mo - 1, a.day);

  // Iterate calendar days from `after`'s tz-day forward (cap covers yearly).
  const carrier = new Date(Date.UTC(start.y, start.mo - 1, start.day));
  for (let i = 0; i <= 800; i++) {
    const y = carrier.getUTCFullYear();
    const mo = carrier.getUTCMonth() + 1;
    const day = carrier.getUTCDate();
    if (matchesDay(rec, y, mo, day, anchorCivil)) {
      const dt = parseDateLocalTz(`${y}-${pad2(mo)}-${pad2(day)}T${rec.timeOfDay}`, tz);
      if (dt && dt.getTime() > after.getTime()) return dt;
    }
    carrier.setUTCDate(carrier.getUTCDate() + 1);
  }
  return null;
}

function matchesDay(
  rec: RecurrenceLike,
  y: number,
  mo: number,
  day: number,
  anchorCivil: number,
): boolean {
  const wd = weekdayMon0(y, mo, day);
  switch (rec.freq) {
    case "weekly":
      return wd === rec.byWeekday;
    case "biweekly": {
      if (wd !== rec.byWeekday) return false;
      const civil = Date.UTC(y, mo - 1, day);
      const weeks = Math.round((civil - anchorCivil) / (7 * 86400000));
      return weeks % 2 === 0;
    }
    case "monthly_nth": {
      if (wd !== rec.byWeekday) return false;
      const nth = Math.floor((day - 1) / 7) + 1; // 1..5
      return nth === rec.nthWeek;
    }
    case "yearly":
      return mo === rec.byMonth && day === rec.byMonthDay;
    default:
      return false;
  }
}

/** Map to Discord's constrained `recurrence_rule`, or null if not representable. */
export function discordRecurrenceRule(
  rec: RecurrenceLike,
  startISO: string,
): Record<string, unknown> | null {
  switch (rec.freq) {
    case "weekly":
      return { start: startISO, frequency: 2, interval: 1, by_weekday: [rec.byWeekday] };
    case "biweekly":
      return { start: startISO, frequency: 2, interval: 2, by_weekday: [rec.byWeekday] };
    case "monthly_nth":
      return {
        start: startISO,
        frequency: 1,
        interval: 1,
        by_n_weekday: [{ n: rec.nthWeek, day: rec.byWeekday }],
      };
    case "yearly":
      return {
        start: startISO,
        frequency: 0,
        interval: 1,
        by_month: [rec.byMonth],
        by_month_day: [rec.byMonthDay],
      };
    default:
      return null;
  }
}

let running = false;

/**
 * Rolling spawn: for each active series whose next occurrence is within its
 * lead time, materialise a concrete Operation (status "open"), then advance to
 * the following occurrence. Enforces seriesEnd / seriesCount (Discord can't).
 */
export async function spawnDueOccurrences(log: Logger): Promise<void> {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const recs = await prisma.operationRecurrence.findMany({ where: { active: true } });
    for (const rec of recs) {
      let guard = 0;
      while (rec.active && guard++ < 24) {
        const leadMs = rec.leadTimeHours * 3600_000;
        if (rec.nextRunAt.getTime() - leadMs > now) break; // not due yet

        // Series end reached → stop before spawning this one.
        if (
          (rec.seriesEnd && rec.nextRunAt.getTime() > rec.seriesEnd.getTime()) ||
          (rec.seriesCount != null && rec.spawnedCount >= rec.seriesCount)
        ) {
          await prisma.operationRecurrence.update({
            where: { id: rec.id },
            data: { active: false },
          });
          rec.active = false;
          break;
        }

        try {
          const tmpl = JSON.parse(rec.templateJson) as Partial<CreateOperationInput>;
          const op = await createOperation(rec.createdById, {
            guildId: rec.guildId,
            title: tmpl.title ?? "Operation",
            description: tmpl.description ?? "",
            opType: tmpl.opType,
            visibility: tmpl.visibility,
            meetingSystem: tmpl.meetingSystem,
            meetingLocation: tmpl.meetingLocation,
            minParticipants: tmpl.minParticipants,
            maxParticipants: tmpl.maxParticipants,
            scheduledAt: rec.nextRunAt,
          });
          await prisma.operation.update({
            where: { id: op.id },
            data: { recurrenceId: rec.id, occurrenceAt: rec.nextRunAt, status: "open" },
          });
          log.info(`[recurrence] spawned op ${op.id} for series ${rec.id}`);
        } catch (e) {
          log.error(e, `[recurrence] spawn failed for series ${rec.id}`);
          break; // don't advance on failure — retry next tick
        }

        const next = nextOccurrence(rec, rec.nextRunAt);
        const spawnedCount = rec.spawnedCount + 1;
        const ended =
          !next ||
          (rec.seriesCount != null && spawnedCount >= rec.seriesCount) ||
          (rec.seriesEnd != null && next.getTime() > rec.seriesEnd.getTime());
        await prisma.operationRecurrence.update({
          where: { id: rec.id },
          data: {
            nextRunAt: next ?? rec.nextRunAt,
            lastSpawnedAt: new Date(),
            spawnedCount,
            active: !ended,
          },
        });
        rec.nextRunAt = next ?? rec.nextRunAt;
        rec.spawnedCount = spawnedCount;
        rec.active = !ended;
      }
    }
  } finally {
    running = false;
  }
}

function hhmmInTz(d: Date, tz: string): string {
  const safe = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: safe,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  const h = get("hour") === "24" ? "00" : get("hour");
  return `${h}:${get("minute")}`;
}

/**
 * Turn a freshly-created op into the first occurrence of a recurring series.
 * The pattern (weekday / nth-week / month-day) is derived from the op's own
 * scheduled date in the guild timezone, so the operator only picks a frequency.
 */
export async function createSeriesForOp(opts: {
  op: {
    id: string;
    guildId: string;
    createdById: string;
    scheduledAt: Date;
    title: string;
    description: string;
    opType: string;
    visibility: string;
    meetingSystem: string;
    meetingLocation: string;
    minParticipants: number;
    maxParticipants: number | null;
  };
  freq: RecurrenceFreq;
  timezone: string;
  seriesEnd?: Date | null;
  seriesCount?: number | null;
  leadTimeHours?: number;
}) {
  const tz = isValidTimezone(opts.timezone) ? opts.timezone : DEFAULT_TIMEZONE;
  const { y, mo, day } = civilParts(opts.op.scheduledAt, tz);
  const timeOfDay = hhmmInTz(opts.op.scheduledAt, tz);
  const byWeekday = weekdayMon0(y, mo, day);
  const nthWeek = Math.floor((day - 1) / 7) + 1;

  const pattern: RecurrenceLike = {
    freq: opts.freq,
    byWeekday,
    nthWeek,
    byMonth: mo,
    byMonthDay: day,
    timeOfDay,
    timezone: tz,
    anchorAt: opts.op.scheduledAt,
  };
  const second = nextOccurrence(pattern, opts.op.scheduledAt);

  const templateJson = JSON.stringify({
    title: opts.op.title,
    description: opts.op.description,
    opType: opts.op.opType,
    visibility: opts.op.visibility,
    meetingSystem: opts.op.meetingSystem,
    meetingLocation: opts.op.meetingLocation,
    minParticipants: opts.op.minParticipants,
    maxParticipants: opts.op.maxParticipants,
  });

  const rec = await prisma.operationRecurrence.create({
    data: {
      guildId: opts.op.guildId,
      createdById: opts.op.createdById,
      freq: opts.freq,
      byWeekday: opts.freq === "yearly" ? null : byWeekday,
      nthWeek: opts.freq === "monthly_nth" ? nthWeek : null,
      byMonth: opts.freq === "yearly" ? mo : null,
      byMonthDay: opts.freq === "yearly" ? day : null,
      timeOfDay,
      timezone: tz,
      anchorAt: opts.op.scheduledAt,
      seriesEnd: opts.seriesEnd ?? null,
      seriesCount: opts.seriesCount ?? null,
      spawnedCount: 1, // the op we just created is occurrence #1
      leadTimeHours: opts.leadTimeHours ?? 168,
      nextRunAt: second ?? opts.op.scheduledAt,
      active: !!second,
      templateJson,
    },
  });
  await prisma.operation.update({
    where: { id: opts.op.id },
    data: { recurrenceId: rec.id, occurrenceAt: opts.op.scheduledAt },
  });
  return rec;
}

export function startRecurrenceScheduler(log: Logger): void {
  setTimeout(() => {
    void spawnDueOccurrences(log);
    setInterval(() => void spawnDueOccurrences(log), 5 * 60 * 1000);
  }, 8000);
}
