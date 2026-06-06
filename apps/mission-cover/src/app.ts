import Fastify, { type FastifyInstance } from "fastify";
import { getEnv } from "./config/env.js";
import { AUTHOR_CREDIT } from "./schema.js";
import { registerCoverRoutes } from "./routes/covers.js";
import { registerEditorRoutes } from "./routes/editor.js";
import { ensureStore } from "./services/store.js";

export async function buildApp(): Promise<FastifyInstance> {
  const env = getEnv();
  const app = Fastify({
    logger: true,
    bodyLimit: env.MAX_PAYLOAD_BYTES,
  });

  app.get("/health", async () => ({ status: "ok" }));

  // Author attribution is part of the product — surfaced, not hidden.
  app.get("/about", async () => ({
    service: "@rdoc-suite/mission-cover",
    engine: "MissionCover (Star Citizen mission cover generator)",
    author: AUTHOR_CREDIT,
  }));

  registerCoverRoutes(app);
  registerEditorRoutes(app);

  await ensureStore();
  return app;
}
