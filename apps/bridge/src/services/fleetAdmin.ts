import { getPrisma } from "@rdoc-suite/db";
import { getEnv, getOAuthEnv } from "../config/env.js";
import { logger } from "./logger.js";
import { rooms } from "./rooms.js";
import { bridgeRoomName } from "./livekit.js";
import { readGuildConfig } from "./guildConfig.js";
import { getGuildInfo } from "./guildInfo.js";
import { fetchGuildMember, removeGuildMemberRole } from "../auth/discord.js";
import { ADMIN_ROLES, type AdminRole, getAdminRecord, countAdmirals } from "./admins.js";

/**
 * Read/action helpers backing the fleetplanner-hosted bridge admin panels
 * (Phase 2). These mirror what the bridge admin web UI does in
 * `admin/routes.ts` (loadDashboardData, the commander-role strip handler)
 * but expose a focused, guild-scoped surface for the /internal/fleet API.
 * The Raid-Planer channel-mirror is intentionally NOT included — that page
 * stays on the bridge admin UI.
 */

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

/** One-shot LiveKit liveness probe (https variant of LIVEKIT_URL, <500 = up). */
async function checkLivekitHealth(): Promise<boolean> {
  const wsUrl = getEnv().LIVEKIT_URL;
  if (!wsUrl) return false;
  const httpUrl = wsUrl.replace(/^ws:\/\//, "http://").replace(/^wss:\/\//, "https://");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 1500);
  try {
    const res = await fetch(httpUrl, { signal: ctl.signal, redirect: "manual" });
    return res.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export async function fleetDashboard(guildId: string): Promise<FleetDashboard> {
  const cfg = await readGuildConfig(guildId);
  const snapshot = rooms.snapshot(bridgeRoomName(guildId));
  const commanderRoleIds = new Set(cfg?.commanderRoleIds ?? []);
  const allowedIds = new Set(cfg?.allowedVoiceChannelIds ?? []);
  const oauth = getOAuthEnv();

  const commanderRoleMembers: FleetDashboard["commanderRoleMembers"] = [];
  const nameByUserId = new Map<string, string>();

  if (oauth && commanderRoleIds.size > 0) {
    try {
      const res = await fetch(
        `https://discord.com/api/v10/guilds/${guildId}/members?limit=1000`,
        { headers: { authorization: `Bot ${oauth.DISCORD_RDOCRTC_BOT_TOKEN}` } },
      );
      if (res.ok) {
        const raw: unknown = await res.json();
        if (Array.isArray(raw)) {
          const voiceRows = await getPrisma().userVoiceState.findMany({ where: { guildId } });
          const voiceByUserId = new Map(voiceRows.map((r) => [r.userId, r.channelId]));
          for (const m of raw) {
            const obj = m as Record<string, unknown>;
            const user = obj.user as Record<string, unknown> | undefined;
            const roles = obj.roles as string[] | undefined;
            if (!user || typeof user.id !== "string" || !roles) continue;
            if (!roles.some((r) => commanderRoleIds.has(r))) continue;
            const display =
              (typeof obj.nick === "string" && obj.nick) ||
              (typeof user.global_name === "string" && user.global_name) ||
              (typeof user.username === "string" && user.username) ||
              user.id;
            const ch = voiceByUserId.get(user.id) ?? null;
            commanderRoleMembers.push({
              userId: user.id,
              displayName: display,
              inVoice: ch !== null,
              inAllowedChannel: ch !== null && allowedIds.has(ch),
            });
            nameByUserId.set(user.id, display);
          }
        }
      }
    } catch (err) {
      logger.warn({ err, guildId }, "fleet dashboard: discord members fetch failed");
    }
  }

  const [guildInfo, livekitOk] = await Promise.all([getGuildInfo(guildId), checkLivekitHealth()]);

  return {
    guildId,
    guildName: guildInfo?.name ?? null,
    enabled: cfg?.enabled ?? false,
    health: { bridgeOk: true, botOk: guildInfo !== null, livekitOk },
    activeCommanders: snapshot.map((c) => ({
      userId: c.userId,
      displayName: nameByUserId.get(c.userId) ?? c.displayName,
      speaking: c.speaking,
    })),
    commanderRoleMembers,
  };
}

export type StripRolesResult =
  | { ok: true; removed: string[] }
  | { ok: false; reason: "invalid_user_id" | "oauth_not_configured" | "no_commander_roles_configured" | "discord_api_error" | "user_not_in_guild" | "partial_failure"; removed?: string[]; failed?: string[] };

/** Strip all configured commander roles a user currently holds. */
export async function stripCommanderRoles(guildId: string, userId: string): Promise<StripRolesResult> {
  if (!/^[0-9]{17,20}$/.test(userId)) return { ok: false, reason: "invalid_user_id" };
  const oauth = getOAuthEnv();
  if (!oauth) return { ok: false, reason: "oauth_not_configured" };
  const cfg = await readGuildConfig(guildId);
  if (!cfg || cfg.commanderRoleIds.length === 0) {
    return { ok: false, reason: "no_commander_roles_configured" };
  }
  const memberRes = await fetchGuildMember({
    botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
    guildId,
    userId,
  });
  if (!memberRes.ok) return { ok: false, reason: "discord_api_error" };
  if (!memberRes.value.present) return { ok: false, reason: "user_not_in_guild" };

  const currentRoles = new Set(memberRes.value.member.roles);
  const toStrip = cfg.commanderRoleIds.filter((r) => currentRoles.has(r));
  if (toStrip.length === 0) return { ok: true, removed: [] };

  const results = await Promise.all(
    toStrip.map((roleId) =>
      removeGuildMemberRole({ botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN, guildId, userId, roleId }),
    ),
  );
  const removed = toStrip.filter((_, i) => results[i]!.ok);
  const failed = toStrip.filter((_, i) => !results[i]!.ok);
  if (failed.length > 0) {
    logger.warn({ guildId, userId, failed }, "fleet strip commander roles: some removals failed");
    return { ok: false, reason: "partial_failure", removed, failed };
  }
  return { ok: true, removed };
}

export type SetRoleResult =
  | { ok: true }
  | { ok: false; reason: "invalid_role" | "target_not_found" | "target_protected" | "would_remove_last_admiral" };

/**
 * System-level admin role change for the fleetplanner-hosted panel.
 * Mirrors setAdminRole's safety guards (no protected target, never demote
 * the last admiral) but skips the "caller must be admiral" check — the
 * fleetplanner superadmin has no bridge AdminUser identity.
 */
export async function setAdminRoleSystem(
  guildId: string,
  userId: string,
  newRole: AdminRole,
): Promise<SetRoleResult> {
  if (!(ADMIN_ROLES as readonly string[]).includes(newRole)) return { ok: false, reason: "invalid_role" };
  const target = await getAdminRecord({ guildId, userId });
  if (!target) return { ok: false, reason: "target_not_found" };
  if (target.protected) return { ok: false, reason: "target_protected" };
  if (newRole === "vice_admiral" && target.role === "admiral") {
    if ((await countAdmirals(guildId)) <= 1) return { ok: false, reason: "would_remove_last_admiral" };
  }
  await getPrisma().adminUser.update({
    where: { guildId_userId: { guildId, userId } },
    data: { role: newRole },
  });
  return { ok: true };
}
