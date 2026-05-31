import pino from "pino";
import { getEnv } from "../config/env.js";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: "bot" },
  redact: {
    paths: [
      "token",
      "*.token",
      "*.DISCORD_RDOCRTC_BOT_TOKEN",
      "*.DISCORD_CLIENT_SECRET",
      "*.SESSION_SECRET",
    ],
    censor: "[REDACTED]",
  },
});
