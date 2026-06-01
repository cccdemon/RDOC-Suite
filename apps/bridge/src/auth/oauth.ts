import { randomBytes } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv, getOAuthEnv } from "../config/env.js";
import { readGuildConfig } from "../services/guildConfig.js";
import { getGlobalSettings } from "../services/globalSettings.js";
import { logger } from "../services/logger.js";
import { issueSessionToken } from "./sessionToken.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchCurrentUser,
  fetchGuildMember,
} from "./discord.js";

const STATE_COOKIE = "dccc_oauth_state";
const STATE_COOKIE_TTL_SECONDS = 10 * 60;

const startQuerySchema = z.object({
  guildId: z.string().regex(/^[0-9]{17,20}$/, "guildId must be a Discord snowflake"),
});

const callbackQuerySchema = z.object({
  code: z.string().min(1),
  state: z.string().min(1),
});

function encodeStateCookie(state: string, guildId: string): string {
  return Buffer.from(JSON.stringify({ state, guildId })).toString("base64url");
}

function decodeStateCookie(raw: string): { state: string; guildId: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, "base64url").toString());
    if (
      parsed &&
      typeof parsed === "object" &&
      "state" in parsed &&
      "guildId" in parsed &&
      typeof (parsed as { state: unknown }).state === "string" &&
      typeof (parsed as { guildId: unknown }).guildId === "string"
    ) {
      const obj = parsed as { state: string; guildId: string };
      return { state: obj.state, guildId: obj.guildId };
    }
  } catch {
    // fall through
  }
  return null;
}

export async function registerOAuthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/auth/start", async (request, reply) => {
    const oauth = getOAuthEnv();
    if (!oauth) {
      return reply.code(503).send({
        error: "oauth_not_configured",
        message:
          "Bridge is missing Discord OAuth credentials (DISCORD_RDOCRTC_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_RDOCRTC_BOT_TOKEN, OAUTH_REDIRECT_URI).",
      });
    }

    const parsed = startQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "bad_request",
        message: parsed.error.issues.map((i) => i.message).join("; "),
      });
    }

    const state = randomBytes(32).toString("hex");
    const cookieValue = encodeStateCookie(state, parsed.data.guildId);
    // Cookie Path must match what the BROWSER sees (un-stripped public URL),
    // not what the bridge sees after Traefik strips PUBLIC_BASE_PATH.
    const cookiePath = `${getEnv().PUBLIC_BASE_PATH}/auth`;
    reply.setCookie(STATE_COOKIE, cookieValue, {
      path: cookiePath,
      httpOnly: true,
      sameSite: "lax",
      secure: oauth.OAUTH_REDIRECT_URI.startsWith("https://"),
      maxAge: STATE_COOKIE_TTL_SECONDS,
    });

    const url = buildAuthorizeUrl({
      clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
      redirectUri: oauth.OAUTH_REDIRECT_URI,
      state,
    });
    return reply.redirect(url, 302);
  });

  app.get("/auth/callback", async (request, reply) => {
    const oauth = getOAuthEnv();
    if (!oauth) {
      return reply.code(503).send({
        error: "oauth_not_configured",
        message: "Bridge is missing Discord OAuth credentials.",
      });
    }

    const parsed = callbackQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send({ error: "bad_request" });
    }

    const cookieRaw = request.cookies[STATE_COOKIE];
    if (!cookieRaw) {
      return reply.code(400).send({ error: "missing_state_cookie" });
    }
    const cookie = decodeStateCookie(cookieRaw);
    if (!cookie) {
      return reply.code(400).send({ error: "bad_state_cookie" });
    }
    if (cookie.state !== parsed.data.state) {
      return reply.code(400).send({ error: "state_mismatch" });
    }

    reply.clearCookie(STATE_COOKIE, { path: `${getEnv().PUBLIC_BASE_PATH}/auth` });

    const tokenRes = await exchangeCodeForToken({
      clientId: oauth.DISCORD_RDOCRTC_CLIENT_ID,
      clientSecret: oauth.DISCORD_CLIENT_SECRET,
      redirectUri: oauth.OAUTH_REDIRECT_URI,
      code: parsed.data.code,
    });
    if (!tokenRes.ok) {
      logger.warn({ status: tokenRes.error.status }, "discord token exchange failed");
      return reply.code(502).send({ error: "token_exchange_failed" });
    }
    // tokenRes.value.access_token is intentionally NOT logged.

    const userRes = await fetchCurrentUser(tokenRes.value.access_token);
    if (!userRes.ok) {
      return reply.code(502).send({ error: "user_fetch_failed" });
    }
    const userId = userRes.value.id;

    // ── Raumdock-wide bridge gate ─────────────────────────────────────
    // Global (non-tenant) requirement: the user must hold a specific
    // Discord role on the Raumdock server to use bridge mode at all.
    // Configured in GlobalSettings (DB), enforced before any tenant check.
    // Only active once both the role and the Raumdock guild are set.
    const globalSettings = await getGlobalSettings();
    if (globalSettings.bridgeRequiredRoleId && globalSettings.raumdockGuildId) {
      const rdMember = await fetchGuildMember({
        botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
        guildId: globalSettings.raumdockGuildId,
        userId,
      });
      if (!rdMember.ok) {
        logger.warn(
          { userId, raumdockGuildId: globalSettings.raumdockGuildId },
          "bridge gate: raumdock member fetch failed",
        );
        return reply.code(502).send({ error: "raumdock_member_fetch_failed" });
      }
      const hasBridgeRole =
        rdMember.value.present &&
        rdMember.value.member.roles.includes(globalSettings.bridgeRequiredRoleId);
      if (!hasBridgeRole) {
        logger.info({ userId }, "auth rejected: missing bridge role");
        return reply.code(403).send({
          error: "missing_bridge_role",
          detail:
            "Dir fehlt die erforderliche Discord-Rolle auf dem Raumdock-Server, um Squad Link zu nutzen.",
        });
      }
    }

    const guildConfig = await readGuildConfig(cookie.guildId);
    if (!guildConfig || !guildConfig.enabled) {
      logger.info(
        { userId, guildId: cookie.guildId, enabled: guildConfig?.enabled ?? false },
        "auth rejected: guild not configured or disabled",
      );
      return reply.code(403).send({ error: "guild_not_enabled" });
    }
    if (guildConfig.commanderRoleIds.length === 0) {
      return reply.code(403).send({ error: "no_commander_roles_configured" });
    }

    const memberRes = await fetchGuildMember({
      botToken: oauth.DISCORD_RDOCRTC_BOT_TOKEN,
      guildId: cookie.guildId,
      userId,
    });
    if (!memberRes.ok) {
      return reply.code(502).send({ error: "member_fetch_failed" });
    }
    if (!memberRes.value.present) {
      const reason = memberRes.value.reason;
      logger.info(
        { userId, guildId: cookie.guildId, reason },
        "auth rejected: guild member lookup failed",
      );
      if (reason === "bot_not_in_guild") {
        return reply.code(403).send({
          error: "bot_not_in_guild",
          detail:
            "Der DCCC-Bot ist auf diesem Discord-Server nicht installiert. Bitte den Bot zuerst einladen, dann nochmal probieren.",
        });
      }
      return reply.code(403).send({ error: "not_a_member" });
    }

    const memberRoles = new Set(memberRes.value.member.roles);
    const isCommander = guildConfig.commanderRoleIds.some((roleId) => memberRoles.has(roleId));
    if (!isCommander) {
      logger.info({ userId, guildId: cookie.guildId }, "auth rejected: missing commander role");
      return reply.code(403).send({ error: "missing_commander_role" });
    }

    const env = getEnv();
    // Session JWT now identifies the Discord user only — not the
    // specific guild they're bridged into. The companion sends the
    // active guildId per WS connect, so one OAuth covers all servers
    // the user is a commander on.
    const sessionToken = await issueSessionToken(
      env.SESSION_SECRET,
      { sub: userId },
      env.SESSION_TOKEN_TTL_DAYS * 24 * 60 * 60,
    );

    // The companion grabs the session via one of two paths:
    //  1) auto: dccc://auth?token=…&guildId=…  (works when the OS has
    //     the URL scheme registered — fragile on Windows dev mode)
    //  2) manual fallback: a single base64 "sign-in code" the user
    //     pastes into the companion. Always works.
    const deepLink = new URL(oauth.COMPANION_REDIRECT_URI);
    deepLink.searchParams.set("token", sessionToken);
    deepLink.searchParams.set("guildId", cookie.guildId);
    const signInCode = Buffer.from(
      JSON.stringify({ token: sessionToken, guildId: cookie.guildId }),
    ).toString("base64");

    return reply
      .code(200)
      .type("text/html; charset=utf-8")
      .send(renderSuccessPage({ deepLink: deepLink.toString(), signInCode }));
  });
}

function renderSuccessPage(opts: { deepLink: string; signInCode: string }): string {
  const esc = (s: string): string =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Channel Commander — signed in</title>
<style>
  body { font-family: system-ui, sans-serif; background: #1b1d23; color: #e7e9ee; margin: 0; padding: 40px; }
  main { max-width: 560px; margin: 0 auto; }
  h1 { font-size: 18px; margin: 0 0 8px; }
  p { color: #9aa0ad; margin: 8px 0; line-height: 1.5; }
  .code-box { background: #25272f; border: 1px solid #2f323b; border-radius: 6px;
              padding: 14px; margin: 16px 0; font-family: ui-monospace, Consolas, monospace;
              font-size: 12px; word-break: break-all; }
  button { background: #3a3f4b; color: #e7e9ee; border: 1px solid #2f323b; border-radius: 6px;
           padding: 8px 14px; font-size: 13px; cursor: pointer; }
  button:hover { background: #454b58; }
  .ok { color: #2ecc71; font-weight: 600; }
  hr { border: none; border-top: 1px solid #2f323b; margin: 24px 0; }
</style>
</head>
<body>
<main>
  <h1>✓ <span class="ok">Signed in</span></h1>
  <p>The companion app should now pick this up automatically. If it does
     not switch to <em>Signed in: yes</em> within a few seconds, copy the
     code below and paste it via <strong>"Paste sign-in code"</strong> in
     the companion window.</p>

  <div class="code-box" id="code">${esc(opts.signInCode)}</div>
  <button onclick="navigator.clipboard.writeText(document.getElementById('code').innerText).then(()=>this.innerText='Copied!')">Copy sign-in code</button>

  <hr>
  <p style="font-size: 11px;">You can close this tab. The code expires in 15 minutes.</p>
</main>
<script>
  // Try the deep-link path opportunistically; harmless if the scheme is unregistered.
  setTimeout(function() { window.location.href = ${JSON.stringify(opts.deepLink)}; }, 200);
</script>
</body>
</html>`;
}
