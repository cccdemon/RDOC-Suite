import type { FastifyInstance } from "fastify";
import { basePath } from "../config/env.js";
import {
  buildAuthorizeUrl, consumeState, exchangeCode, fetchDiscordUser,
  issueState, displayName, avatarUrl,
} from "../auth/discord.js";
import { createSession, destroySession, setSessionCookie, clearSessionCookie } from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";
import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";

export async function authRoutes(app: FastifyInstance) {
  // GET /auth/start — redirect to Discord OAuth
  app.get("/auth/start", async (_req, reply) => {
    const state = issueState();
    reply.redirect(buildAuthorizeUrl(state), 302);
  });

  // GET /auth/callback — handle OAuth callback
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;

      if (error || !code || !state || !consumeState(state)) {
        return reply.redirect(basePath("/?flash=error:Login+failed.+Try+again."), 302);
      }

      try {
        const tokens = await exchangeCode(code);
        const discordUser = await fetchDiscordUser(tokens.access_token);

        const name = displayName(discordUser);
        const avatar = avatarUrl(discordUser);
        const env = getEnv();

        const user = await prisma.user.upsert({
          where: { id: discordUser.id },
          create: {
            id: discordUser.id,
            username: name,
            avatarHash: discordUser.avatar,
            // Bootstrap superadmin if configured
            role: env.SUPERADMIN_DISCORD_ID === discordUser.id ? "superadmin" : "crew",
          },
          update: {
            username: name,
            avatarHash: discordUser.avatar,
            lastSeenAt: new Date(),
            // Promote to superadmin if ID matches and they aren't already
            ...(env.SUPERADMIN_DISCORD_ID === discordUser.id && { role: "superadmin" }),
          },
        });

        if (!user.active) {
          return reply.redirect(basePath("/?flash=error:Your+account+is+disabled."), 302);
        }

        const session = await createSession(user.id);
        setSessionCookie(reply, session.id, session.expiresAt);
        return reply.redirect(basePath("/?flash=ok:Welcome+back,+" + encodeURIComponent(name)), 302);
      } catch (err) {
        app.log.error(err, "OAuth callback error");
        return reply.redirect(basePath("/?flash=error:Login+error.+Please+try+again."), 302);
      }
    }
  );

  // POST /auth/logout
  app.post("/auth/logout", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    await destroySession(ctx.sessionId);
    clearSessionCookie(reply);
    return reply.redirect(basePath("/?flash=ok:Logged+out."), 302);
  });
}
