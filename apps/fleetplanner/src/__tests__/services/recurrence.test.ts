import { describe, it, expect } from "vitest";
import {
  nextOccurrence,
  upcomingOccurrences,
  discordRecurrenceRule,
  type RecurrenceLike,
} from "../../services/recurrence.js";
import { parseDateLocalTz, fmtDateLocalTz } from "../../lib/timezone.js";

const TZ = "Europe/Berlin";
// 2026-06-06 is a Saturday.
const anchor = parseDateLocalTz("2026-06-06T20:00", TZ)!;
const SAT = (new Date(Date.UTC(2026, 5, 6)).getUTCDay() + 6) % 7; // Mon=0 → Sat=5

function base(freq: string): RecurrenceLike {
  return {
    freq,
    byWeekday: SAT,
    nthWeek: 1, // 2026-06-06 is the 1st Saturday
    byMonth: 6,
    byMonthDay: 6,
    timeOfDay: "20:00",
    timezone: TZ,
    anchorAt: anchor,
  };
}

describe("nextOccurrence", () => {
  it("weekly → next same weekday a week later", () => {
    const n = nextOccurrence(base("weekly"), anchor)!;
    expect(fmtDateLocalTz(n, TZ)).toBe("2026-06-13T20:00");
  });

  it("biweekly → skips the in-between week", () => {
    const n = nextOccurrence(base("biweekly"), anchor)!;
    expect(fmtDateLocalTz(n, TZ)).toBe("2026-06-20T20:00");
  });

  it("monthly_nth → 1st Saturday of next month", () => {
    const n = nextOccurrence(base("monthly_nth"), anchor)!;
    expect(fmtDateLocalTz(n, TZ)).toBe("2026-07-04T20:00");
  });

  it("yearly → same date next year", () => {
    const n = nextOccurrence(base("yearly"), anchor)!;
    expect(fmtDateLocalTz(n, TZ)).toBe("2027-06-06T20:00");
  });

  it("keeps wall-clock time across a DST change (weekly)", () => {
    // Late-Oct anchor; DST ends in Europe/Berlin on 2026-10-25. The next weekly
    // occurrence must still read 20:00 local even though the UTC hour shifts.
    const oct = parseDateLocalTz("2026-10-24T20:00", TZ)!; // Saturday before DST end
    const n = nextOccurrence({ ...base("weekly"), anchorAt: oct }, oct)!;
    expect(fmtDateLocalTz(n, TZ)).toBe("2026-10-31T20:00");
  });
});

describe("upcomingOccurrences", () => {
  it("returns the next dates in order, 14 days apart for biweekly", () => {
    const dates = upcomingOccurrences(base("biweekly"), anchor, 3);
    expect(dates.map((d) => fmtDateLocalTz(d, TZ))).toEqual([
      "2026-06-20T20:00",
      "2026-07-04T20:00",
      "2026-07-18T20:00",
    ]);
  });

  it("stops at seriesEnd instead of filling the limit", () => {
    const rec = { ...base("weekly"), seriesEnd: parseDateLocalTz("2026-06-21T00:00", TZ)! };
    const dates = upcomingOccurrences(rec, anchor, 5);
    expect(dates.map((d) => fmtDateLocalTz(d, TZ))).toEqual([
      "2026-06-13T20:00",
      "2026-06-20T20:00",
    ]);
  });

  it("returns nothing for a zero limit", () => {
    expect(upcomingOccurrences(base("weekly"), anchor, 0)).toEqual([]);
  });
});

describe("discordRecurrenceRule", () => {
  it("weekly maps to WEEKLY interval 1", () => {
    const r = discordRecurrenceRule(base("weekly"), anchor.toISOString())!;
    expect(r).toMatchObject({ frequency: 2, interval: 1, by_weekday: [SAT] });
  });
  it("biweekly maps to WEEKLY interval 2", () => {
    expect(discordRecurrenceRule(base("biweekly"), anchor.toISOString())).toMatchObject({
      frequency: 2,
      interval: 2,
    });
  });
  it("monthly_nth maps to MONTHLY by_n_weekday", () => {
    expect(discordRecurrenceRule(base("monthly_nth"), anchor.toISOString())).toMatchObject({
      frequency: 1,
      by_n_weekday: [{ n: 1, day: SAT }],
    });
  });
  it("yearly maps to YEARLY by_month + by_month_day", () => {
    expect(discordRecurrenceRule(base("yearly"), anchor.toISOString())).toMatchObject({
      frequency: 0,
      by_month: [6],
      by_month_day: [6],
    });
  });
});
