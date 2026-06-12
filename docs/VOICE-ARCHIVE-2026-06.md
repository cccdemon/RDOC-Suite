# Voice Concept Archive — apps/bridge + apps/relay-bots (2026-06-12)

**Status:** ARCHIVE. The voice subsystem (`apps/bridge`, `apps/relay-bots`) was **removed**
on 2026-06-12 because it is being **redesigned from scratch**. This document preserves the
*as-removed* concept and implementation inventory so the redesign can reference what existed.

Authoritative concept docs are kept and still apply as historical context:
- [`docs/companion-voice-architecture.md`](companion-voice-architecture.md) — target voice
  architecture (Companion voice modes, Discord role IDs, Command Net vs Global Radio).
- [`docs/FR-P3-federation-voice.md`](FR-P3-federation-voice.md) — cross-Discord federation
  voice (REJECTED 2026-06-07; kept for history).

> This archive captures the *implementation* that was deleted; the two docs above capture the
> *intended concept*. Read all three together before redesigning.

---

## 1. Voice modes (concept)

- **Command Net** (PTT-1): commander/captain channel. Members talk in a dedicated **LiveKit
  commander room**. Direct LiveKit ↔ Companion; no Discord relay.
- **Global Radio** (PTT-2): org-wide radio. Members talk into a **LiveKit relay room**
  (`voice-relay`); **relay bots** mirror that room's audio into **Discord voice channels** so
  Discord-only members hear it. Global still uses LiveKit to reach the bots.

Infra (see memory / nginx-SNI + LiveKit notes):
- **LiveKit SFU** behind `wss://voice.raumdock.org`, runs `network_mode: host` (docker-proxy
  UDP source-port rewrite breaks ICE 5-tuple).
- **coturn** TURN server; on Proxmox LXC use **port-preserving SNAT** (not MASQUERADE) for the
  RTC port range, plus `rtc.ips.excludes` for docker bridges.

---

## 2. apps/bridge (removed)

Fastify server, `@rdoc-suite/bridge`, listens on `BRIDGE_HOST:BRIDGE_PORT` (default
`0.0.0.0:8787`). Talks to the suite Postgres via `@rdoc-suite/db` (Prisma). Mints LiveKit
tokens, stores per-guild bridge config + admins, serves a native admin web UI, and exposes
internal APIs consumed by fleetplanner and the relay-bots worker.

**Routes** (`src/routes/`):
- `relay.ts` — `/relay/token` (LiveKit token mint; Discord role checks via
  `DISCORD_RELAY_BOT_TOKEN` + `RELAY_GUILD_ID`/`RELAY_REQUIRED_ROLE_ID`).
- `relayBots.ts` — `/relay-bots/service-config?guildId=` (returns `{livekitUrl, livekitApiKey,
  livekitApiSecret, roomName, guildId, bots:[{name,token,channelId}]}` — consumed by
  apps/relay-bots).
- `sessions.ts` — bridge voice sessions (create/get/end + per-session invites).
- `fleetInternal.ts` — `/internal/fleet/*` admin API used by fleetplanner's (now removed)
  `/admin/bridge` UI to manage guild config + admins without a second login. Gated by
  `BRIDGE_FLEET_SECRET`; 503 when unset.
- `internal.ts` — bot-only internal API (gated by `INTERNAL_BRIDGE_SECRET`).
- `download.ts` — Companion download tokens / DM delivery.
- `updater.ts` — Companion auto-update feed (GitHub releases).
- `suite.ts` — suite-facing endpoints.
- `prometheusMetrics.ts` — `/metrics`.

**Services** (`src/services/`): `livekit` (token mint + room ops), `guildConfig`,
`relayBotsConfig`, `relayPermissions`, `rooms`, `sessions`, `admins` (+ `seedSuperadmin`),
`adminInviteLinks`, `audit`, `globalSettings`, `monitoring`, `companionDownloads`,
`githubReleases`, `discordMetaCache`, `guildInfo`, `strategyChannels`, `bridgeEvents`,
`fleetAdmin`, `permissions`, `metrics`, `logger`.

**Admin UI:** `src/admin/static` (legacy native UI). The modern path absorbed it into
fleetplanner `/admin/bridge` via `fleetInternal`. `BRIDGE_ADMIN_UI_MODE = full|legacy|disabled`
controlled only the `/admin/*` exposure (backend routes always on).

**Key deps:** fastify 5, `livekit-server-sdk`, `@fastify/websocket`, `jose`, `jszip`, prisma,
prom-client, zod 4.

## 3. apps/relay-bots (removed)

Discord ↔ LiveKit audio relay worker, `@rdoc-suite/relay-bots`. Bridges the LiveKit relay room
audio into one or more Discord voice channels (one bot per channel).

**Flow** (`src/index.ts`):
1. `loadConfig()` reads `config.json` (`CONFIG_PATH`).
2. If `bridge` is configured, fetch `${bridge.url}/relay-bots/service-config?guildId=` with
   `Authorization: Bearer ${serviceSecret}` → overrides livekit creds + room + bot list.
3. `LivekitSubscriber` (`@livekit/rtc-node`) subscribes to the LiveKit `relayRoomName`
   (default `voice-relay`).
4. `BotManager` (discord.js + `@discordjs/voice` + `@discordjs/opus`) logs in each bot, joins
   its `channelId`, and pipes subscribed LiveKit audio into Discord.
5. Admin HTTP server on `ADMIN_HOST:ADMIN_PORT` (default `0.0.0.0:8788`) for metrics/health.

**Config shape** (`src/config.ts`):
```jsonc
{
  "bridge": { "url": "http://bridge:8787", "serviceSecret": "…" },   // optional remote config
  "livekit": { "url": "wss://…", "apiKey": "…", "apiSecret": "…", "relayRoomName": "voice-relay" },
  "discord": { "guildId": "…", "bots": [{ "name": "…", "token": "…", "channelId": "…" }] }
}
```
Fleetplanner stored the bots **encrypted** in the DB (`GuildVoiceBot`, key
`VOICEBOT_ENCRYPTION_KEY` — BYOK) and synced them to the bridge, which served them to this
worker via `service-config`.

**Key deps:** `@discordjs/voice`, `@discordjs/opus`, `@livekit/rtc-node`, discord.js 14,
`livekit-server-sdk`, zod 3.

## 4. Environment (removed/affected vars)

Bridge: `BRIDGE_SERVER_URL`, `BRIDGE_HOST`, `BRIDGE_PORT`, `BRIDGE_PUBLIC_PATH`,
`BRIDGE_ADMIN_UI_MODE`, `BRIDGE_INTERNAL_URL`, `BRIDGE_FLEET_SECRET`, `INTERNAL_BRIDGE_SECRET`.
Relay token role checks: `DISCORD_RELAY_BOT_TOKEN`, `RELAY_GUILD_ID`, `RELAY_REQUIRED_ROLE_ID`.
Relay-bots worker: `RELAY_LIVEKIT_ROOM` (`voice-relay`), `RELAY_BOTS_ADMIN_URL`,
`RELAY_BOTS_SECRET`, `RELAY_BOTS_ADMIN_SECRET`, `CONFIG_PATH`, `ADMIN_HOST`, `ADMIN_PORT`.
LiveKit: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`, `LIVEKIT_PROMETHEUS_URL`.
Fleetplanner voice-bot encryption: `VOICEBOT_ENCRYPTION_KEY`.

## 5. Fleetplanner coupling (already removed 2026-06-12)

Fleetplanner previously hosted the bridge admin UI at `/admin/bridge` (`routes/bridgeAdmin.ts`,
`services/bridge.ts` = internal-API client, `services/bridgeVoiceOrder.ts`, ~10 `bridge*Page`
builders, `badm.*` i18n). All removed in the same change; only the external `apps/bridge`
served the data via `/internal/fleet/*`. Fleetplanner voice bots live in `GuildVoiceBot`
(encrypted) — that schema/table was **not** touched here.

## 6. What was NOT removed

- `apps/bot` (Discord slash-command bot), `apps/companion` (desktop), `apps/mission-cover`,
  `apps/monitoring`, `apps/error-page` — kept.
- The two concept docs above — kept.
- LiveKit / coturn infra (external) — kept.
- `GuildVoiceBot` table + `VOICEBOT_ENCRYPTION_KEY` — kept (redesign may reuse or migrate).
