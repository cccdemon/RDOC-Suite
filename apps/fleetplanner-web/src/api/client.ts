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

async function mutate<T>(method: "POST" | "PUT" | "DELETE", path: string, csrfToken: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    credentials: "same-origin",
    headers: {
      accept: "application/json",
      "x-csrf-token": csrfToken,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
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

export function claimSeat(opId: string, seatId: string, csrfToken: string): Promise<{ ok: true; seatId: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/claim`, csrfToken);
}

export function unclaimSeat(opId: string, seatId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/seats/${encodeURIComponent(seatId)}/claim`, csrfToken);
}

export function cqbSignup(opId: string, csrfToken: string, note?: string): Promise<{ ok: true }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/cqb/signup`, csrfToken, note ? { note } : {});
}

export function cqbWithdraw(opId: string, csrfToken: string): Promise<{ ok: true }> {
  return mutate("DELETE", `/operations/${encodeURIComponent(opId)}/cqb/signup`, csrfToken);
}

export function setHangarShare(opId: string, csrfToken: string, allow: boolean): Promise<{ ok: true }> {
  return mutate("PUT", `/operations/${encodeURIComponent(opId)}/hangar-share`, csrfToken, { allow });
}

export function getHangar(): Promise<{ ships: import("./types").ShipSummary[] }> {
  return get<{ ships: import("./types").ShipSummary[] }>("/hangar");
}

export function searchShips(q: string): Promise<{ ships: import("./types").ShipSummary[] }> {
  return get<{ ships: import("./types").ShipSummary[] }>(`/ships/search?q=${encodeURIComponent(q)}`);
}

export function registerShipUnit(
  opId: string,
  csrfToken: string,
  input: { shipId?: string; ownedShipId?: string; storeOwnedShip?: boolean; captainNote?: string },
): Promise<{ ok: true; unitId: string }> {
  return mutate("POST", `/operations/${encodeURIComponent(opId)}/units`, csrfToken, {
    unitType: "ship",
    ...input,
  });
}

export function listOperations(includePast = false): Promise<{ operations: OperationSummary[] }> {
  return get<{ operations: OperationSummary[] }>(`/operations${includePast ? "?past=true" : ""}`);
}

export function getOperation(id: string): Promise<OperationDetail> {
  return get<OperationDetail>(`/operations/${encodeURIComponent(id)}`);
}
