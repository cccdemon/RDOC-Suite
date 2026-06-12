// E2E TEST-LOGIN SEAM — DISABLED UNLESS `E2E_TEST_LOGIN_SECRET` IS SET.
//
// This is a deliberate, env-gated test backdoor used ONLY by the Playwright
// suite (scripts/e2e) to sign in synthetic test players against a running
// instance. Security posture:
//   - Routes are registered ONLY when E2E_TEST_LOGIN_SECRET (>=32 chars) is set.
//     With it unset (the normal prod default) these routes do not exist (404).
//   - Every request is gated by a constant-time secret compare.
//   - It can ONLY mint sessions for synthetic `e2e-*` usernames — never real
//     users — so it cannot be used to impersonate a real superadmin.
//   - All test users live in a single synthetic E2E guild; cleanup wipes only
//     that guild's operations.
// Unset the env var after an E2E run to remove the seam entirely.
import type { FastifyInstance } from "fastify";
import { timingSafeEqual } from "node:crypto";
import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import { createSession, setSessionCookie } from "../auth/session.js";

const E2E_GUILD_ID = "100000000000000001"; // synthetic, never a real Discord id
const E2E_GUILD_NAME = "E2E-Testserver";
const USERNAME_RE = /^e2e-[a-z0-9-]{1,40}$/;
const INSTANCE_ROLES = new Set(["crew", "fleetoperator", "superadmin"]);
const GUILD_ROLES = new Set(["crew", "fleetoperator"]);

function secretOk(provided: unknown, expected: string): boolean {
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
  } catch {
    return false;
  }
}

export async function e2eAuthRoutes(app: FastifyInstance) {
  const secret = getEnv().E2E_TEST_LOGIN_SECRET;
  if (!secret) return; // seam disabled

  app.log.warn("E2E test-login seam ENABLED (E2E_TEST_LOGIN_SECRET set) — disable in normal prod by unsetting it.");

  async function ensureE2eGuild(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.guild.upsert as any)({
      where: { id: E2E_GUILD_ID },
      create: { id: E2E_GUILD_ID, name: E2E_GUILD_NAME, active: true, botInstalledAt: new Date() },
      update: { active: true },
    });
  }

  // ── Mint a session for a synthetic test player ──────────────────────
  app.post<{ Body: Record<string, unknown> }>("/e2e/login", async (req, reply) => {
    if (!secretOk(req.headers["x-e2e-secret"], secret)) return reply.code(404).send();
    const body = req.body ?? {};
    const username = typeof body.username === "string" ? body.username : "";
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: "username must match e2e-*" });
    const role = INSTANCE_ROLES.has(String(body.role)) ? String(body.role) : "crew";
    const guildRole = GUILD_ROLES.has(String(body.guildRole)) ? String(body.guildRole) : "crew";

    await ensureE2eGuild();

    const identity = await prisma.userIdentity.findUnique({
      where: { provider_providerId: { provider: "e2e", providerId: username } },
      select: { userId: true },
    });
    let userId: string;
    if (identity) {
      userId = identity.userId;
      await prisma.user.update({ where: { id: userId }, data: { role, active: true, lastSeenAt: new Date(), username } });
    } else {
      const user = await prisma.user.create({
        data: {
          username,
          role,
          identities: { create: { provider: "e2e", providerId: username, username } },
        },
      });
      userId = user.id;
    }

    await prisma.guildMembership.upsert({
      where: { guildId_userId: { guildId: E2E_GUILD_ID, userId } },
      create: { guildId: E2E_GUILD_ID, userId, role: guildRole },
      update: { role: guildRole },
    });

    const session = await createSession(userId);
    setSessionCookie(reply, session.id, session.expiresAt);
    return reply.send({ ok: true, userId, guildId: E2E_GUILD_ID, csrfToken: session.csrfToken });
  });

  // ── Wipe E2E test operations (scoped to the synthetic guild only) ───
  app.post("/e2e/cleanup", async (req, reply) => {
    if (!secretOk(req.headers["x-e2e-secret"], secret)) return reply.code(404).send();
    const ops = await prisma.operation.findMany({ where: { guildId: E2E_GUILD_ID }, select: { id: true } });
    let deleted = 0;
    for (const o of ops) {
      await prisma.operation.delete({ where: { id: o.id } }).then(() => { deleted++; }).catch(() => {});
    }
    return reply.send({ ok: true, deletedOperations: deleted, guildId: E2E_GUILD_ID });
  });
}
