// One vocabulary for the state of an operation (UI audit §8: "Statusbadges
// verwenden dieselben Begriffe über Liste, Detail, Admin und Kalender hinweg").
// Before this module the list view printed the raw enum — "open", "private" —
// while the calendar and the agenda showed German words for the same thing.

export type OpStatusKey =
  | "draft" | "open" | "fast" | "voll" | "locked"
  | "starting" | "running" | "done" | "cancelled";

export type OpStatusBadge = { key: OpStatusKey; label: string; color: string };

const STATUS: Record<OpStatusKey, { label: string; color: string }> = {
  draft: { label: "ENTWURF", color: "var(--dim2)" },
  open: { label: "OFFEN", color: "var(--green)" },
  fast: { label: "FAST VOLL", color: "var(--gold)" },
  voll: { label: "VOLL", color: "var(--cyan)" },
  locked: { label: "GESPERRT", color: "var(--gold)" },
  starting: { label: "STARTET", color: "var(--cyan)" },
  running: { label: "LÄUFT", color: "var(--cyan)" },
  done: { label: "ABGESCHLOSSEN", color: "var(--dim3)" },
  cancelled: { label: "ABGESAGT", color: "var(--red)" },
};

/**
 * The one status an operation shows. An explicit lifecycle status always wins
 * over the time/capacity heuristic — a cancelled or completed op must never
 * read as "OFFEN" just because it still has free seats.
 */
export function opStatusBadge(op: {
  status: string;
  scheduledAt: string | number;
  filledSeats?: number;
  totalSeats?: number;
}, now: number = Date.now()): OpStatusBadge {
  const explicit = op.status as OpStatusKey;
  if (explicit === "draft" || explicit === "locked" || explicit === "cancelled" || explicit === "starting") {
    return { key: explicit, ...STATUS[explicit] };
  }
  if (op.status === "in_progress") return { key: "running", ...STATUS.running };
  if (op.status === "completed") return { key: "done", ...STATUS.done };

  const ts = typeof op.scheduledAt === "number" ? op.scheduledAt : new Date(op.scheduledAt).getTime();
  if (ts < now) return { key: "done", ...STATUS.done };

  const total = op.totalSeats ?? 0;
  const filled = op.filledSeats ?? 0;
  if (total > 0 && filled >= total) return { key: "voll", ...STATUS.voll };
  if (total > 0 && filled / total >= 0.8) return { key: "fast", ...STATUS.fast };
  return { key: "open", ...STATUS.open };
}

/** Visibility, in the same words the wizard and the edit form use. */
const VISIBILITY_LABEL: Record<string, string> = {
  private: "PRIVAT",
  guild: "PRIVAT", // legacy value
  partners: "PARTNER",
  public: "ÖFFENTLICH",
};
export const visibilityLabel = (v: string): string => VISIBILITY_LABEL[v] ?? v.toUpperCase();

/** The viewer's own participation, separate from the operation's status. */
export const SIGNUP_LABEL: Record<string, string> = {
  joined: "DABEI",
  waitlist: "WARTELISTE",
};
