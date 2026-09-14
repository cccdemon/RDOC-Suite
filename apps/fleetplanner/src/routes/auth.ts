import type { FastifyInstance } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import {
  issueState,
  consumeState,
  authorizeUrlFor,
  exchangeForProfile,
  redirectUriFor,
  discordEnabled,
  safeReturnTo,
} from "../auth/providers.js";
import type { OAuthProvider } from "../auth/providers.js";
import { resolveIdentity } from "../auth/identity.js";
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
  // Redirects to the provider's OAuth authorize URL. `?returnTo=/ops/<id>`
  // brings the user back to that page after login (relative paths only).
  app.get<{ Params: { provider: string }; Querystring: { returnTo?: string } }>("/auth/:provider/start", async (req, reply) => {
    const provider = req.params.provider as OAuthProvider;
    if (!isEnabledProvider(provider)) {
      return reply.redirect(basePath("/?flash=error:Provider+not+configured."), 302);
    }
    const state = issueState(provider, safeReturnTo(req.query.returnTo));
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
      setSessionCookie(reply, session.token, session.expiresAt);
      if (consumed.returnTo) return reply.redirect(basePath(consumed.returnTo), 302);
      return reply.redirect(basePath("/?flash=ok:Welcome+back."), 302);
    } catch (err) {
      app.log.error(err, "OAuth callback error");
      return reply.redirect(basePath("/?flash=error:Login+error.+Please+try+again."), 302);
    }
  });

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
  return p === "discord" && discordEnabled();
}
