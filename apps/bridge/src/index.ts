import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";
import { logger } from "./services/logger.js";
import { seedSuperadmin } from "./services/admins.js";

async function main(): Promise<void> {
  const env = getEnv();
  const app = await buildApp();

  // Bootstrap the first admin from env (replaces the removed `/cc admin add`).
  await seedSuperadmin();

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down bridge");
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await app.listen({ host: env.BRIDGE_HOST, port: env.BRIDGE_PORT });
  logger.info({ host: env.BRIDGE_HOST, port: env.BRIDGE_PORT }, "bridge listening");
}

main().catch((err) => {
  logger.error({ err }, "fatal error in bridge main");
  process.exit(1);
});
