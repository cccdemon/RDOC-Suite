# RDOC Suite Merge Log

This file is the handover log for consolidating RDCC, RDOC-RTC, and
RDOC-VoiceRelayBots into this repository.

Rule: before implementation changes, add a short entry under "Queued /
Planned Step" describing what will be changed. After the change, move or
copy the result into "Completed Steps" with commit id if committed.

## Current Baseline

- Repository: `RDOC-Suite`
- Created from: `RDOC-SC-Suite/RDCC`
- Initial commit: `5045813 Initial RDOC Suite shell from RDCC`
- Strategy: RDCC remains the suite shell, styling source, admin UX source,
  Discord guild authority, and deployment base.

## Source Projects

- `RDOC-SC-Suite/RDCC`: base shell, admin styling, Discord bot, guild config,
  raid planner, companion download flow, commander PTT.
- `RDOC/RDOC-RTC`: session lifecycle, Admiral/API-key auth, relay token route,
  relay-bots bridge config, monitoring, audit log, "Voice to All", richer
  companion session UX.
- `RDOC/RDOC-VoiceRelayBots`: worker service that relays LiveKit audio into
  Discord voice channels and exposes metrics/reload/voice-state APIs.

## Target Shape

```text
RDOC-Suite/
  apps/
    bridge/       # one backend for admin, auth, sessions, signaling, relay APIs
    bot/          # Discord slash commands + voice-state cache
    companion/    # RDCC-styled Tauri app with RTC features added
    relay-bots/   # imported VoiceRelayBots worker
  packages/
    shared/
    db/
  prisma/
  docs/
```

## Similar Functionality Map

| Function | RDCC | RDOC-RTC | Target |
| --- | --- | --- | --- |
| LiveKit PTT bridge | guild room per Discord guild | session room per invite | support both guild and session room modes |
| WebSocket signaling | `ptt:start/stop`, voice gating, status flags | `ptt:start/stop`, heartbeat RTT | merged protocol with guild/session context |
| Admin auth | guild-scoped Discord OAuth admins | global Discord OAuth admins + API keys | guild-scoped admins plus API credentials |
| Admin UI | RDCC styling, dashboard, raid planner, config, admins | sessions, relay bots, monitoring, audit | RDCC styling with added pages |
| Discord voice state | bot cache in DB | proxied from relay service | keep RDCC bot cache, use relay proxy as extra status source |
| Relay to Discord channels | planned bridge mode | implemented worker | import worker as `apps/relay-bots` |
| Companion | Discord OAuth, server picker, PTT roster | invite/session, Admiral mode, Voice to All | RDCC UI base with RTC features added |

## Recommended Order

1. Import RDOC-RTC schema concepts into RDCC Prisma without changing runtime code.
2. Add backend auth/API credential services needed by Admiral/API clients.
3. Add session lifecycle backend routes and tests.
4. Add RDCC-styled admin pages for Sessions and API Keys.
5. Import relay token and relay-bots config backend routes.
6. Move VoiceRelayBots into `apps/relay-bots` and convert it to pnpm workspace.
7. Add RDCC-styled Relay Bots and Discord Voice admin pages.
8. Merge monitoring and audit log.
9. Extend shared WebSocket protocol.
10. Merge companion RTC/Admiral/Voice-to-All functions into RDCC companion.
11. Update Docker Compose and deployment docs.
12. Run full build/test/smoke verification and commit stable milestones.

## Queued / Planned Step

- 2026-05-27: Create this merge log and project plan before any merge work, so
  future agents can resume from a repo-local source of truth.
- 2026-05-27: Check all source repositories (`RDOC-SC-Suite/RDCC`,
  `RDOC/RDOC-RTC`, `RDOC/RDOC-VoiceRelayBots`) for upstream changes with
  `git pull`, then bring relevant source changes into `RDOC-Suite` while
  preserving the suite repo as the independent target repository.
- 2026-05-27: Apply deployment naming decision: all web interfaces should use
  `suite.raumdock.org`; LiveKit URL should use `voice.raumdock.org`.
- 2026-05-27: Remove `/dccc` from public suite URLs. Web interfaces should be
  served from `https://suite.raumdock.org/` with empty `PUBLIC_BASE_PATH`.
- 2026-05-27: Configure new Git remote origin:
  `git@github.com:cccdemon/RDOC-Suite.git`.
- 2026-05-27: Rename Docker containers/images to the clear pattern
  `rdoc-suite-<part>` for parts like `livekit`, `bridge`, and `bot`.
- 2026-05-27: Move toward microservice architecture by adding dedicated
  Docker images/services for `monitoring` and `fleetplanner` instead of
  folding those concerns into the bridge image.
- 2026-05-27: Start one-binary Companion merge. Keep RDCC SquadLink UI as
  default, then add dormant RDOC-RTC/Suite capability plumbing for future
  role-unlocked Admiral tools and Voice-to-All without changing the normal
  Commander flow.

## Completed Steps

- 2026-05-27: Created fresh Git repository `RDOC-Suite` from RDCC shell.
  Commit: `5045813`.
- 2026-05-27: Added this merge log and initial integration plan.
  Commit: `7846263`.
- 2026-05-27: Attempted to pull source repositories before importing further
  changes.
  - `RDOC-SC-Suite/RDCC`: local branch `main`, HEAD
    `607f1fe99b7480ece952402c16ce4db4553fc418`. `git pull --ff-only`
    failed because remote is `git@github.com:head87x/rdcc.git` and GitHub SSH
    auth is unavailable in this environment (`Permission denied (publickey)`).
    HTTPS also requested credentials, so no upstream changes could be fetched.
  - `RDOC/RDOC-RTC`: local branch `better-architecture`, HEAD
    `056e7d7232a594426868726c13ee484e03fdf5a5`. `git pull --ff-only`
    failed because remote is `git@github.com:cccdemon/RDOC-RTC.git` and
    GitHub SSH auth is unavailable. HTTPS also requested credentials, so no
    upstream changes could be fetched.
  - `RDOC/RDOC-VoiceRelayBots`: local branch `main`, HEAD
    `1d32ceeb3ead7cc365e8116cc432e13ca82386a1`. HTTPS pull from
    `https://github.com/cccdemon/RDOC-VoiceRelayBots.git main` succeeded and
    reported `Already up to date`.
  - Result for `RDOC-Suite`: no source-code changes imported from upstream
    because the only reachable source repo had no new commits.
- 2026-05-27: Applied deployment naming decision.
  - Web interface / bridge public URL: `https://suite.raumdock.org`
  - Discord OAuth callback: `https://suite.raumdock.org/auth/callback`
  - LiveKit signaling URL: `wss://voice.raumdock.org`
  - Updated `.env.example`, `.env.prod.template`, `Caddyfile`,
    `docker-compose.prod.yml`, `STAND.md`, and relevant code comments.
  - Left historical `CHANGELOG.md` entries unchanged.
- 2026-05-27: Removed `/dccc` path prefix from active production config and
  docs. `PUBLIC_BASE_PATH` is now empty for production root-host routing.
- 2026-05-27: Configured Git remote `origin` as
  `git@github.com:cccdemon/RDOC-Suite.git`.
- 2026-05-27: Renamed active Docker container/image references to
  `rdoc-suite-<part>`.
  - `rdoc-suite-livekit`
  - `rdoc-suite-bridge`
  - `rdoc-suite-bot`
  - Updated compose files, production env comment, and deployment notes.
- 2026-05-27: Added first microservice split for Fleetplanner and Monitoring.
  - Imported RDOC-RTC `apps/fleetplanner` as `@rdoc-suite/fleetplanner`.
  - Added dedicated fleetplanner production image/service:
    `rdoc-suite-fleetplanner`.
  - Added dedicated Prometheus-based monitoring image/service:
    `rdoc-suite-monitoring`.
  - Routed fleetplanner via `https://suite.raumdock.org/fleetplanner`.
  - Routed monitoring via `https://suite.raumdock.org/monitoring`.
  - Added separate data volumes for fleetplanner and monitoring.
  - Ran `pnpm.cmd --filter @rdoc-suite/fleetplanner exec prisma generate
    --schema prisma/schema.prisma` and `pnpm.cmd --filter
    @rdoc-suite/fleetplanner build`; both passed.
  - Ran production compose config validation with a temporary `.env`; passed.
  - Docker image build for monitoring was not run successfully because Docker
    Desktop Linux engine was not available in this environment.
- 2026-05-27: Started one-binary Companion merge.
  - Kept `apps/companion` RDCC/SquadLink UI as the base.
  - Added `apps/companion/src/lib/suite.ts` capability lookup with
    Commander-only fallback.
  - Added dormant persisted `relayHotkey` setting for future Voice-to-All.
  - Added hidden future top-bar controls for Admiral and Voice-to-All; they
    only render if the bridge grants capabilities.
  - Added bridge route `/suite/capabilities`, authenticated by companion
    session JWT and returning conservative false capabilities for now.
  - Verified `pnpm.cmd --filter @dccc/companion build`: passed.
  - `@dccc/bridge` full build remains blocked by existing admin/db TypeScript
    issues unrelated to this route; re-check after schema/db package cleanup.
- 2026-05-27: Fixed `@dccc/bridge` TypeScript build (18 type errors resolved).
  Root cause: `packages/db/generated/client` did not exist (Prisma client
  was never generated in this repo clone). Without it, `getPrisma()` resolved
  to `any`, cascading implicit-any errors into every `.map()` callback that
  touched Phase B models. Fix: `pnpm db:generate`. No code changes required.
  `pnpm --filter @dccc/bridge build` exits 0.
- 2026-05-27: Wired `canManageSessions` in `/suite/capabilities` route.
  Route now reads `guildId` from `?guildId=` query param (companion already
  sends it), falls back to the optional JWT `guildId` claim, then calls
  `isAdmin({ guildId, userId })` against the `AdminUser` table. Returns
  `canManageSessions: true` for any user with an `AdminUser` row for that
  guild (both `admiral` and `vice_admiral` roles). `canUseRelay` and
  `canUseFleetTools` remain `false` pending their respective decisions.
  Build verified: `pnpm --filter @dccc/bridge build` exits 0.
  - Root cause: `packages/db/generated/client` did not exist (Prisma client
    was never generated in this repo clone). Without it, `getPrisma()` resolved
    to `any`, cascading implicit-any errors into every `.map()` callback that
    touched Phase B models (`AdminUser`, `AdminInviteLink`, `UserVoiceState`,
    `CompanionDownloadToken`) and producing one `{}` vs. `string` narrowing
    error at line 1370 of `admin/routes.ts`.
  - Fix: ran `pnpm db:generate` → Prisma client generated to
    `packages/db/generated/client`. No code changes required.
  - Verified: `pnpm --filter @dccc/bridge build` exits 0, no errors.
  - Note: `generated/client` is in `.gitignore`; every fresh clone needs
    `pnpm db:generate` before building. Added to the Queued-steps protocol.

## Open Decisions

- Package namespace: currently inherited as `@dccc/*`; recommended final
  namespace is `@rdoc-suite/*` or `@rdoc-sc/*`.
- Room model: support both persistent guild bridge rooms and invite-based
  session rooms, but keep one shared `RoomRegistry` implementation.
- Fleetplanner: defer until voice/session/relay consolidation is stable.
- Voice-to-All permission: not yet decided (Commander role vs. separate Discord role vs. admin-only).
- Session model: not yet decided (invite-based ops rooms vs. unified guild rooms with extra invite links).

## Decided

- **Admiral tools in Companion** (2026-05-27): `canManageSessions` is based on
  the existing RDCC `AdminUser` whitelist, guild-scoped. No separate API keys
  required for Companion Admiral tools. If a Discord user is in `AdminUser` for
  that guild, their session JWT will carry `canManageSessions: true` from the
  `/suite/capabilities` route.

## Queued / Planned Steps

- 2026-05-30: Step 12 — Full build/test/smoke verification and stable commit.
  Scope: build all workspace packages, run full bridge test suite, verify compose config,
  commit all merge work, tag stable milestone.
  Results:
  - `@dccc/shared` build: exit 0
  - `@dccc/bridge` build: exit 0
  - `@dccc/companion` build (tsc + vite): exit 0
  - `@rdoc-suite/relay-bots` build: exit 0
  - `@rdoc-suite/fleetplanner` build: exit 0
  - `pnpm --filter @dccc/bridge test`: 80/80 passed (6 test files)
  - `prisma migrate status`: 11 migrations, all applied
  - `docker compose -f docker-compose.prod.yml config`: valid (exit 0)
  - Commit: `f9984e9` — 64 files, 8068 insertions, 618 deletions
  All 12 merge steps complete.

- 2026-05-30: Step 11 — Update Docker Compose and deployment docs.
  Deliverables:
  - `docker-compose.prod.yml`: add `relay-bots` service (build context `apps/relay-bots`,
    image `rdoc-suite-relay-bots:latest`, port 8788 localhost-only, config.json mounted
    from `./relay-bots.config.json` on host). monitoring `depends_on` adds relay-bots.
  - `.env.example`: add `LIVEKIT_PROMETHEUS_URL` optional var (bridge → monitoring scrape).
  - `STAND.md` (new): deployment status snapshot — what's live, what needs operator action,
    open config decisions, relay-bots config.json setup instructions.
  - Note `Caddyfile` as orphan/alternative config: prod uses Traefik (see compose comments).

- 2026-05-30: Step 10 — Companion RTC/Admiral/Voice-to-All + import RDCC mobile-PWA additions.
  Part A — RDCC import (bridge):
  - Schema: `EphemeralChannel` model added (GC'd strategy voice channels). Migration `add_ephemeral_channel`.
  - Service: `apps/bridge/src/services/bridgeEvents.ts` copied — debounced guild-state event bus.
  - Service: `apps/bridge/src/services/strategyChannels.ts` copied — on-demand voice channel create + 15-min GC.
  - Discord API: `createGuildVoiceChannel` + `bulkModifyChannelPositions` added to `auth/discord.ts`.
  - Static files copied from RDCC: `admin.mobile.css`, `manifest.webmanifest`, `sw.js`, `pwa-icons/` (5 icons).
  - `views.ts`: `layout()` gets `viewport-fit=cover`, mobile CSS link, manifest link, PWA meta tags, SW registration.
    `renderRaidPlaner` gets Strategy-Channel button (was `renderCommandPanel` in RDCC; RDOC-Suite name kept).
  - `routes.ts`: `/admin` → `/admin/` trailing-slash redirect; `GET /admin/api/live-stream` SSE (replaces
    5 s polling, backed by `bridgeEvents`); `POST /admin/api/channels/reorder`; `POST /admin/api/strategy-channel`.
    `startStrategyChannelGc()` called on app boot.
  - `admin.js`: replaced with RDCC version (optimistic moves, tap-to-move, EventSource live-stream,
    mobile guild-switcher bottom-sheet, strategy-channel dialog, channel reorder); relay-bots form/metrics
    functions (Steps 7-8) re-inserted.
  Part B — Companion Step 10:
  - New `apps/companion/src/lib/sessionApi.ts` — `joinSession(bridgeUrl, bearerToken, inviteToken)` → POST /sessions/join.
  - New `apps/companion/src/components/SessionJoinModal.tsx` — invite token entry UI (commander joins session by paste/type).
  - New `apps/companion/src/lib/relayAudio.ts` — `RelayAudio`: fetches `/relay/token` (bearer), connects second LiveKit
    room, exposes `setPttActive(bool)` to mute/unmute relay audio.
  - `App.tsx`:
    - ADMIRAL button enabled → `openUrl(${bridgeUrl}/admin/sessions)` via tauri plugin-opener.
    - VOICE TO ALL button enabled → relay PTT via `RelayAudio`; status chip on connected panel.
    - `relayHotkey` registered via setupHotkey-like listener for relay PTT (hold to talk in relay room).
    - "JOIN SESSION" button in signed-in panel → `SessionJoinModal` → on confirm: `joinSession()` +
      `ws.connectSession()` + LiveKit connect with session token.
    - Session-aware status: when in session room, shows session label instead of guild name.
    - "LEAVE SESSION" action (back to guild room).
    - AppState gains `sessionMode`, `sessionId`, `sessionLabel`, `relayConnected`, `relayPttActive`.

- 2026-05-29: Step 9 — Extend shared WebSocket protocol.
  Deliverables:
  - Protocol (`packages/shared/src/protocol.ts`):
    - Add `pong` to `ServerMessage`: `{ type: "pong"; timestamp: number; serverTime: number }`
    - Add `roomMode: "guild" | "session"` + `sessionId?: string` to `bridge:joined`
  - Validation (`packages/shared/src/validation.ts`):
    - Add `pong` schema to `serverMessageSchema`
    - Add `roomMode`, `sessionId` fields to `bridgeJoinedSchema`
  - Bridge WS (`apps/bridge/src/signaling/ws.ts`):
    - `attachLifecycle`: handle `heartbeat` by sending `pong { timestamp, serverTime }` reply
    - Add `handleSessionCommander(socket, token, sessionId)`:
      - Verify JWT → userId
      - Verify `SessionInvite.findFirst({ sessionId, usedBy: userId })` exists
      - Verify `Session.status === "active"`
      - Issue `issueSessionLivekitToken(userId, sessionId)`
      - Join `RoomRegistry` under `session-{sessionId}`
      - Send `bridge:joined` with `roomMode: "session"`, `sessionId`, LiveKit creds
      - Recheck: session still active (no Discord role check)
    - `registerWsRoute`: dispatch to `handleSessionCommander` when `sessionId` query param present
  - Companion WS (`apps/companion/src/lib/ws.ts`):
    - Track `lastHeartbeatTimestamp` per send
    - Handle `pong` message: compute RTT, expose `rtt: number | null` property
    - Notify listeners on RTT update (reuse existing `message` listener path)
    - Add `connectSession(token, sessionId)` method alongside `connect(token, guildId)`
  - Tests: extend `ws.test.ts` with session WS path + pong response

- 2026-05-29: Step 8 — Merge monitoring and audit log.
  Deliverables:
  - Prisma: `AdminAuditLog` model added to `prisma/schema.prisma`.
    New migration `add_admin_audit_log`.
  - Service: `apps/bridge/src/services/audit.ts` —
    `appendAudit` (best-effort, never throws), `listRecentAudit(guildId, limit, offset)`,
    `countAudit(guildId)`. Guild-scoped (adds `guildId?` field vs. RDOC-RTC global model).
  - Service: `apps/bridge/src/services/monitoring.ts` —
    `monitoringSnapshot()` with uptime, active rooms/commanders/speaking, system
    memory/CPU, LiveKit bandwidth scrape (optional `LIVEKIT_PROMETHEUS_URL` env var).
  - rooms.ts: `globalMetrics()` added to `RoomRegistry` — returns per-room and
    aggregate stats for the monitoring page without exposing sockets.
  - Route: `apps/bridge/src/routes/prometheusMetrics.ts` — `GET /metrics`
    Prometheus text format; exports `dccc_rooms_active`, `dccc_commanders_active`,
    `dccc_commanders_speaking`. Registered in `app.ts`.
  - Env: `LIVEKIT_PROMETHEUS_URL` optional var added to `baseEnvSchema`.
  - Admin routes (additions to `registerAdminRoutes`):
      GET  /admin/monitoring              — HTML monitoring page
      GET  /admin/monitoring/snapshot     — JSON snapshot (for page AJAX)
      GET  /admin/audit                   — HTML audit page (admiral-only)
      GET  /admin/discord-voice           — HTML Discord voice page (completing step 7)
      GET  /admin/discord/voice-states    — JSON voice-state data for Discord Voice page
      GET  /admin/discord/roles           — JSON guild roles (filtered to commanderRoleIds)
      PATCH /admin/discord/members/:userId/channel  — move guild member
      PUT   /admin/discord/members/:userId/roles/:roleId — add role
      DELETE /admin/discord/members/:userId/roles/:roleId — remove role
  - `appendAudit` wired into: invite mint, invite revoke, admin remove,
    admin role change, session create, session end.
  - Views: `renderMonitoring`, `renderAudit`, `renderDiscordVoice` added to
    `apps/bridge/src/admin/views.ts`; `renderNav` active union extended with
    `"monitoring" | "audit" | "discord-voice"` and three new nav items.
  - prometheus.yml: relay-bots scrape job uncommented.

## Completed Steps (continued)

- 2026-05-27: Session lifecycle backend — Option A (invite-based ops rooms).
  Decision: Admiral mints single-use invite tokens; Commanders redeem them
  for LiveKit credentials. No WS for session rooms (yet — step 9).
  Deliverables:
  - Prisma: `Session` + `SessionInvite` models added to schema.
    Migration `20260527213109_add_session_models` created and applied.
  - Service: `apps/bridge/src/services/sessions.ts` —
    createSession, endSession, listActiveSessions, mintSessionInvite,
    consumeSessionInvite, listSessionInvites, revokeSessionInvite.
  - LiveKit: `issueSessionLivekitToken` + `deleteSessionRoom` added to
    `apps/bridge/src/services/livekit.ts`.
  - Routes: `apps/bridge/src/routes/sessions.ts` registered in app.ts.
    POST /sessions, GET /sessions, GET /sessions/:id, DELETE /sessions/:id,
    POST /sessions/:id/invites, GET /sessions/:id/invites,
    DELETE /sessions/:id/invites/:inviteId, POST /sessions/join.
    All gated by isAdmin except POST /sessions/join (bearer JWT only).
  - Tests: `apps/bridge/src/__tests__/sessions.test.ts` — 18 tests.
    All 73 bridge tests pass.
  - Side-fix: `apps/bridge/src/__tests__/setup.ts` sets DATABASE_URL to
    the absolute path of dev.db so tests run without a shell-level env var.
  Note: DATABASE_URL="file:./prisma/dev.db" resolves to prisma/prisma/dev.db
  (Prisma resolves relative to schema dir). Use "file:./dev.db" in future
  to keep db at prisma/dev.db.
- 2026-05-27: Admin pages for Sessions (step 4 of recommended order).
  RDCC-styled admin web UI for Admirals to manage invite-based ops sessions.
  Deliverables:
  - Views: `renderSessions` + `renderSessionDetail` added to
    `apps/bridge/src/admin/views.ts`. Follow exact RDCC pattern (template
    literals, `esc()`, `html` tag, `dateFmt()`, German strings, ALL-CAPS).
  - Nav: "SESSIONS" item added to `renderNav` between RAID PLANER and KONFIG.
    `active` union extended with `"sessions"`.
  - Routes (6) added to `apps/bridge/src/admin/routes.ts` inside
    `registerAdminRoutes`, gated by `requireAdminSession()`:
      GET  /admin/sessions             — sessions list + "New session" form
      POST /admin/sessions             — create session, redirect with toast
      GET  /admin/sessions/:id         — detail + invites + fresh-invite banner
      POST /admin/sessions/:id/end     — end session, redirect to list
      POST /admin/sessions/:id/invites — mint invite, redirect with ?fresh_*
      POST /admin/sessions/:id/invites/:inviteId/revoke — revoke, redirect
  - Added `application/x-www-form-urlencoded` content-type parser in
    `registerAdminRoutes` (native form POSTs, no new npm dependency).
  - Fresh-invite banner reuses `id="fresh-url"` + `id="copy-fresh"` so
    existing admin.js copy-button handler works without changes.
  - Imports: `createSession`, `endSession`, `getSession`, `listActiveSessions`,
    `mintSessionInvite`, `listSessionInvites`, `revokeSessionInvite` from
    sessions service; `renderSessions`, `renderSessionDetail` from views.
  - Build: `pnpm --filter @dccc/bridge build` exits 0.
  - Tests: all 73 tests pass (no new tests added for HTML pages).
- 2026-05-27: Step 5 — Relay token + relay-bots config backend routes.
  Deliverables:
  - Schema: `RelayBotsConfig` model added to `prisma/schema.prisma`.
    Migration `20260527215503_add_relay_bots_config` created and applied to
    both `prisma/dev.db` and `prisma/prisma/dev.db`.
  - Env: 7 optional relay env vars added to `baseEnvSchema` in
    `apps/bridge/src/config/env.ts` and documented in `.env.example`:
    RELAY_GUILD_ID, RELAY_REQUIRED_ROLE_ID, RELAY_DISCORD_BOT_TOKEN,
    RELAY_LIVEKIT_ROOM (default "voice-relay"), RELAY_BOTS_ADMIN_URL,
    RELAY_BOTS_SECRET, RELAY_BOTS_ADMIN_SECRET.
  - Service: `apps/bridge/src/services/relayBotsConfig.ts` —
    getRelayBotsConfig, setRelayBotsConfig, getRelayLivekitCredentials,
    getRelayRoomName, notifyRelayBotsReload.
  - LiveKit: `issueRelayToken` added to `apps/bridge/src/services/livekit.ts`.
    Uses DB credentials with env fallback; publisher/subscriber grant split.
  - Routes: `apps/bridge/src/routes/relay.ts` registered in app.ts.
    GET /relay/token — bearer JWT auth; optional Discord role check for
    publisher; guildId from ?guildId= param or config or RELAY_GUILD_ID env.
  - Routes: `apps/bridge/src/routes/relayBots.ts` registered in app.ts.
    GET  /admin/relay-bots/config       — read config (cookie auth; tokens redacted for vice admiral)
    POST /admin/relay-bots/config       — write config + notify bots service
    GET  /admin/relay-bots/metrics      — proxy from RELAY_BOTS_ADMIN_URL/api/metrics
    POST /admin/relay-bots/restart      — proxy to RELAY_BOTS_ADMIN_URL/api/restart
    GET  /relay-bots/service-config     — relay bots service fetches config (Bearer RELAY_BOTS_SECRET)
  - Build: `pnpm --filter @dccc/bridge build` exits 0.
  - Tests: all 73 tests pass.
- 2026-05-28: Step 6 — `RDOC/RDOC-VoiceRelayBots` imported as `apps/relay-bots`.
  Package name: `@rdoc-suite/relay-bots`. Already covered by `pnpm-workspace.yaml`
  (`apps/*`). Source files copied verbatim from RDOC-VoiceRelayBots HEAD
  `1d32ceeb`; no code changes to the service itself.
  Deliverables:
  - `apps/relay-bots/package.json` — name `@rdoc-suite/relay-bots`, same deps
  - `apps/relay-bots/tsconfig.json` — NodeNext module, strict, same settings
  - `apps/relay-bots/Dockerfile` — pnpm-based multi-stage build (replaced npm)
  - `apps/relay-bots/config.example.json` — bridge URL updated to
    `https://suite.raumdock.org` (was `/dccc` path prefix)
  - `apps/relay-bots/src/` — config.ts, metrics.ts, index.ts, discord/bot.ts,
    discord/botManager.ts, livekit/subscriber.ts, web/adminServer.ts
  - `apps/relay-bots/.gitignore`
  Note: `@discordjs/opus` native addon requires `pnpm approve-builds` for the
  build script to run. This is a deploy-time concern; TypeScript build passes
  without it (`pnpm --filter @rdoc-suite/relay-bots build` exits 0).
  All 73 bridge tests still pass.
- 2026-05-28: Step 7 — RDCC-styled Relay Bots admin page.
  Deliverables:
  - Views: `renderRelayBots` + `RelayBotsPageData` added to
    `apps/bridge/src/admin/views.ts`. Config form (LiveKit URL/room/key/secret,
    guild ID, dynamic bot list with name/channelId/token) + live metrics section
    (`#relay-metrics-global`, `#relay-metrics-bots`).
    Bot token inputs disabled for vice admirals; `data-can-see-tokens` attribute
    on the card communicates role to admin.js without a second template variable.
  - Nav: "RELAY BOTS" item added to `renderNav` between SESSIONS and KONFIG.
    `active` union already included `"relay-bots"` (added in step 6 prep).
  - Route: `GET /admin/relay-bots` added to `apps/bridge/src/admin/routes.ts`.
    Calls `getRelayBotsConfig()` + `getAdminNavGuilds()`; sets `canSeeTokens`
    from session role; renders `renderRelayBots`.
    Import: `renderRelayBots` from views, `getRelayBotsConfig` from service.
  - JS: `wireRelayBotsForm()` + `wireRelayBotsMetrics()` added to
    `apps/bridge/src/admin/static/admin.js` and called from `boot()`.
    - Form: seeds bot array from server-rendered rows; add/remove bots client-
      side with re-render; Save → JSON POST to `${NAV}/relay-bots/config` →
      redirect with `?saved=1`; Restart → POST `${NAV}/relay-bots/restart`.
    - Metrics: 3-second poll of `${NAV}/relay-bots/metrics`; renders global
      uptime/frames/audio/watchdog chips in `#relay-metrics-global`;
      per-bot name/state/buffer-bar rows in `#relay-metrics-bots`.
      Gracefully shows "OFFLINE" when service is unreachable.
  - TypeScript: `tsc --noEmit` exits 0. All 73 bridge tests pass.
- 2026-05-30: Step 9 — Extend shared WebSocket protocol.
  Deliverables:
  - Protocol (`packages/shared/src/protocol.ts`):
    - `bridge:joined` gains `roomMode: "guild" | "session"` + `sessionId?: string`
    - New `pong` server message: `{ type: "pong"; timestamp: number; serverTime: number }`
  - Validation (`packages/shared/src/validation.ts`):
    - `bridgeJoinedSchema` updated with `roomMode` + `sessionId`
    - `pongSchema` added to `serverMessageSchema`
  - Bridge WS (`apps/bridge/src/signaling/ws.ts`):
    - `attachLifecycle`: `heartbeat` case now sends application-level `pong` reply
    - `handleOAuthCommander`: sends `roomMode: "guild"` in `bridge:joined`
    - New `handleSessionCommander(socket, token, sessionId)`:
      - Verifies JWT → userId
      - Checks `SessionInvite.findFirst({ sessionId, usedBy: userId })` → 4403 if absent
      - Checks `Session.status === "active"` → 4403 if ended/missing
      - Issues `issueSessionLivekitToken({ userId, livekitRoom: session.livekitRoom })`
      - Joins `RoomRegistry` under `session-{sessionId}`
      - Sends `bridge:joined` with `roomMode: "session"`, `sessionId`, LiveKit creds
      - Recheck: session still active (no Discord role check)
    - `registerWsRoute`: dispatches to `handleSessionCommander` when `?sessionId=` present
  - Companion WS (`apps/companion/src/lib/ws.ts`):
    - `teardownSocket()` helper extracted (was inline in `connect()`)
    - New `connectSession(token, sessionId)` method for session-room WS
    - `openSocket()` handles `guildId` vs `sessionId` routing, closes on 4403
    - `lastHeartbeatTimestamp` tracked; `rtt: number | null` property updated on `pong`
  - Tests (`apps/bridge/src/__tests__/ws.test.ts`): 7 new tests
    - pong reply to heartbeat
    - `bridge:joined` includes `roomMode: "guild"` for guild path
    - Session path: rejects invalid token (4401)
    - Session path: rejects non-member (4403)
    - Session path: rejects ended session (4403)
    - Session path: sends `bridge:joined` with `roomMode: "session"` + creds
    - Session path: ptt:start broadcasts commander:list
  - Build: `@dccc/shared`, `@dccc/bridge`, `@dccc/companion` all exit 0.
    All 80 bridge tests pass.
- 2026-05-30: Step 10 — Companion RTC/Admiral/Voice-to-All + RDCC mobile-PWA import.
  Part A — RDCC import (bridge):
  - Schema: `EphemeralChannel` model. Migration `20260529221549_add_ephemeral_channel`.
  - Service: `bridgeEvents.ts` (debounced guild-state event bus).
  - Service: `strategyChannels.ts` (on-demand voice channel + 15-min GC).
    `startStrategyChannelGc()` called from `app.ts` at boot.
  - Discord API: `createGuildVoiceChannel`, `bulkModifyChannelPositions`, `deleteChannel`
    added to `auth/discord.ts`.
  - Static files copied: `admin.mobile.css`, `manifest.webmanifest`, `sw.js`, `pwa-icons/`.
  - `views.ts`: PWA meta tags + mobile CSS link + SW registration in `layout()`;
    strategy-channel button in `renderRaidPlaner` channel-mirror header.
  - `routes.ts`: `/admin` redirect; SSE live-stream `GET /admin/api/live-stream`;
    `POST /admin/api/channels/reorder`; `POST /admin/api/strategy-channel`.
  - `admin.js`: replaced with RDCC version (optimistic moves, tap-to-move, EventSource,
    mobile guild-switcher bottom-sheet, strategy-channel, channel reorder) + relay-bots
    form/metrics (Steps 7-8) re-inserted.
  Part B — Companion Step 10:
  - New `src/lib/sessionApi.ts` — `joinSession()` → POST /sessions/join (bearer auth).
  - New `src/components/SessionJoinModal.tsx` — invite token entry UI.
  - New `src/lib/relayAudio.ts` — `RelayAudio`: fetches /relay/token, wraps second
    LivekitAudio, exposes `setPttActive(bool)` + status listener.
  - `App.tsx`:
    - ADMIRAL button → `openUrl(bridgeUrl/admin/sessions)` via tauri plugin-opener.
    - SESSION button → SessionJoinModal → `ws.connectSession()` + LiveKit on join.
    - SESSION VERLASSEN button when in session → disconnect + reconnect guild WS.
    - VOICE TO ALL button + relayHotkey → relay PTT via RelayAudio.
    - Status strip shows session label when in session mode.
    - AppState: `sessionId`, `sessionLabel`, `relayStatus`, `relayPttActive`.
  - Build: `@dccc/bridge`, `@dccc/companion` exit 0. All 80 bridge tests pass.
- 2026-05-30: Step 11 — Update Docker Compose and deployment docs.
  Deliverables:
  - `docker-compose.prod.yml`: `relay-bots` service added (build context `apps/relay-bots`,
    image `rdoc-suite-relay-bots:latest`, port 127.0.0.1:8788:8788, config.json mounted from
    `./relay-bots.config.json` on host). `monitoring` depends_on now includes `relay-bots`.
  - `.env.example`: `LIVEKIT_PROMETHEUS_URL` optional var documented.
  - `STAND.md` created: deployment topology, all services + status, Traefik/Caddyfile note,
    relay-bots.config.json setup instructions, build/deploy commands, open decisions.
- 2026-05-29: Step 8 — Merge monitoring and audit log.
  Deliverables:
  - Prisma: `AdminAuditLog` model added to `prisma/schema.prisma`.
    Migration `20260529214305_add_admin_audit_log` created and applied.
    Fields: id, guildId?, actorUserId?, actorLabel?, action, target?,
    metadata (JSON string, default "{}"), createdAt. Index on (guildId, createdAt).
  - Service: `apps/bridge/src/services/audit.ts` —
    `appendAudit` (best-effort, never throws), `listRecentAudit(guildId, limit, offset)`,
    `countAudit(guildId)`. Guild-scoped vs. RDOC-RTC's global model.
  - Service: `apps/bridge/src/services/monitoring.ts` —
    `monitoringSnapshot()` with uptime, active rooms/commanders/speaking, system
    memory/CPU, LiveKit bandwidth scrape (optional `LIVEKIT_PROMETHEUS_URL` env var).
  - rooms.ts: `globalMetrics()` added to `RoomRegistry` — returns per-room and
    aggregate stats without exposing sockets.
  - Route: `apps/bridge/src/routes/prometheusMetrics.ts` — `GET /metrics`
    Prometheus text format; exports `dccc_rooms_active`, `dccc_commanders_active`,
    `dccc_commanders_speaking`. Registered in `app.ts` before admin routes.
  - Env: `LIVEKIT_PROMETHEUS_URL` optional var added to `baseEnvSchema` in
    `apps/bridge/src/config/env.ts`.
  - Admin routes added to `registerAdminRoutes`:
      GET  /admin/monitoring              — HTML monitoring page
      GET  /admin/monitoring/snapshot     — JSON snapshot (30s poll by page JS)
      GET  /admin/audit                   — HTML audit log (admiral-only; 403 for vice_admiral)
      GET  /admin/discord-voice           — HTML Discord voice page (completing step 7)
      GET  /admin/discord/voice-states    — JSON voice-state data (15s poll by page JS)
      GET  /admin/discord/roles           — JSON guild roles
      PATCH /admin/discord/members/:userId/channel  — move guild member + audit
      PUT   /admin/discord/members/:userId/roles/:roleId — add role + audit
      DELETE /admin/discord/members/:userId/roles/:roleId — remove role + audit
  - `appendAudit` wired into 5 existing handlers: invite revoke, admin remove,
    admin role change, session create, session end.
  - Views: `renderMonitoring`, `renderAudit`, `renderDiscordVoice` added to
    `apps/bridge/src/admin/views.ts`. Nav extended with "DISCORD VOICE",
    "MONITORING", "AUDIT" items; `renderNav` active union extended with
    `"monitoring" | "audit" | "discord-voice"`.
  - prometheus.yml: relay-bots scrape job uncommented (was gated on step 11,
    moved to active now that relay-bots is imported).
  - Build: `pnpm --filter @dccc/bridge build` exits 0. All 73 tests pass.
---

## Queued — Post-merge review fixes (2026-05-30)

External code review of committed merge (07d0ac4) found bugs. Fixing in one pass:

- **#1 (High)** Voice-channel enforcement fallback missing. `internal.ts` docstring
  claims the 60s recheck loop catches voice-channel drift, but the `attachLifecycle`
  recheck in `ws.ts` only calls `recheckCommanderRole` (role only). Add
  `checkAllowedVoiceChannel` to the loop so a user who leaves an allowed channel
  loses audio even if the bot's internal push is unavailable.
- **#2 (Med)** `ptt:start` accepted regardless of audio-enabled state. Bridge will
  reject ptt:start when the socket is not currently audio-enabled, so a client
  cannot broadcast TALKING after `audio:disable`.
- **#3 (Med)** Shared test drift: `validation.test.ts` bridge:joined fixture missing
  required `roomMode` → `@dccc/shared` test fails. Add `roomMode`.
- **#4 (Med)** `registerUnit` creates fleetUnit before validating ship / creating
  seats → orphan unit on failure. Validate ship + compute specs first, then create
  unit + seats + captain assignment in one `$transaction`.
- **#5 (Med)** `claimSeat` check-then-update race. Wrap in `$transaction` with a
  conditional `updateMany` (where userId null) + re-check single-seat-per-op.
- **#6 (Med)** Relay subscriber tokens unprotected. `GET /relay/token?role=subscriber`
  required only a valid companion JWT; doc claimed a shared secret. Require
  `RELAY_BOTS_SECRET` bearer for subscriber role; companion JWT path = publisher only.
- **#7 (Med)** Updater token in request body + wildcard CORS. Move to Authorization
  bearer; restrict CORS to known origins.
- **#8 (Low)** Companion download tokens stored plaintext. Store SHA-256 hash, compare
  on redeem.
- **#9 (Low)** ESLint config: add browser/service-worker globals for static JS, ignore
  generated/static assets. Fix real unused-var findings.
- **Cosmetic** Fix mojibake in README + oauth.ts strings; self-host fleetplanner fonts;
  fleetplanner dev cookie `secure` conditional on NODE_ENV.

## Completed — Post-merge review fixes (2026-05-30)

All 11 review findings fixed. `pnpm build` ✓, `pnpm lint` ✓ (188 → 0 errors),
`pnpm test` ✓ (shared 13, bridge 87 — was 80, +7 new). Companion + fleetplanner
tsc/vite build ✓.

- **#1** `apps/bridge/src/signaling/ws.ts` — guild-path recheck loop now also runs
  `checkAllowedVoiceChannel` and reconciles the audio grant (pushAudioDisable /
  pushAudioEnable) so voice-channel drift is caught even if the bot's
  `/internal/voice-state-changed` push is unavailable.
- **#2** Audio gating made server-authoritative. `rooms.ts` tracks per-socket
  `audioEnabled`; `pushAudioEnable`/`pushAudioDisable` and both join paths set it;
  `ptt:start` now rejects with `audio_not_enabled` when audio isn't granted.
  Regression test added.
- **#3** `packages/shared/src/__tests__/validation.test.ts` — bridge:joined fixture
  gained `roomMode: "guild"`. Shared tests pass.
- **#4** `apps/fleetplanner/src/services/units.ts` — `registerUnit` validates ship +
  computes seat specs before any write, then creates unit + seats + captain
  assignment inside one `$transaction` (no orphan units).
- **#5** `claimSeat` wrapped in a `$transaction` with a conditional
  `updateMany(where userId:null)` — race-safe seat claiming.
- **#6** `apps/bridge/src/routes/relay.ts` — `role=subscriber` now requires the
  `RELAY_BOTS_SECRET` bearer (constant-time compare); companion JWT path is
  publisher-only. No HTTP consumer used subscriber (relay-bots mints its own token),
  so nothing breaks. 6 relay tests added (`relay.test.ts`).
- **#7** `apps/bridge/src/routes/updater.ts` + `apps/companion/src/lib/updater.ts` —
  token moved to `Authorization: Bearer` header (query/body kept as fallback for
  older EXEs); CORS echoes the request Origin instead of `*` and allows the
  `authorization` header.
- **#8** `apps/bridge/src/services/companionDownloads.ts` — raw download tokens are
  no longer persisted (only sha256). A DB read can't recover live links. Admin
  re-copy after mint is gone (re-mint instead).
- **#9** `eslint.config.mjs` — browser + service-worker globals for
  `apps/bridge/src/admin/static/**/*.js`; `_`-prefix ignore + `caughtErrors:none` +
  `allowEmptyCatch` for that vendored JS. Fixed 5 real unused-var/`prefer-const`
  findings in `views.ts`, `auth.ts`, `web.ts`, `routes.ts`, `livekit.ts`.
- **Cosmetic** Fixed mojibake `fÃ¼r`→`für` in `SettingsModal.tsx`; dropped the
  Google-Fonts `@import` from fleetplanner `render.ts` (system-font fallbacks already
  present); fleetplanner session cookie `secure` now gated on
  `NODE_ENV==="production"` so local HTTP dev login works.
  (README mojibake reported by the reviewer was a false positive — files are clean UTF-8.)

---

## Queued — Fleetplanner finalize (2026-05-30)

User directive "finalize my fleetmanager". Scope:

1. **DB → Postgres** (from SQLite). New `postgres` service in docker-compose.prod.yml,
   `DATABASE_URL` switched, fresh PG baseline migration (old SQLite migration dropped),
   `.env.example` + STAND.md updated. Assumption: fresh DB (ships re-sync; old SQLite
   ops/users not migrated).
2. **Ship catalog cache + weekly refresh**: ships fetched from SC wiki are cached
   (already are); add a configurable auto-refresh (default weekly) + manual admin
   trigger. New `ShipSyncState` singleton (intervalDays, lastRunAt, running, enabled,
   shipCount). Scheduler in boot; full-catalog paginated sync.
3. **Feature audit**: confirm seat-claim, captain-adds-ship-with-crew-count,
   admiral-creates-op→discord-event all work end-to-end; fix gaps.
   Found gaps: backgroundSync never scheduled; Discord event id never stored
   (re-open duplicates events, can't delete on cancel) → add `Operation.discordEventId`.
4. **Admin GUI**: ship-sync panel (status, interval, "Sync now"); general GUI polish.
