import Fastify from "fastify";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import { getEnv } from "./config/env.js";
import { authRoutes } from "./routes/auth.js";
import { webRoutes } from "./routes/web.js";
import { apiRoutes } from "./routes/api.js";
import { guildRoutes } from "./routes/guilds.js";
import { partnershipRoutes } from "./routes/partnerships.js";
import { bridgeAdminRoutes } from "./routes/bridgeAdmin.js";

export async function buildApp() {
  const env = getEnv();

  const app = Fastify({
    logger: { level: env.NODE_ENV === "production" ? "info" : "debug" },
    trustProxy: true,
  });

  await app.register(cookie);
  await app.register(formbody);

  // Routes register without the PUBLIC_BASE_PATH prefix because Caddy's
  // handle_path strips it before forwarding. basePath() is only used for
  // generating URLs in responses/redirects that go through Caddy.
  await app.register(authRoutes);
  await app.register(guildRoutes);
  await app.register(partnershipRoutes);
  await app.register(webRoutes);
  await app.register(bridgeAdminRoutes);
  await app.register(apiRoutes);

  return app;
}
