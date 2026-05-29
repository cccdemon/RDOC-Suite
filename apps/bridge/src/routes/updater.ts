import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { logger } from "../services/logger.js";
import { fetchLatestCompanionRelease } from "../services/githubReleases.js";
import { mintDownloadToken } from "../services/companionDownloads.js";

/**
 * Auto-update flow for the Companion.
 *
 * Both endpoints require the same OAuth-JWT the Companion already
 * has from its Discord sign-in — there's no public bypass that
 * would let an unauthenticated caller pull the EXE without going
 * through the admin's single-use-token mechanism.
 *
 *   GET /updater/companion/check?token=<jwt>
 *     Returns the latest GitHub-release version + notes. No side
 *     effects, no download URL. Pure version peek.
 *
 *   POST /updater/companion/mint-download-token
 *     Body: { token: <jwt> }
 *     Mints a fresh single-use download token (label tagged
 *     "[auto-update] <userId>"), returns the public download URL.
 *     Companion opens it in the system browser; the user follows
 *     the regular landing-page + SmartScreen flow.
 */

/** Pull a bearer token from the Authorization header, if present. */
function bearerFromHeader(request: FastifyRequest): string | undefined {
  const h = request.headers.authorization;
  if (typeof h !== "string") return undefined;
  const [scheme, tok] = h.split(/\s+/, 2);
  if (scheme?.toLowerCase() === "bearer" && tok) return tok;
  return undefined;
}

/**
 * Authenticate the request. Prefers the Authorization bearer header
 * (less likely to be logged/leaked than a query string or body field);
 * `fallbackToken` keeps older Companion builds that send the token in the
 * query/body working until they auto-update.
 */
async function authenticate(
  request: FastifyRequest,
  fallbackToken: string | undefined,
): Promise<{ ok: true; userId: string } | { ok: false; status: number; reason: string }> {
  const rawToken = bearerFromHeader(request) ?? fallbackToken;
  if (!rawToken) return { ok: false, status: 401, reason: "missing_token" };
  const verified = await verifySessionToken(getEnv().SESSION_SECRET, rawToken);
  if (!verified.ok) {
    return { ok: false, status: 401, reason: verified.reason };
  }
  return { ok: true, userId: verified.payload.sub };
}

function publicOrigin(): string {
  const v = process.env.OAUTH_REDIRECT_URI;
  if (!v) return "";
  try {
    return new URL(v).origin;
  } catch {
    return "";
  }
}

/** Set CORS headers on every response from this router. The companion
 *  runs under `tauri.localhost` (origin scheme varies by platform), so
 *  rather than a blanket `*` we echo the caller's Origin. No credentials
 *  (cookies) are used here — auth is an explicit bearer token — so
 *  echoing the origin is not a credentialed-CORS risk, it just drops the
 *  wildcard. `authorization` is allowed so the token can move out of the
 *  query string / body into the header. */
function setCors(reply: import("fastify").FastifyReply, request: FastifyRequest): void {
  const origin = request.headers.origin;
  reply.header("access-control-allow-origin", typeof origin === "string" && origin ? origin : "null");
  reply.header("vary", "Origin");
  reply.header("access-control-allow-methods", "GET, POST, OPTIONS");
  reply.header("access-control-allow-headers", "content-type, authorization");
}

export async function registerUpdaterRoutes(app: FastifyInstance): Promise<void> {
  // OPTIONS preflight for the POST endpoint. (Simple GETs don't
  // strictly need a preflight but we register one too for paranoia.)
  app.options("/updater/companion/check", async (request, reply) => {
    setCors(reply, request);
    reply.code(204).send();
  });
  app.options("/updater/companion/mint-download-token", async (request, reply) => {
    setCors(reply, request);
    reply.code(204).send();
  });

  app.get<{ Querystring: { token?: string } }>(
    "/updater/companion/check",
    async (request, reply) => {
      setCors(reply, request);
      const auth = await authenticate(request, request.query.token);
      if (!auth.ok) {
        reply.code(auth.status).send({ error: auth.reason });
        return;
      }
      const env = getEnv();
      if (!env.GITHUB_REPO) {
        reply.code(503).send({ error: "updater_not_configured" });
        return;
      }
      const release = await fetchLatestCompanionRelease();
      if (!release || !release.asset) {
        reply.code(404).send({ error: "no_release" });
        return;
      }
      // Strip "v" prefix so 0.5.0 compares cleanly to APP_VERSION
      // baked into the EXE.
      const version = release.tagName.replace(/^v/i, "");
      reply.send({
        version,
        tagName: release.tagName,
        publishedAt: release.publishedAt,
        notes: release.body ?? release.name ?? null,
        assetName: release.asset.name,
        assetSize: release.asset.size,
      });
    },
  );

  // Body token is now optional — the Companion sends the token in the
  // Authorization header. Older builds still send it in the body, so we
  // accept either; the body field is a fallback, not required.
  const mintBodySchema = z.object({ token: z.string().min(20).optional() }).optional();
  app.post("/updater/companion/mint-download-token", async (request, reply) => {
    setCors(reply, request);
    const parsed = mintBodySchema.safeParse(request.body ?? {});
    const auth = await authenticate(request, parsed.success ? parsed.data?.token : undefined);
    if (!auth.ok) {
      reply.code(auth.status).send({ error: auth.reason });
      return;
    }
    const env = getEnv();
    if (!env.GITHUB_REPO) {
      reply.code(503).send({ error: "updater_not_configured" });
      return;
    }
    // 1-day TTL — auto-update tokens are meant to be consumed
    // within minutes. The shorter window limits the window in
    // which a leaked link could be replayed (though even a leak
    // is at worst "attacker downloads our EXE that's already on
    // GitHub").
    const token = await mintDownloadToken({
      label: `[auto-update] ${auth.userId}`,
      createdBy: auth.userId,
      ttlDays: 1,
    });
    const url = `${publicOrigin()}${env.PUBLIC_BASE_PATH}/download/companion/${token.plaintext}`;
    logger.info(
      { userId: auth.userId, tokenId: token.id },
      "updater: minted single-use download token for auto-update",
    );
    reply.send({
      ok: true,
      url,
      expiresAt: token.expiresAt.toISOString(),
    });
  });
}
