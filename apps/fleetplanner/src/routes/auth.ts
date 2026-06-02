import type { FastifyInstance } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import {
  issueState,
  consumeState,
  authorizeUrlFor,
  exchangeForProfile,
  redirectUriFor,
  discordEnabled,
  discordOAuthClientId,
  githubEnabled,
  googleEnabled,
} from "../auth/providers.js";
import type { OAuthProvider } from "../auth/providers.js";
import { resolveIdentity, linkIdentity } from "../auth/identity.js";
import {
  createSession,
  destroySession,
  setSessionCookie,
  clearSessionCookie,
} from "../auth/session.js";
import { requireAuth } from "../auth/middleware.js";

const STATE_COOKIE = "fp_oauth_state";

function cookieOpts(env: ReturnType<typeof getEnv>) {
  return {
    httpOnly: true as const,
    secure: env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: basePath("/auth"),
    maxAge: 5 * 60,
  };
}

export async function authRoutes(app: FastifyInstance) {
  const env = getEnv();

  // ── Generic login start: /auth/:provider/start ─────────────────────
  // Redirects to the provider's OAuth authorize URL.
  app.get<{ Params: { provider: string } }>("/auth/:provider/start", async (req, reply) => {
    const provider = req.params.provider as OAuthProvider;
    if (!isEnabledProvider(provider)) {
      return reply.redirect(basePath("/?flash=error:Provider+not+configured."), 302);
    }
    const state = issueState(provider);
    const redirectUri = redirectUriFor(provider, env.WEB_PUBLIC_URL, env.PUBLIC_BASE_PATH);
    reply.setCookie(STATE_COOKIE, state, cookieOpts(env));
    return reply.redirect(authorizeUrlFor(provider, state, redirectUri), 302);
  });

  // ── Generic OAuth callback: /auth/:provider/callback ──────────────
  app.get<{
    Params: { provider: string };
    Querystring: { code?: string; state?: string; error?: string };
  }>("/auth/:provider/callback", async (req, reply) => {
    const { code, state, error } = req.query;
    const cookieState = (req.cookies as Record<string, string | undefined>)[STATE_COOKIE];

    if (error || !code || !state || !cookieState || cookieState !== state) {
      return reply.redirect(basePath("/?flash=error:Login+failed.+Try+again."), 302);
    }

    const consumed = consumeState(state);
    if (!consumed) {
      return reply.redirect(basePath("/?flash=error:Login+session+expired.+Try+again."), 302);
    }

    reply.clearCookie(STATE_COOKIE, { path: basePath("/auth") });

    try {
      const redirectUri = redirectUriFor(
        consumed.provider,
        env.WEB_PUBLIC_URL,
        env.PUBLIC_BASE_PATH,
      );
      const profile = await exchangeForProfile(consumed.provider, code, redirectUri);

      const result = await resolveIdentity(profile);
      if (!result.ok) {
        const msg =
          result.reason === "account_disabled" ? "Your+account+is+disabled." : "Login+error.";
        return reply.redirect(basePath(`/?flash=error:${msg}`), 302);
      }

      const session = await createSession(result.userId);
      setSessionCookie(reply, session.id, session.expiresAt);
      return reply.redirect(basePath("/?flash=ok:Welcome+back."), 302);
    } catch (err) {
      app.log.error(err, "OAuth callback error");
      return reply.redirect(basePath("/?flash=error:Login+error.+Please+try+again."), 302);
    }
  });

  // ── Discord link start (must be logged in, no Discord yet) ─────────
  // /auth/discord/link/start — initiates the Discord OAuth for linking.
  app.get("/auth/discord/link/start", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    if (!discordEnabled()) {
      return reply.redirect(basePath("/account?flash=error:Discord+not+configured."), 302);
    }
    const state = issueState("discord", ctx.user.id);
    const redirectUri = redirectUriFor("discord", env.WEB_PUBLIC_URL, env.PUBLIC_BASE_PATH);
    const linkRedirectUri = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/auth/discord/link/callback`;
    reply.setCookie(STATE_COOKIE, state, cookieOpts(env));
    // Separate redirect URI for the link flow so Discord knows this is linking
    const p = new URLSearchParams({
      client_id: discordOAuthClientId()!,
      redirect_uri: linkRedirectUri,
      response_type: "code",
      scope: "identify",
      state,
    });
    return reply.redirect(`https://discord.com/api/v10/oauth2/authorize?${p}`, 302);
  });

  // ── Discord link callback ──────────────────────────────────────────
  app.get<{ Querystring: { code?: string; state?: string; error?: string } }>(
    "/auth/discord/link/callback",
    async (req, reply) => {
      const { code, state, error } = req.query;
      const cookieState = (req.cookies as Record<string, string | undefined>)[STATE_COOKIE];

      if (error || !code || !state || !cookieState || cookieState !== state) {
        return reply.redirect(basePath("/account?flash=error:Discord+linking+failed."), 302);
      }
      const consumed = consumeState(state);
      if (!consumed?.linkUserId) {
        return reply.redirect(basePath("/account?flash=error:Link+session+expired."), 302);
      }
      reply.clearCookie(STATE_COOKIE, { path: basePath("/auth") });

      try {
        const linkRedirectUri = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/auth/discord/link/callback`;
        const profile = await exchangeForProfile("discord", code, linkRedirectUri);

        const result = await linkIdentity(consumed.linkUserId, profile);
        if (!result.ok) {
          const msg =
            result.reason === "already_linked_to_another"
              ? "Discord+account+already+linked+to+another+user."
              : "Linking+failed.";
          return reply.redirect(basePath(`/account?flash=error:${msg}`), 302);
        }
        return reply.redirect(basePath("/account?flash=ok:Discord+linked+successfully."), 302);
      } catch (err) {
        app.log.error(err, "Discord link callback error");
        return reply.redirect(basePath("/account?flash=error:Discord+linking+error."), 302);
      }
    },
  );

  // ── Backward-compat: /auth/start → /auth/discord/start ─────────────
  app.get("/auth/start", async (_req, reply) => {
    return reply.redirect(basePath("/auth/discord/start"), 302);
  });
  app.get("/auth/callback", async (req, reply) => {
    // Redirect old-style callback to the new /auth/discord/callback handler.
    // Preserves ?code=&state= query params.
    const qs = new URLSearchParams(req.query as Record<string, string>).toString();
    return reply.redirect(basePath(`/auth/discord/callback${qs ? "?" + qs : ""}`), 302);
  });

  app.post("/auth/logout", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    await destroySession(ctx.sessionId);
    clearSessionCookie(reply);
    return reply.redirect(basePath("/?flash=ok:Logged+out."), 302);
  });
}

// ── Helpers ────────────────────────────────────────────────────────

function isEnabledProvider(p: string): p is OAuthProvider {
  if (p === "discord") return discordEnabled();
  if (p === "github") return githubEnabled();
  if (p === "google") return googleEnabled();
  return false;
}
