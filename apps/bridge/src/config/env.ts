import "dotenv/config";
import { z } from "zod";

const baseEnvSchema = z.object({
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  BRIDGE_HOST: z.string().default("0.0.0.0"),
  BRIDGE_PORT: z.coerce.number().int().nonnegative().default(8787),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  LIVEKIT_URL: z.string().default("ws://localhost:7880"),
  LIVEKIT_API_KEY: z.string().default("devkey"),
  LIVEKIT_API_SECRET: z.string().default("secret"),
  // Public path prefix in front of the bridge. Production on
  // suite.raumdock.org uses the host root, so this stays empty there.
  // Required so cookies set during the OAuth flow carry the right Path
  // attribute if a deployment ever uses a stripped path prefix.
  PUBLIC_BASE_PATH: z
    .string()
    .default("")
    .transform((v) => v.replace(/\/+$/, ""))
    .refine((v) => v === "" || v.startsWith("/"), {
      message: "PUBLIC_BASE_PATH must be empty or start with '/'",
    }),
  // Shared secret for the bot → bridge internal HTTP push that delivers
  // voice-state changes in real time. Optional in dev/test (the endpoint
  // 503s when unset); required in production for instant voice-channel
  // enforcement to work — otherwise we fall back to the 60s recheck loop.
  INTERNAL_BRIDGE_SECRET: z.string().min(16).optional(),
  // Separate secret for the admin web-UI session cookie. Optional —
  // when unset we fall back to SESSION_SECRET so single-secret
  // deployments still work. Set this in production to give the admin
  // surface its own credential.
  ADMIN_SESSION_SECRET: z.string().min(32).optional(),
  // Companion session-JWT TTL in days. The bridge re-checks Discord
  // roles every 60s while a WS is alive, so a long TTL doesn't extend
  // the window during which a kicked-out user can still talk — only
  // the window during which they can re-open the EXE without going
  // through Discord OAuth again. 30 days is a friendly default for
  // a tool used in long-running campaigns; security-sensitive
  // deployments can dial it lower.
  SESSION_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(30),
  // GitHub source for the companion EXE download links. Bridge fetches
  // the latest release's asset from this repo when a single-use
  // download token is consumed and streams the bytes to the client.
  // GITHUB_REPO format is "owner/name", e.g. "head87x/rdcc".
  // GITHUB_TOKEN is a PAT with `contents:read` scope on the repo
  // (required for PRIVATE repos; public repos can omit it).
  // COMPANION_ASSET_PATTERN is matched (case-insensitive substring)
  // against release asset names — pick "dccc-companion.exe" or
  // ".exe" if you only ever publish one Windows binary.
  GITHUB_REPO: z
    .string()
    .regex(/^[^/\s]+\/[^/\s]+$/, "GITHUB_REPO must be owner/name")
    .optional(),
  GITHUB_TOKEN: z.string().min(8).optional(),
  // Portable EXE filename pattern for the admin-mintable download
  // link (Companion erstmal installieren). Default: a release asset
  // whose name contains ".exe" but NOT ".nsis.zip" (so the NSIS
  // installer used by the auto-updater is excluded here).
  COMPANION_ASSET_PATTERN: z.string().default(".exe"),
  // Auto-updater artifact pattern. Default ".nsis.zip" matches the
  // file Tauri's bundler produces (NSIS installer compressed in a
  // zip + .sig sibling for signature). The updater endpoint will
  // only find a release if THIS asset is present.
  COMPANION_UPDATER_PATTERN: z.string().default(".nsis.zip"),

  // Voice relay bots. Optional — when unset the relay token endpoint 503s.
  // RELAY_GUILD_ID: default guild for Discord role checks (can be overridden
  //   per-request via ?guildId= query param).
  // RELAY_REQUIRED_ROLE_ID: Discord role that a user must have to get a
  //   publisher relay token. Omit to allow any authenticated user to publish.
  // RELAY_DISCORD_BOT_TOKEN: bot token used for Discord role membership checks.
  //   If unset, the bridge falls back to the first bot token stored in
  //   RelayBotsConfig.bots. Can be the same token as DISCORD_BOT_TOKEN.
  // RELAY_LIVEKIT_ROOM: fallback room name when RelayBotsConfig has no roomName.
  // RELAY_BOTS_ADMIN_URL: base URL of the relay bots service admin API
  //   (e.g. http://relay-bots:8788). When set, metrics + reload are proxied.
  // RELAY_BOTS_SECRET: Bearer secret that the relay bots service presents when
  //   calling GET /relay-bots/service-config.
  // RELAY_BOTS_ADMIN_SECRET: secret the bridge sends to the relay bots service
  //   admin API (Basic auth: admin:<secret>).
  RELAY_GUILD_ID: z.string().optional(),
  RELAY_REQUIRED_ROLE_ID: z.string().optional(),
  RELAY_DISCORD_BOT_TOKEN: z.string().optional(),
  RELAY_LIVEKIT_ROOM: z.string().default("voice-relay"),
  RELAY_BOTS_ADMIN_URL: z.string().optional(),
  RELAY_BOTS_SECRET: z.string().optional(),
  RELAY_BOTS_ADMIN_SECRET: z.string().optional(),
  // Optional explicit URL for LiveKit's Prometheus metrics endpoint.
  // When unset, the bridge derives it from LIVEKIT_URL by replacing ws(s)
  // with http(s) and appending /metrics. Set this when LiveKit is behind a
  // proxy or the metrics port differs from the signaling port.
  LIVEKIT_PROMETHEUS_URL: z.string().url().optional(),
});

export type BridgeEnv = z.infer<typeof baseEnvSchema>;

const oauthEnvSchema = z.object({
  DISCORD_CLIENT_ID: z
    .string()
    .regex(/^[0-9]{17,20}$/, "DISCORD_CLIENT_ID must be a Discord snowflake"),
  DISCORD_CLIENT_SECRET: z.string().min(1, "DISCORD_CLIENT_SECRET is required"),
  DISCORD_BOT_TOKEN: z.string().min(1, "DISCORD_BOT_TOKEN is required"),
  OAUTH_REDIRECT_URI: z.string().url("OAUTH_REDIRECT_URI must be a URL"),
  COMPANION_REDIRECT_URI: z.string().min(1).default("dccc://auth"),
});

export type OAuthEnv = z.infer<typeof oauthEnvSchema>;

let _env: BridgeEnv | undefined;
let _oauthEnv: OAuthEnv | undefined | null;

export function getEnv(overrides?: NodeJS.ProcessEnv): BridgeEnv {
  if (overrides) {
    return baseEnvSchema.parse(overrides);
  }
  if (!_env) {
    const result = baseEnvSchema.safeParse(process.env);
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

/**
 * Returns OAuth config or null if not configured.
 * Tests and unit-tests can still run without Discord credentials.
 */
export function getOAuthEnv(): OAuthEnv | null {
  if (_oauthEnv !== undefined) return _oauthEnv;
  const result = oauthEnvSchema.safeParse(process.env);
  _oauthEnv = result.success ? result.data : null;
  return _oauthEnv;
}

export function resetEnvCache(): void {
  _env = undefined;
  _oauthEnv = undefined;
}
