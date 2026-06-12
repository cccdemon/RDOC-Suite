// IA merge E: one shared op-form schema for create (Wizard) and edit (EckdatenForm).
// Previously the two diverged (visibility lists + op-type palettes differed). This
// module is the single source of truth for the core operation fields, their
// options/validation, and the request-body mapping, so create and edit can't drift.

export type OpType = { key: string; label: string; color: string; rgb: string; icon: string };

export const OP_TYPES: OpType[] = [
  { key: "combat", label: "Kampf", color: "var(--red)", rgb: "255,68,68", icon: "fighter" },
  { key: "mining", label: "Mining", color: "var(--gold)", rgb: "240,165,0", icon: "bolt" },
  { key: "salvage", label: "Bergung", color: "var(--orange)", rgb: "255,122,69", icon: "swap" },
  { key: "explore", label: "Exploration", color: "var(--cyan)", rgb: "0,212,255", icon: "globe" },
  { key: "transport", label: "Transport", color: "var(--purple)", rgb: "160,100,255", icon: "vehicle" },
  { key: "training", label: "Training", color: "var(--green)", rgb: "0,255,136", icon: "lead" },
  { key: "social", label: "Sozial", color: "#ff70c8", rgb: "255,112,200", icon: "users" },
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
  };
}
