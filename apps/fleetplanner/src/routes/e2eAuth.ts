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

const E2E_GUILD_ID = "100000000000000001"; // synthetic primary, never a real Discord id
const E2E_GUILD_ID_2 = "100000000000000002"; // synthetic secondary (cross-guild tests, e.g. partnerships)
// Allow-list of synthetic guilds the seam may mint into. A login may request the
// secondary by passing `guildId`; anything else falls back to the primary.
const E2E_GUILDS: Record<string, string> = {
  [E2E_GUILD_ID]: "E2E-Testserver",
  [E2E_GUILD_ID_2]: "E2E-Testserver-2",
};
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
  const env = getEnv();
  const secret = env.E2E_TEST_LOGIN_SECRET;
  if (!secret) return; // seam disabled

  // Hard prod guard: never register the backdoor in production without an
  // explicit, auditable opt-in — even if the secret leaked into a prod env.
  const allowInProd = /^(1|true)$/i.test(env.E2E_ALLOW_IN_PROD ?? "");
  if (env.NODE_ENV === "production" && !allowInProd) {
    app.log.warn("E2E_TEST_LOGIN_SECRET is set in production but E2E_ALLOW_IN_PROD is not — E2E seam stays DISABLED.");
    return;
  }

  // Optional time-box: after the deadline the seam self-disables. Checked at
  // registration AND per request, so a long-lived instance closes the window
  // without a redeploy.
  const expiresAt = env.E2E_TEST_LOGIN_EXPIRES ? new Date(env.E2E_TEST_LOGIN_EXPIRES) : null;
  const seamExpired = (): boolean => expiresAt !== null && Date.now() > expiresAt.getTime();
  if (seamExpired()) {
    app.log.warn(`E2E seam past E2E_TEST_LOGIN_EXPIRES (${env.E2E_TEST_LOGIN_EXPIRES}) — staying DISABLED.`);
    return;
  }

  app.log.warn(
    `E2E test-login seam ENABLED (synthetic e2e-* users only). Disable by unsetting E2E_TEST_LOGIN_SECRET` +
      `${expiresAt ? `; auto-disables at ${expiresAt.toISOString()}` : ""}.`,
  );

  async function ensureE2eGuild(guildId: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (prisma.guild.upsert as any)({
      where: { id: guildId },
      create: { id: guildId, name: E2E_GUILDS[guildId] ?? "E2E-Testserver", active: true, botInstalledAt: new Date() },
      update: { active: true },
    });
  }

  // ── Mint a session for a synthetic test player ──────────────────────
  app.post<{ Body: Record<string, unknown> }>("/e2e/login", async (req, reply) => {
    if (seamExpired() || !secretOk(req.headers["x-e2e-secret"], secret)) return reply.code(404).send();
    const body = req.body ?? {};
    const username = typeof body.username === "string" ? body.username : "";
    if (!USERNAME_RE.test(username)) return reply.code(400).send({ error: "username must match e2e-*" });
    const role = INSTANCE_ROLES.has(String(body.role)) ? String(body.role) : "crew";
    const guildRole = GUILD_ROLES.has(String(body.guildRole)) ? String(body.guildRole) : "crew";
    // Optional secondary guild for cross-guild flows; only allow-listed ids.
    const guildId = typeof body.guildId === "string" && E2E_GUILDS[body.guildId] ? body.guildId : E2E_GUILD_ID;

    await ensureE2eGuild(guildId);

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
      where: { guildId_userId: { guildId, userId } },
      create: { guildId, userId, role: guildRole },
      update: { role: guildRole },
    });

    const session = await createSession(userId);
    setSessionCookie(reply, session.token, session.expiresAt);
    return reply.send({ ok: true, userId, guildId, csrfToken: session.csrfToken });
  });

  // ── Wipe E2E test operations (scoped to the synthetic guilds only) ──
  app.post("/e2e/cleanup", async (req, reply) => {
    if (seamExpired() || !secretOk(req.headers["x-e2e-secret"], secret)) return reply.code(404).send();
    const ops = await prisma.operation.findMany({ where: { guildId: { in: Object.keys(E2E_GUILDS) } }, select: { id: true } });
    let deleted = 0;
    for (const o of ops) {
      await prisma.operation.delete({ where: { id: o.id } }).then(() => { deleted++; }).catch(() => {});
    }
    return reply.send({ ok: true, deletedOperations: deleted, guilds: Object.keys(E2E_GUILDS) });
  });
}
