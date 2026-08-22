// The operation status vocabulary — one list, used by the object header and by
// the console's status control. Two copies would drift, and a status that reads
// "Gesperrt" in one place and "locked" in the other is worse than either.

export type OpStatusMeta = { value: string; label: string; color: string };

export const OP_STATUSES: OpStatusMeta[] = [
  { value: "draft", label: "Entwurf", color: "var(--dim2)" },
  { value: "open", label: "Offen", color: "var(--green)" },
  { value: "locked", label: "Gesperrt", color: "var(--gold)" },
  { value: "starting", label: "Startet", color: "var(--cyan)" },
  { value: "in_progress", label: "Läuft", color: "var(--cyan)" },
  { value: "completed", label: "Abgeschlossen", color: "var(--dim)" },
  { value: "cancelled", label: "Abgesagt", color: "var(--red2)" },
];

/** Unknown values keep their raw name rather than vanishing from the header. */
export function statusMeta(value: string): OpStatusMeta {
  return OP_STATUSES.find((s) => s.value === value) ?? { value, label: value, color: "var(--dim2)" };
}
