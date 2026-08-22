// Which half of an operation page the viewer is on (handoff §6).
//
// Until now the operator console hung underneath the full participant page, so
// managing an operation meant scrolling past everything a guest sees. The two
// are now modes of the same route, and the mode lives in the URL so a reload,
// a deep link and the browser's Back button all land in the same place.
//
// Every URL that worked before still works. `?op=fleet` and its aliases came
// from the console's own tab links and from the legacy `/ops/:id/manage`
// redirect; they name a management tab, so they mean the management mode even
// though they say nothing about it.

export type OperationMode = "view" | "manage";

/** Query keys that name a management tab — see OperatorConsole.tabFromParams. */
const TAB_KEYS = ["op", "sub", "section"] as const;

/**
 * The mode a URL asks for, before permissions are considered.
 * `null` means the URL is silent and the caller may pick its own default.
 */
export function requestedMode(sp: URLSearchParams): OperationMode | null {
  const explicit = sp.get("mode");
  if (explicit === "manage" || explicit === "view") return explicit;
  // A tab in the URL is an old management link. Honour it rather than dropping
  // the operator on the participant page with their tab silently discarded.
  if (TAB_KEYS.some((k) => sp.get(k))) return "manage";
  return null;
}

/**
 * The mode actually shown. Management is only ever offered to someone the
 * server already calls a manager — a crew member who types `?mode=manage`
 * gets the participant view, not an empty console.
 *
 * This is UX, not authorisation: every mutation behind the console is checked
 * server-side regardless of what the client decided to render.
 */
export function resolveMode(sp: URLSearchParams, canManage: boolean): OperationMode {
  if (!canManage) return "view";
  return requestedMode(sp) ?? "view";
}

/**
 * The query string for switching modes, preserving everything else.
 *
 * Switching to the participant view drops the management tab as well: leaving
 * `?op=cqb` behind would silently send the next "Verwalten" click to whichever
 * tab the viewer happened to leave, and would make a copied link reopen the
 * console for the recipient.
 */
export function withMode(sp: URLSearchParams, mode: OperationMode): URLSearchParams {
  const next = new URLSearchParams(sp);
  next.delete("flash"); // a one-shot notice must not survive a mode switch
  if (mode === "manage") {
    next.set("mode", "manage");
  } else {
    next.delete("mode");
    for (const k of TAB_KEYS) next.delete(k);
  }
  return next;
}
