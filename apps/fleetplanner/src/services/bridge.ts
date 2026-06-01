import { getEnv } from "../config/env.js";

// ── Types (redeclared inline; fleetplanner does NOT depend on the bridge
//    package). Keep in sync with apps/bridge shared/service types. ──────

export type BridgeMode = "discord_channel" | "external_voice" | "bot_relay";

export type GuildConfig = {
  guildId: string;
  enabled: boolean;
  commanderRoleIds: string[];
  allowedVoiceChannelIds: string[];
  bridgeMode: BridgeMode;
  logChannelId?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type AdminRole = "admiral" | "vice_admiral";

export type AdminRecord = {
  guildId: string;
  userId: string;
  role: AdminRole;
  protected: boolean;
  addedBy: string | null;
  createdAt: string;
};

export type MonitoringSnapshot = {
  generatedAt: string;
  uptimeSeconds: number;
  activeRooms: number;
  activeCommanders: number;
  speakingCommanders: number;
  system: {
    cpuPercent: number | null;
    memory: {
      processRssBytes: number;
      processHeapUsedBytes: number;
      processHeapTotalBytes: number;
      systemUsedBytes: number;
      systemTotalBytes: number;
    };
  };
  bandwidth: {
    source: string;
    totalBytesIn: number | null;
    totalBytesOut: number | null;
    bitrateIn: number | null;
    bitrateOut: number | null;
    error?: string;
  };
  rooms: Array<{
    roomId: string;
    activeCommanders: number;
    speakingCommanders: number;
    commanders: Array<{ userId: string; displayName?: string; speaking: boolean }>;
  }>;
};

export type AuditEntry = {
  id: string;
  guildId: string | null;
  actorUserId: string | null;
  actorLabel: string | null;
  action: string;
  target: string | null;
  metadata: string;
  createdAt: string;
};

// ── HTTP client ───────────────────────────────────────────────────────

/** True when the bridge internal API is configured (shared secret present). */
export function bridgeConfigured(): boolean {
  return !!getEnv().BRIDGE_FLEET_SECRET;
}

class BridgeNotConfiguredError extends Error {
  constructor() {
    super("BRIDGE_FLEET_SECRET is not configured");
    this.name = "BridgeNotConfiguredError";
  }
}

async function bridgeFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const env = getEnv();
  const secret = env.BRIDGE_FLEET_SECRET;
  if (!secret) throw new BridgeNotConfiguredError();
  const base = env.BRIDGE_INTERNAL_URL.replace(/\/$/, "");
  const headers: Record<string, string> = {
    authorization: `Bearer ${secret}`,
    ...(opts.body ? { "content-type": "application/json" } : {}),
    ...((opts.headers as Record<string, string>) ?? {}),
  };
  return fetch(`${base}${path}`, {
    ...opts,
    headers,
    signal: opts.signal ?? AbortSignal.timeout(10000),
  });
}

async function expectOk(res: Response, action: string): Promise<void> {
  if (!res.ok) {
    const detail = await res.text().catch(() => res.statusText);
    throw new Error(`Bridge ${action} failed (${res.status}): ${detail}`);
  }
}

const SNOWFLAKE = /^[0-9]{17,20}$/;

function assertGuildId(guildId: string): void {
  if (!SNOWFLAKE.test(guildId)) throw new Error(`Invalid guildId: ${guildId}`);
}

export async function getBridgeGuildConfig(guildId: string): Promise<GuildConfig | null> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/config`);
  if (res.status === 404) return null;
  await expectOk(res, "get guild config");
  return (await res.json()) as GuildConfig;
}

export async function saveBridgeGuildConfig(
  guildId: string,
  patch: {
    enabled?: boolean;
    commanderRoleIds?: string[];
    allowedVoiceChannelIds?: string[];
  },
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/config`, {
    method: "POST",
    body: JSON.stringify(patch),
  });
  await expectOk(res, "save guild config");
}

export async function listBridgeAdmins(guildId: string): Promise<AdminRecord[]> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/admins`);
  await expectOk(res, "list admins");
  return (await res.json()) as AdminRecord[];
}

export async function addBridgeAdmin(
  guildId: string,
  userId: string,
  role: AdminRole,
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/admins`, {
    method: "POST",
    body: JSON.stringify({ userId, role }),
  });
  await expectOk(res, "add admin");
}

export async function removeBridgeAdmin(guildId: string, userId: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/admins/${userId}`, {
    method: "DELETE",
  });
  await expectOk(res, "remove admin");
}

export async function getBridgeMonitoring(guildId: string): Promise<MonitoringSnapshot> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/monitoring`);
  await expectOk(res, "get monitoring");
  return (await res.json()) as MonitoringSnapshot;
}

export async function getBridgeAudit(
  guildId: string,
  opts: { limit?: number; offset?: number } = {},
): Promise<{ entries: AuditEntry[]; total: number }> {
  assertGuildId(guildId);
  const qs = new URLSearchParams();
  if (opts.limit !== undefined) qs.set("limit", String(opts.limit));
  if (opts.offset !== undefined) qs.set("offset", String(opts.offset));
  const suffix = qs.toString() ? `?${qs.toString()}` : "";
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/audit${suffix}`);
  await expectOk(res, "get audit");
  return (await res.json()) as { entries: AuditEntry[]; total: number };
}
