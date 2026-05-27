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

## Open Decisions

- Package namespace: currently inherited as `@dccc/*`; recommended final
  namespace is `@rdoc-suite/*` or `@rdoc-sc/*`.
- Admin role model: recommended to keep RDCC guild-scoped admins and extend
  them with active/login/API-key fields from RDOC-RTC.
- Room model: support both persistent guild bridge rooms and invite-based
  session rooms, but keep one shared `RoomRegistry` implementation.
- Fleetplanner: defer until voice/session/relay consolidation is stable.
