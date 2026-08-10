// Typed fetch client for /api/v1. Cookie-session auth (same-origin); never
// stores tokens. Errors carry the server's stable envelope when present.
import type {
  ApiErrorBody,
  OperationDetail,
  OperationSummary,
  SessionResponse,
} from "./types";

export const API_BASE: string =
  (import.meta.env.VITE_API_BASE as string | undefined) ?? "/fleetplanner/api/v1";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorBody["error"]["code"] | "unknown";
  readonly requestId: string | null;

  constructor(status: number, body: ApiErrorBody | null) {
    super(body?.error.message ?? `API error ${status}`);
    this.status = status;
    this.code = body?.error.code ?? "unknown";
    this.requestId = body?.error.requestId ?? null;
  }
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    credentials: "same-origin",
    headers: { accept: "application/json" },
  });
  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      body = null;
    }
    throw new ApiError(res.status, body);
  }
  return (await res.json()) as T;
}

// Last-known-good CSRF token. The session prop is fetched once at App mount, so
// a token can go stale if the session is replaced (re-login in another tab, etc.)
// — that surfaced as "Invalid CSRF token" 403s. We refresh it on demand below.
let csrfOverride: string | null = null;

async function mutate<T>(method: "POST" | "PUT" | "PATCH" | "DELETE", path: string, csrfToken: string, body?: unknown): Promise<T> {
  const send = (token: string) =>
    fetch(`${API_BASE}${path}`, {
      method,
      credentials: "same-origin",
      headers: {
        accept: "application/json",
        "x-csrf-token": token,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });

  let res = await send(csrfOverride ?? csrfToken);
  // A 403 may just be a stale in-memory CSRF token. Refetch the current session
  // token and retry once — the rejected request had no side effect (the CSRF
  // gate runs before the mutation), so the retry is safe.
  if (res.status === 403) {
    const fresh = await get<SessionResponse>("/session").catch(() => null);
    const freshCsrf = fresh?.csrfToken ?? null;
    if (freshCsrf && freshCsrf !== (csrfOverride ?? csrfToken)) {
      csrfOverride = freshCsrf;
      res = await send(freshCsrf);
    }
  }
  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      errBody = null;
    }
    throw new ApiError(res.status, errBody);
  }
  return (await res.json()) as T;
}

export function getSession(): Promise<SessionResponse> {
  return get<SessionResponse>("/session");
}

// Base without the /api/v1 suffix, e.g. "/fleetplanner" — for /auth/* endpoints.
const AUTH_BASE = API_BASE.replace(/\/api\/v1\/?$/, "");

// Log out: destroys the server session + clears the cookie (cookie-auth, no CSRF).
// On success the browser is sent back to the app root.
export async function logout(): Promise<void> {
  await fetch(`${AUTH_BASE}/auth/logout`, { method: "POST", credentials: "same-origin", redirect: "manual" }).catch(() => undefined);
  window.location.href = `${AUTH_BASE}/`;
}

export function getContent(slug: string, lang?: "de" | "en"): Promise<{ title: string; html: string }> {
  return get<{ title: string; html: string }>(`/content/${encodeURIComponent(slug)}${lang ? `?lang=${lang}` : ""}`);
}

export type OpCover = {
  url: string;
  width: number;
  height: number;
  preset: string;
  format: string;
  updatedAt: string;
};
export type OpCoverState = { serviceConfigured: boolean; cover: OpCover | null };

export function getOpCover(opId: string): Promise<OpCoverState> {
  return get<OpCoverState>(`/operations/${encodeURIComponent(opId)}/cover`);
}

export function generateOpCover(opId: string, csrfToken: string, opts: { format: string; preset: string }): Promise<{ ok: true; cover: OpCover | null }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cover/generate`, csrfToken, opts);
}

export function deleteOpCover(opId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/cover`, csrfToken);
}

export function coverEditLink(opId: string, csrfToken: string, opts: { format: string; preset: string }): Promise<{ editorUrl: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cover/edit-link`, csrfToken, opts);
}

// FR-B8: save the UI language preference on the user.
export function setProfileLocale(csrfToken: string, locale: "de" | "en"): Promise<{ ok: true }> {
  return mutate("PATCH", "/profile", csrfToken, { locale });
}

// FR-P3: opt in/out of listing one's owned ships in the guild Org-Flotte.
export function setProfileShareHangar(csrfToken: string, shareHangarWithOrg: boolean): Promise<{ ok: true }> {
  return mutate("PATCH", "/profile", csrfToken, { shareHangarWithOrg });
}

export function getAccount(): Promise<import("./types").AccountResponse> {
  return get<import("./types").AccountResponse>("/account");
}

export function getRoadmap(): Promise<{ items: import("./types").RoadmapItem[] }> {
  return get<{ items: import("./types").RoadmapItem[] }>("/roadmap");
}

/** Orgs that consented to appear in the start page's "used by" panel. Public. */
export function getPublicOrgs(): Promise<import("./types").PublicOrgsResponse> {
  return get<import("./types").PublicOrgsResponse>("/public/orgs");
}

export function claimSeat(opId: string, seatId: string, csrfToken: string): Promise<{ ok: true; seatId: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/claim`, csrfToken);
}

export function unclaimSeat(opId: string, seatId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/claim`, csrfToken);
}

export function cqbSignup(opId: string, csrfToken: string, opts?: { note?: string; groupId?: string }): Promise<{ ok: true }> {
  const body: { note?: string; groupId?: string } = {};
  if (opts?.note) body.note = opts.note;
  if (opts?.groupId) body.groupId = opts.groupId;
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cqb/signup`, csrfToken, body);
}

export function cqbWithdraw(opId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/cqb/signup`, csrfToken);
}

// FR-B5: operator places/moves a CQB soldier into a team (groupId null = unassign).
export function assignCqbSoldier(opId: string, signupId: string, csrfToken: string, groupId: string | null): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cqb/${encodeURIComponent(signupId)}/assign`, csrfToken, { groupId });
}

// #5: operator adds any person (guild member / seat occupant) to a CQB team.
export function removeCqbSoldier(opId: string, signupId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/cqb/${encodeURIComponent(signupId)}`, csrfToken);
}

export function addCqbTeamMember(opId: string, groupId: string, userId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cqb-teams/${encodeURIComponent(groupId)}/members`, csrfToken, { userId });
}

// Operator backfill: auto-fill all squad-less accepted fighters into the first open squad.
export function autoFillFighters(opId: string, csrfToken: string): Promise<{ ok: true; placed: number }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/fighter-squads/auto-fill`, csrfToken) as Promise<{ ok: true; placed: number }>;
}

// #1 late-arrival ("nachkommen"): set/clear ETA (HH:MM, null clears) on a unit/seat/signup.
export function setUnitLateArrival(opId: string, unitId: string, eta: string | null, csrfToken: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}/late-arrival`, csrfToken, { eta });
}
export function setSeatLateArrival(opId: string, seatId: string, eta: string | null, csrfToken: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/late-arrival`, csrfToken, { eta });
}
export function setCqbLateArrival(opId: string, signupId: string, eta: string | null, csrfToken: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/cqb/${encodeURIComponent(signupId)}/late-arrival`, csrfToken, { eta });
}

// FR-B3: embed a CQB team into a carrier ship (carrierUnitId null = standalone).
export function assignCqbTeamCarrier(opId: string, groupId: string, csrfToken: string, carrierUnitId: string | null): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/cqb-teams/${encodeURIComponent(groupId)}/carrier`, csrfToken, { carrierUnitId });
}

// FR-B2: operator formations (Verbände).
export function createFormation(opId: string, csrfToken: string, name: string): Promise<{ ok: true; id: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/formations`, csrfToken, { name });
}
export function deleteFormation(opId: string, fid: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/formations/${encodeURIComponent(fid)}`, csrfToken);
}
export function renameFormation(opId: string, fid: string, csrfToken: string, name: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/formations/${encodeURIComponent(fid)}`, csrfToken, { name });
}
// FR-B6: rename a CQB squad.
export function renameCqbTeam(opId: string, groupId: string, csrfToken: string, name: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/cqb-teams/${encodeURIComponent(groupId)}`, csrfToken, { name });
}
export function assignUnitFormation(opId: string, unitId: string, csrfToken: string, formationId: string | null): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}/formation`, csrfToken, { formationId });
}

// FR-B4: load a vehicle or a Jäger into a carrier ship (carrierUnitId null = standalone).
export function assignUnitCarrier(opId: string, unitId: string, csrfToken: string, carrierUnitId: string | null): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}/carrier`, csrfToken, { carrierUnitId });
}

// Roster-Fundament: hang a Staffel/Trupp under a Verband (parentId null = detach).
export function setGroupParent(opId: string, groupId: string, csrfToken: string, parentId: string | null): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/groups/${encodeURIComponent(groupId)}/parent`, csrfToken, { parentId });
}

// Roster-Fundament: move a member to a slot in its group. Slot 0 = make Captain.
export function setMemberSlot(
  opId: string,
  csrfToken: string,
  memberKind: "unit" | "person",
  memberId: string,
  slot: number,
): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/member-slot`, csrfToken, { memberKind, memberId, slot });
}

export function setHangarShare(opId: string, csrfToken: string, allow: boolean): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/hangar-share`, csrfToken, { allow });
}

export function getOperatorView(opId: string): Promise<import("./types").OperatorView> {
  return get<import("./types").OperatorView>(`/operations/${encodeURIComponent(opId)}/operator`);
}

export function decideUnit(
  opId: string,
  unitId: string,
  decision: "accept" | "reject",
  csrfToken: string,
  requirementId?: string,
): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}/${decision}`, csrfToken, requirementId ? { requirementId } : {});
}

// Edit an offered unit: rebind to a Bedarf (requirementId; null detaches),
// rename a squad, or set the captain note. Allowed for operators + the captain.
export function patchUnit(
  opId: string,
  unitId: string,
  csrfToken: string,
  data: {
    requirementId?: string | null;
    squadName?: string;
    captainNote?: string | null;
    /** Role in this op; null falls back to the catalog-derived class. */
    roleOverride?: import("./types").ShipClass | null;
  },
): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}`, csrfToken, data);
}

export function assignSeat(opId: string, seatId: string, userId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/assignment`, csrfToken, { userId });
}

export function unassignSeat(opId: string, seatId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/assignment`, csrfToken);
}

// FR-B1: operator edits a seat — active flag and/or custom label.
export function patchSeat(opId: string, seatId: string, csrfToken: string, data: { active?: boolean; label?: string }): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}`, csrfToken, data);
}

export function answerQuestion(opId: string, qid: string, answer: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/questions/${encodeURIComponent(qid)}/answer`, csrfToken, { answer });
}

// FR-B7: a participant/viewer asks the operator a question.
export function askQuestion(opId: string, csrfToken: string, body: string): Promise<{ ok: true; id: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/questions`, csrfToken, { body });
}

// Withdraw / delete a unit. The backend gate allows the unit's own captain
// (crew who offered the ship) as well as op operators.
export function withdrawUnit(opId: string, unitId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/units/${encodeURIComponent(unitId)}`, csrfToken);
}

// FR-A1: operator-curated briefing / tutorial links on an operation.
export type ResourceLink = { id: string; title: string | null; url: string; kind: string | null; sortOrder: number };
export function addResourceLink(opId: string, csrfToken: string, input: { url: string; title?: string; kind?: string }): Promise<{ ok: true; link: ResourceLink }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/resource-links`, csrfToken, input);
}
export function removeResourceLink(opId: string, linkId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/resource-links/${encodeURIComponent(linkId)}`, csrfToken);
}

// ── op documents (PDF) ──────────────────────────────────────────────
export type OpDocument = { id: string; filename: string; size: number; createdAt: string };

/** Absolute URL for downloading/viewing a document (cookie-auth GET). */
export function opDocumentUrl(opId: string, docId: string): string {
  return `${API_BASE}/operations/${encodeURIComponent(opId)}/documents/${encodeURIComponent(docId)}`;
}

/** Upload a PDF (multipart). CSRF in the header with the same stale-token retry as mutate(). */
export async function uploadOpDocument(opId: string, csrfToken: string, file: File): Promise<{ ok: true; document: OpDocument }> {
  const path = `/operations/${encodeURIComponent(opId)}/documents`;
  const send = (token: string) => {
    const fd = new FormData();
    fd.append("document", file, file.name);
    return fetch(`${API_BASE}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-csrf-token": token },
      body: fd,
    });
  };
  let res = await send(csrfOverride ?? csrfToken);
  if (res.status === 403) {
    const fresh = await get<SessionResponse>("/session").catch(() => null);
    const freshCsrf = fresh?.csrfToken ?? null;
    if (freshCsrf && freshCsrf !== (csrfOverride ?? csrfToken)) {
      csrfOverride = freshCsrf;
      res = await send(freshCsrf);
    }
  }
  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try { errBody = (await res.json()) as ApiErrorBody; } catch { errBody = null; }
    throw new ApiError(res.status, errBody);
  }
  return (await res.json()) as { ok: true; document: OpDocument };
}

export function deleteOpDocument(opId: string, docId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/documents/${encodeURIComponent(docId)}`, csrfToken);
}

export type OperationStream = { id: string; platform: "twitch" | "youtube" | "vdo_ninja" | "other"; url: string; label: string; userId: string | null; username: string | null };
export function addStream(opId: string, csrfToken: string, input: { platform: string; url: string; label?: string }): Promise<{ ok: true; stream: OperationStream }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/streams`, csrfToken, input);
}
export function removeStream(opId: string, streamId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/streams/${encodeURIComponent(streamId)}`, csrfToken);
}

export function addLeader(opId: string, userId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/leaders`, csrfToken, { userId });
}

export function removeLeader(opId: string, userId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/leaders/${encodeURIComponent(userId)}`, csrfToken);
}

export function getHangar(): Promise<{ ships: import("./types").ShipSummary[] }> {
  return get<{ ships: import("./types").ShipSummary[] }>("/hangar");
}

export function searchShips(q: string): Promise<{ ships: import("./types").ShipSummary[] }> {
  return get<{ ships: import("./types").ShipSummary[] }>(`/ships/search?q=${encodeURIComponent(q)}`);
}

export type LocationHit = { name: string; system: string };
export function searchLocations(q: string, system?: string): Promise<{ locations: LocationHit[] }> {
  const qs = new URLSearchParams();
  if (q) qs.set("q", q);
  if (system) qs.set("system", system);
  return get<{ locations: LocationHit[] }>(`/locations/search?${qs.toString()}`);
}

export function addHangarShip(shipId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", "/hangar", csrfToken, { shipId });
}

export function removeHangarShip(shipId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/hangar/${encodeURIComponent(shipId)}`, csrfToken);
}

export function importFleet(csrfToken: string, fleetJson: string): Promise<import("./types").FleetImportResponse> {
  return mutate("POST", "/hangar/import", csrfToken, { fleetJson });
}

/** Pull the player's hulls from their public Fleetyards.net hangar. The username
 *  is persisted server-side, so this doubles as the re-sync call. */
export function importFleetFromFleetyards(
  csrfToken: string,
  username: string,
): Promise<import("./types").FleetyardsImportResponse> {
  return mutate("POST", "/hangar/import/fleetyards", csrfToken, { username });
}

export async function sendFeedback(
  subject: string,
  message: string,
  csrfToken: string,
  files: File[] = [],
): Promise<{ ok: true }> {
  // No screenshots → plain JSON (keeps the CSRF-retry in mutate()).
  if (files.length === 0) {
    return mutate("POST", "/feedback", csrfToken, { subject, message });
  }
  // With screenshots → multipart/form-data. CSRF travels in the header, so the
  // same stale-token retry as mutate() applies; rebuild the body each attempt
  // because a FormData stream can only be sent once.
  const build = () => {
    const fd = new FormData();
    fd.append("subject", subject);
    fd.append("message", message);
    for (const f of files) fd.append("screenshots", f, f.name);
    return fd;
  };
  const send = (token: string) =>
    fetch(`${API_BASE}/feedback`, {
      method: "POST",
      credentials: "same-origin",
      headers: { accept: "application/json", "x-csrf-token": token },
      body: build(),
    });

  let res = await send(csrfOverride ?? csrfToken);
  if (res.status === 403) {
    const fresh = await get<SessionResponse>("/session").catch(() => null);
    const freshCsrf = fresh?.csrfToken ?? null;
    if (freshCsrf && freshCsrf !== (csrfOverride ?? csrfToken)) {
      csrfOverride = freshCsrf;
      res = await send(freshCsrf);
    }
  }
  if (!res.ok) {
    let errBody: ApiErrorBody | null = null;
    try {
      errBody = (await res.json()) as ApiErrorBody;
    } catch {
      errBody = null;
    }
    throw new ApiError(res.status, errBody);
  }
  return (await res.json()) as { ok: true };
}

export function listTemplates(guildId: string, q?: string): Promise<{ templates: import("./types").TemplateSummary[] }> {
  const qs = `?guildId=${encodeURIComponent(guildId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  return get<{ templates: import("./types").TemplateSummary[] }>(`/templates${qs}`);
}

export function applyTemplate(
  id: string,
  csrfToken: string,
  input: { guildId: string; scheduledAt: string; title?: string },
): Promise<{ ok: true; id: string }> {
  return mutate("POST", `/templates/${encodeURIComponent(id)}/apply`, csrfToken, input);
}

export function registerUnit(
  opId: string,
  csrfToken: string,
  input: {
    unitType: "ship" | "squad" | "vehicle";
    shipId?: string;
    ownedShipId?: string;
    storeOwnedShip?: boolean;
    squadName?: string;
    squadSize?: number;
    carrierUnitId?: string;
    captainNote?: string;
    /** FR: offer the ship for a specific fleet requirement (Bedarf). */
    requirementId?: string;
    /** Role in this op; omit to use the catalog-derived class. */
    roleOverride?: import("./types").ShipClass;
  },
): Promise<{ ok: true; unitId: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/units`, csrfToken, input);
}

export function editOperation(
  id: string,
  csrfToken: string,
  input: {
    title?: string;
    description?: string;
    opType?: string;
    meetingSystem?: string;
    meetingLocation?: string;
    scheduledAt?: string;
    visibility?: string;
    maxParticipants?: number | null;
    squadLinkVoiceEnabled?: boolean;
    isStreamEvent?: boolean;
  },
): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(id)}`, csrfToken, input);
}

/** SquadLink Lite voice deep-link for the op's commanders (CommandNet room).
 *  `link` is non-null only once the op started and the feature is enabled +
 *  server-configured. `storeUrl` is the MS Store install link when configured. */
export function getSquadLink(id: string): Promise<{
  enabled: boolean;
  configured: boolean;
  started: boolean;
  link: string | null;
  storeUrl: string | null;
}> {
  return get(`/operations/${encodeURIComponent(id)}/squadlink`);
}

export function setOperationStatus(id: string, csrfToken: string, status: string): Promise<{ ok: true; status: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(id)}/status`, csrfToken, { status });
}

// SquadLink voice recipients — the operator-curated grant list of userIds who
// receive the op's (shared) CommandNet deep-link. Replace-whole-set semantics.
export function getVoiceRecipients(id: string): Promise<{ userIds: string[] }> {
  return get<{ userIds: string[] }>(`/operations/${encodeURIComponent(id)}/voice/recipients`);
}
export function setVoiceRecipients(id: string, csrfToken: string, userIds: string[]): Promise<{ ok: true; userIds: string[] }> {
  return mutate("PUT", `/operations/${encodeURIComponent(id)}/voice/recipients`, csrfToken, { userIds });
}

export function deleteOperation(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(id)}`, csrfToken);
}

export function publishTemplate(
  id: string,
  csrfToken: string,
  input: { name?: string; summary?: string; visibility?: string },
): Promise<{ ok: true; id: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(id)}/publish-template`, csrfToken, input);
}

export function createRecurrence(
  id: string,
  csrfToken: string,
  input: { freq: string; seriesCount?: number; seriesEnd?: string },
): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(id)}/recurrence`, csrfToken, input);
}

export function stopRecurrence(id: string, csrfToken: string): Promise<{ ok: true; stopped: boolean }> {
  return mutate("POST", `/operations/${encodeURIComponent(id)}/recurrence/stop`, csrfToken);
}

export function getNeeds(id: string): Promise<import("./types").NeedsResponse> {
  return get<import("./types").NeedsResponse>(`/operations/${encodeURIComponent(id)}/needs`);
}

export function addShipNeeds(
  id: string,
  csrfToken: string,
  input: { shipTypes: string[]; name?: string; note?: string },
): Promise<{ ok: true; added: number }> {
  return mutate("POST", `/operations/${encodeURIComponent(id)}/needs/ships`, csrfToken, input);
}

export function renameNeed(id: string, reqId: string, csrfToken: string, name: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/operations/${encodeURIComponent(id)}/needs/${encodeURIComponent(reqId)}`, csrfToken, { name });
}

export function removeNeed(id: string, reqId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(id)}/needs/${encodeURIComponent(reqId)}`, csrfToken);
}

export function setFighterSquads(id: string, csrfToken: string, count: number): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(id)}/needs/fighters`, csrfToken, { count });
}

export function setCqbTeams(id: string, csrfToken: string, count: number, size: number): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(id)}/needs/cqb`, csrfToken, { count, size });
}

export function getAdminGuilds(): Promise<import("./types").AdminGuildsResponse> {
  return get<import("./types").AdminGuildsResponse>("/admin/guilds");
}

export function banGuild(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/admin/guilds/${encodeURIComponent(id)}/ban`, csrfToken);
}

export function unbanGuild(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/admin/guilds/${encodeURIComponent(id)}/unban`, csrfToken);
}

export function getAdminSettings(): Promise<import("./types").AdminSettingsResponse> {
  return get<import("./types").AdminSettingsResponse>("/admin/settings");
}

export function setMaintenanceMode(csrfToken: string, enabled: boolean): Promise<{ ok: true }> {
  return mutate("POST", "/admin/maintenance", csrfToken, { enabled });
}

export function setFeedbackChannel(csrfToken: string, channelId: string): Promise<{ ok: true }> {
  return mutate("PUT", "/admin/settings/feedback", csrfToken, { channelId });
}

export function syncCatalog(csrfToken: string, kind: "ships" | "locations"): Promise<{ ok: true }> {
  return mutate("POST", `/admin/${kind}/sync`, csrfToken);
}
export function getSystemHealth(): Promise<import("./types").SystemHealthResponse> {
  return get<import("./types").SystemHealthResponse>("/admin/system/health");
}
export function getSystemEvents(opts?: { level?: string; category?: string; limit?: number }): Promise<import("./types").SystemEventsResponse> {
  const qs = new URLSearchParams();
  if (opts?.level) qs.set("level", opts.level);
  if (opts?.category) qs.set("category", opts.category);
  if (opts?.limit) qs.set("limit", String(opts.limit));
  const q = qs.toString();
  return get<import("./types").SystemEventsResponse>(`/admin/system/events${q ? `?${q}` : ""}`);
}

export function setCatalogConfig(csrfToken: string, kind: "ships" | "locations", intervalDays: number): Promise<{ ok: true }> {
  return mutate("PUT", `/admin/${kind}/config`, csrfToken, { intervalDays });
}

export function getAdminUsers(): Promise<import("./types").AdminUsersResponse> {
  return get<import("./types").AdminUsersResponse>("/admin/users");
}

export function setUserRole(id: string, csrfToken: string, role: string): Promise<{ ok: true }> {
  return mutate("PUT", `/admin/users/${encodeURIComponent(id)}/role`, csrfToken, { role });
}

export function toggleUserActive(id: string, csrfToken: string): Promise<{ ok: true; active: boolean }> {
  return mutate("POST", `/admin/users/${encodeURIComponent(id)}/active`, csrfToken);
}

export function getDiagnostics(guildId: string): Promise<import("./types").DiagnosticsResponse> {
  return get<import("./types").DiagnosticsResponse>(`/guilds/${encodeURIComponent(guildId)}/diagnostics`);
}

// "What's new" popup: unseen player-changelog for the signed-in user + ack.
export type UnseenChangelog = { version: string; entries: Array<{ date: string; title: string; changes: string[] }> };
export function getUnseenChangelog(): Promise<UnseenChangelog> {
  return get<UnseenChangelog>("/changelog/unseen");
}
export function ackChangelog(csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", "/changelog/ack", csrfToken);
}

export function getPartnerships(guildId: string): Promise<import("./types").PartnershipsResponse> {
  return get<import("./types").PartnershipsResponse>(`/guilds/${encodeURIComponent(guildId)}/partnerships`);
}

export function mintPartnerInvite(guildId: string, csrfToken: string, label: string): Promise<{ ok: true; token: string; label: string }> {
  return mutate("POST", `/guilds/${encodeURIComponent(guildId)}/partnerships/invite`, csrfToken, { label });
}

export function acceptPartnerToken(guildId: string, csrfToken: string, token: string): Promise<{ ok: true }> {
  return mutate("POST", `/guilds/${encodeURIComponent(guildId)}/partnerships/accept`, csrfToken, { token });
}

export function setPartnerAutoShare(guildId: string, partnerGuildId: string, csrfToken: string, autoShare: boolean): Promise<{ ok: true }> {
  return mutate("PUT", `/guilds/${encodeURIComponent(guildId)}/partnerships/${encodeURIComponent(partnerGuildId)}/auto-share`, csrfToken, { autoShare });
}

export function revokePartnership(guildId: string, partnershipId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/guilds/${encodeURIComponent(guildId)}/partnerships/${encodeURIComponent(partnershipId)}/revoke`, csrfToken);
}

export function decideSharedEvent(guildId: string, eventId: string, decision: "approve" | "decline", csrfToken: string): Promise<{ ok: true }> {
  return mutate("POST", `/guilds/${encodeURIComponent(guildId)}/partnerships/events/${encodeURIComponent(eventId)}/${decision}`, csrfToken);
}

export function getGuildSettings(guildId: string): Promise<import("./types").GuildSettingsResponse> {
  return get<import("./types").GuildSettingsResponse>(`/guilds/${encodeURIComponent(guildId)}/settings`);
}

// FR-P3: guild Org Fleet roster (who owns what). Members-only on the server.
export function getOrgFleet(guildId: string): Promise<import("./types").OrgFleetResponse> {
  return get<import("./types").OrgFleetResponse>(`/guilds/${encodeURIComponent(guildId)}/fleet`);
}

// FR-P3 Polls/Umfragen.
export function listPolls(): Promise<import("./types").PollListResponse> {
  return get<import("./types").PollListResponse>("/polls");
}
export function getPoll(id: string): Promise<import("./types").PollDetail> {
  return get<import("./types").PollDetail>(`/polls/${encodeURIComponent(id)}`);
}
export function createPoll(
  csrfToken: string,
  input: import("./types").CreatePollRequest,
): Promise<{ ok: true; id: string }> {
  return mutate("POST", "/polls", csrfToken, input);
}
export function votePoll(id: string, csrfToken: string, optionIds: string[]): Promise<{ ok: true }> {
  return mutate("POST", `/polls/${encodeURIComponent(id)}/vote`, csrfToken, { optionIds });
}
export function withdrawPollVote(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/polls/${encodeURIComponent(id)}/vote`, csrfToken);
}
export function addPollOption(id: string, csrfToken: string, label: string): Promise<{ ok: true; id: string }> {
  return mutate("POST", `/polls/${encodeURIComponent(id)}/options`, csrfToken, { label });
}
export function closePoll(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("PATCH", `/polls/${encodeURIComponent(id)}`, csrfToken, { status: "closed" });
}
export function updatePoll(
  id: string,
  csrfToken: string,
  patch: Partial<import("./types").UpdatePollRequest>,
): Promise<{ ok: true }> {
  return mutate("PATCH", `/polls/${encodeURIComponent(id)}`, csrfToken, patch);
}
export function deletePoll(id: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/polls/${encodeURIComponent(id)}`, csrfToken);
}

// FR-C2: list a guild's text channels + post an op announcement to one.
export function getGuildChannels(guildId: string): Promise<{ channels: Array<{ id: string; name: string }> }> {
  return get<{ channels: Array<{ id: string; name: string }> }>(`/guilds/${encodeURIComponent(guildId)}/channels`);
}
export function announceOperation(opId: string, csrfToken: string, channelId: string): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/announce`, csrfToken, { channelId });
}

export function updateGuildSettings(
  guildId: string,
  csrfToken: string,
  input: {
    orgName?: string | null;
    timezone?: string;
    discordInviteUrl?: string | null;
    admiralRoleId?: string | null;
    landingOptIn?: boolean;
  },
): Promise<{ ok: true }> {
  return mutate("PATCH", `/guilds/${encodeURIComponent(guildId)}/settings`, csrfToken, input);
}

export function setMemberRole(
  guildId: string,
  userId: string,
  role: "fleetoperator" | "crew",
  csrfToken: string,
): Promise<{ ok: true }> {
  return mutate("PUT", `/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}/role`, csrfToken, { role });
}

export function listOperations(includePast = false): Promise<{ operations: OperationSummary[] }> {
  return get<{ operations: OperationSummary[] }>(`/operations${includePast ? "?past=true" : ""}`);
}

export { type OperationSummary };

export function getOperation(id: string): Promise<OperationDetail> {
  return get<OperationDetail>(`/operations/${encodeURIComponent(id)}`);
}

export function createOperation(
  csrfToken: string,
  input: {
    guildId: string;
    title: string;
    opType: string;
    description?: string;
    meetingSystem?: string;
    meetingLocation?: string;
    scheduledAt: string;
    minParticipants?: number;
    visibility?: string;
    isStreamEvent?: boolean;
    partnerTargetGuildIds?: string[];
  },
): Promise<{ ok: true; id: string }> {
  return mutate("POST", "/operations", csrfToken, input);
}
