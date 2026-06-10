// Build an iCalendar (.ics) VEVENT for an operation so users can add it to
// their calendar after signing up. Operations have no end time, so we default
// to a 2-hour duration.

const DEFAULT_DURATION_MS = 2 * 60 * 60 * 1000;

type IcsOp = {
  id: string;
  title: string;
  description?: string | null;
  scheduledAt: Date;
  meetingSystem?: string | null;
  meetingLocation?: string | null;
};

/** UTC timestamp in iCal basic format: YYYYMMDDTHHMMSSZ. */
function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Escape text per RFC 5545 (backslash, comma, semicolon, newline). */
function icsEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Render a single-event .ics document for an operation. `publicUrl` is the
 * public origin+basePath (e.g. https://suite.raumdock.org/fleetplanner) used to
 * build the event URL and UID domain.
 */
export function buildOpIcs(op: IcsOp, publicUrl: string): string {
  const start = op.scheduledAt;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MS);
  const location = [op.meetingLocation?.trim(), op.meetingSystem?.trim()]
    .filter(Boolean)
    .join(" · ");
  const host = (() => {
    try {
      return new URL(publicUrl).host;
    } catch {
      return "suite.raumdock.org";
    }
  })();
  const url = `${publicUrl}/ops/${op.id}`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//RDOC Fleetplanner//Operations//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:op-${op.id}@${host}`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(start)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${icsEscape(op.title)}`,
    location ? `LOCATION:${icsEscape(location)}` : "",
    op.description?.trim()
      ? `DESCRIPTION:${icsEscape(op.description.trim().slice(0, 900))}`
      : "",
    `URL:${icsEscape(url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  // iCal requires CRLF line endings + a trailing CRLF.
  return lines.join("\r\n") + "\r\n";
}
