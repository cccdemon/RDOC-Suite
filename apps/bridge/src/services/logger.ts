import pino from "pino";
import { getEnv } from "../config/env.js";

export const logger = pino({
  level: getEnv().LOG_LEVEL,
  base: { service: "bridge" },
  redact: {
    paths: [
      "token",
      "*.token",
      "*.SESSION_SECRET",
      "*.DISCORD_BOT_TOKEN",
      "*.DISCORD_CLIENT_SECRET",
    ],
    censor: "[REDACTED]",
  },
});
