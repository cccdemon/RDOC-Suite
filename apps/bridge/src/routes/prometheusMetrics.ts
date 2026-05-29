import type { FastifyInstance } from "fastify";
import { rooms } from "../services/rooms.js";

export async function registerPrometheusMetricsRoute(app: FastifyInstance): Promise<void> {
  app.get("/metrics", async (_req, reply) => {
    const m = rooms.globalMetrics();
    const lines = [
      "# HELP dccc_rooms_active Number of guild bridge rooms with at least one connected commander",
      "# TYPE dccc_rooms_active gauge",
      `dccc_rooms_active ${m.activeRooms}`,
      "# HELP dccc_commanders_active Total commanders connected via WebSocket",
      "# TYPE dccc_commanders_active gauge",
      `dccc_commanders_active ${m.activeCommanders}`,
      "# HELP dccc_commanders_speaking Commanders currently transmitting audio (PTT active)",
      "# TYPE dccc_commanders_speaking gauge",
      `dccc_commanders_speaking ${m.speakingCommanders}`,
    ];
    reply.type("text/plain; version=0.0.4").send(lines.join("\n") + "\n");
  });
}
