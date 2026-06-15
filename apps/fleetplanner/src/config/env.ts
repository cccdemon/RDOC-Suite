import { z } from "zod";

// URLs that get rendered as links or used as redirect targets must be real
// http(s) URLs — z.url() alone still accepts javascript:/data: schemes.
const httpUrl = z
  .string()
  .url()
  .refine((u) => /^https?:\/\//i.test(u), "must be an http(s) URL");

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
  WEB_PUBLIC_URL: httpUrl.default("http://localhost:3200"),
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
  // Voice/SquadLink stack was removed 2026-06-12; these are leftover (often empty)
  // env vars. Kept lenient so a stale/empty value doesn't fail-fast the boot.
  FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL: z.string().optional(),
  FLEETPLANNER_VOICE_CLIENT_CONFIG_URL: z.string().optional(),
  LIVEKIT_URL: z.string().optional(),
  LIVEKIT_API_KEY: z.string().optional(),
  LIVEKIT_API_SECRET: z.string().optional(),
  RELAY_LIVEKIT_ROOM: z.string().default("voice-relay"),
  RELAY_BOTS_ADMIN_URL: z.string().optional(),
  RELAY_BOTS_ADMIN_SECRET: z.string().optional(),

  // E2E test-login seam (scripts/e2e). When set (>=32 chars), enables the
  // /e2e/login + /e2e/cleanup backdoor for synthetic e2e-* test players ONLY.
  // Unset in normal prod — the routes do not exist without it.
  E2E_TEST_LOGIN_SECRET: z.string().min(32).optional(),

  // Mission-cover render microservice (FR-P4). Internal docker-network URL +
  // shared M2M secret (matches the service's MISSIONCOVER_SERVICE_SECRET). When
  // the secret is unset, the cover feature is hidden (coverServiceConfigured()).
  MISSIONCOVER_SERVICE_URL: httpUrl.default("http://mission-cover:3300"),
  MISSIONCOVER_SERVICE_SECRET: z.string().min(32).optional(),
  // Public base URL of the mission-cover service (Caddy /cover) — used to build
  // the editor link the operator's browser is redirected to.
  MISSIONCOVER_PUBLIC_URL: httpUrl.default("https://suite.raumdock.org/cover"),

  // RDOC SquadLink Lite deep-link (FR SquadLink-CommandNet). Operationscommandanten
  // get a `squadlink://connect` link from the op detail UI that joins the op voice
  // room without PIN/code. The token is HMAC-SHA256(secret, room) hex and MUST stay
  // byte-for-byte identical to the init-server's `ROOM_AUTH_SECRET` (RDOC-SACompanion
  // server/init/src/auth.rs `token_for`). Unset → feature hidden (squadLinkConfigured()).
  SQUADLINK_ROOM_AUTH_SECRET: z.string().optional(),
  // Signaling server WebSocket URL the link points at (init-server /ws).
  SQUADLINK_WS_URL: z.string().default("wss://squadlink.raumdock.org/ws"),
  // Microsoft Store listing for SquadLink Lite. When set, the op voice panel offers
  // an "install the app" link next to the join link. Unset → install link hidden
  // (the Store listing may not be published yet).
  SQUADLINK_STORE_URL: z.string().optional(),
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
