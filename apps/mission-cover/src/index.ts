import { buildApp } from "./app.js";
import { getEnv } from "./config/env.js";
import { closeBrowser } from "./services/render.js";

const env = getEnv();
const app = await buildApp();

async function shutdown(signal: string): Promise<void> {
  app.log.info({ signal }, "shutting down");
  await app.close().catch(() => {});
  await closeBrowser();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

try {
  await app.listen({ host: env.HOST, port: env.PORT });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
