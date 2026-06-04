import { getPrisma } from "@rdoc-suite/db";
import { fetchGuildMember } from "../auth/discord.js";
import { getOAuthEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { readGuildConfig } from "./guildConfig.js";
import { getGlobalSettings } from "./globalSettings.js";

export type BridgeGateResult =
  | { ok: true }
  | { ok: false; reason: "missing_bridge_role" | "raumdock_member_fetch_failed" };

/**
 * Raumdock-wide bridge gate: the user must hold a specific Discord role on
 * the Raumdock server to use Squad Link at all. Live Discord lookup (no
 * cache), so a freshly granted/revoked role is reflected immediately.
 *
 * Shared by the OAuth login (apps/bridge/src/auth/oauth.ts) and the WS
 * connect (signaling/ws.ts) so a role change propagates on the next WS
 * connect without forcing a fresh OAuth. Returns ok when OAuth creds are
 * absent (tests/demos) or the gate isn't configured.
 */
export async function checkBridgeGate(opts: { userId: string }): Promise<BridgeGateResult> {
  const oauth = getOAuthEnv();
  if (!oauth) return { ok: true };

  const globalSettings = await getGlobalSettings();
  if (!globalSettings.bridgeRequiredRoleId || !globalSettings.raumdockGuildId) {
    return { ok: true };
  }

  const rdMember = await fetchGuildMember({
    botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
    guildId: globalSettings.raumdockGuildId,
    userId: opts.userId,
  });
  if (!rdMember.ok) {
    logger.warn(
      { userId: opts.userId, raumdockGuildId: globalSettings.raumdockGuildId },
      "bridge gate: raumdock member fetch failed",
    );
    return { ok: false, reason: "raumdock_member_fetch_failed" };
  }
  const hasBridgeRole =
    rdMember.value.present &&
    rdMember.value.member.roles.includes(globalSettings.bridgeRequiredRoleId);
  if (!hasBridgeRole) {
    return { ok: false, reason: "missing_bridge_role" };
  }
  return { ok: true };
}

export type PermissionCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "guild_not_enabled"
        | "missing_bridge_role"
        | "discord_api_error"
        | "not_in_voice"
        | "outside_allowed_voice_channel";
    };

export type VoiceChannelCheckResult =
  | { ok: true }
  | { ok: false; reason: "not_in_voice" | "outside_allowed_voice_channel" };

/**
 * Re-verifies that the user may use **Bridge Mode** (the no-mission Squad Link
 * guild bridge). Bridge Mode is its own operating mode, gated only by the
 * Raumdock bridge role ([[checkBridgeGate]]) — NOT by the commander role.
 * The commander role gates Command Net (the mission commander room), which is
 * a separate path issued by the fleetplanner.
 */
export async function recheckBridgeAccess(opts: {
  userId: string;
  guildId: string;
}): Promise<PermissionCheckResult> {
  const guildConfig = await readGuildConfig(opts.guildId);
  if (!guildConfig || !guildConfig.enabled) {
    return { ok: false, reason: "guild_not_enabled" };
  }
  const gate = await checkBridgeGate({ userId: opts.userId });
  if (!gate.ok) {
    return {
      ok: false,
      reason: gate.reason === "missing_bridge_role" ? "missing_bridge_role" : "discord_api_error",
    };
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
