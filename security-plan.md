# Security Plan

Date: 2026-05-22

Scope: `discord-channel-commander`, including the Discord bot, bridge server, LiveKit integration, Tauri companion app, Prisma database, Docker deployment, and public reverse-proxy setup.

## Current Security Posture

The project already has several good foundations:

- Discord access is based on official OAuth2 and bot APIs, not selfbots or client modification.
- The bridge validates OAuth login against guild membership and configured commander roles.
- Bridge WebSocket messages are schema-validated at the boundary.
- Session JWTs are short-lived by default.
- LiveKit tokens are minted server-side and scoped to one room.
- Bridge and LiveKit signaling are loopback-bound in production compose and expected to sit behind a reverse proxy.
- `.env`, local databases, logs, generated Prisma client output, and private keys are gitignored.
- Logs redact common token/secret field names.

The main risks are not broad architectural failures; they are specific gaps around authorization boundaries, token transport, production hardening, and desktop-client storage.

## Priority 0: Immediate Fixes

### 1. Enforce Allowed Voice Channels

**Risk:** High

The bot lets admins configure participating voice channels, but the bridge does not currently enforce that a commander is actually in one of those channels before issuing a LiveKit token.

Relevant files:

- `apps/bot/src/commands/cc.ts`
- `apps/bridge/src/auth/oauth.ts`
- `apps/bridge/src/signaling/ws.ts`
- `apps/bridge/src/services/permissions.ts`
- `apps/bridge/src/services/guildConfig.ts`

Current behaviour:

- OAuth checks guild membership and commander role.
- `ptt:start` checks that `msg.guildId` matches the session token.
- `voiceChannelId` is optional and not used for authorization.
- `allowedVoiceChannelIds` is stored but not enforced by the bridge.

Fix:

- On `ptt:start`, require a `voiceChannelId`.
- Verify the supplied `voiceChannelId` is in `GuildConfig.allowedVoiceChannelIds`.
- Verify via Discord API that the user is currently connected to that voice channel, or implement a trusted bot-side presence/voice-state cache if Gateway voice-state intent is available.
- Deny LiveKit token issuance if the channel check fails.

Acceptance criteria:

- A commander with the correct role but outside an allowed channel cannot receive a LiveKit token.
- A commander in a non-allowed voice channel cannot receive a LiveKit token.
- Removing a voice channel from config blocks new PTT sessions immediately.
- Tests cover valid channel, invalid channel, missing channel, and stale channel config.

### 2. Stop Passing Session Tokens in URLs

**Risk:** High

Session JWTs are placed in:

- `dccc://auth?token=...`
- `/ws?token=...`
- the browser success page sign-in code

URLs can leak through browser history, proxy logs, app logs, crash dumps, debug logs, and screenshots. The companion also logs received deep-link URLs during development.

Relevant files:

- `apps/bridge/src/auth/oauth.ts`
- `apps/bridge/src/signaling/ws.ts`
- `apps/companion/src/lib/ws.ts`
- `apps/companion/src/lib/auth.ts`

Fix:

- Replace the displayed sign-in code with a short one-time exchange code.
- Store exchange codes server-side with a short TTL, single-use semantics, and the target `guildId`/`userId`.
- Let the companion POST the exchange code to `/auth/exchange`.
- Return the session JWT only in the HTTPS response body.
- For WebSocket authentication, pass the token in the first message after connect or use a short-lived one-time WebSocket ticket.
- Remove token-bearing URLs from logs.

Acceptance criteria:

- No session JWT appears in callback URLs, WebSocket URLs, deep-link URLs, browser address bars, or proxy request paths.
- Exchange codes are single-use and expire in less than 5 minutes.
- Reusing an exchange code fails.
- Tests verify no JWT is accepted from query string after the migration.

### 3. Remove Token Logging in Companion

**Risk:** High

The companion currently logs deep-link input, including URLs that can contain session tokens.

Relevant files:

- `apps/companion/src/lib/auth.ts`
- `apps/companion/src/App.tsx`

Fix:

- Remove `console.log("[deep-link] received", ...)`.
- Remove or guard `console.log("[deep-link] getCurrent on mount:", ...)`.
- Keep hotkey debug logging behind an explicit development flag.

Acceptance criteria:

- Production build does not log session tokens, deep-link URLs, sign-in codes, or auth payloads.
- CI or lint rule prevents accidental token/debug logging in production code.

## Priority 1: Production Hardening

### 4. Enable a Tauri Content Security Policy

**Risk:** Medium

The Tauri app has CSP disabled with `"csp": null`. Since the companion stores session tokens locally, any webview injection or unexpected asset loading has a larger blast radius.

Relevant file:

- `apps/companion/src-tauri/tauri.conf.json`

Fix:

- Add a restrictive CSP.
- Allow only local app assets and the configured bridge/LiveKit endpoints.
- Disallow inline scripts unless strictly required.

Suggested baseline:

```json
{
  "app": {
    "security": {
      "csp": "default-src 'self'; connect-src 'self' https: wss:; img-src 'self' asset: data:; style-src 'self' 'unsafe-inline'; script-src 'self'"
    }
  }
}
```

Acceptance criteria:

- Companion runs with CSP enabled.
- OAuth flow, WebSocket, and LiveKit still work.
- No external script execution is allowed.

### 5. Store Session Tokens More Safely

**Risk:** Medium

The companion stores session JWTs in `tauri-plugin-store` plain app settings.

Relevant file:

- `apps/companion/src/lib/store.ts`

Fix:

- Prefer OS-backed credential storage where available.
- If that is not practical, reduce session TTL and avoid refresh tokens.
- Treat local token storage as bearer-token storage in docs and threat model.

Acceptance criteria:

- Token storage location and risk are documented.
- Either OS credential storage is used, or session TTL is short enough that local token theft has limited value.
- Sign-out deletes local token data.

### 6. Pin Container Image Versions

**Risk:** Medium

Both dev and production compose use `livekit/livekit-server:latest`.

Relevant files:

- `docker-compose.yml`
- `docker-compose.prod.yml`

Fix:

- Pin LiveKit to a known version.
- Upgrade deliberately after reading changelogs.
- Document the current tested LiveKit version.

Acceptance criteria:

- No production container uses `:latest`.
- Upgrade process includes compatibility test and rollback path.

### 7. Remove Dev Credentials From Any Public Surface

**Risk:** Medium

Development LiveKit uses `--dev`, `devkey`, and `secret`. This is fine only when strictly local.

Relevant files:

- `docker-compose.yml`
- `apps/bridge/src/config/env.ts`

Fix:

- Keep `--dev` only in local compose.
- Make production fail if `LIVEKIT_API_KEY=devkey` or `LIVEKIT_API_SECRET=secret`.
- Make production fail if `LIVEKIT_URL` is plain `ws://` on a public deployment.

Acceptance criteria:

- Production startup rejects default LiveKit credentials.
- Production docs require random LiveKit API credentials.

### 8. Add Rate Limits

**Risk:** Medium

OAuth start/callback and WebSocket connection attempts are not rate-limited in the app.

Relevant files:

- `apps/bridge/src/app.ts`
- `apps/bridge/src/auth/oauth.ts`
- `apps/bridge/src/signaling/ws.ts`

Fix:

- Add per-IP rate limiting for `/auth/start`, `/auth/callback`, and `/ws`.
- Add backoff or temporary blocking after repeated invalid token attempts.
- Ensure reverse proxy forwards a trustworthy client IP header only from trusted proxies.

Acceptance criteria:

- Brute-force attempts against state, callback, and WebSocket auth are throttled.
- Tests or manual checks confirm limits trigger.

## Priority 2: Authorization and Audit Quality

### 9. Persist and Revoke Sessions

**Risk:** Medium

`revokeToken` only uses an in-memory `Set`, which is lost on restart and is not effective across multiple bridge instances.

Relevant file:

- `apps/bridge/src/auth/sessionToken.ts`

Fix:

- Store session `jti` records in the database or Redis.
- Add revoke-on-signout.
- Add admin ability to revoke all sessions for a user or guild.

Acceptance criteria:

- Revocation survives bridge restarts.
- Revoked tokens fail on all bridge instances.

### 10. Add Audit Events

**Risk:** Medium

There is a `CommanderSession` model, but active PTT start/stop is not currently persisted in the reviewed bridge path.

Relevant files:

- `prisma/schema.prisma`
- `apps/bridge/src/signaling/ws.ts`

Fix:

- Persist PTT start/stop metadata.
- Record authorization failures, permission recheck kicks, and LiveKit token issuance failures.
- Never persist audio.

Acceptance criteria:

- Admin can answer who opened a bridge session and when.
- Audit logs contain no session JWTs, LiveKit tokens, OAuth tokens, or audio data.

### 11. Validate Discord Command Inputs More Strictly

**Risk:** Low to Medium

Slash command inputs are constrained by Discord option types, but stored IDs should still be validated before DB writes.

Relevant files:

- `apps/bot/src/commands/cc.ts`
- `apps/bot/src/services/guildConfig.ts`

Fix:

- Validate role IDs and channel IDs with snowflake regex before storage.
- Ensure selected channels belong to the interaction guild.
- Ensure selected roles belong to the interaction guild.

Acceptance criteria:

- Invalid or cross-guild IDs are rejected.
- Tests cover service-level validation, not only Discord UI constraints.

## Priority 3: Dependency and Supply Chain

### 12. Address Dependency Audit Finding

**Risk:** Low to Medium

`corepack pnpm audit --prod` found one moderate advisory:

- Package: `@hono/node-server`
- Advisory: middleware bypass via repeated slashes in `serveStatic`
- Vulnerable versions: `<1.19.13`
- Path: `packages__db > @prisma/client > prisma > @prisma/dev > @hono/node-server`

This appears in the Prisma/dev tooling path, not the public Fastify bridge runtime path, but it should still be cleaned up.

Fix:

- Upgrade Prisma and generated client dependencies to versions that pull a patched `@hono/node-server`.
- Re-run `corepack pnpm audit --prod`.
- Keep dependency updates in CI.

Acceptance criteria:

- `corepack pnpm audit --prod` reports no moderate/high/critical vulnerabilities.

### 13. Add CI Security Checks

**Risk:** Medium

Fix:

- Add CI jobs for:
  - `pnpm lint`
  - `pnpm test`
  - `pnpm audit --prod`
  - `cargo audit` for the Tauri side
  - secret scanning
  - dependency lockfile review

Acceptance criteria:

- Security checks run on pull requests.
- Failing security checks block merges.

## Priority 4: Deployment Controls

### 14. Harden Reverse Proxy Headers

**Risk:** Low to Medium

The production notes rely on Traefik, while the repo also contains a Caddyfile. Security headers should be explicit in whichever proxy is actually used.

Relevant files:

- `Caddyfile`
- production Traefik config outside this repo

Fix:

- Add headers at the public edge:
  - `Strict-Transport-Security`
  - `X-Content-Type-Options: nosniff`
  - `Referrer-Policy: no-referrer`
  - `Permissions-Policy` limiting camera/mic where appropriate
- Ensure WebSocket upgrade handling is explicit.

Acceptance criteria:

- Public endpoints show expected security headers.
- Bridge and LiveKit WebSocket flows still work.

### 15. Run Containers With Least Privilege

**Risk:** Low to Medium

Fix:

- Run bridge as non-root in the runtime image.
- Use read-only filesystem where practical.
- Mount only the SQLite/Prisma data directory as writable.
- Add `cap_drop: ["ALL"]` where compatible.

Acceptance criteria:

- Bridge container does not run as root.
- Container cannot write outside required data paths.

## Suggested Work Order

1. Enforce allowed voice channel authorization before LiveKit token issuance.
2. Replace token-in-URL login/WS flow with one-time exchange codes and non-URL token transport.
3. Remove production token/debug logs from the companion.
4. Add Tauri CSP and safer token storage.
5. Pin LiveKit version and reject production default credentials.
6. Add rate limits and persistent revocation.
7. Add audit logging for PTT lifecycle.
8. Add dependency/security CI.
9. Harden reverse proxy headers and container runtime.

## Manual Verification Checklist

- A non-member cannot sign in.
- A guild member without a commander role cannot sign in.
- A commander role holder outside an allowed voice channel cannot start PTT.
- A commander role holder in an allowed voice channel can start PTT.
- Removing the commander role kicks an active user within the permission recheck interval.
- Disabling the guild blocks new sessions and terminates active sessions.
- No JWT or LiveKit token appears in browser URLs, WebSocket URLs, proxy logs, app logs, or desktop logs.
- LiveKit only accepts bridge-minted tokens.
- Production LiveKit does not use `devkey` or `secret`.
- Dependency audit has no moderate/high/critical findings.

