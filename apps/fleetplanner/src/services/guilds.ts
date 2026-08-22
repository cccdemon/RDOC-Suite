// Multi-tenant guild service: install guilds, sync per-guild memberships
// from Discord, map Discord roles → fleetplanner roles, resolve the
// active guild for a request.

import { prisma } from "../db.js";
import { checkGuildBotPresence, discordUserIdForFleetplannerUser, fetchGuildBasic, fetchGuildMemberRoles, fetchGuildPresence } from "./discord.js";
import { getActivePartnerGuildIds } from "./partnerships.js";

export type GuildRole = "fleetoperator" | "crew";

// Synthetic E2E test guilds (see routes/e2eAuth.ts) — never real Discord ids,
// so a presence check always 404s. Excluded from the sweep (so they don't flap)
// and from superadmin metrics/lists (so test data never inflates real numbers).
export const E2E_GUILD_IDS = ["100000000000000001", "100000000000000002"];

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
async function deactivateGuild(guildId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.guild.update as any)({ where: { id: guildId }, data: { active: false } });
}

// In-memory throttle: at most one Discord presence sweep per process per window.
let lastSweepAt = 0;
const SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * Soft-hide guilds whose bot was removed. The Fleetplanner bot is REST-only
 * (no gateway → no guildDelete event), so presence is polled on demand. Called
 * before the admin guild list renders; throttled so reloads don't hammer the
 * Discord API. Only a definitive "absent" (403/404) deactivates a guild —
 * transient failures are left untouched. Re-adding the bot reactivates it via
 * installGuild().
 */
export async function sweepGuildPresence(force = false): Promise<void> {
  const now = Date.now();
  if (!force && now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;

  const guilds = await prisma.guild.findMany({
    where: { active: true, bannedAt: null },
    select: { id: true, name: true, iconHash: true },
  });
  for (const g of guilds) {
    if (E2E_GUILD_IDS.includes(g.id)) continue;
    const { presence, basic } = await fetchGuildPresence(g.id);
    if (presence === "absent") {
      await deactivateGuild(g.id);
      continue;
    }
    // Name and icon are otherwise written only at install time, so a server
    // that renames itself or changes its icon keeps the old values forever —
    // and a stale icon hash 404s on Discord's CDN. The call above already
    // carries the current values; use them.
    if (basic && (basic.name !== g.name || basic.icon !== g.iconHash)) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (prisma.guild.update as any)({
        where: { id: g.id },
        data: { name: basic.name, iconHash: basic.icon },
      }).catch(() => { /* a refresh must never break the sweep */ });
    }
  }
}

/**
 * Keep guild names, icons and presence fresh on their own schedule. Before this
 * the sweep only ran when a superadmin happened to open the admin console, so a
 * changed server icon stayed broken on the public start page indefinitely.
 */
export function startGuildRefreshScheduler(log: { info: (msg: string) => void; error: (e: unknown, msg: string) => void }): void {
  const tick = () =>
    void sweepGuildPresence(true).catch((e) => log.error(e, "[guilds] presence/refresh sweep failed"));
  setTimeout(() => {
    tick();
    setInterval(tick, 6 * 60 * 60 * 1000);
  }, 30_000);
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
    eventCount: number;
  }>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (prisma.guild.findMany as any)({
    // Hide soft-removed guilds (bot gone → active=false). Banned guilds stay
    // visible so a superadmin can unban them. E2E test guilds never show.
    where: { id: { notIn: E2E_GUILD_IDS }, OR: [{ active: true }, { bannedAt: { not: null } }] },
    orderBy: [{ bannedAt: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      active: true,
      bannedAt: true,
      ownerUserId: true,
      _count: { select: { memberships: true, operations: true } },
    },
  })) as Array<{
    id: string;
    name: string;
    active: boolean;
    bannedAt: Date | null;
    ownerUserId: string | null;
    _count: { memberships: number; operations: number };
  }>;
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    active: r.active,
    bannedAt: r.bannedAt,
    ownerUserId: r.ownerUserId,
    memberCount: r._count.memberships,
    eventCount: r._count.operations,
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

// Every logged-in user — including a superadmin — sees exactly the guilds
// where they hold a role (>= crew). No role in a guild → it is not listed.
// A superadmin's full cross-guild view lives in the admin console
// (listAllGuildsForAdmin). Operating in a guild still requires a real
// fleetoperator membership there; visibility ≠ authority.
export async function listUserGuilds(userId: string) {
  return prisma.guildMembership.findMany({
    where: { userId, guild: { active: true } },
    include: { guild: true },
    orderBy: { guild: { name: "asc" } },
  });
}

/** Non-voice guild settings + member list for the admiral console (API v1). */
export async function getGuildSettingsData(guildId: string): Promise<{
  guild: {
    id: string;
    name: string;
    orgName: string | null;
    ownerUserId: string | null;
    admiralRoleId: string | null;
    discordInviteUrl: string | null;
    timezone: string;
    landingOptIn: boolean;
  };
  members: Array<{ userId: string; username: string; role: string; isOwner: boolean }>;
} | null> {
  const [guild, memberships] = await Promise.all([
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (prisma.guild.findUnique as any)({
      where: { id: guildId },
      select: {
        id: true, name: true, orgName: true, ownerUserId: true,
        admiralRoleId: true, discordInviteUrl: true, timezone: true, landingOptIn: true,
      },
    }) as Promise<{
      id: string; name: string; orgName: string | null; ownerUserId: string | null;
      admiralRoleId: string | null; discordInviteUrl: string | null; timezone: string;
      landingOptIn: boolean;
    } | null>,
    prisma.guildMembership.findMany({
      where: { guildId },
      include: { user: { select: { id: true, username: true } } },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!guild) return null;
  return {
    guild,
    members: memberships.map((m) => ({
      userId: m.userId,
      username: m.user.username,
      role: m.role,
      isOwner: m.userId === guild.ownerUserId,
    })),
  };
}

/** Persist validated non-voice guild settings. Caller pre-validates each field. */
export async function updateGuildSettings(
  guildId: string,
  data: {
    orgName?: string | null;
    timezone?: string;
    discordInviteUrl?: string | null;
    admiralRoleId?: string | null;
    landingOptIn?: boolean;
  },
): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (prisma.guild.update as any)({ where: { id: guildId }, data });
}

/**
 * Orgs for the public "used by" panel on the start page.
 *
 * Three conditions, all required: the guild consented (`landingOptIn`), it is
 * live (active, not banned), and it has a Discord invite — a card with no
 * destination is pointless. Nothing personal is returned, and the synthetic E2E
 * guilds are excluded so test data can never end up on the landing page.
 */
export async function listPublicOrgs(): Promise<
  Array<{ name: string; inviteUrl: string; iconUrl: string | null }>
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (await (prisma.guild.findMany as any)({
    where: {
      landingOptIn: true,
      active: true,
      bannedAt: null,
      discordInviteUrl: { not: null },
      id: { notIn: E2E_GUILD_IDS },
    },
    select: { id: true, name: true, orgName: true, iconHash: true, discordInviteUrl: true },
    orderBy: [{ orgName: "asc" }, { name: "asc" }],
  })) as Array<{
    id: string; name: string; orgName: string | null;
    iconHash: string | null; discordInviteUrl: string | null;
  }>;

  return rows
    .filter((g): g is typeof g & { discordInviteUrl: string } => Boolean(g.discordInviteUrl))
    .map((g) => ({
      name: g.orgName?.trim() || g.name,
      inviteUrl: g.discordInviteUrl,
      iconUrl: g.iconHash ? `https://cdn.discordapp.com/icons/${g.id}/${g.iconHash}.png?size=64` : null,
    }));
}

/** Set a member's per-guild role. Never demotes the guild owner below
 *  fleetoperator (owner stays admiral). Returns false if no such member. */
export async function setMembershipRole(
  guildId: string,
  userId: string,
  role: GuildRole,
): Promise<{ ok: boolean; ownerProtected?: boolean }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const guild = (await (prisma.guild.findUnique as any)({
    where: { id: guildId },
    select: { ownerUserId: true },
  })) as { ownerUserId: string | null } | null;
  if (guild?.ownerUserId === userId && role !== "fleetoperator") {
    return { ok: false, ownerProtected: true };
  }
  const res = await prisma.guildMembership.updateMany({
    where: { guildId, userId },
    data: { role },
  });
  return { ok: res.count > 0 };
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
 *   1. Member of the op's guild → their membership role.
 *   2. Op visibility "public" → any authenticated user gets "crew".
 *   3. Op visibility "partners" → member of an active partner guild gets
 *      "crew".
 *   4. Otherwise null (no access).
 *
 * NOTE: a superadmin is NOT auto-granted operator here. Outside the admin
 * console they act on their real GuildMembership.role (or fall through to
 * visibility, like any user). Cross-guild management lives in /admin.
 *
 * Cross-guild participants never exceed "crew" — they can register units
 * and claim seats but cannot manage the op. Used by op-scoped API routes
 * (which act on an op id, not the active-guild cookie).
 */
export async function effectiveOpRole(
  userId: string,
  _instanceRole: string,
  operationId: string,
): Promise<GuildRole | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const op = (await (prisma.operation.findUnique as any)({
    where: { id: operationId },
    select: { guildId: true, visibility: true },
  })) as { guildId: string; visibility: string } | null;
  if (!op) return null;

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

// Per-operation management gate. All op-level roles share the SAME rights
// (user requirement): the guild's fleet operators, the op CREATOR
// (Event Manager), and any appointed op LEADER (Raid Leiter / Wing Commander).
// A superadmin is NOT auto-granted — effectiveOpRole resolves their real
// guild membership; cross-guild powers live in the admin console.
export async function canApproveUnits(userId: string, instanceRole: string, operationId: string) {
  const opRole = await effectiveOpRole(userId, instanceRole, operationId);
  if (opRole === "fleetoperator") return true;
  // The creator keeps full control of their own op even if their guild role is
  // only crew (or they later lose guild membership).
  const op = await prisma.operation.findUnique({
    where: { id: operationId },
    select: { createdById: true },
  });
  if (op?.createdById === userId) return true;
  if (!opRole) return false;
  const leader = await prisma.operationLeader.findUnique({
    where: { operationId_userId: { operationId, userId } },
    select: { id: true },
  });
  return !!leader;
}
