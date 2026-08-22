import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { loadSession } from "./session.js";
import { basePath } from "../config/env.js";
import { resolveActiveGuild } from "../services/guilds.js";

export type AuthContext = { user: User; sessionId: string; csrfToken: string };

/** Auth context plus the active guild (tenant) and the user's role in it. */
type GuildContext = AuthContext & {
  guildId: string;
  guildName: string;
  guildRole: string;
};

type UserRole = "superadmin" | "fleetoperator" | "crew";

const ROLE_RANK: Record<UserRole, number> = {
  superadmin: 4,
  fleetoperator: 3,
  crew: 1,
};

const ACTIVE_GUILD_COOKIE = "fp_guild";

function activeGuildCookie(request: FastifyRequest): string | undefined {
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
async function requireGuild(
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
