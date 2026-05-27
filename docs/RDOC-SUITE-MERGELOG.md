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

## Completed Steps

- 2026-05-27: Created fresh Git repository `RDOC-Suite` from RDCC shell.
  Commit: `5045813`.

## Open Decisions

- Package namespace: currently inherited as `@dccc/*`; recommended final
  namespace is `@rdoc-suite/*` or `@rdoc-sc/*`.
- Admin role model: recommended to keep RDCC guild-scoped admins and extend
  them with active/login/API-key fields from RDOC-RTC.
- Room model: support both persistent guild bridge rooms and invite-based
  session rooms, but keep one shared `RoomRegistry` implementation.
- Fleetplanner: defer until voice/session/relay consolidation is stable.
