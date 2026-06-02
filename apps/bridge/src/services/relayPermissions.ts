import { getEnv, getOAuthEnv } from "../config/env.js";
import { getGlobalSettings } from "./globalSettings.js";
import { getRelayBotsConfig } from "./relayBotsConfig.js";

export type RelayRoleGateVerdict =
  | { ok: true }
  | { ok: false; reason: "misconfigured" | "missing_role" };

export async function hasRelayRole(
  botToken: string,
  guildId: string,
  discordUserId: string,
  requiredRoleId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `https://discord.com/api/v10/guilds/${guildId}/members/${discordUserId}`,
      { headers: { authorization: `Bot ${botToken}` } },
    );
    if (!res.ok) return false;
    const member = (await res.json()) as { roles?: string[] };
    return Array.isArray(member.roles) && member.roles.includes(requiredRoleId);
  } catch {
    return false;
  }
}

export async function isRelayConfigured(guildId: string): Promise<boolean> {
  if (getEnv().RELAY_BOTS_SECRET) return true;
  const config = await getRelayBotsConfig(guildId);
  return config.bots.length > 0;
}

export async function checkRelayPublisherRoleGate(
  discordUserId: string,
): Promise<RelayRoleGateVerdict> {
  const settings = await getGlobalSettings();
  if (!settings.relayRequiredRoleId) return { ok: true };

  const checkGuildId = settings.raumdockGuildId;
  const botToken = getOAuthEnv()?.DISCORD_RDOCRTC_BOT_TOKEN;
  if (!checkGuildId || !botToken) {
    return { ok: false, reason: "misconfigured" };
  }

  const allowed = await hasRelayRole(
    botToken,
    checkGuildId,
    discordUserId,
    settings.relayRequiredRoleId,
  );
  return allowed ? { ok: true } : { ok: false, reason: "missing_role" };
}

export async function canUseRelayForCommander(opts: {
  guildId: string | null;
  userId: string;
}): Promise<boolean> {
  if (!opts.guildId) return false;
  if (!(await isRelayConfigured(opts.guildId))) return false;
  return (await checkRelayPublisherRoleGate(opts.userId)).ok;
}
