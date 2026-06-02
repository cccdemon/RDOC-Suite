# Bridge Admin Deprecation Plan

Date: 2026-06-02

## Goal

Fleetplanner is the primary UI for normal operation and mission voice control.
Bridge remains the technical control plane for Discord, LiveKit, relay bots,
Companion downloads, Bridge Mode sessions, audit, monitoring, and internal APIs.

The Bridge Admin web UI is not deleted immediately. It is moved into legacy
status first, then hidden behind an explicit mode flag, and only removed after
all required functions are available through Fleetplanner.

## Current Decision

Do not remove Bridge backend or Bridge internal APIs.

Keep:

- `/internal/fleet/*`
- Discord voice-state and member movement APIs
- Discord role add/remove APIs
- relay bot service config, metrics, and restart plumbing
- Companion download and updater routes
- Bridge Mode session APIs
- audit and monitoring services
- WebSocket signaling

Deprecate as normal operator UI:

- native Bridge Admin dashboard
- native Bridge Admin guild config
- native Bridge Admin commander-role and allowed-channel controls
- native Bridge Admin raid-planer/manual commander workflow

## Route Matrix

| Area | Current surface | Real function today | Target status | Notes |
| --- | --- | --- | --- | --- |
| Fleet internal API | `apps/bridge/src/routes/fleetInternal.ts` | Fleetplanner calls Bridge for config, sessions, relay bots, audit, Discord voice, downloads | keep | Must not be affected by Bridge Admin UI flags. |
| Bridge Admin auth | `apps/bridge/src/admin/routes.ts` OAuth/login/invite | Bootstrap/admin access for native Bridge Admin | keep for legacy | Needed while native UI still exists. |
| Bridge Admin dashboard | `/admin/` | Legacy operational dashboard and health view | hide legacy | Fleetplanner has bridge dashboard/monitoring pages. |
| Bridge Admin config | `/admin/config` | Legacy bridge mode, commander roles, allowed voice channels | hide legacy | Normal Mission Voice no longer uses this as primary config. |
| Bridge Admin admins/invites | `/admin/admins`, `/admin/invite/*` | Native Bridge Admin user management | keep for legacy | Fleetplanner also proxies admin management. Remove only after bootstrap path is replaced. |
| Bridge Admin sessions | `/admin/sessions` | Bridge Mode sessions and invites | move/keep | Fleetplanner already has `/admin/bridge/:guildId/sessions`. Companion still links to native Bridge Admin in one place. |
| Bridge Admin relay bots | `/admin/relay-bots` | Relay config, metrics, restart | move/keep | Fleetplanner already exposes relay bot config and metrics. Backend remains required. |
| Bridge Admin monitoring/audit | `/admin/monitoring`, `/admin/audit` | Diagnostics | move/keep | Fleetplanner already exposes bridge monitoring and audit pages. |
| Bridge Admin Discord voice | `/admin/discord-voice` | Member move and role controls | move/keep | Fleetplanner already exposes Discord Voice panel. |
| Companion downloads | `/download/*`, admin download token UI | GitHub Actions-built Companion installer delivery | keep | Download route/API remains required. UI can move to Fleetplanner. |
| Updater | `/updater/*` | Companion auto-update metadata/artifacts | keep | Independent from Admin UI. |
| Public sessions API | `/sessions/*` | Companion Bridge Mode join flow | keep | Independent from Admin UI. |

## Implementation Steps

### Step 1 - Add this deprecation plan

Document the target architecture, route matrix, and safe migration sequence
before changing code.

Expected result: another AI can continue without guessing which Bridge pieces
are allowed to be removed.

### Step 2 - Add Bridge Admin UI mode flag

Add `BRIDGE_ADMIN_UI_MODE=full|legacy|disabled`.

- `full`: current native Bridge Admin UI remains available.
- `legacy`: native UI remains available, but should present itself as legacy and
  prefer Fleetplanner for normal operation control.
- `disabled`: native `/admin/*` UI is disabled, while all non-admin backend
  routes stay active.

Expected result: deployments can hide the native Bridge Admin UI without
breaking Fleetplanner, Companion, relay bots, sessions, downloads, or updater
flows.

### Step 3 - Move Companion admin-session link to Fleetplanner

The Companion currently opens `${bridgeUrl}/admin/sessions` for admin session
management. Replace that with a Fleetplanner URL once the app has a reliable
Fleetplanner base URL for the active deployment.

Expected result: Companion no longer drives users into native Bridge Admin for
Bridge Mode session management.

### Step 4 - Mark legacy Bridge Admin pages in UI

Native Bridge Admin pages that are not the primary operator workflow should show
a clear legacy notice and point operators to Fleetplanner.

Expected result: accidental operator use moves away from old Bridge Admin pages
without breaking deep links or diagnostic access.

### Step 5 - Remove only after proof

Only remove native Bridge Admin pages after:

- Fleetplanner has equivalent controls.
- Companion no longer links to native Bridge Admin.
- tests cover the remaining backend routes.
- production has run with `BRIDGE_ADMIN_UI_MODE=legacy` or `disabled`.

Expected result: no backend capability is lost during UI cleanup.

