# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — Companion: Command Net flapping one-way audio (Discord-voice gate hysteresis) (2026-06-05)

- Commander Net audio dropped intermittently ("whoever joined last is heard, others not"; speaking indicator flickering; one side mutes mid-talk). Root cause: the 5s mission poll tore the commander LiveKit room down on a *single* `discordVoice.ok=false` poll, and the backend gate derives from the Bot's flaky/stale Discord voice-state. Members sitting in their own per-unit relaybot channels (the normal in_progress state) flapped the gate and churned the room.
- Companion now applies `COMMANDER_GATE_GRACE_MS` (20s) hysteresis: the commander room + PTT-1 transmit stay alive for 20s after the last genuine gate pass, so a transient blip no longer drops audio. Grace only starts after the first real pass (a user who never qualifies gets none); a real channel-leave (>20s) still drops. Global Radio / relay path unchanged. Companion 0.5.19 → 0.5.20.
- Follow-up (separate): harden the server-side voice-state source (Bot logged 0 `voiceStateUpdate` events — GuildVoiceStates intent / stale `UserVoiceState`).

### Removed — Bridge: native Admin operation pages (Dashboard / Raid Planer / Konfig) (2026-06-02)

- Native Bridge Admin operation UI is removed now that Fleetplanner covers it: `GET /admin/` Dashboard (→ redirects to `/admin/sessions`), `GET /admin/raid-planer`, `GET /admin/config` + `POST /admin/api/config`, and the dashboard live feeds `GET /admin/api/live` and `GET /admin/api/live-stream`. Dashboard/Raid Planer/Konfig nav links removed in all modes.
- The native Bridge Admin UI is now **diagnostics-only** (Sessions, Relay Bots, Monitoring, Audit, Discord Voice, Admins) plus auth. All backend routes (`/internal/fleet/*`, `/sessions/*`, `/download/*`, `/updater/*`, relay, WS) are unaffected; the `strategyChannels` service + GC stay (used by the Fleetplanner M2M endpoints).

### Added — Fleetmanager: Raid-Planer parity (channel reorder + strategy channels) (2026-06-02)

- **Bridge `/internal/fleet/*` M2M API** gains two endpoints: `POST .../discord/channels/reorder` (reorder allowed voice channels, mirroring the native `/admin/api/channels/reorder` allowed-list validation + position mapping) and `POST .../discord/strategy-channel` (create a temporary voice channel and pull selected members in, auto-GC'd after 15 min idle). Both reuse the existing bridge services unchanged.
- **Fleetplanner Discord Voice panel** (`/admin/bridge/:guildId/discord-voice`) now offers channel reorder (▲/▼ controls over allowed channels) and a strategy-channel form (name + member checkboxes), superadmin-gated with CSRF like the existing move/role actions. This closes the last gap before native Bridge Admin Raid Planer can be removed.

### Changed - Fleetmanager: Bridge Admin legacy control plane (2026-06-02)

- Fleetplanner is documented as the primary UI for normal Mission Voice and operation control, while Bridge remains the backend control plane for Discord, LiveKit, relay bots, sessions, downloads, updater, audit, monitoring, and internal APIs.
- Bridge native Admin UI can now be gated with `BRIDGE_ADMIN_UI_MODE=full|legacy|disabled`; `disabled` skips only `/admin/*` UI registration and leaves Fleetplanner/Companion backend routes active.
- Bridge native Admin legacy mode now removes Dashboard, Raid Planer, and Konfig from the primary navigation while keeping diagnostic and Bridge Mode pages reachable.
- Companion Admiral session management now opens Fleetplanner Bridge Sessions when `fleetplannerUrl` and `guildId` are known, with the old Bridge Admin sessions URL kept only as fallback.

### Changed - Fleetmanager: Mission Voice Companion enforcement (2026-06-02)

- Mission voice links are now operation-bound and use the HTTPS `/companion/mission?token=...` wrapper, with `/companion/download` as the stable Fleetmanager download entry point for GitHub Actions-built Companion installers.
- Mission start DMs now target accepted Unit Captains, Operation Leaders/FleetCommanders, and Commanders-tab users, with a clickable configuration link plus raw `rdoc://mission?...` fallback.
- Companion mission polling now receives Discord voice presence state, disconnects LiveKit, and disables Commander/Relay PTT when the user leaves the advised Discord voice channel.
- Fleetmanager prevents duplicate squad names, blocks unit/squad structure changes after mission start, cleans up mission voice on operation delete, and exposes pull-crew voice controls in the new UI.
- Relay Discord channel names now come from the assigned unit/squad while RelayBot display names stay on their configured bot labels.

### Removed — Dead-code cleanup: Fleet-Auth, captainRoleId, eventChannelId (2026-06-02)

- **Companion: removed dead Fleetplanner OAuth flow.** `src/lib/fleetplannerAuth.ts`, `src/components/FleetVoiceModal.tsx`, and the Rust `start_fleet_oauth_webview` Tauri command are deleted. The `dccc://fleet-auth` companion login was replaced by the mission-link system in the Companion overhaul but the backend and Rust shims were never cleaned up.
- **Fleetplanner: removed dead companion OAuth routes.** `GET /auth/discord/companion/start`, `GET /auth/discord/companion/callback`, and `GET /companion/configure` are removed from `apps/fleetplanner/src/routes/auth.ts`. These generated `dccc://fleet-auth?token=…` deep links that the current Companion ignores (it only processes URLs with both `token` and `url` params).
- **Fleetplanner: fixed unit-accept DM.** On unit accept, the server was creating a full-scope `CompanionSession` and sending the captain a `companion/configure` link — a dead link that the Companion silently dropped. Removed `createCompanionSession` call + `companionConfigUrl` from the accept flow; DM now fires without the dead link. `createCompanionSession` / `loadCompanionSession` (full-scope) and `FULL_TTL_MS` removed from `companionSession.ts`.
- **Fleetplanner: removed `captainRoleId` guild setting.** The `captain` GuildRole gated no route guard in the codebase (all guards are `crew` or `fleetoperator`). The Discord role was only a visual badge on unit-accept; `commanderVoiceRoleId` + the voice session system now handle all Discord role lifecycle. Removed: `Guild.captainRoleId` (schema + migration `20260602020000_guild_remove_captain_role_id`), `assignCaptainDiscordRole`, `removeCaptainDiscordRoles`, `configuredCaptainRoleIds`, `CaptainDiscordRole` type, `captainsWhoseEventRolesCanBeRemoved`, and Commander/Admiral buttons in the fleet panel UI. Env vars `DISCORD_COMMANDER_ROLE_ID` and `DISCORD_ADMIRAL_ROLE_ID` removed.
- **Fleetplanner: removed `eventChannelId` guild setting.** The guild-level default Discord event voice channel is superseded by the per-op `eventVoiceChannelId` selector (already implemented on the op create/edit forms). Removed from schema (migration `20260602010000_guild_remove_event_channel_id`), guild settings form, and Discord service. Env var `DISCORD_EVENT_CHANNEL_ID` removed.

### Changed — Guild settings: Mission Voice panel (2026-06-02)

- `commanderVoiceRoleId` and `globalVoiceRoleId` moved out of the generic "Discord integration" form into a dedicated **"Mission Voice — Companion & Relay"** section in guild settings. Panel is only rendered when `voiceEnabled = true`, making it clear these fields are voice-feature-specific and irrelevant until RDOC Voice Permission is granted.

### Added — Bridge + Fleetplanner: DB-backed Raumdock role gates (2026-06-01)

- **`GlobalSettings` singleton in bridge SQLite.** New model `GlobalSettings` (id `"global"`, `raumdockGuildId?`, `bridgeRequiredRoleId?`, `relayRequiredRoleId?`) stores cross-guild access gates.
- **Bridge access gate:** when `bridgeRequiredRoleId` and `raumdockGuildId` are configured, the OAuth callback fetches the user's Raumdock guild member roles and rejects non-members with `403 missing_bridge_role` before any tenant-level check.
- **Relay gate:** `RELAY_REQUIRED_ROLE_ID` env var replaced by `GlobalSettings.relayRequiredRoleId`, checked against the Raumdock guild. The env var is no longer read.
- **Fleetplanner superadmin UI:** "Global / Bridge Settings" page at `/fleetplanner/admin/bridge` — form gated to the `protected` (bootstrap) admiral only. Fields: `raumdockGuildId`, `bridgeRequiredRoleId`, `relayRequiredRoleId`.
- Bridge exposes `GET|POST /internal/fleet/global-settings` (M2M, Bearer `BRIDGE_FLEET_SECRET`).

### Fixed — Companion: Mission voice lifecycle (builds 0.5.4–0.5.6, 2026-06-02)

- **Mission close kicks instead of switching (build 0.5.5).** `missionOpIdRef` now pins the `opId` on the first successful poll. If the poll returns `op: null` or a different `opId`, the mission ends and the Companion returns to bridge mode — no silent switch to the "next active op". `missionOpIdRef` is reset on `onMissionDisconnect`.
- **Mission-mode shows wrong roster (build 0.5.6).** In mission mode the bridge-connected pane (showing `activeCommanders`) was rendering in parallel with the mission panel. The bridge pane is now hidden when `missionOwnsLocal` (`missionActive && missionHasCommander`). Participant count for the mission commander room is surfaced via `FleetAudio.participantsChanged` → `commanderParticipants` app state and shown in `MissionVoicePanel` as "N im Kanal".
- **Self excluded from mission presence count (build 0.5.6+).** `FleetAudio` now counts only remote participants (`room.numParticipants` excludes the local participant). Previously the count was off by one.

### Added — Companion: Voice routing strip (build 0.5.4, 2026-06-02)

- New FUNK strip below the status bar shows the connected room and speaking target for both PTTs at a glance. LOKAL lane: commander room (mission) or session/guild-bridge; GLOBAL lane: Discord relay. Colour: green = actively sending, cyan = connected, dim = disconnected. Hotkey label shown per lane. Derived from existing state (`missionOwnsLocal`, `localRoomLabel`, relay status) — no new protocol messages.

### Changed — Fleetplanner: Mission Commander rules + DM + Global Voice (2026-06-01)

- **Squad captains are now automatic mission commanders; ship captains are not.** `listMissionCommanders` and `isMissionCommander` in `services/missionCommanders.ts` check for `unitType = "squad"`. Ship-unit captains can be added manually as `MissionVoiceParticipant` by a fleetoperator.
- **Global Voice per commander.** New `MissionVoiceParticipant.globalVoice` boolean (migration `20260602003000_mission_voice_global_voice`). Toggled via the Commanders tab; when a voice session is live the Discord `globalVoiceRoleId` is granted/revoked immediately.
- **Mission start DM.** When op transitions to `in_progress`, each mission commander receives a Discord DM with: (a) download link if `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` is set, (b) personal `rdoc://mission?token=…&url=…` Companion link.
- **New `missionCommanders.ts` service** extracted from `api.ts` — `listMissionCommanders`, `isMissionCommander`, `missionVoiceAccessUsers`.

### Added — Fleetplanner: Commanders tab + mission metrics (2026-06-01)

- **Commanders tab** on the op detail page — lists accepted squad captains and manually-added `MissionVoiceParticipant` entries, with add/remove controls and per-commander Global Voice toggle.
- **Mission overview metrics** — ship count, FPS squad count, total seat count, filled/open breakdown shown in the op overview header.
- **Copy button** on each mission voice link in the voice links panel.

### Changed — Companion: Mission-First 2-PTT Architecture (build 0.5.3, 2026-05-31)

Major architectural simplification. The old multi-mode companion (Bridge-PTT + Fleet-Voice-PTT + Fleet-Voice-Global + up to 4 hotkeys, 3 auth flows) is replaced by a focused 2-PTT design.

- **Two hotkeys only.** `localHotkey` (default Mouse4) and `globalHotkey` (default R). Old `hotkey` and `relayHotkey` store keys migrated on load.
- **PTT-LOCAL is context-dependent.** Without active mission → guild Bridge room (Squad Link, unchanged). With active mission + commander room → mission `commanderRoom` LiveKit room. Bridge WS + guild roster stay connected in mission mode; only the audio send-target switches.
- **PTT-GLOBAL is always Discord relay.** Connects as soon as `canUseRelay` is granted — independent of mission state.
- **Mission-link flow replaces Fleetplanner OAuth.** Separate Fleetplanner Discord login removed entirely. Entry point is `rdoc://mission?token=…&url=…` (deep link from Discord DM / op page). Legacy `dccc://fleet-voice?token=…` accepted during transition. App polls `GET /api/companion/mission-voice` (30s interval) to track op state.
- **`missionOwnsLocalRef` transition guard** prevents double-connect/double-disconnect churn when the bridge:joined event fires while mission mode is active.
- Old `/api/companion/voice` (20s polling, unit rooms + global LiveKit floor) removed from Fleetplanner.
- Settings simplified: 2 hotkey fields instead of 4; Fleetplanner-Auth section removed from SettingsModal.
- `docs/companion-app-opus.md` added — full architecture reference for the new design.

### Added — RDOC Squad Link app icon (build 125, 2026-05-27)

- Companion EXE now ships with the real RDOC Squad Link brand mark (gold/silver astronaut helmet over "SL" wordmark, transparent background) instead of the 89-byte placeholder. Affects the EXE icon (taskbar, desktop shortcut, Alt-Tab) and the main window title-bar icon. Source PNG kept at `apps/companion/src-tauri/icons/squadlink.png` — re-run `pnpm tauri icon icons/squadlink.png` to regenerate the icon set after any brand update.

### Fixed — Keyboard PTT auto-repeat debounce (build 123, 2026-05-27)

- **Keyboard PTT no longer re-fires the local "click" sound while held.** Win32 Raw Input delivers a `WM_INPUT` for every Windows auto-repeat tick (~30/s) with `RI_KEY_BREAK` unset, so the previous dispatcher emitted "pressed" on every repeat — replaying the synthesized radio-static cue continuously while the hotkey was held. Mouse hotkeys (Mouse4/Mouse5) were unaffected because mouse buttons have no OS auto-repeat. The window-focused fallback path was also unaffected (`KeyboardEvent.repeat` filtered out).
- Added a `hotkey_down: bool` guard in [apps/companion/src-tauri/src/lib.rs](apps/companion/src-tauri/src/lib.rs)'s `handle_raw_key`: "pressed" only fires on the rising edge (first Down after the last Up), "released" only fires when a matching "pressed" had been observed. WS state + mute toggles were already idempotent, so the only user-visible delta is the audio cue firing once per press instead of once per repeat tick.

### Added

- **Voice-channel enforcement** — the bridge now rejects commanders whose current Discord voice channel is not in `GuildConfig.allowedVoiceChannelIds` (configured via `/cc channel add`). Check runs both at WebSocket connect time and in the existing 60-second permission-recheck loop, so a commander who leaves the allowed channel mid-session is kicked within 60 s with WS close code `4403`. Empty list = no restriction (backwards-compatible with deployments that never set `/cc channel add`).
- New error codes on the WS `error` payload: `outside_allowed_voice_channel`, `not_in_voice`.
- Bot now uses the `GuildVoiceStates` intent (non-privileged — no Discord Developer Portal toggle needed) and persists every `voiceStateUpdate` into a new `UserVoiceState` Prisma table. On `ClientReady` it backfills `guild.voiceStates.cache` for every guild, so commanders who were in voice before the bot started are recognized immediately.
- New Prisma model `UserVoiceState` with composite primary key `(guildId, userId)` and index on `(guildId, channelId)`. Migration `20260523195614_add_user_voice_state`.
- New service function `checkAllowedVoiceChannel({userId, guildId, allowedIds})` in `apps/bridge/src/services/permissions.ts`, separate from `recheckCommanderRole` so the cheap DB lookup doesn't get coupled to the expensive Discord API call.
- 5 new unit tests in `apps/bridge/src/__tests__/permissions.test.ts` and 5 new integration tests in `ws.test.ts`. Total bridge suite: 34 tests (was 25 — wait, 29 before + 5 new = 34, accounting for the redundant new ws case names ≈ 34).

### Fixed

- `packages/shared` `parseServerMessage` test for `bridge:joined` had been failing since the sticky-LiveKit refactor added the required `speaking: boolean` field to `commanderInfoSchema`. Test fixture updated.
- **Prod docker-compose mount path**: bridge + bot volume now mounts on `/app/data` (where `DATABASE_URL` already pointed via the production `.env`), not `/app/prisma`. The old mount silently shadowed the image's `prisma/schema.prisma` and `prisma/migrations/`, which broke our deploy when a parallel `better-architecture` branch had previously baked its own schema into the same volume — our main-branch Phase A migration was being silently ignored at runtime. Comments in `docker-compose.prod.yml`, `STAND.md`, and `CLAUDE.md` updated to explain why this is load-bearing.
- **Prod LiveKit `--node-ip`**: prod compose now passes `--node-ip ${LIVEKIT_NODE_IP}` so LiveKit advertises the deployer's real public IP to WebRTC clients. Without it, LiveKit's STUN-based auto-detection returns an unreachable internal address (e.g. the LXC bridge gateway `10.10.10.1` on a Proxmox host), ICE never establishes, and audio fails with "could not establish pc connection". New env var documented in `.env.prod.template`. Verified on `commander.raumdock.org` with `LIVEKIT_NODE_IP=85.215.253.135`.

### Added — instant voice-channel toggle (Phase A.1)

- **Bot → Bridge real-time push.** After every `voiceStateUpdate` upsert, the bot fires a fire-and-forget HTTP POST to `${BRIDGE_INTERNAL_URL}/internal/voice-state-changed` with the bridge's `X-Internal-Auth` shared secret. Bridge re-evaluates `checkAllowedVoiceChannel` for the user's open WebSocket and immediately pushes `audio:enable` (if now valid) or `audio:disable` (if no longer valid). Result: audio cuts within ~100 ms of leaving the allowed channel and resumes within ~100 ms of rejoining, instead of the previous 0–60 s window from the polling-only design.
- New WebSocket server messages `audio:enable {roomId, livekitUrl, livekitToken}` and `audio:disable {reason}`. The companion handles them by (re)connecting / disconnecting its LiveKit session while keeping the WS open as the persistent control channel.
- `bridge:joined.livekitUrl` and `bridge:joined.livekitToken` are now optional — absent when the user is not yet in an allowed voice channel at connect time. The companion waits for an `audio:enable` instead of being kicked with `4403` as in v0.2.
- New bridge env var `INTERNAL_BRIDGE_SECRET` (optional, min 16 chars). When unset the new endpoint 503s and the system falls back to the 60s recheck loop. New bot env vars `BRIDGE_INTERNAL_URL` and `INTERNAL_BRIDGE_SECRET` (both optional with the same fallback).
- 5 new bridge tests covering: 503 when secret unset, 401 on wrong header, 200 noop when no open WS, audio:enable push round-trip, audio:disable push round-trip. Existing voice-rejection tests rewritten to assert the new no-kick-at-connect semantics. Bridge suite now 39 green.

### Changed

- Bridge 60-second permission-recheck loop now only re-verifies the Discord **role** (slow-changing, not pushed by bot). The voice-channel check at WS-connect time still runs but its failure no longer closes the socket — it just defers `audio:enable`. The 60s loop keeps role-loss as the only kick reason; voice-state changes are handled in real time by the push endpoint.
- `apps/companion/src/App.tsx` now distinguishes "audio paused — join an allowed voice channel" from a hard error, so leaving the allowed channel doesn't look like a connection failure.

### Added — Phase B1: three-tier auth backend (Admin → Admiral → Commander)

- **New Prisma models** in [prisma/schema.prisma](prisma/schema.prisma): `AdminUser` (per-guild Discord-userId whitelist for the upcoming web admin UI), `ApiCredential` (Admiral "key:secret" pairs, sha256-hashed at rest), `Session` (Admiral-created LiveKit room with a finite lifetime), `InviteToken` (one-shot per-session, per-Discord-user invitation, sha256-hashed at rest). Migration `20260523214956_add_admin_session_invite_models`.
- **New service layer** in [apps/bridge/src/services/](apps/bridge/src/services/): `admins.ts`, `apiCredentials.ts`, `sessions.ts`, `inviteTokens.ts` — all with secure random-secret generation, sha256-hex storage, constant-time hash verification, no plaintext persistence.
- **New REST API** at `/api/v1/*` in [apps/bridge/src/routes/api.ts](apps/bridge/src/routes/api.ts) — HTTP Basic Auth via `key:secret`, all endpoints scoped to the credential's guild. Endpoints: `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/end`, `POST /sessions/:id/invites`, `GET /guild/:id/members` (Discord-REST on-demand, no privileged GuildMembers intent needed).
- **WebSocket auth extended** in [apps/bridge/src/signaling/ws.ts](apps/bridge/src/signaling/ws.ts): now accepts three auth styles — `?token=<oauth-jwt>` (legacy, for the old companion until Phase B3 ships), `?invite=<raw-token>&name=<display>` (new Commander path), `?adm=<key:secret>&session=<id>&name=<display>` (new Admiral path). New room namespace `commander-session-<sessionId>` for B-style sessions, distinct from the per-guild legacy `commander-bridge-<guildId>` room.
- **Two new helpers** in [apps/bridge/src/services/livekit.ts](apps/bridge/src/services/livekit.ts): `sessionRoomName()` + `issueSessionLivekitToken()` — issue per-session tokens with the user's chosen display name as the LiveKit `name` field.
- **Bot bootstrap commands** in [apps/bot/src/commands/cc.ts](apps/bot/src/commands/cc.ts): `/cc admin add|remove|list @user` for managing the admin whitelist (Discord Manage Guild permission required, same gate as the rest of `/cc`); `/cc generate-credential label:<text>` to issue an Admiral API credential without waiting for the web admin UI (Phase B2). Credentials are returned as `key:secret` plaintext in an ephemeral reply, shown once.
- 16 new bridge tests in [apps/bridge/src/__tests__/sessions.test.ts](apps/bridge/src/__tests__/sessions.test.ts) covering credential lifecycle, invite-token mint + verify (including session-ended + token-expired rejection), REST surface (create/list/end session, mint invite, guild scoping), and the new WS auth paths. Bridge suite goes 39 → 55 green.

### Changed

- Kicking sockets on session-end uses a new `rooms.findAllInRoom(roomId)` helper (RoomRegistry) — pull the list once, close 4403 with reason `session_ended` on each.

### Added — Phase B (2026-05-24): Web Admin UI, replaces the B1 admiral-tier experiment

- **New admin web UI at `/admin/*`** in the bridge — server-side rendered HTML (no React/Vite build step), styled with the Chaos Crew Voice Console design system (Cyan/Gold, Share Tech Mono + Rajdhani, sharp borders, scanlines, corner-tick cards). Pages: `/admin/login`, `/admin/` (dashboard with 5-second live polling), `/admin/config` (guild config editor — bridge-mode, commander roles, allowed voice channels, enable/disable), `/admin/admins` (admin list + invite-link mint/revoke).
- **Single-use Discord-OAuth admin invite links.** Existing admin clicks "Neuen Admin einladen" + types a label → bridge mints a 32-byte raw token, returns it once with a `https://<host>/admin/invite/<token>` URL. New admin opens the URL → Discord OAuth → atomic consume-the-invite + insert-into-AdminUser → lands signed-in on the dashboard. Single-use, 7-day TTL by default, used invites stay for audit, unused can be revoked.
- **New Prisma model `AdminInviteLink`** with sha256-hashed token storage. Migration `20260523233020_drop_admiral_models_add_admin_invite_links` also drops the three B1 tables (`ApiCredential`, `Session`, `InviteToken`) which weren't used in production yet.
- **New env vars** (both optional with sensible fallbacks): `ADMIN_SESSION_SECRET` (min 32 chars; falls back to `SESSION_SECRET` for single-secret deployments). Admin session cookie TTL is 24h, HS256 JWT via jose.
- **Reuses the existing `apps/bridge/src/auth/discord.ts` helpers** for Discord OAuth (no duplication) and the existing `addAdmin/isAdmin/listAdmins` from `services/admins.ts`.
- **New dependency:** `@fastify/static` to serve the admin CSS/JS bundle. Static files copied from `src/admin/static/` to `dist/admin/static/` via a small `node -e` step in the bridge's `build` script (no extra build tool).
- 14 new tests (`adminInvites.test.ts` covering the service contract + smoke tests for the admin routes — login redirect, static file serving, OAuth state cookie, gated API endpoints). Bridge suite goes 39 → 53.

### Added — Companion Auto-Updater (2026-05-24)

- **Notify-only auto-updater for the Companion.** On startup (3 s after sign-in), the companion calls the new bridge endpoint `GET /updater/companion/check?token=<jwt>`. Bridge fetches the latest GitHub release via the GitHub Releases API (PAT-authenticated), compares against the companion's locally-baked `${APP_VERSION}-build${APP_BUILD}` string, and returns version + release notes if newer. Companion then shows a chaos-crew-styled `UpdateModal` with the notes and a "DOWNLOAD IM BROWSER ÖFFNEN" button. Clicking it `POST`s back to `/updater/companion/mint-download-token` — bridge mints a fresh single-use download token (labelled `[auto-update] <userId>`, 1-day TTL) and returns the public landing-page URL. Companion opens the URL in the system browser via `@tauri-apps/plugin-opener`; user follows the regular SmartScreen flow and replaces the portable EXE manually.
- **Does NOT bypass the admin-mintable single-use-token mechanism** — same `mintDownloadToken()` service, same token-table, same audit trail. The auto-updater path just bypasses the human in the admin UI; the cryptographic guarantees are identical.
- **New bridge env vars** (already in service code from earlier download work, now load-bearing for the updater): `GITHUB_REPO=<owner/repo>`, `GITHUB_TOKEN=<PAT classic, scope=repo>` (required for private repos, optional for public — rate-limit risk without it), `COMPANION_ASSET_PATTERN` (default `.exe`).
- **New bridge route file** `apps/bridge/src/routes/updater.ts` with `setCors()` helper — both endpoints serve `access-control-allow-origin: *` so the companion's WebView2 (`tauri.localhost` origin) can call `commander.raumdock.org` without a CORS preflight failure. OPTIONS preflight handlers included for paranoia.
- **New companion files** `src/lib/updater.ts` (HTTP client + `parseVersion`/`isNewer` semver-ish comparison) and `src/components/UpdateModal.tsx` (chaos-crew card with release notes, busy/opened/error states).
- **`LOCAL_VERSION = ${APP_VERSION}-build${APP_BUILD}`** composed in the companion so existing GitHub release tags following `v<semver>-build<N>` compare correctly. Without the build suffix every existing release looked "newer" forever; without including build numbers in `parseVersion` (`/(\d+)/` to match digits anywhere in a segment), every `buildN` suffix parsed as 0 and 91 always equalled 92.
- **End-to-end-verified live on 2026-05-24:** companion build 94 installed locally → release `v0.5.0-build95` published on GitHub → update popup appeared within 3 s of next sign-in.
- **Release workflow stays manual** — no CI yet. Build EXE locally with `pnpm --filter @dccc/companion tauri:build`, draft a GitHub release with tag `v<APP_VERSION>-build<N>`, upload the EXE as an asset. CI-on-tag-push explicitly deferred (user decision 2026-05-24: "lass es erstmal manuell").

### Fixed — Etappe 1 Bugfixes (2026-05-26)

- **PTT-Hotkey survived Settings-Save (Bug #2).** `onSettingsSave` in [apps/companion/src/App.tsx](apps/companion/src/App.tsx) used to call `setupHotkey(next.hotkey, () => { /* no-op */ })`, with a misleading comment claiming the real PTT handler was "re-attached via the listener registered at mount". That was false — `setupHotkey()` internally tears down the prior `listen()` handler before installing the new one, so the no-op callback overwrote the mount-time PTT logic. PTT silently stopped working after any settings save until the next app restart. Extracted the PTT handler into a stable `useCallback` (`handlePttEvent`) and now pass it to both call sites.
- **PTT works in DirectX-exclusive-fullscreen games (Bug #1).** Keyboard hotkeys used to go through `tauri-plugin-global-shortcut`, which wraps Win32 `RegisterHotKey`. That API is silently swallowed by DirectX-exclusive-fullscreen apps because the game owns input capture. Reworked [apps/companion/src-tauri/src/lib.rs](apps/companion/src-tauri/src/lib.rs): keyboard + mouse hotkeys now both go through the same `rdev` low-level Windows hook (`SetWindowsHookEx(WH_KEYBOARD_LL)` / `WH_MOUSE_LL`), which sees events even when a game owns capture. New Tauri commands `set_hotkey` / `clear_hotkey` let the JS side hot-swap the active hotkey via shared `Arc<Mutex<…>>` state, without restarting the listener thread. Added `parse_accelerator()` / `key_to_accelerator()` covering letters, digits, F1–F12, navigation/editing keys, numpad, and the common punctuation set. Dropped `@tauri-apps/plugin-global-shortcut` (npm) + `tauri-plugin-global-shortcut` (cargo) + the `global-shortcut:*` capabilities. Note: if a game runs as Admin, the companion needs Admin too — Windows blocks low-level hooks installed from a less-privileged process.
- **Self-hearing protection + diagnostic (Bug #3).** Added an `isSelfByIdentity || isSelfByName` check in `RoomEvent.TrackSubscribed` ([apps/companion/src/lib/livekit.ts](apps/companion/src/lib/livekit.ts)). An SFU should never deliver our own published track back to us, but if it ever does (LiveKit bug, identity-suffix race during fast PTT cycles) the track is refused with a loud `WARN` in the log instead of attaching silently. The "connected" log line now also prints the local participant's `identity` and `name` so users can verify the self-check against any `track subscribed` event. If users still report self-hearing without the `REFUSING to attach` warn appearing, the source is outside LiveKit — typically Discord echoing the user's voice back via another commander's open Discord mic, or a Windows-side audio loopback (Stereo Mix / "Listen to this device").

### Fixed — Etappe 1 follow-up: drop requireAdministrator manifest, fixes Discord-PTT (build 112, 2026-05-26)

Build 103's `requireAdministrator` manifest fixed keyboard PTT on the test system where rdev's WH_KEYBOARD_LL hook initially didn't deliver events. Live testing in build 110 uncovered the cost: Windows UIPI prevents a non-elevated Discord (the typical case) from receiving keyboard or mouse input while the elevated Companion window has focus. Symptoms: Discord's own push-to-mute on the same hotkey stops working whenever Companion has focus, and a Mouse4 hotkey grabs Companion focus mid-press (because the click lands on the Companion window), so even the release is swallowed and Discord stays muted.

The trade-off favored the wrong direction. Discord, TeamSpeak and similar apps work fine without elevation by using `RegisterHotKey` or Raw Input — they accept the small Exclusive-Fullscreen blind spot rather than break input for the rest of the system. Reverted: build.rs falls back to tauri-build's default manifest (asInvoker). The build-100 channel-based fix for the rdev WH_KEYBOARD_LL timeout still ships, so on most systems rdev keyboard works without elevation now anyway; on systems where it still doesn't, we'll migrate keyboard to Raw Input (WM_INPUT) in a follow-up rather than requiring elevation. Mouse PTT is unaffected on every system.

### Refined — Etappe 4 follow-ups: Raid-Planer tab, cache, drag-drop, multi-select, custom modal (2026-05-27)

After the initial Channel-Mirror landed on the dashboard, six successive refinements based on live user feedback:

- **Caching**: the dashboard polling (5s) was triggering three Discord REST calls per tick (members + channels + roles) and the card occasionally went blank on a Discord hiccup. New `apps/bridge/src/services/discordMetaCache.ts` holds an in-process TTL cache for guild channels + roles (60s fresh, 30 min stale-while-error). On a Discord fail the stale value is returned, so the card stays populated. Successful channel rename invalidates the cache so the new name shows on the next tick instead of after the 60s window. Single-flight wrapping dedupes concurrent admin sessions.
- **Better mutation error mapping**: new `mapDiscordError()` helper translates 403/404/400/429/401 into specific client-facing codes (`missing_manage_channels`, `discord_not_found`, `discord_bad_request`, `discord_rate_limited`, `discord_unauthorized`). The raw Discord response body is included in a `detail` field so the admin UI can show it. Frontend now has `formatMutationError()` that turns `{ error, detail }` into German user-facing text — including a specific message for `discord_rate_limited` that parses Discord's `retry_after` and explains the 2-per-10-min channel-rename limit. `fetchWithRateLimit` cap raised from 5s to 15s so the channel-rename retry can wait out Discord's ~10s quote.
- **"Raid Planer" tab**: Channel-Mirror moved out of the dashboard onto its own page at `/admin/raid-planer` with a dedicated nav entry. Dashboard goes back to live commander state only. New `renderRaidPlaner()` view + GET route; the same `/admin/api/live` polling powers both pages.
- **Role-assign whitelist + colour indicator**: only the roles listed in `GuildConfig.commanderRoleIds` can be granted or revoked through the Raid-Planer (enforced both client-side and server-side with a `role_not_in_commander_whitelist` error). The dropdown is gone, replaced by a right-click context menu showing "Vergebe X" or "Entferne X" depending on whether the user already holds the role. New `DashboardData.primaryCommanderRoleId` carries the FIRST role-id of the whitelist to the client, which uses it for a green/red name-colour indicator (admin picks which role lights up names by ordering the textarea). Per-member `channelMirror[].members[].currentCommanderRoleIds` lists which whitelisted roles each user has, so the menu labels itself correctly.
- **Drag-and-drop member move + multi-select**: replaced the per-row "Verschieben…" dropdown with HTML5 drag-and-drop between channel tiles. Drop targets get a cyan border highlight. Click (with or without Ctrl) on a member toggles them in a module-scoped `SELECTED_USERS` set; clicking outside the member rows or context menu clears the whole selection. Right-click on a selected member fans the role-action out to all selected users in parallel via `Promise.allSettled`. The add/remove label is computed against "do ALL selected users already have it", so a mixed selection adds the role to the ones missing it first.
- **Bot member separator**: members whose displayName contains "funkrelais" OR whose Discord `user.bot` flag is true are collapsed under a "RELAIS-BOTS" separator at the bottom of each channel tile. They render with just a "BOT" label and no per-row controls — they're protocol participants, not humans to manage.
- **Custom rename modal**: replaced `window.prompt()` with a Promise-based chaos-crew-styled modal (`.dccc-modal*`) — cyan corner-tick, mono title, ghost+cyan action buttons. Enter confirms, Escape / Cancel / backdrop click dismiss with null.

### Added — Etappe 4: Admin Channel-Mirror with rename / move / role / DM-link (2026-05-27)

New "CHANNEL MIRROR" card on the admin dashboard, one tile per voice channel that's in `GuildConfig.allowedVoiceChannelIds`. Each tile lists who is currently sitting in that channel (driven by the existing `UserVoiceState` table) and exposes four direct-control affordances per member:

- **Channel rename** (click on the channel name → prompt → PATCH `/admin/api/channels/:id/rename`)
- **Move member** (per-row dropdown → POST `/admin/api/members/:userId/move {channelId}`)
- **Assign role** (per-row dropdown → POST `/admin/api/members/:userId/role {roleId, action: "add"}`)
- **DM Companion-download link** (per-row button → mints a single-use `companionDownloadToken` + POSTs to `/users/@me/channels` then `/channels/:id/messages` via the bot, recipient gets a self-explanatory message with the public landing URL)

Implementation:

- **New Discord-REST helpers** in [apps/bridge/src/auth/discord.ts](apps/bridge/src/auth/discord.ts): `addGuildMemberRole` (PUT), `moveGuildMember` (PATCH `/guilds/:gid/members/:uid` with `channel_id`), `modifyChannel` (PATCH `/channels/:id`), `fetchGuildChannels`, `fetchGuildRoles`, `sendDirectMessage` (two-step `/users/@me/channels` → `/channels/:id/messages`).
- **DashboardData type** in [apps/bridge/src/admin/views.ts](apps/bridge/src/admin/views.ts) extended with `channelMirror[]`, `allVoiceChannels[]`, `allRoles[]`; the move/role dropdowns get pre-populated name → id lists so admins don't deal with raw snowflakes.
- **Admin mutation endpoints** in [apps/bridge/src/admin/routes.ts](apps/bridge/src/admin/routes.ts): four new POSTs under `${ROUTE_PREFIX}/api/...` all scoped to the admin's session guild — including a server-side check that the channel being renamed is in *this* guild's allowlist (an admin of guild A can't rename channels in guild B by URL-poking). Discord 403 responses are surfaced with specific error codes (`missing_manage_channels`, `missing_manage_roles`, `missing_move_members`, `dm_closed_by_user`) so the admin UI tells the user *what's missing* instead of just "HTTP 502".
- **Admin frontend** in [apps/bridge/src/admin/static/admin.js](apps/bridge/src/admin/static/admin.js) + [admin.css](apps/bridge/src/admin/static/admin.css): the existing 5-second `/admin/api/live` polling now also redraws the Channel-Mirror grid; `wireChannelMirrorHandlers` attaches click-to-rename + change-to-move + change-to-role + click-to-DM handlers. Pure DOM, no framework, idempotent across polling re-renders via `__wired` flags.
- **DM landing URL** is built from the inbound request's `x-forwarded-proto` + `x-forwarded-host` headers (Traefik in prod, falls back to `request.headers.host` locally) so we don't need a `PUBLIC_HOST` env var.

**Bot permission prerequisites** (deploy step, not code): the bot needs `Manage Channels`, `Move Members`, `Manage Roles` on the target guild. Sending DMs has no permission cost beyond being a member of a shared guild. Existing bot intents (`Guilds` + `GuildVoiceStates`) are unchanged — DMs go via REST, not the gateway.

### Added — Etappe 2: per-user status flags (output-mute + AFK, 2026-05-26)

Two new optional status fields on the squad roster so peers can see when a commander has muted their incoming audio or has flagged themselves AFK. Both are manual toggles (no auto-idle detection) and persist across Companion restarts.

- **Protocol surface** ([packages/shared/src/types.ts](packages/shared/src/types.ts), [protocol.ts](packages/shared/src/protocol.ts), [validation.ts](packages/shared/src/validation.ts)): `CommanderInfo` gained two optional booleans `outputMuted?` and `afk?`. Two new client→server messages: `{ type: "status:output-mute", muted: boolean }` and `{ type: "status:afk", afk: boolean }`. The snapshot builder only spreads the flags when truthy so the wire payload stays compact and pre-Etappe-2 clients parse cleanly.
- **Bridge state** ([apps/bridge/src/services/rooms.ts](apps/bridge/src/services/rooms.ts), [signaling/ws.ts](apps/bridge/src/signaling/ws.ts)): `Participant` carries `outputMuted` + `afk` (default false). New `setOutputMuted(socket, muted)` and `setAfk(socket, afk)` setters mirror the existing `setSpeaking` shape. The WS message switch routes the new messages through the setters and rebroadcasts `commander:list`.
- **Companion store** ([apps/companion/src/lib/store.ts](apps/companion/src/lib/store.ts)): `Settings` now persists `outputMuted` + `afk`. New `saveOutputMuted` / `saveAfk` helpers; `loadSettings` migrates missing fields to false.
- **Companion LiveKit** ([apps/companion/src/lib/livekit.ts](apps/companion/src/lib/livekit.ts)): new `setOutputMuted(muted)` method sets `.muted` on every attached remote `<audio>` element and remembers the flag so newly-subscribed tracks (joining mid-mute) inherit it. Subscription stays alive — we just don't play the audio locally — so speaking flags still flow in the roster.
- **Companion UI** ([apps/companion/src/App.tsx](apps/companion/src/App.tsx)): two new header buttons "MUTE" + "AFK" (cyan/gold-tinted when active). Roster rows now show `AFK` (cyan) and `MUTED` (gold) pills next to the existing TALKING/IDLE state, so other commanders see at a glance who can hear them.
- **Tests**: 2 new bridge tests in [ws.test.ts](apps/bridge/src/__tests__/ws.test.ts) verifying the toggle round-trip + that re-setting to false drops the field from the snapshot. Bridge suite: 53 → 55 green. Shared suite: 13 green (unchanged — new schemas are covered by the existing parseClient/Server tests).

### Fixed — Etappe 1 follow-ups: making Bug #1 actually work in production (builds 99-103, 2026-05-26)

Build 98's rdev migration compiled and ran, but live-testing exposed three additional issues that took four more builds to resolve. Net result: keyboard PTT now works in fullscreen games, in any focus state, without manual elevation.

- **LowLevelHooksTimeout silently killed our keyboard hook.** Build 98's rdev callback called `app.emit("hotkey", …)` synchronously, which goes through Tauri's IPC channel and can stall under contention. Windows enforces a `LowLevelHooksTimeout` (default 5000ms; some anti-cheat / gaming-perf tooling drops it to 250ms) on `WH_KEYBOARD_LL` callbacks — overrun once and Windows silently removes the hook for the rest of the process lifetime. `WH_MOUSE_LL` is a separate hook, so mouse-side-buttons kept working. Symptoms: first F press worked, all subsequent keypresses (even across full app restarts) were never delivered, but Mouse4 always worked. Fix in build 100: funnel every emit through `std::sync::mpsc::channel` into a dedicated emitter thread, so the hook callback does ONLY mutex+compare+send (a few μs) and stays well under any plausible timeout.
- **`WH_KEYBOARD_LL` requires elevation on the user's system.** Build 100's channel fix removed the timeout failure, but keyboard events still never reached our hook at all — diagnostic logging in builds 99/101/102 proved the callback was never invoked for keyboard events even though it was for mouse. Some combination of anti-cheat / input-protection / security tooling on the user's machine refuses to let a non-elevated process install `WH_KEYBOARD_LL` (mouse uses a less restrictive path). Verified by manually right-click → "Run as administrator" — that made the hook deliver events. Fix in build 103: embed a Windows app manifest with `requireAdministrator` via `tauri_build::WindowsAttributes::app_manifest`. The OS now prompts for UAC at launch, no manual right-click needed. New tradeoff: UAC prompt every time the user starts the Companion. Documented in the release notes.
- **WebView2 swallows keystrokes while the Companion window has focus.** Even running as Admin, keyboard PTT didn't fire when the user clicked into the Companion window — yet Mouse4/5 still worked. Webview-keyboard-capture-specific: when the window is focused, WebView2 captures keystrokes at the document level before they reach our global LL-hook. Fix in build 103: add a window-level `keydown`/`keyup` listener in App.tsx that also routes through `handlePttEvent`, so the focused-window path catches what the LL-hook misses. Both paths converge on the same `setMuted` call, making a duplicated event idempotent. Extracted `formatKeyboardAccelerator` + new `isMouseHotkey` / `keyReleaseMatchesAccelerator` helpers into `src/lib/hotkey.ts` so the React handler and `HotkeyCapture` share the same parsing.

### Removed — Phase B rollback of the B1 admiral-tier

- Three Prisma models that backed the unused admiral-creates-sessions flow (`ApiCredential`, `Session`, `InviteToken`) — all empty in production, atomic drop in the same migration as the AdminInviteLink add.
- Service files `apps/bridge/src/services/{apiCredentials,sessions,inviteTokens}.ts`.
- REST surface `apps/bridge/src/routes/api.ts` (the entire `/api/v1/*` namespace).
- WebSocket auth-paths `?invite=<token>` and `?adm=<key:secret>` — companion now uses only the existing `?token=<jwt>` OAuth path from Phase A.1.
- LiveKit helpers `sessionRoomName` + `issueSessionLivekitToken`.
- Bot slash command `/cc generate-credential` (the others — `/cc admin add|remove|list`, `/cc setup`, `/cc enable|disable|status`, `/cc role/channel add|remove` — stay until the web UI is verified live, then get removed in a follow-up commit).
- Test file `apps/bridge/src/__tests__/sessions.test.ts`.

## [0.1.0] - 2026-05-22

First end-to-end working MVP: a single commander can sign in via Discord, hold a configurable hotkey (mouse-button or keyboard), and reach **Audio: connected** on a local LiveKit room — verified live on Windows + Docker Desktop.

### Added (since previous milestone, sign-in + audio path)

- README rewritten with architecture diagram (Mermaid + ASCII), quickstart, repository layout, and scripts table.
- `docs/admin-guide.md` — full step-by-step Discord Developer Portal setup and operating notes.
- `docs/commander-guide.md` — commander-facing setup, hotkey reference, and troubleshooting.
- `docs/privacy.md` — data inventory and deletion instructions.
- Companion `Paste sign-in code` button + bridge HTML success page with copyable base64 code. Fallback for environments where the `dccc://` deep link doesn't fire (notably Windows Tauri dev mode).
- Diagnostic `[deep-link] / [hotkey raw]` logging in the companion to make sign-in and hotkey issues debuggable from the DevTools console.
- Single-instance plugin (`tauri-plugin-single-instance` with `deep-link` feature) so the OAuth redirect activates the running companion process instead of spawning a duplicate.
- Runtime registration of the `dccc://` URL scheme via `app.deep_link().register_all()` (dev-mode equivalent of the installer's Windows-registry write).
- Bridge `/auth/callback` now renders an HTML success page with the sign-in code; the deep-link redirect is attempted opportunistically via a 200ms `setTimeout`.

### Changed (live-test fixes)

- LiveKit tokens carry a random 8-char suffix in `identity` (`<userId>-<hex>`), so rapid press/release/press cycles do not collide on LiveKit's still-async server-side cleanup (was producing `DUPLICATE_IDENTITY` / reason 2 kicks). The real Discord user id is preserved as the `name` field and in our own `RoomRegistry` for active-commander tracking.
- `docker-compose.yml`: explicit `ports:` mappings instead of `network_mode: host` (the latter is broken on Docker Desktop for Windows). LiveKit is also launched with `--node-ip 127.0.0.1` so it advertises localhost as its WebRTC endpoint — without this, ICE candidate-pair establishment fails because the browser cannot NAT-hairpin to the host's external IP.
- React `StrictMode` removed from the companion entry. Its dev-mode double-mount triggered two parallel `BridgeWs` + `LivekitAudio` instances, which then collided on LiveKit identity. A cancelable-effect refactor is the proper fix and is tracked as a follow-up.

### Added (stabilisation)

### Added

- Server-side commander-role recheck while a PTT session is active: bridge re-verifies the role every 60 s and kicks (close 4403) with an `error` payload if it disappeared, was revoked, or the guild was disabled.
- Discord API rate-limit handling: a single retry honoring `Retry-After` on HTTP 429, capped at 5 s total wait.
- Bot logs lifecycle events: shard disconnect / reconnecting / resume / error and top-level client errors.
- Companion: explicit session-expiry handling — on WS close 4401 the persistent token is cleared, LiveKit is disconnected, and the UI shows "session expired — please sign in again".
- 5 new vitest tests for `RoomRegistry` (join/leave snapshots, broadcast, empty-room cleanup, no-op leave). Bridge suite now 20 tests, total 33/33.

### Added

- LiveKit voice bridge — actual cross-channel audio between commanders:
  - `livekit-server-sdk` in the bridge mints short-lived access tokens scoped to `commander-bridge-<guildId>` rooms (publish + subscribe, no recording).
  - In-memory `RoomRegistry` tracks who is currently in which room and broadcasts `commander:list` updates to everyone in the room on join/leave.
  - `bridge:joined` now carries `livekitUrl` + `livekitToken` so the companion can connect to the SFU directly.
  - `commander:list` now includes the `roomId` it refers to (multi-room awareness).
  - PTT guildId is verified against the session token's guildId — a commander can only PTT into their own server's bridge room.
  - Bridge cleans up room membership and broadcasts an updated commander list on every WS close.
- Companion `LivekitAudio` wrapper: connects on `bridge:joined`, publishes microphone with echo cancellation + noise suppression, attaches remote audio tracks to `<audio>` elements, disconnects on `bridge:left`.
- New "Audio" status field in the companion UI.
- `docker-compose.yml` adds a local LiveKit server (`--dev` mode) on host network with built-in dev credentials.
- Environment: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (defaults to the dev container's values).

### Changed

- Default hotkey is now `Mouse4` (back-side mouse button). Keyboard hotkeys still work; the value `MouseN` is treated specially by the hotkey layer.
- Tauri-plugin-global-shortcut handles keyboard hotkeys; an always-on `rdev` listener thread (Windows only for now) handles mouse-button hotkeys. The event filter ensures only the configured accelerator triggers PTT.
- (Earlier:) attempted to use `Alt+F1` as a default before settling on `Mouse4`. Before that we tried `Alt+CapsLock`, which Windows' `RegisterHotKey` refuses to bind because CapsLock is a toggle key.

### Added

- Companion now drives a real PTT round-trip end-to-end:
  - Global hotkey (default `Alt+F1`, user-configurable) emits Rust → JS events with `pressed`/`released` state.
  - `BridgeWs` client with auto-reconnect (exponential backoff, capped at 30 s), 20 s heartbeat, structured server message dispatch.
  - OAuth flow: "Sign in with Discord" opens the bridge in the system browser; `dccc://auth?token=…&guildId=…` deep link is captured and the session is persisted via `@tauri-apps/plugin-store`.
  - Settings store: `token`, `guildId`, `hotkey` survive app restarts.
  - UI now reflects real state: connection status, signed-in flag, active commanders, hotkey label, error banner; "Sign in / Sign out" and "Change hotkey" actions.
- Tauri plugins enabled: `global-shortcut`, `deep-link`, `opener`, `store`; Cargo + JS deps added in parallel.
- `dccc://` registered as a desktop URL scheme; plugin capabilities scoped to the `main` window.
- Companion app skeleton (`@dccc/companion`) built with Tauri 2 + React 18 + Vite 6.
- Status UI: server name, connection status, commander role, hotkey, microphone, active commander count (all mock values for now).
- Dark theme; live banner "COMMANDER BRIDGE LIVE" toggles on `pttActive` state.
- Tauri config: window 520×640, identifier `com.head87x.dccc.companion`, bundle metadata, minimal default capability (`core:default`).
- Rust crate `dccc-companion` (lib + bin) with a placeholder `greet` command and dev-tools auto-open in debug builds.
- Minimal 32×32 placeholder PNG icon — replaced with real artwork in chapter 11.
- Pnpm overrides pin `@types/react@^18.3.18` to avoid React 19 leaking in via Prisma Studio transitives.
- Esbuild added to `pnpm.onlyBuiltDependencies` so Vite's native binary installs cleanly.

### Added

- Discord OAuth2 login on the bridge:
  - `GET /auth/start?guildId=…` → 302 redirect to Discord with `identify guilds.members.read` scope.
  - `GET /auth/callback?code=…&state=…` → exchanges code, fetches `/users/@me`, checks guild membership via bot token, matches against `GuildConfig.commanderRoleIds`, issues session token, redirects to `COMPANION_REDIRECT_URI` (default `dccc://auth`).
- CSRF protection via signed state cookie (httpOnly, sameSite=lax, 10-min TTL).
- Read-only `readGuildConfig()` in bridge (writes stay on the bot).
- Discord API client (`exchangeCodeForToken`, `fetchCurrentUser`, `fetchGuildMember`, `buildAuthorizeUrl`) — all Zod-validated, access tokens never logged.
- Optional OAuth env (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `OAUTH_REDIRECT_URI`, `COMPANION_REDIRECT_URI`) — when missing, OAuth routes return 503 with a helpful error.
- 8 new vitest tests for OAuth flow (success path, state mismatch, missing cookie, guild disabled, missing commander role, not-a-member).
- Generator output moved from `packages/db/src/generated/` to `packages/db/generated/` so the relative import path resolves the same way in `src/` and `dist/`.

### Changed

- Bridge no longer passes a pre-built pino instance to Fastify (type incompatibility); Fastify builds its own pino with the same level/redact options.

- Bridge backend skeleton (`@dccc/bridge`) built on Fastify 5 and `@fastify/websocket`.
- `GET /health` returns `{ ok: true, service: "bridge" }`.
- `GET /ws` (WebSocket) accepts `?token=<jwt>` for session-token authentication.
- JWT session tokens via `jose` (HS256, 15-minute default TTL, issuer + audience claims, revocation list).
- Server-side validation of all incoming WS messages with `parseClientMessage` from `@dccc/shared`.
- Heartbeat loop (server pings every 20s, terminates connection if no pong).
- Defined WebSocket close codes: `4401` for auth failure, `4400` for protocol violation.
- Zod-validated bridge environment (`SESSION_SECRET ≥ 32 chars`, `BRIDGE_HOST`, `BRIDGE_PORT`, `LOG_LEVEL`).
- Pino logger with token redaction (shared style with bot).
- Graceful shutdown on SIGINT/SIGTERM.
- Vitest suite for bridge: 7 end-to-end WebSocket tests covering health check, auth rejection, protocol validation, JSON-parse rejection, and PTT round-trip.
- Test setup file seeds env vars before any module import (fixes eager `getEnv()` in logger).
- `.env` now includes `SESSION_SECRET`, `BRIDGE_HOST`, `BRIDGE_PORT`, `LOG_LEVEL` for local dev.
- Discord bot MVP (`@dccc/bot`) with `/cc` slash command tree:
  - `/cc setup mode:<external_voice|discord_channel|bot_relay>` — initialise configuration.
  - `/cc role add|remove <role>` — manage commander roles.
  - `/cc channel add|remove <voice channel>` — manage participating voice channels.
  - `/cc status` — embed showing current configuration.
  - `/cc enable` / `/cc disable` — toggle the system per server.
- All `/cc` commands are gated by Discord's `Manage Guild` permission and refuse DM use.
- Zod-validated bot environment (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `LOG_LEVEL`).
- Pino logger with redaction of tokens and secrets.
- `GuildConfig` service backed by `@dccc/db` (upserts, JSON-encoded ID lists, snowflake-safe).
- Global slash command registration via REST API on bot startup.
- Graceful shutdown (SIGINT/SIGTERM) closes Discord client and Prisma connection.
- `@dccc/db` package wrapping Prisma client (lazy singleton via `getPrisma()`, `disconnectPrisma()`).
- Prisma 6 schema (`prisma/schema.prisma`) with `GuildConfig` and `CommanderSession` models on SQLite.
- Initial migration `20260521194606_init` (creates both tables).
- Root scripts: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.
- Prisma client generated into `packages/db/src/generated/` (gitignored, regenerated on demand).
- `.env` (gitignored) with `DATABASE_URL="file:./dev.db"` for local development; `.env.example` updated to match.
- `@dccc/shared` package with domain types (`GuildConfig`, `CommanderSession`, `BridgeRoom`, `CommanderInfo`), WebSocket protocol (`ClientMessage`, `ServerMessage`), and Zod validators (`parseClientMessage`, `parseServerMessage`).
- Discord snowflake ID validation (17–20 digit numeric strings).
- Vitest test suite for shared package (13 tests covering positive and negative parse cases).
- Root `pnpm test` script (recursive, `--if-present`).
- pnpm workspace with four packages: `apps/bot`, `apps/bridge`, `apps/companion`, `packages/shared`.
- Root `package.json` (`build`, `lint`, `format` scripts), pinned `pnpm@10.33.0`, Node >=20.
- `tsconfig.base.json` with TypeScript strict mode, `noUncheckedIndexedAccess`, ES2022 target.
- ESLint flat config (typescript-eslint + Prettier integration) and `.prettierrc.json`.
- `.env.example` listing all environment variables from CLAUDE.md.
- `.gitattributes` enforcing LF line endings for source files (CRLF for `.bat`/`.cmd`/`.ps1`).
- Placeholder entry points and `tsconfig.json` for each workspace package (build green, no logic yet).
- Initial repository scaffolding: `.gitignore`, `README.md`, `LICENSE` (MIT), `CHANGELOG.md`.
- Project specification in `CLAUDE.md` describing the Discord Channel Commander Voice Bridge architecture (Bot + Bridge + Companion).
