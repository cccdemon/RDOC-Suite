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

export function getSession(): Promise<SessionResponse> {
  return get<SessionResponse>("/session");
}

export function listOperations(includePast = false): Promise<{ operations: OperationSummary[] }> {
  return get<{ operations: OperationSummary[] }>(`/operations${includePast ? "?past=true" : ""}`);
}

export function getOperation(id: string): Promise<OperationDetail> {
  return get<OperationDetail>(`/operations/${encodeURIComponent(id)}`);
}
