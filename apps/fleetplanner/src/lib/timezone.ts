/**
 * IANA timezone IDs offered as choices in the guild settings.
 * Grouped roughly by region; keep the list short (common choices for SC ops orgs).
 */
export const TIMEZONE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: "Europe/Berlin",      label: "Berlin (CET/CEST)" },
  { value: "Europe/London",      label: "London (GMT/BST)" },
  { value: "Europe/Paris",       label: "Paris (CET/CEST)" },
  { value: "Europe/Amsterdam",   label: "Amsterdam (CET/CEST)" },
  { value: "Europe/Stockholm",   label: "Stockholm (CET/CEST)" },
  { value: "Europe/Warsaw",      label: "Warsaw (CET/CEST)" },
  { value: "Europe/Moscow",      label: "Moscow (MSK)" },
  { value: "America/New_York",   label: "New York (EST/EDT)" },
  { value: "America/Chicago",    label: "Chicago (CST/CDT)" },
  { value: "America/Denver",     label: "Denver (MST/MDT)" },
  { value: "America/Los_Angeles",label: "Los Angeles (PST/PDT)" },
  { value: "America/Sao_Paulo",  label: "São Paulo (BRT)" },
  { value: "Asia/Tokyo",         label: "Tokyo (JST)" },
  { value: "Asia/Shanghai",      label: "Shanghai (CST)" },
  { value: "Asia/Seoul",         label: "Seoul (KST)" },
  { value: "Asia/Singapore",     label: "Singapore (SGT)" },
  { value: "Australia/Sydney",   label: "Sydney (AEST/AEDT)" },
  { value: "UTC",                label: "UTC" },
];

export const DEFAULT_TIMEZONE = "Europe/Berlin";

/** Validate that a string is a known IANA timezone the server can handle. */
export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * Format a UTC Date for display in a given timezone.
 * Result: "2026-06-15 20:00 CEST" style.
 */
export function fmtDateTz(d: Date, tz: string): string {
  const safe = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: safe,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const abbr = new Intl.DateTimeFormat("en-GB", {
    timeZone: safe, timeZoneName: "short",
  }).formatToParts(d).find((p) => p.type === "timeZoneName")?.value ?? safe;
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")} ${abbr}`;
}

/**
 * Format a UTC Date as a value for a `datetime-local` input, in the given timezone.
 * Result: "YYYY-MM-DDTHH:MM" (no seconds, no Z — browsers treat it as local).
 */
export function fmtDateLocalTz(d: Date, tz: string): string {
  const safe = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: safe,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}`;
}

/**
 * Parse a `datetime-local` value (YYYY-MM-DDTHH:MM) as wall-clock time in
 * the given timezone, returning a UTC Date. Falls back to treating input as
 * UTC if the timezone is invalid.
 */
export function parseDateLocalTz(raw: string, tz: string): Date | null {
  if (!raw) return null;
  const safe = isValidTimezone(tz) ? tz : DEFAULT_TIMEZONE;
  // Trick: append a fake UTC offset so Date.parse sees an unambiguous string,
  // then correct by the actual offset at that instant. We use the Temporal-lite
  // approach: ask Intl what UTC time corresponds to the wall-clock in that tz.
  const [datePart, timePart] = raw.split("T");
  if (!datePart || !timePart) return null;
  const [y, mo, day] = datePart.split("-").map(Number);
  const [h, min] = timePart.split(":").map(Number);
  if ([y, mo, day, h, min].some((n) => !Number.isFinite(n))) return null;

  // Binary-search to find the UTC instant whose wall-clock in `safe` equals
  // the requested time. One pass with a correction is usually enough.
  const guess = Date.UTC(y, mo - 1, day, h, min);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: safe, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });

  function wallClock(utcMs: number): { y: number; mo: number; day: number; h: number; min: number } {
    const parts = formatter.formatToParts(new Date(utcMs));
    const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
    return { y: get("year"), mo: get("month"), day: get("day"), h: get("hour") % 24, min: get("minute") };
  }

  function wallMinutes(utcMs: number): number {
    const wc = wallClock(utcMs);
    return Date.UTC(wc.y, wc.mo - 1, wc.day, wc.h, wc.min);
  }

  const targetMs = Date.UTC(y, mo - 1, day, h, min);
  // correction = how many ms we are off from the target wall-clock
  const correction = wallMinutes(guess) - targetMs;
  const adjusted = guess - correction;
  // Verify (handles DST edge: the first attempt may land in the wrong fold)
  if (wallMinutes(adjusted) !== targetMs) {
    // try ±1 hour around the fold
    for (const delta of [-3600000, 3600000, -7200000, 7200000]) {
      const candidate = adjusted + delta;
      if (wallMinutes(candidate) === targetMs) return new Date(candidate);
    }
    // give up — return raw UTC parse as fallback
    return new Date(`${raw}Z`);
  }
  return new Date(adjusted);
}
