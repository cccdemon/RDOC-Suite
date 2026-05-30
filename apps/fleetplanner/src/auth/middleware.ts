import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { loadSession } from "./session.js";
import { basePath } from "../config/env.js";
import { resolveActiveGuild, guildRoleAtLeast, effectiveOpRole, type GuildRole } from "../services/guilds.js";

export type AuthContext = { user: User; sessionId: string; csrfToken: string };

/** Auth context plus the active guild (tenant) and the user's role in it. */
export type GuildContext = AuthContext & {
  guildId: string;
  guildName: string;
  guildRole: string;
};

export type UserRole = "superadmin" | "fleetoperator" | "captain" | "crew";

const ROLE_RANK: Record<UserRole, number> = {
  superadmin: 4,
  fleetoperator: 3,
  captain: 2,
  crew: 1,
};

const ACTIVE_GUILD_COOKIE = "fp_guild";

export function hasRole(user: User, minRole: UserRole): boolean {
  const rank = ROLE_RANK[user.role as UserRole] ?? 0;
  return rank >= ROLE_RANK[minRole];
}

export function activeGuildCookie(request: FastifyRequest): string | undefined {
  return (request.cookies as Record<string, string | undefined>)[ACTIVE_GUILD_COOKIE];
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const ctx = await loadSession(request);
  if (!ctx) {
    reply.redirect(basePath("/login"), 302);
    return null;
  }
  return ctx;
}

export async function requireRole(
  request: FastifyRequest,
  reply: FastifyReply,
  minRole: UserRole,
): Promise<AuthContext | null> {
  const ctx = await requireAuth(request, reply);
  if (!ctx) return null;
  if (!hasRole(ctx.user, minRole)) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return ctx;
}

export async function optionalAuth(request: FastifyRequest): Promise<AuthContext | null> {
  return loadSession(request);
}

/**
 * Resolve the logged-in user AND their active guild (tenant). The active
 * guild comes from the fp_guild cookie, validated against membership;
 * falls back to the user's first guild. If the user is logged in but has
 * NO guild membership, redirects to /guilds/none (the "add the bot / join
 * a Discord" page). Returns null when a redirect was issued.
 */
export async function requireGuild(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<GuildContext | null> {
  const ctx = await requireAuth(request, reply);
  if (!ctx) return null;
  const active = await resolveActiveGuild(ctx.user.id, activeGuildCookie(request));
  if (!active) {
    reply.redirect(basePath("/guilds/none"), 302);
    return null;
  }
  return { ...ctx, guildId: active.guildId, guildName: active.guildName, guildRole: active.role };
}

/**
 * Like requireGuild, but also enforces a minimum role WITHIN the active
 * guild. Instance superadmins bypass the guild-role check.
 */
export async function requireGuildRole(
  request: FastifyRequest,
  reply: FastifyReply,
  minRole: GuildRole,
): Promise<GuildContext | null> {
  const gctx = await requireGuild(request, reply);
  if (!gctx) return null;
  if (gctx.user.role === "superadmin") return gctx; // instance owner bypass
  if (!guildRoleAtLeast(gctx.guildRole, minRole)) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return gctx;
}

/**
 * Enforce a minimum role within a SPECIFIC operation's guild (used by
 * op-scoped API routes that act on an op id rather than the active guild).
 * 403s non-members and users below the required role.
 */
export async function requireOpRole(
  request: FastifyRequest,
  reply: FastifyReply,
  operationId: string,
  minRole: GuildRole,
): Promise<AuthContext | null> {
  const ctx = await requireAuth(request, reply);
  if (!ctx) return null;
  const role = await effectiveOpRole(ctx.user.id, ctx.user.role, operationId);
  if (!role || !guildRoleAtLeast(role, minRole)) {
    reply.code(403).send({ error: "forbidden" });
    return null;
  }
  return ctx;
}

/** Optional variant: resolves active guild but never redirects. */
export async function optionalGuild(request: FastifyRequest): Promise<GuildContext | null> {
  const ctx = await loadSession(request);
  if (!ctx) return null;
  const active = await resolveActiveGuild(ctx.user.id, activeGuildCookie(request));
  if (!active) return null;
  return { ...ctx, guildId: active.guildId, guildName: active.guildName, guildRole: active.role };
}
