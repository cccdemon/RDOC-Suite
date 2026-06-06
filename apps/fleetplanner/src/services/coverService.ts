import { getEnv } from "../config/env.js";

// Thin client for the @rdoc-suite/mission-cover render microservice (FR-P4).
// Mirrors the bridge.ts M2M pattern: Bearer secret + internal docker-network
// URL. The fleetplanner never renders; it sends the op payload and stores only
// the returned image URL/id.

export type CoverAsset = { name: string; role?: string };

export type CoverData = {
  title: string;
  subtitle?: string;
  tagline?: string;
  objectiveTitle?: string;
  objectiveText?: string;
  dateTime?: string;
  location?: string;
  assets?: CoverAsset[];
  briefingUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  backgroundImage?: string;
  branding?: {
    footerTitle?: string;
    securityText?: string;
    fileCode?: string;
    guildLogoUrl?: string;
  };
};

export type CoverFormat = "16:9" | "1:1" | "9:16" | "4:3" | "custom";
export type CoverPreset = "fleet-ops" | "black-ops" | "exploration" | "outlaw";

export type CoverRequest = {
  opId: string;
  format?: CoverFormat;
  preset?: CoverPreset;
  data: CoverData;
};

export type CoverResponse = {
  id: string;
  opId: string;
  width: number;
  height: number;
  preset: CoverPreset;
  format: CoverFormat;
  createdAt: string;
  urls: { png: string };
  author: { name: string; website: string; twitch: string; youtube: string };
};

/** True when the mission-cover service is configured (shared secret present). */
export function coverServiceConfigured(): boolean {
  return !!getEnv().MISSIONCOVER_SERVICE_SECRET;
}

class CoverServiceNotConfiguredError extends Error {
  constructor() {
    super("MISSIONCOVER_SERVICE_SECRET is not configured");
    this.name = "CoverServiceNotConfiguredError";
  }
}

async function coverFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const env = getEnv();
  const secret = env.MISSIONCOVER_SERVICE_SECRET;
  if (!secret) throw new CoverServiceNotConfiguredError();
  const base = env.MISSIONCOVER_SERVICE_URL.replace(/\/$/, "");
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    ...(opts.body ? { "content-type": "application/json" } : {}),
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${base}${path}`, {
    ...opts,
    headers,
    // Rendering can take a few seconds (headless Chromium); allow headroom.
    signal: opts.signal ?? AbortSignal.timeout(30000),
  });
}

async function expectOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`mission-cover ${action} failed (${res.status}): ${detail}`);
  }
}

/** Render + store a cover for an op. Returns the image link + metadata. */
export async function requestCover(req: CoverRequest): Promise<CoverResponse> {
  const res = await coverFetch("/v1/covers", {
    method: "POST",
    body: JSON.stringify(req),
  });
  await expectOk(res, "render");
  return (await res.json()) as CoverResponse;
}

/** Fetch metadata for a previously rendered cover. */
export async function getCover(id: string): Promise<CoverResponse | null> {
  const res = await coverFetch(`/v1/covers/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  await expectOk(res, "get");
  return (await res.json()) as CoverResponse;
}
