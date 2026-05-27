import type { FastifyReply, FastifyRequest } from "fastify";
import type { User } from "@prisma/client";
import { loadSession } from "./session.js";
import { basePath } from "../config/env.js";

export type AuthContext = { user: User; sessionId: string; csrfToken: string };

export type UserRole = "superadmin" | "fleetoperator" | "captain" | "crew";

const ROLE_RANK: Record<UserRole, number> = {
  superadmin: 4,
  fleetoperator: 3,
  captain: 2,
  crew: 1,
};

export function hasRole(user: User, minRole: UserRole): boolean {
  const rank = ROLE_RANK[user.role as UserRole] ?? 0;
  return rank >= ROLE_RANK[minRole];
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<AuthContext | null> {
  const ctx = await loadSession(request);
  if (!ctx) {
    reply.redirect(basePath("/auth/start"), 302);
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
