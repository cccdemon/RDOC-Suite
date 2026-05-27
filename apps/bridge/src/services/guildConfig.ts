import type { BridgeMode, GuildConfig } from "@dccc/shared";
import { getPrisma } from "@dccc/db";

const BRIDGE_MODES = new Set<BridgeMode>(["discord_channel", "external_voice", "bot_relay"]);

function isBridgeMode(value: string): value is BridgeMode {
  return BRIDGE_MODES.has(value as BridgeMode);
}

function decodeIdList(json: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed) && parsed.every((x) => typeof x === "string")) {
      return parsed;
    }
  } catch {
    // fall through
  }
  return [];
}

/**
 * Bridge-side write API for guild configuration. Used by the admin
 * web UI (Phase B onwards). Previously bridge was read-only and writes
 * went via bot slash commands; now both paths upsert into the same row.
 */
export async function saveGuildConfig(
  guildId: string,
  patch: {
    enabled?: boolean;
    bridgeMode?: BridgeMode;
    commanderRoleIds?: string[];
    allowedVoiceChannelIds?: string[];
    logChannelId?: string | null;
  },
): Promise<GuildConfig> {
  const data: Record<string, unknown> = {};
  if (patch.enabled !== undefined) data.enabled = patch.enabled;
  if (patch.bridgeMode !== undefined) data.bridgeMode = patch.bridgeMode;
  if (patch.commanderRoleIds !== undefined) {
    data.commanderRoleIds = JSON.stringify(patch.commanderRoleIds);
  }
  if (patch.allowedVoiceChannelIds !== undefined) {
    data.allowedVoiceChannelIds = JSON.stringify(patch.allowedVoiceChannelIds);
  }
  if (patch.logChannelId !== undefined) data.logChannelId = patch.logChannelId;

  const row = await getPrisma().guildConfig.upsert({
    where: { guildId },
    create: {
      guildId,
      enabled: patch.enabled ?? false,
      bridgeMode: patch.bridgeMode ?? "external_voice",
      commanderRoleIds: JSON.stringify(patch.commanderRoleIds ?? []),
      allowedVoiceChannelIds: JSON.stringify(patch.allowedVoiceChannelIds ?? []),
      logChannelId: patch.logChannelId ?? null,
    },
    update: data,
  });
  const cfg: GuildConfig = {
    guildId: row.guildId,
    enabled: row.enabled,
    commanderRoleIds: decodeIdList(row.commanderRoleIds),
    allowedVoiceChannelIds: decodeIdList(row.allowedVoiceChannelIds),
    bridgeMode: isBridgeMode(row.bridgeMode) ? row.bridgeMode : "external_voice",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.logChannelId) cfg.logChannelId = row.logChannelId;
  return cfg;
}

export async function readGuildConfig(guildId: string): Promise<GuildConfig | null> {
  const row = await getPrisma().guildConfig.findUnique({ where: { guildId } });
  if (!row) return null;
  const cfg: GuildConfig = {
    guildId: row.guildId,
    enabled: row.enabled,
    commanderRoleIds: decodeIdList(row.commanderRoleIds),
    allowedVoiceChannelIds: decodeIdList(row.allowedVoiceChannelIds),
    bridgeMode: isBridgeMode(row.bridgeMode) ? row.bridgeMode : "external_voice",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.logChannelId) {
    cfg.logChannelId = row.logChannelId;
  }
  return cfg;
}
