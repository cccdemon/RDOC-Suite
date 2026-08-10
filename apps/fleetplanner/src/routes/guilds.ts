import type { FastifyInstance, FastifyReply } from "fastify";
import { basePath, discordSiteBase, getEnv } from "../config/env.js";
import { requireAuth } from "../auth/middleware.js";
import { installGuild } from "../services/guilds.js";

// API-only backend: this router keeps ONLY the Discord bot-install OAuth flow
// (redirects, not HTML). All guild listing/settings/diagnostics UI lives in the
// fleetplanner-web SPA and talks to /api/v1. Do not add HTML routes here.

// Discord bot permissions bitfield:
// MANAGE_CHANNELS(4) | VIEW_CHANNEL(10) | SEND_MESSAGES(11) | READ_MESSAGE_HISTORY(16) |
// CONNECT(20) | MOVE_MEMBERS(24) | MANAGE_ROLES(28) | MANAGE_EVENTS(33) | ADD_EVENTS(44)
const BOT_PERMISSIONS =
  (1n << 4n) | (1n << 10n) | (1n << 11n) | (1n << 16n) |
  (1n << 20n) | (1n << 24n) | (1n << 28n) | (1n << 33n) |
  (1n << 44n);
const ACTIVE_GUILD_COOKIE = "fp_guild";

function setActiveGuild(reply: FastifyReply, guildId: string): void {
  reply.setCookie(ACTIVE_GUILD_COOKIE, guildId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 24 * 60 * 60,
  });
}

export async function guildRoutes(app: FastifyInstance) {
  const env = getEnv();
  const botClientId = env.DISCORD_FLEETPLANNER_CLIENT_ID || env.DISCORD_CLIENT_ID;

  // ── Add bot to a Discord (self-service) ────────────────────────────
  app.get("/guilds/add", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    if (!botClientId) {
      return reply.redirect(basePath("/?flash=error:Bot+client+id+not+configured."), 302);
    }
    const redirectUri = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/guilds/added`;
    const p = new URLSearchParams({
      client_id: botClientId,
      scope: "bot applications.commands",
      permissions: BOT_PERMISSIONS.toString(),
      redirect_uri: redirectUri,
      response_type: "code",
    });
    return reply.redirect(`${discordSiteBase()}/oauth2/authorize?${p}`, 302);
  });

  // ── Bot-added callback (Discord redirects with ?guild_id=) ─────────
  app.get<{ Querystring: { guild_id?: string; error?: string } }>(
    "/guilds/added",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      const guildId = req.query.guild_id;
      if (req.query.error || !guildId) {
        return reply.redirect(basePath("/?flash=error:Bot+install+cancelled."), 302);
      }
      const installed = await installGuild(guildId, ctx.user.id);
      if (!installed.ok) {
        const msg =
          installed.reason === "banned"
            ? "This+Discord+is+banned+from+Fleetplanner."
            : "Could+not+read+guild+(is+the+bot+in+it?).";
        return reply.redirect(basePath(`/?flash=error:${msg}`), 302);
      }
      setActiveGuild(reply, installed.id);
      return reply.redirect(basePath(`/guilds/settings?flash=ok:${encodeURIComponent(installed.name)}+added.`), 302);
    },
  );
}
