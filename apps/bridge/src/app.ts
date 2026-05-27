import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import cookie from "@fastify/cookie";
import { registerWsRoute } from "./signaling/ws.js";
import { registerOAuthRoutes } from "./auth/oauth.js";
import { registerInternalRoutes } from "./routes/internal.js";
import { registerDownloadRoutes } from "./routes/download.js";
import { registerUpdaterRoutes } from "./routes/updater.js";
import { registerAdminRoutes } from "./admin/routes.js";
import { getEnv } from "./config/env.js";

const REDACT_PATHS = [
  "token",
  "*.token",
  "*.SESSION_SECRET",
  "*.DISCORD_BOT_TOKEN",
  "*.DISCORD_CLIENT_SECRET",
];

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: getEnv().LOG_LEVEL,
      base: { service: "bridge" },
      redact: { paths: REDACT_PATHS, censor: "[REDACTED]" },
    },
  });

  await app.register(cookie);
  await app.register(websocket);

  // Public health probe. CORS-open so the companion's "Test connection"
  // button works from any origin (Vite dev, Tauri webview, browser
  // bookmark). The endpoint reveals nothing sensitive.
  app.get("/health", async (_req, reply) => {
    reply.header("access-control-allow-origin", "*");
    reply.header("access-control-allow-methods", "GET, OPTIONS");
    return { ok: true, service: "bridge" };
  });
  app.options("/health", async (_req, reply) => {
    reply
      .header("access-control-allow-origin", "*")
      .header("access-control-allow-methods", "GET, OPTIONS")
      .header("access-control-allow-headers", "content-type")
      .code(204)
      .send();
  });

  await registerOAuthRoutes(app);
  await registerInternalRoutes(app);
  await registerDownloadRoutes(app);
  await registerUpdaterRoutes(app);
  await registerAdminRoutes(app);
  await registerWsRoute(app);

  return app;
}
