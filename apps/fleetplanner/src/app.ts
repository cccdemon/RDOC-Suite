import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import { getEnv } from "./config/env.js";
import { authRoutes } from "./routes/auth.js";
import { webRoutes } from "./routes/web.js";
import { apiRoutes } from "./routes/api.js";
import { apiV1Routes } from "./routes/apiV1.js";
import { guildRoutes } from "./routes/guilds.js";
import { partnershipRoutes } from "./routes/partnerships.js";
import { bridgeAdminRoutes } from "./routes/bridgeAdmin.js";
import { coverRoutes } from "./routes/cover.js";
import { discordInteractionRoutes } from "./routes/discordInteractions.js";
import { registerMetrics } from "./services/metrics.js";
import { enterLocale, localeFromAcceptLanguage } from "./i18n/index.js";
import { isMaintenanceOn, loadMaintenance } from "./services/maintenance.js";
import { loadSession } from "./auth/session.js";
import { maintenancePage, rawHtml } from "./web/render.js";

export async function buildApp() {
  const env = getEnv();

  const app = Fastify({
    logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: true,
  });

  // Log unhandled errors and return a clean 5xx — Caddy picks up the status
  // code and forwards browser requests to the error-page microservice.
  app.setErrorHandler((err: unknown, request, reply) => {
    const e = err as { statusCode?: number; code?: string; name?: string; message?: string };
    const status = e.statusCode ?? 500;
    app.log.error(err, `Unhandled error on ${request.method} ${request.url}`);
    return reply.code(status).send({
      statusCode: status,
      code: e.code,
      error: e.name,
      message: e.message,
    });
  });

  // i18n: set a request-scoped baseline locale from Accept-Language. enterWith
  // makes it stick for the rest of the request's async context; loadSession()
  // later upgrades it to the authenticated user's stored locale. t() reads it.
  app.addHook("onRequest", async (request) => {
    enterLocale(localeFromAcceptLanguage(request.headers["accept-language"]));
  });

  await app.register(cookie);
  await app.register(formbody);
  // Feedback form screenshot uploads (multipart). Limits are also enforced
  // per-file in the /feedback route; this is the hard plugin-level guard.
  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 4, fields: 10 },
  });

  // Prometheus metrics (HTTP histogram + /metrics route). Registered early so
  // the onResponse hook covers all subsequent routes.
  registerMetrics(app);

  // Maintenance gate. Registered AFTER cookie so loadSession can read the
  // session. When maintenance is on, everyone gets the maintenance screen
  // EXCEPT superadmins (who must stay able to manage and turn it off) and a
  // small infra/login allowlist (health, metrics, OAuth login, Discord
  // interactions). The screen renders in the visitor's resolved locale.
  app.addHook("onRequest", async (request, reply) => {
    if (!isMaintenanceOn()) return;
    const path = request.url.split("?")[0] || "/";
    if (
      path === "/health" ||
      path === "/metrics" ||
      path.startsWith("/auth/") ||
      path === "/discord/interactions"
    ) {
      return;
    }
    const ctx = await loadSession(request).catch(() => null);
    if (ctx?.user.role === "superadmin") return; // admins bypass to manage
    reply
      .code(503)
      .header("Retry-After", "3600")
      .type("text/html; charset=utf-8")
      .send(rawHtml(maintenancePage()));
  });

  // Routes register without the PUBLIC_BASE_PATH prefix because Caddy's
  // handle_path strips it before forwarding. basePath() is only used for
  // generating URLs in responses/redirects that go through Caddy.
  await app.register(authRoutes);
  await app.register(guildRoutes);
  await app.register(partnershipRoutes);
  await app.register(webRoutes);
  await app.register(bridgeAdminRoutes);
  await app.register(coverRoutes);
  await app.register(discordInteractionRoutes);
  await app.register(apiRoutes);
  // FR-P2: JSON-only /api/v1 read slice (strangler split — SSR stays in parallel).
  await app.register(apiV1Routes);

  // Load the persisted maintenance flag into memory (best-effort; defaults off).
  await loadMaintenance().catch((err) => app.log.error(err, "loadMaintenance failed"));

  return app;
}
