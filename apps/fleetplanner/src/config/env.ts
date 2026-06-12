import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  PORT: z.coerce.number().default(3200),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().default("file:./data/fleetplanner.db"),
  SESSION_SECRET: z.string().min(32),
  // Dedicated encryption key for GuildVoiceBot tokens. Set this once and keep it stable.
  // If unset, falls back to SESSION_SECRET (which causes re-entry on every rotate).
  VOICEBOT_ENCRYPTION_KEY: z.string().min(32).optional(),
  PUBLIC_BASE_PATH: z.string().default(""),
  // Force maintenance mode on regardless of the superadmin toggle (1/true/on).
  // Useful during deploys; leave unset for normal operation.
  MAINTENANCE_MODE: z.string().optional(),
  WEB_PUBLIC_URL: z.string().default("http://localhost:3200"),
  // At least one OAuth provider must be configured. Discord is the
  // original provider; GitHub and Google are alternatives.
  DISCORD_CLIENT_ID: z.string().optional(),
  DISCORD_RDOCRTC_CLIENT_ID: z.string().optional(),
  DISCORD_RDOCRTC_BOT_TOKEN: z.string().optional(),
  DISCORD_CLIENT_SECRET: z.string().optional(),
  SUPERADMIN_DISCORD_ID: z.string().optional(),
  // Free-text contact shown to users who need to reach the instance SuperAdmin
  // (e.g. to request Voice Permission). Discord handle, email, or URL.
  SUPERADMIN_CONTACT: z.string().optional(),

  // GitHub OAuth (optional — leave unset to hide GitHub login button)
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // Google OAuth (optional — leave unset to hide Google login button)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  // Optional legacy alias kept only so old environments still parse.
  // Fleetplanner Discord actions require DISCORD_FLEETPLANNER_BOT_TOKEN.
  DISCORD_GUILD_ID: z.string().optional(),
  // Guild that is always allowed to use LiveKit voice sessions regardless of voiceEnabled flag.
  RAUMDOCK_GUILD_ID: z.string().optional(),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_FLEETPLANNER_CLIENT_ID: z.string().optional(),
  DISCORD_FLEETPLANNER_CLIENT_SECRET: z.string().optional(),
  DISCORD_FLEETPLANNER_BOT_TOKEN: z.string().optional(),
  // Ed25519 public key of the Fleetplanner Discord app — required to verify
  // incoming HTTP interactions (FR-P1 event-distribution approval buttons).
  // Set the app's "Interactions Endpoint URL" to <WEB_PUBLIC_URL>/discord/interactions.
  DISCORD_FLEETPLANNER_PUBLIC_KEY: z.string().optional(),
  // Companion app OAuth — uses the RDOC-RTC Bot (separate from the Fleetmanager Bot)
  DISCORD_COMPANION_BOT_ID: z.string().optional(),
  DISCORD_COMPANION_BOT_KEY: z.string().optional(),
  FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL: z.string().optional(),
  FLEETPLANNER_VOICE_CLIENT_CONFIG_URL: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  RELAY_LIVEKIT_ROOM: z.string().default("voice-relay"),
  RELAY_BOTS_ADMIN_URL: z.string().optional(),
  RELAY_BOTS_ADMIN_SECRET: z.string().optional(),

  // Mission-cover render microservice (FR-P4). Internal docker-network URL +
  // shared M2M secret (matches the service's MISSIONCOVER_SERVICE_SECRET). When
  // the secret is unset, the cover feature is hidden (coverServiceConfigured()).
  MISSIONCOVER_SERVICE_URL: z.string().url().default("http://mission-cover:3300"),
  MISSIONCOVER_SERVICE_SECRET: z.string().min(32).optional(),
  // Public base URL of the mission-cover service (Caddy /cover) — used to build
  // the editor link the operator's browser is redirected to.
  MISSIONCOVER_PUBLIC_URL: z.string().default("https://suite.raumdock.org/cover"),
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
