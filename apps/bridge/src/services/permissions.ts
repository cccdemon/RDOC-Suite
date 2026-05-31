import { getPrisma } from "@rdoc-suite/db";
import { fetchGuildMember } from "../auth/discord.js";
import { getOAuthEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { readGuildConfig } from "./guildConfig.js";

export type PermissionCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "guild_not_enabled"
        | "no_commander_roles_configured"
        | "not_a_member"
        | "missing_commander_role"
        | "discord_api_error"
        | "not_in_voice"
        | "outside_allowed_voice_channel";
    };

export type VoiceChannelCheckResult =
  | { ok: true }
  | { ok: false; reason: "not_in_voice" | "outside_allowed_voice_channel" };

/**
 * Re-verifies that the given user is still allowed to participate in
 * the commander bridge for the given guild. Used periodically during
 * an active PTT session so a commander who has their role revoked is
 * kicked out.
 *
 * Returns { ok: true } when OAuth credentials are missing — in that
 * mode the bridge runs without Discord checks (tests, demos).
 */
export async function recheckCommanderRole(opts: {
  userId: string;
  guildId: string;
}): Promise<PermissionCheckResult> {
  const oauth = getOAuthEnv();
  if (!oauth) {
    return { ok: true };
  }

  const guildConfig = await readGuildConfig(opts.guildId);
  if (!guildConfig || !guildConfig.enabled) {
    return { ok: false, reason: "guild_not_enabled" };
  }
  if (guildConfig.commanderRoleIds.length === 0) {
    return { ok: false, reason: "no_commander_roles_configured" };
  }

  const memberRes = await fetchGuildMember({
    botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
    guildId: opts.guildId,
    userId: opts.userId,
  });
  if (!memberRes.ok) {
    logger.warn(
      { userId: opts.userId, guildId: opts.guildId, status: memberRes.error.status },
      "permission recheck: discord api error",
    );
    return { ok: false, reason: "discord_api_error" };
  }
  if (!memberRes.value.present) {
    return { ok: false, reason: "not_a_member" };
  }

  const memberRoles = new Set(memberRes.value.member.roles);
  const isCommander = guildConfig.commanderRoleIds.some((roleId) => memberRoles.has(roleId));
  if (!isCommander) {
    return { ok: false, reason: "missing_commander_role" };
  }
  return { ok: true };
}

/**
 * Verifies the user is currently sitting in one of the voice channels
 * the guild admin marked as participating (`/cc channel add`).
 *
 * Empty `allowedIds` means the admin has not configured any
 * restriction → every channel (and being-outside-voice) is allowed.
 * That matches the historical behaviour before voice-channel
 * enforcement existed, so adding this check to an existing deployment
 * is non-breaking until the admin opts in by adding the first channel.
 *
 * Voice state is sourced from the `UserVoiceState` table, which the
 * bot keeps current via the `GuildVoiceStates` intent +
 * voiceStateUpdate handler. The bridge itself has no Discord-Gateway
 * connection.
 */
export async function checkAllowedVoiceChannel(opts: {
  userId: string;
  guildId: string;
  allowedIds: string[];
}): Promise<VoiceChannelCheckResult> {
  if (opts.allowedIds.length === 0) {
    return { ok: true };
  }
  const row = await getPrisma().userVoiceState.findUnique({
    where: { guildId_userId: { guildId: opts.guildId, userId: opts.userId } },
  });
  if (!row || row.channelId === null) {
    return { ok: false, reason: "not_in_voice" };
  }
  if (!opts.allowedIds.includes(row.channelId)) {
    return { ok: false, reason: "outside_allowed_voice_channel" };
  }
  return { ok: true };
}
