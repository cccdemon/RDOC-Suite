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

export async function setBridgeAdminRole(guildId: string, userId: string, role: AdminRole): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/admins/${userId}/role`, {
    method: "POST",
    body: JSON.stringify({ role }),
  });
  await expectOk(res, "set admin role");
}

// ── Admin invite links ────────────────────────────────────────────────

export type AdminInviteLink = {
  id: string;
  label: string;
  role: AdminRole;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
};

export type MintedInviteLink = {
  id: string;
  label: string;
  role: AdminRole;
  expiresAt: string;
  url: string;
};

export async function listBridgeInvites(guildId: string): Promise<AdminInviteLink[]> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/invites`);
  await expectOk(res, "list invites");
  return (await res.json()) as AdminInviteLink[];
}

export async function mintBridgeInvite(
  guildId: string,
  label: string,
  role: AdminRole,
  ttlDays?: number,
): Promise<MintedInviteLink> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/invites`, {
    method: "POST",
    body: JSON.stringify({ label, role, ...(ttlDays ? { ttlDays } : {}) }),
  });
  await expectOk(res, "mint invite");
  return (await res.json()) as MintedInviteLink;
}

export async function revokeBridgeInvite(guildId: string, id: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/invites/${id}`, {
    method: "DELETE",
  });
  await expectOk(res, "revoke invite");
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

// ── Phase 2: Dashboard ────────────────────────────────────────────────

export type FleetDashboard = {
  guildId: string;
  guildName: string | null;
  enabled: boolean;
  health: { bridgeOk: boolean; botOk: boolean; livekitOk: boolean };
  activeCommanders: Array<{ userId: string; displayName?: string; speaking: boolean }>;
  commanderRoleMembers: Array<{
    userId: string;
    displayName: string;
    inVoice: boolean;
    inAllowedChannel: boolean;
  }>;
};

export async function getBridgeDashboard(guildId: string): Promise<FleetDashboard> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/dashboard`);
  await expectOk(res, "get dashboard");
  return (await res.json()) as FleetDashboard;
}

export async function stripBridgeCommanderRoles(guildId: string, userId: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/commander-roles/${userId}`, {
    method: "DELETE",
  });
  await expectOk(res, "strip commander roles");
}

// ── Phase 2: Sessions ─────────────────────────────────────────────────

export type SessionRecord = {
  id: string;
  guildId: string;
  label: string;
  createdBy: string;
  livekitRoom: string;
  status: "active" | "ended";
  createdAt: string;
  endedAt: string | null;
  inviteCount?: number;
};

export type SessionInvite = {
  id: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedBy: string | null;
};

export type IssuedSessionInvite = {
  id: string;
  sessionId: string;
  label: string;
  expiresAt: string;
  plaintext: string;
};

export async function listBridgeSessions(guildId: string): Promise<SessionRecord[]> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/sessions`);
  await expectOk(res, "list sessions");
  return ((await res.json()) as { sessions: SessionRecord[] }).sessions;
}

export async function createBridgeSession(guildId: string, label: string): Promise<SessionRecord> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/sessions`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  await expectOk(res, "create session");
  return (await res.json()) as SessionRecord;
}

export async function getBridgeSession(
  guildId: string,
  sessionId: string,
): Promise<{ session: SessionRecord; invites: SessionInvite[] } | null> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/sessions/${sessionId}`);
  if (res.status === 404) return null;
  await expectOk(res, "get session");
  return (await res.json()) as { session: SessionRecord; invites: SessionInvite[] };
}

export async function endBridgeSession(guildId: string, sessionId: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/sessions/${sessionId}/end`, {
    method: "POST",
  });
  await expectOk(res, "end session");
}

export async function mintBridgeSessionInvite(
  guildId: string,
  sessionId: string,
  label: string,
  ttlHours?: number,
): Promise<IssuedSessionInvite> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/sessions/${sessionId}/invites`, {
    method: "POST",
    body: JSON.stringify({ label, ...(ttlHours ? { ttlHours } : {}) }),
  });
  await expectOk(res, "mint session invite");
  return (await res.json()) as IssuedSessionInvite;
}

export async function revokeBridgeSessionInvite(
  guildId: string,
  sessionId: string,
  inviteId: string,
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(
    `/internal/fleet/guilds/${guildId}/sessions/${sessionId}/invites/${inviteId}/revoke`,
    { method: "POST" },
  );
  await expectOk(res, "revoke session invite");
}

// ── Phase 2: Relay bots (singleton, not guild-scoped) ─────────────────

export type RelayBotEntry = { name: string; token: string; channelId: string };
export type RelayBotsConfig = {
  livekitUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  roomName: string;
  guildId: string;
  bots: RelayBotEntry[];
};

export type BridgeGlobalSettings = {
  raumdockGuildId: string | null;
  bridgeRequiredRoleId: string | null;
  relayRequiredRoleId: string | null;
  updatedAt: string | null;
  updatedById: string | null;
};

export async function getBridgeGlobalSettings(): Promise<BridgeGlobalSettings> {
  const res = await bridgeFetch(`/internal/fleet/global-settings`);
  await expectOk(res, "get global settings");
  return (await res.json()) as BridgeGlobalSettings;
}

export async function saveBridgeGlobalSettings(
  patch: {
    raumdockGuildId?: string | null;
    bridgeRequiredRoleId?: string | null;
    relayRequiredRoleId?: string | null;
  },
  updatedById: string,
): Promise<void> {
  const res = await bridgeFetch(`/internal/fleet/global-settings`, {
    method: "POST",
    body: JSON.stringify({ ...patch, updatedById }),
  });
  await expectOk(res, "save global settings");
}

export async function getBridgeRelayConfig(guildId: string): Promise<RelayBotsConfig> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/relay-bots/config`);
  await expectOk(res, "get relay config");
  return (await res.json()) as RelayBotsConfig;
}

export async function saveBridgeRelayConfig(guildId: string, config: RelayBotsConfig): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/relay-bots/config`, {
    method: "POST",
    body: JSON.stringify({ ...config, guildId }),
  });
  await expectOk(res, "save relay config");
}

export async function getBridgeRelayMetrics(): Promise<unknown> {
  const res = await bridgeFetch(`/internal/fleet/relay-bots/metrics`);
  await expectOk(res, "get relay metrics");
  return res.json();
}

export async function restartBridgeRelayBots(): Promise<void> {
  const res = await bridgeFetch(`/internal/fleet/relay-bots/restart`, { method: "POST" });
  await expectOk(res, "restart relay bots");
}

// ── Phase 2: Discord voice (live role / channel management) ───────────

export type DiscordVoiceState = {
  channels: Array<{ id: string; name: string }>;
  voiceStates: Array<{ userId: string; displayName: string; channelId: string | null }>;
  offline?: boolean;
};

export async function getBridgeVoiceStates(guildId: string): Promise<DiscordVoiceState> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/discord/voice-states`);
  await expectOk(res, "get voice states");
  return (await res.json()) as DiscordVoiceState;
}

export async function getBridgeDiscordRoles(
  guildId: string,
): Promise<Array<{ id: string; name: string }>> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/discord/roles`);
  await expectOk(res, "get discord roles");
  return ((await res.json()) as { roles: Array<{ id: string; name: string }> }).roles;
}

export async function moveBridgeMember(
  guildId: string,
  userId: string,
  channelId: string | null,
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(
    `/internal/fleet/guilds/${guildId}/discord/members/${userId}/channel`,
    { method: "PATCH", body: JSON.stringify({ channelId }) },
  );
  await expectOk(res, "move member");
}

export async function addBridgeMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(
    `/internal/fleet/guilds/${guildId}/discord/members/${userId}/roles/${roleId}`,
    { method: "PUT" },
  );
  await expectOk(res, "add member role");
}

export async function removeBridgeMemberRole(
  guildId: string,
  userId: string,
  roleId: string,
): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(
    `/internal/fleet/guilds/${guildId}/discord/members/${userId}/roles/${roleId}`,
    { method: "DELETE" },
  );
  await expectOk(res, "remove member role");
}

/** Reorder the guild's allowed voice channels. `ordered` is the full set of
 *  allowed channel IDs in the desired display order (every ID must be in the
 *  bridge's allowed list). */
export async function reorderBridgeChannels(guildId: string, ordered: string[]): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/discord/channels/reorder`, {
    method: "POST",
    body: JSON.stringify({ ordered }),
  });
  await expectOk(res, "reorder channels");
}

export type StrategyChannelResult = {
  ok: true;
  channelId: string;
  name: string;
  moved: string[];
  moveFailures: Array<{ userId: string; status: number; message: string }>;
};

/** Create a temporary "strategy" voice channel and pull the given Discord
 *  members into it. The bridge garbage-collects it after 15 min idle. */
export async function createBridgeStrategyChannel(
  guildId: string,
  name: string,
  userIds: string[],
): Promise<StrategyChannelResult> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/discord/strategy-channel`, {
    method: "POST",
    body: JSON.stringify({ name, userIds }),
  });
  await expectOk(res, "create strategy channel");
  return (await res.json()) as StrategyChannelResult;
}

// ── Companion download tokens (global, not guild-scoped) ──────────────

export type DownloadToken = {
  id: string;
  guildId: string;
  label: string;
  createdBy: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  usedFrom: string | null;
};

export type CompanionRelease = {
  configured: boolean;
  release: {
    tagName: string;
    name: string | null;
    publishedAt: string | null;
    asset: { name: string; size: number } | null;
  } | null;
};

export async function listCompanionDownloads(guildId: string): Promise<{ tokens: DownloadToken[]; configured: boolean }> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/companion-downloads`);
  await expectOk(res, "list download tokens");
  return (await res.json()) as { tokens: DownloadToken[]; configured: boolean };
}

export async function mintCompanionDownload(guildId: string, label: string): Promise<{ id: string; label: string; expiresAt: string; url: string }> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/companion-downloads`, {
    method: "POST",
    body: JSON.stringify({ label }),
  });
  await expectOk(res, "mint download token");
  return (await res.json()) as { id: string; label: string; expiresAt: string; url: string };
}

export async function revokeCompanionDownload(guildId: string, id: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/companion-downloads/${id}`, { method: "DELETE" });
  await expectOk(res, "revoke download token");
}

export async function getCompanionRelease(): Promise<CompanionRelease> {
  const res = await bridgeFetch(`/internal/fleet/companion-release`);
  await expectOk(res, "get companion release");
  return (await res.json()) as CompanionRelease;
}

export async function dmBridgeDownloadLink(guildId: string, userId: string, label?: string): Promise<void> {
  assertGuildId(guildId);
  const res = await bridgeFetch(`/internal/fleet/guilds/${guildId}/members/${userId}/dm-download-link`, {
    method: "POST",
    body: JSON.stringify(label ? { label } : {}),
  });
  await expectOk(res, "dm download link");
}
