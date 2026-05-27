import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  DISCORD_CLIENT_ID: z
    .string()
    .regex(/^[0-9]{17,20}$/, "DISCORD_CLIENT_ID must be a Discord snowflake"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  // Internal bridge endpoint for real-time voice-state push.
  // BRIDGE_INTERNAL_URL: in docker-compose typically http://bridge:8787
  // (service-name DNS), in local dev http://localhost:8787.
  // INTERNAL_BRIDGE_SECRET: shared with the bridge via the same .env;
  // both sides must agree, or the bridge will reject the push with 401.
  // Both optional: when either is missing, the bot logs voice-state
  // changes only to the DB (the bridge's 60s recheck loop still kicks
  // commanders eventually, just not instantly).
  BRIDGE_INTERNAL_URL: z.string().url().optional(),
  INTERNAL_BRIDGE_SECRET: z.string().min(16).optional(),
});

export type BotEnv = z.infer<typeof envSchema>;

let _env: BotEnv | undefined;

export function getEnv(): BotEnv {
  if (!_env) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const issues = result.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("\n  ");
      throw new Error(`Invalid environment variables:\n  ${issues}`);
    }
    _env = result.data;
  }
  return _env;
}
