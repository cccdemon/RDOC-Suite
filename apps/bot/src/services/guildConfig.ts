import type { BridgeMode, GuildConfig } from "@rdoc-suite/shared";
import { getPrisma } from "@rdoc-suite/db";

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
    // fall through to empty
  }
  return [];
}

function encodeIdList(ids: string[]): string {
  return JSON.stringify(ids);
}

function rowToGuildConfig(row: {
  guildId: string;
  enabled: boolean;
  commanderRoleIds: string;
  allowedVoiceChannelIds: string;
  bridgeMode: string;
  logChannelId: string | null;
  createdAt: Date;
  updatedAt: Date;
}): GuildConfig {
  const config: GuildConfig = {
    guildId: row.guildId,
    enabled: row.enabled,
    commanderRoleIds: decodeIdList(row.commanderRoleIds),
    allowedVoiceChannelIds: decodeIdList(row.allowedVoiceChannelIds),
    bridgeMode: isBridgeMode(row.bridgeMode) ? row.bridgeMode : "external_voice",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
  if (row.logChannelId) {
    config.logChannelId = row.logChannelId;
  }
  return config;
}

export async function getGuildConfig(guildId: string): Promise<GuildConfig | null> {
  const row = await getPrisma().guildConfig.findUnique({ where: { guildId } });
  return row ? rowToGuildConfig(row) : null;
}

export async function ensureGuildConfig(
  guildId: string,
  defaults: { bridgeMode?: BridgeMode } = {},
): Promise<GuildConfig> {
  const row = await getPrisma().guildConfig.upsert({
    where: { guildId },
    create: {
      guildId,
      bridgeMode: defaults.bridgeMode ?? "external_voice",
    },
    update: {},
  });
  return rowToGuildConfig(row);
}

export async function setBridgeMode(guildId: string, mode: BridgeMode): Promise<GuildConfig> {
  const row = await getPrisma().guildConfig.upsert({
    where: { guildId },
    create: { guildId, bridgeMode: mode },
    update: { bridgeMode: mode },
  });
  return rowToGuildConfig(row);
}

export async function setEnabled(guildId: string, enabled: boolean): Promise<GuildConfig> {
  const row = await getPrisma().guildConfig.upsert({
    where: { guildId },
    create: { guildId, enabled },
    update: { enabled },
  });
  return rowToGuildConfig(row);
}

async function mutateIdList(
  guildId: string,
  field: "commanderRoleIds" | "allowedVoiceChannelIds",
  mutate: (current: string[]) => string[],
): Promise<GuildConfig> {
  const existing = await getPrisma().guildConfig.findUnique({
    where: { guildId },
  });
  const current = decodeIdList(existing?.[field] ?? "[]");
  const next = mutate(current);

  const row = await getPrisma().guildConfig.upsert({
    where: { guildId },
    create: { guildId, [field]: encodeIdList(next) },
    update: { [field]: encodeIdList(next) },
  });
  return rowToGuildConfig(row);
}

export function addCommanderRole(guildId: string, roleId: string): Promise<GuildConfig> {
  return mutateIdList(guildId, "commanderRoleIds", (current) =>
    current.includes(roleId) ? current : [...current, roleId],
  );
}

export function removeCommanderRole(guildId: string, roleId: string): Promise<GuildConfig> {
  return mutateIdList(guildId, "commanderRoleIds", (current) =>
    current.filter((id) => id !== roleId),
  );
}

export function addAllowedChannel(guildId: string, channelId: string): Promise<GuildConfig> {
  return mutateIdList(guildId, "allowedVoiceChannelIds", (current) =>
    current.includes(channelId) ? current : [...current, channelId],
  );
}

export function removeAllowedChannel(guildId: string, channelId: string): Promise<GuildConfig> {
  return mutateIdList(guildId, "allowedVoiceChannelIds", (current) =>
    current.filter((id) => id !== channelId),
  );
}
