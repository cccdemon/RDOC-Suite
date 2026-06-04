import type { FastifyInstance } from "fastify";
import { registry } from "../services/metrics.js";

export async function registerPrometheusMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_req, reply) => {
    reply.type(registry.contentType);
    return registry.metrics();
  });
}
