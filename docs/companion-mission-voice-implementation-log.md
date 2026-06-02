# Companion Mission Voice Implementation Log

Date: 2026-06-02

This file records implementation steps before they are executed so another AI can continue without reconstructing intent from diffs.

## Step 1 - Scope The Remaining Work

Before changing more code, inspect the current Fleetplanner/Companion/relay-bot code paths for:

- Relay bot channel creation and UI controls.
- Mission token creation/loading.
- Operation deletion cleanup.
- Squad/unit validation.
- Companion mission polling and disconnect behavior.
- Existing tests and migration layout.

Goal: choose the smallest implementation sequence that completes the open list without undoing existing behavior.

Result:

- Existing relay-bot channel creation is in `apps/fleetplanner/src/services/voiceBots.ts`.
- Existing new UI already renders Mission Voice/Voice Channel sections in `apps/fleetplanner/src/web/pages.ts`, but the controls need verification against the requested workflow.
- Existing Companion mission polling was operation-pinned client-side only.
- Existing mission tokens were user-scoped only.
- Existing operation deletion only deleted the operation and scheduled Discord event; voice cleanup must be added.

## Step 2 - Discord Presence Disconnect Contract

Before changing UI polish or token storage, add the backend contract required by Companion:

- `/api/companion/mission-voice` must return `discordVoice`.
- The backend must withhold LiveKit tokens while `discordVoice.ok` is false.
- Companion must disconnect LiveKit and disable PTT when `discordVoice.ok` becomes false.
- Mission access must cover accepted Unit Captains, Operation Leaders, and Commanders tab users.

Result:

- Implemented in `apps/fleetplanner/src/routes/api.ts`, `apps/fleetplanner/src/services/missionCommanders.ts`, `apps/companion/src/App.tsx`, and `apps/companion/src/components/MissionVoicePanel.tsx`.
- Verified with `pnpm.cmd --filter @rdoc-suite/fleetplanner build` and `pnpm.cmd --filter @rdoc-suite/companion build`.

## Step 3 - Operation-Bound Mission Tokens

Before editing token creation/loading, bind mission voice sessions to an operation at the database level:

- Add nullable `operationId` to `CompanionSession`.
- Add a migration for the column and index.
- Change `createMissionVoiceSession` to require `operationId`.
- Change `loadMissionVoiceSession` to return both `userId` and `operationId`.
- Reject mission polling when the token has no operation binding.
- Update every mission token creation call to pass the operation id.

Expected result: a mission token cannot silently roll a user into another active operation.

Result:

- Added nullable `CompanionSession.operationId` to schema and migration.
- Mission voice token creation now requires an operation id.
- Mission token loading rejects unbound tokens.
- Mission polling resolves only the token-bound operation.
- Fleetplanner TypeScript build passed.

## Step 4 - Operation Delete Voice Cleanup

Before changing deletion, ensure deleting an operation performs the same mission cleanup as `completed`/`cancelled`:

- Close LiveKit mission rooms.
- Clean up operation Discord voice channels where possible.
- Delete the scheduled Discord event after cleanup.
- Then delete the operation.

Expected result: deleting an active operation does not leave LiveKit rooms or relay voice channels behind.

Result:

- `apps/fleetplanner/src/routes/web.ts` now closes mission LiveKit rooms and attempts voice-channel cleanup before operation deletion.
- Discord scheduled event deletion remains after the DB delete as best-effort cleanup.

## Step 5 - Squad Name Invariants

Before editing unit registration/update, enforce the channel-name assumptions:

- Accepted/pending squad names must be unique per operation, case-insensitive.
- Squad name changes must be blocked once an operation is `in_progress`, `completed`, or `cancelled`.
- Structural edits after the mission is active should not rename/reassign voice-channel semantics unexpectedly.

Expected result: the expected Discord channel name can safely be derived from the squad/unit name.

Result:

- Unit registration rejects duplicate non-rejected squad names per operation.
- Unit edit rejects duplicate squad names.
- Unit name/type/structure edits are blocked once operation status is `in_progress`, `completed`, or `cancelled`.

## Step 6 - Channel Names Versus Relay Bot Names

Before editing relay-bot sync:

- Discord voice channel names should be based on the assigned unit/squad name.
- Relay bot display/nickname should remain the configured bot label.
- Fleetplanner expected-channel guidance should use the persisted Discord channel name.

Expected result: users see the squad/unit channel name, while each RelayBot keeps its configured display name.

Result:

- New Discord voice channels are named from the accepted unit/squad.
- Relay bot config sent to the relay service keeps the configured bot label as bot display name.

## Step 7 - Stable Companion Download Link

Before editing DM content, add a stable Fleetplanner URL for downloads:

- Add `/companion/download`.
- If `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` is configured, redirect to it.
- Otherwise show a small page that says no download is configured yet.
- Use this stable Fleetplanner URL in mission start DMs.

Expected result: DMs can point to Fleetplanner even though Companion builds/releases are produced by GitHub Actions.

Result:

- Added `/companion/download`.
- Mission start DMs now use the stable Fleetplanner download URL.
- Fleetplanner build passed.

## Step 8 - Companion Presence UI Polish

Before editing Companion UI text:

- Fix the channel guidance typo to `advised`.
- Make the Relay/global display visibly unavailable when Discord voice presence is invalid.
- Keep the functional PTT guard already implemented in `App.tsx`.

Expected result: users see that both Commander and Relay paths are unavailable until they rejoin the advised Discord channel.

Result:

- Mission panel now says `advised`.
- Relay/global display hides the hotkey and shows `Discord Voice required` when presence is invalid.

## Step 9 - Focused Test Coverage

Before adding broad tests, add focused unit coverage for shared backend logic:

- `companionSession` creates operation-bound mission tokens and rejects unbound/expired/wrong-scope tokens.
- `missionCommanders` includes all accepted Unit Captains, Operation Leaders, and manually-added participants.

Expected result: the most failure-prone mission access rules are covered without needing a full Fastify/Discord integration test harness.

Result:

- Added `companionSession.test.ts` and `missionCommanders.test.ts`.
- Fleetplanner test run passed.
- Fleetplanner TypeScript build passed.

## Step 10 - Relay Bot Recovery Verification

Before changing relay-bot runtime code, inspect the existing watchdog/rejoin behavior:

- Relay bots should rejoin their configured channel if disconnected while humans are present.
- Service watchdog should restart relay state if all bots stay disconnected.
- Fleetplanner sync should preserve assigned bot labels/channel ids after restart.

Expected result: either confirm existing behavior is sufficient or add a narrowly scoped recovery improvement.

Result:

- `RelayBot` rejoins its configured channel when humans are present and the voice connection disconnects.
- `RelayBot` leaves empty channels and waits outside until humans return.
- Relay service watchdog restarts relay state after sustained all-bot disconnects.
- Fleetplanner `syncFleetplannerRelayBots` persists assigned channel IDs and configured bot labels into relay service config.
- No code change needed for this step.

## Step 11 - New UI Relay Channel Controls

Before editing `pages.ts`, inspect the new operation UI Mission Voice panel:

- Verify whether fleetoperators can launch/create relay Discord channels.
- Verify whether they can see assigned channels and copy Companion links.
- Verify whether they can move crew into their assigned channel.

Expected result: the new UI exposes the same workflow needed for mission start without falling back to the classic UI.

Result:

- New Mission Voice tab already had Launch/Rename/Delete.
- Added Voice Control section with Pull-all and Move-member actions.

## Step 12 - Companion Presence Poll Latency

Before editing Companion polling:

- Current mission polling interval is 30 seconds.
- That is too slow for the requirement "disconnect when the user leaves Discord".
- Reduce mission polling interval to a short cadence while a mission config is active.

Expected result: Companion reacts to invalid Discord voice presence within a few seconds, bounded by backend/bridge voice-state freshness.

Result:

- Companion mission polling interval reduced from 30 seconds to 5 seconds.

## Step 13 - Final Verification

Before handing over:

- Run Fleetplanner tests.
- Run Fleetplanner TypeScript build.
- Run Companion TypeScript/Vite build for local verification only; production Companion build remains GitHub Actions.
- Run `git diff --check`.
- Summarize remaining risks, if any.

Result:

- `pnpm.cmd --filter @rdoc-suite/fleetplanner test` passed.
- `pnpm.cmd --filter @rdoc-suite/fleetplanner build` passed.
- `pnpm.cmd --filter @rdoc-suite/companion build` passed for local verification.
- `git diff --check` passed.
