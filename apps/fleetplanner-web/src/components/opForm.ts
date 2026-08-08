// IA merge E: one shared op-form schema for create (Wizard) and edit (EckdatenForm).
// Previously the two diverged (visibility lists + op-type palettes differed). This
// module is the single source of truth for the core operation fields, their
// options/validation, and the request-body mapping, so create and edit can't drift.

export type OpType = { key: string; label: string; color: string; icon: string };

// One structural accent for every type: the palette has no seven hues to give
// out, and the icon plus the label already carry the distinction.
export const OP_TYPES: OpType[] = [
  { key: "combat", label: "Kampf", color: "var(--cyan)", icon: "fighter" },
  { key: "mining", label: "Mining", color: "var(--cyan)", icon: "bolt" },
  { key: "salvage", label: "Bergung", color: "var(--cyan)", icon: "swap" },
  { key: "explore", label: "Exploration", color: "var(--cyan)", icon: "globe" },
  { key: "transport", label: "Transport", color: "var(--cyan)", icon: "vehicle" },
  { key: "training", label: "Training", color: "var(--cyan)", icon: "lead" },
  { key: "social", label: "Sozial", color: "var(--cyan)", icon: "users" },
];

// 3-option visibility (the design's model). Legacy "guild" maps onto "private".
export type VisOption = { key: string; label: string; desc: string; icon: string };
export const VIS_OPTIONS: VisOption[] = [
  { key: "private", label: "Privat", desc: "Nur dein Server", icon: "lock" },
  { key: "partners", label: "Partner", desc: "Verbündete Server sehen es", icon: "link" },
  { key: "public", label: "Öffentlich", desc: "Instanzweit sichtbar", icon: "globe" },
];

export const SYSTEMS = ["Stanton", "Pyro", "Nyx"];

export function normalizeVisibility(v: string): string {
  return v === "guild" ? "private" : v;
}

// The core op fields shared by create + edit. Create adds guildId + needs/recurrence;
// edit adds maxParticipants — those stay with their respective flows.
export type OpCoreForm = {
  title: string;
  scheduledAt: string; // datetime-local string
  opType: string;
  description: string;
  meetingSystem: string;
  meetingLocation: string;
  visibility: string;
  isStreamEvent: boolean;
};

export function coreValid(f: Pick<OpCoreForm, "title" | "scheduledAt">): boolean {
  return f.title.trim().length > 0 && f.scheduledAt.length > 0;
}

// Maps the shared form fields onto the API body subset used by both
// POST /operations (create) and PATCH /operations/:id (edit).
export function coreOpBody(f: OpCoreForm) {
  return {
    title: f.title.trim(),
    opType: f.opType,
    // sent as trimmed strings (empty allowed) so editing can clear a field; create
    // treats these as optional too.
    description: f.description.trim(),
    meetingSystem: f.meetingSystem.trim(),
    meetingLocation: f.meetingLocation.trim(),
    scheduledAt: f.scheduledAt ? new Date(f.scheduledAt).toISOString() : undefined,
    visibility: normalizeVisibility(f.visibility),
    isStreamEvent: f.isStreamEvent,
  };
}
