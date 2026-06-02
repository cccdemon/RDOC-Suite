// Multi-tenant guild service: install guilds, sync per-guild memberships
// from Discord, map Discord roles → fleetplanner roles, resolve the
// active guild for a request.

import { prisma } from "../db.js";
import { discordUserIdForFleetplannerUser, fetchGuildBasic, fetchGuildMemberRoles } from "./discord.js";
import { getActivePartnerGuildIds } from "./partnerships.js";

export type GuildRole = "fleetoperator" | "crew";

const ROLE_RANK: Record<GuildRole, number> = { fleetoperator: 3, crew: 1 };

export function guildRoleAtLeast(role: string, min: GuildRole): boolean {
  const rank = ROLE_RANK[role as GuildRole] ?? 0;
  return rank >= ROLE_RANK[min];
}

/**
 * Install (or refresh) a guild after the bot was added to it. The
 * installing user becomes the guild owner + a fleetoperator member.
 */
export type InstallResult =
  | { ok: true; id: string; name: string }
  | { ok: false; reason: "unreadable" | "banned" };

export async function installGuild(
  guildId: string,
  ownerUserId: string,
): Promise<InstallResult> {
  // Refuse (re)install of a banned guild — SuperAdmin ban is sticky.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const existing = (await (prisma.guild.findUnique as any)({
    where: { id: guildId },
    select: { bannedAt: true },
  })) as { bannedAt: Date | null } | null;
  if (existing?.bannedAt) return { ok: false, reason: "banned" };

  const basic = await fetchGuildBasic(guildId);
  if (!basic) return { ok: false, reason: "unreadable" };

  const guild = await prisma.guild.upsert({
    where: { id: guildId },
    create: {
      id: guildId,
      name: basic.name,
      iconHash: basic.icon,
      ownerUserId,
      botInstalledAt: new Date(),
      active: true,
    },
    update: {
      name: basic.name,
      iconHash: basic.icon,
      botInstalledAt: new Date(),
      active: true,
      // Keep the original owner if one is already set.
      ...(ownerUserId ? {} : {}),
    },
  });

  // Owner becomes a fleetoperator member.
  await prisma.guildMembership.upsert({
    where: { guildId_userId: { guildId, userId: ownerUserId } },
    create: { guildId, userId: ownerUserId, role: "fleetoperator" },
    update: { role: "fleetoperator" },
  });

  return { ok: true, id: guild.id, name: guild.name };
}

/**
 * Soft-remove a guild from Fleetplanner: active=false. Ops, memberships,
 * partnerships and bots stay in the DB; the guild vanishes from all lists
 * and can be reactivated by adding the bot again (unless banned).
 */
export async function deactivateGuild(guildId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.guild.update as any)({ where: { id: guildId }, data: { active: false } });
}

/** SuperAdmin ban: force inactive + set bannedAt so it cannot be re-added. */
export async function banGuild(guildId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.guild.update as any)({
    where: { id: guildId },
    data: { active: false, bannedAt: new Date() },
  });
}

/** SuperAdmin unban: clear bannedAt. Stays inactive until re-added. */
export async function unbanGuild(guildId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.guild.update as any)({
    where: { id: guildId },
    data: { bannedAt: null },
  });
}

/** All guilds for the SuperAdmin panel, incl. inactive + banned. */
export async function listAllGuildsForAdmin(): Promise<
  Array<{
    id: string;
    name: string;
    active: boolean;
    bannedAt: Date | null;
    ownerUserId: string | null;
    memberCount: number;
  }>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (prisma.guild.findMany as any)({
    orderBy: [{ bannedAt: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      active: true,
      bannedAt: true,
      ownerUserId: true,
      _count: { select: { memberships: true } },
    },
  })) as Array<{
    id: string;
    name: string;
    active: boolean;
    bannedAt: Date | null;
    ownerUserId: string | null;
    _count: { memberships: number };
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    bannedAt: r.bannedAt,
    ownerUserId: r.ownerUserId,
    memberCount: r._count.memberships,
  }));
}

/** Map a member's Discord role ids to a fleetplanner role via the guild's mapping. */
function mapDiscordRole(
  guild: { admiralRoleId: string | null },
  discordRoleIds: string[],
): GuildRole | null {
  if (guild.admiralRoleId && discordRoleIds.includes(guild.admiralRoleId)) return "fleetoperator";
  return null;
}

/**
 * Sync a user's guild memberships from the Discord guild list obtained
 * during OAuth (guilds scope). For each installed+active guild the user
 * is a Discord member of, ensure a membership row. If the guild has a
 * Discord-role mapping configured, the member's Discord roles are fetched
 * and mapped (never downgrades the guild owner below fleetoperator).
 */
export async function syncUserGuildMemberships(userId: string, discordGuildIds: string[]): Promise<void> {
  if (discordGuildIds.length === 0) return;
  const installed = await prisma.guild.findMany({
    where: { id: { in: discordGuildIds }, active: true },
  });

  for (const guild of installed) {
    const isOwner = guild.ownerUserId === userId;
    let role: GuildRole = isOwner ? "fleetoperator" : "crew";

    if (!isOwner && (guild.admiralRoleId)) {
      const discordUserId = await discordUserIdForFleetplannerUser(userId).catch(() => null);
      const roleIds = discordUserId ? await fetchGuildMemberRoles(guild.id, discordUserId).catch(() => null) : null;
      if (roleIds) {
        const mapped = mapDiscordRole(guild, roleIds);
        if (mapped) role = mapped;
      }
    }

    const existing = await prisma.guildMembership.findUnique({
      where: { guildId_userId: { guildId: guild.id, userId } },
    });

    if (!existing) {
      await prisma.guildMembership.create({ data: { guildId: guild.id, userId, role } });
    } else if (!isOwner && (guild.admiralRoleId)) {
      // Only auto-adjust role when a Discord mapping is configured; otherwise
      // keep whatever was set manually in-app.
      await prisma.guildMembership.update({
        where: { id: existing.id },
        data: { role },
      });
    }
  }
}

export async function listUserGuilds(userId: string) {
  return prisma.guildMembership.findMany({
    where: { userId, guild: { active: true } },
    include: { guild: true },
    orderBy: { guild: { name: "asc" } },
  });
}

export async function getMembership(userId: string, guildId: string) {
  return prisma.guildMembership.findUnique({
    where: { guildId_userId: { guildId, userId } },
    include: { guild: true },
  });
}

/**
 * Effective guild role of a user FOR a specific operation's guild.
 *
 * Resolution order:
 *   1. superadmin → fleetoperator everywhere.
 *   2. Member of the op's guild → their membership role.
 *   3. Op visibility "public" → any authenticated user gets "crew".
 *   4. Op visibility "partners" → member of an active partner guild gets
 *      "crew".
 *   5. Otherwise null (no access).
 *
 * Cross-guild participants never exceed "crew" — they can register units
 * and claim seats but cannot manage the op. Used by op-scoped API routes
 * (which act on an op id, not the active-guild cookie).
 */
export async function effectiveOpRole(
  userId: string,
  instanceRole: string,
  operationId: string,
): Promise<GuildRole | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const op = (await (prisma.operation.findUnique as any)({
    where: { id: operationId },
    select: { guildId: true, visibility: true },
  })) as { guildId: string; visibility: string } | null;
  if (!op) return null;
  if (instanceRole === "superadmin") return "fleetoperator";

  const m = await prisma.guildMembership.findUnique({
    where: { guildId_userId: { guildId: op.guildId, userId } },
    select: { role: true },
  });
  if (m) return m.role as GuildRole;

  // Not a member of the hosting guild — fall back to visibility.
  if (op.visibility === "public") return "crew";
  if (op.visibility === "partners") {
    const partnerIds = await getActivePartnerGuildIds(op.guildId);
    if (partnerIds.length > 0) {
      const partnerMembership = await prisma.guildMembership.findFirst({
        where: { userId, guildId: { in: partnerIds } },
        select: { id: true },
      });
      if (partnerMembership) return "crew";
    }
  }
  return null;
}

/**
 * Resolve which guild a request operates on. Prefers the cookie value if
 * the user is a member; otherwise falls back to the user's first guild.
 * Returns null if the user has no guild memberships.
 */
export async function resolveActiveGuild(
  userId: string,
  cookieGuildId: string | undefined,
): Promise<{ guildId: string; role: string; guildName: string } | null> {
  if (cookieGuildId) {
    const m = await getMembership(userId, cookieGuildId);
    if (m && m.guild.active) return { guildId: m.guildId, role: m.role, guildName: m.guild.name };
  }
  const first = await prisma.guildMembership.findFirst({
    where: { userId, guild: { active: true } },
    include: { guild: true },
    orderBy: { createdAt: "asc" },
  });
  if (!first) return null;
  return { guildId: first.guildId, role: first.role, guildName: first.guild.name };
}
