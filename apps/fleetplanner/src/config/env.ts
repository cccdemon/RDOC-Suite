import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3200),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("file:./data/fleetplanner.db"),
  SESSION_SECRET: z.string().min(32),
  PUBLIC_BASE_PATH: z.string().default(""),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3200"),
  // At least one OAuth provider must be configured. Discord is the
  // original provider; GitHub and Google are alternatives.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  SUPERADMIN_DISCORD_ID: z.string().optional(),

  // GitHub OAuth (optional — leave unset to hide GitHub login button)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Google OAuth (optional — leave unset to hide Google login button)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Optional Discord bot integration for creating scheduled events
  DISCORD_GUILD_ID: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_FLEETPLANNER_CLIENT_ID: z.string().optional(),
  DISCORD_FLEETPLANNER_BOT_TOKEN: z.string().optional(),
  DISCORD_COMMANDER_ROLE_ID: z.string().optional(),
  DISCORD_ADMIRAL_ROLE_ID: z.string().optional(),
  DISCORD_EVENT_CHANNEL_ID: z.string().optional(), // voice channel → in-voice events
  FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL: z.string().optional(),
  FLEETPLANNER_VOICE_CLIENT_CONFIG_URL: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (!_env) {
    const result = schema.safeParse(process.env);
    if (!result.success) {
      console.error("Invalid environment variables:", result.error.flatten().fieldErrors);
      process.exit(1);
    }
    _env = result.data;
  }
  return _env;
}

export function basePath(suffix = ""): string {
  return `${getEnv().PUBLIC_BASE_PATH}${suffix}`;
}
