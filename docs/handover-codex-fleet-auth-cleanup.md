# Handover: Fleet-Auth Dead-Code Cleanup + Unit-Accept DM Fix

**For:** Codex (implementation agent)
**From:** Architecture audit 2026-06-02
**Repo root:** `c:\Users\streamer\Documents\Projekte\RDOC-Suite`
**Status:** Plan approved. Read this file fully before touching anything.

---

## 1. Context & Why

The Companion app was redesigned to a **mission-first 2-PTT architecture** (see `docs/companion-app-overview.md`). The old Fleetplanner Discord OAuth flow (`dccc://fleet-auth`) and manual JSON fleet-voice modal were removed from the Companion frontend. The Fleetplanner backend and Rust side were never cleaned up. This leaves:

- Dead TS files the compiler ignores (but that pollute the codebase)
- Dead Rust Tauri commands still registered and compiled
- Dead Fleetplanner backend routes still serving
- A broken "unit accepted" DM flow: when a fleetoperator accepts a captain's unit, a Discord DM is sent containing a `companionConfigUrl` pointing to `/companion/configure?token=...`. That page redirects to `dccc://fleet-auth?token=...`. The current Companion deep-link handler ignores `dccc://fleet-auth` because it only processes URLs that have BOTH `token` and `url` params — `fleet-auth` links only have `token`. Captains get a useless link in their DM.

---

## 2. What Was Already Done (do NOT redo)

| What | Where | Done |
|---|---|---|
| 2-PTT AppState (`localHotkey`, `globalHotkey`, mission refs) | `apps/companion/src/App.tsx` | ✓ |
| Mission-link deep link handler (`rdoc://mission` + legacy `dccc://fleet-voice`) | `apps/companion/src/App.tsx:836` | ✓ |
| `FleetAudio` / `missionCommanderRef` for commander room | `apps/companion/src/lib/fleetAudio.ts` | ✓ |
| `MissionVoicePanel`, `MissionLinkModal` components | `apps/companion/src/components/` | ✓ |
| `/api/companion/mission-voice` polling endpoint | `apps/fleetplanner/src/routes/api.ts:1417` | ✓ |
| `/api/ops/:opId/voice-links` generates `rdoc://mission?token=…&url=…` links | `apps/fleetplanner/src/routes/api.ts:1498` | ✓ |
| `createMissionVoiceSession` / `loadMissionVoiceSession` (narrow scope) | `apps/fleetplanner/src/auth/companionSession.ts` | ✓ |

**Do not touch any of the above.**

---

## 3. Changes to Make

### 3.1 Companion — delete dead TS files

**Delete entirely:**
- `apps/companion/src/lib/fleetplannerAuth.ts`
- `apps/companion/src/components/FleetVoiceModal.tsx`

These are not imported anywhere. Verify with a grep before deleting:
```
grep -rn "fleetplannerAuth\|FleetVoiceModal" apps/companion/src/
```
Expected: only hits in the files themselves, nothing else.

### 3.2 Companion — remove dead Rust command

In `apps/companion/src-tauri/src/lib.rs`:

**Remove the entire `start_fleet_oauth_webview` function** and its struct `FleetOAuthCompletedEvent`:
- Lines ~140–197: the `#[tauri::command] async fn start_fleet_oauth_webview(...)` function
- The `FleetOAuthCompletedEvent` struct (only used by this function — confirm with grep)

**Remove the registration** from the `generate_handler![]` macro near line 698:
```rust
start_fleet_oauth_webview,   // ← remove this line
```

Verify the struct is only used by this function:
```
grep -n "FleetOAuthCompletedEvent" apps/companion/src-tauri/src/lib.rs
```

### 3.3 Fleetplanner — remove dead auth routes

In `apps/fleetplanner/src/routes/auth.ts`:

**Remove the `/companion/configure` handler** (around line 177–214):
```ts
app.get<{ Querystring: { token?: string } }>("/companion/configure", ...);
```

**Remove the companion OAuth routes** (around lines 217–314):
```ts
// ── Companion app OAuth (uses RDOC-RTC Bot: DISCORD_COMPANION_BOT_ID/KEY) ────
app.get("/auth/discord/companion/start", ...);
app.get("/auth/discord/companion/callback", ...);
```

These are the only callers of `loadCompanionSession` and `createCompanionSession`. After removing them, these functions become unused.

**Remove the imports** of `createCompanionSession` and `loadCompanionSession` from the top of `auth.ts`.

### 3.4 Fleetplanner — fix the unit-accept DM

In `apps/fleetplanner/src/routes/api.ts`, around lines 531–553:

**Before:**
```ts
const companionToken = await createCompanionSession(unit.captainId);
const companionConfigUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/companion/configure?token=${encodeURIComponent(companionToken)}`;
Promise.allSettled([
  assignCaptainDiscordRole(unit.captainId, unit.operation.guildId, "commander"),
  sendAcceptedCaptainVoiceDm(unit.captainId, {
    operationTitle: unit.operation.title,
    unitName,
    operationUrl,
    companionConfigUrl,
  }),
]);
```

**After:**
```ts
Promise.allSettled([
  assignCaptainDiscordRole(unit.captainId, unit.operation.guildId, "commander"),
  sendAcceptedCaptainVoiceDm(unit.captainId, {
    operationTitle: unit.operation.title,
    unitName,
    operationUrl,
  }),
]);
```

Remove the `companionToken` and `companionConfigUrl` locals entirely.

Remove the `createCompanionSession` import from the top of `api.ts` (line ~42).

### 3.5 Fleetplanner — clean up companionSession.ts

After 3.3 and 3.4, `createCompanionSession` and `loadCompanionSession` are unused.

In `apps/fleetplanner/src/auth/companionSession.ts`:
- Remove `createCompanionSession` export
- Remove `loadCompanionSession` export
- Remove `FULL_TTL_MS` constant
- Keep: `createMissionVoiceSession`, `loadMissionVoiceSession`, `createSession`, `loadScopedSession`, `randomHex`, `MISSION_VOICE_TTL_MS`, `CompanionScope` type

The `"full"` scope value in `CompanionScope` type can stay for DB compatibility (existing rows with `scope = 'full'` in the `CompanionSession` table are harmless). Only remove the functions that create and load full-scope sessions.

### 3.6 Fleetplanner — update sendAcceptedCaptainVoiceDm signature (if needed)

Check `apps/fleetplanner/src/services/discord.ts` for the `sendAcceptedCaptainVoiceDm` function signature. If `companionConfigUrl` is a required parameter, make it optional or remove it. The DM should still be sent; just without the companion config link.

Look for the function and update accordingly — the DM content should remain useful (operationTitle, unitName, operationUrl, download link if env vars set).

---

## 4. What NOT to Touch

- `apps/fleetplanner/src/routes/auth.ts` — keep all other auth routes (`/auth/discord/start`, `/auth/discord/callback`, GitHub/Google auth, `/auth/start` backwards-compat redirect, etc.)
- `apps/fleetplanner/src/auth/companionSession.ts` — keep `"full"` in the `CompanionScope` type and the DB schema. Do NOT run a migration to remove existing `scope = 'full'` rows; they expire naturally.
- `apps/companion/src-tauri/src/lib.rs` — keep `dccc://` scheme registration (line ~742–743). Legacy `dccc://fleet-voice` links are still accepted by the mission-link handler during transition. Only remove the `start_fleet_oauth_webview` command.
- `apps/fleetplanner/src/routes/api.ts` — the `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` env var in the DM is still valid (if set, it puts a download link in the DM). Don't remove that.
- The entire Bridge admin UI — leave as-is. Phased sunset is a separate step.
- `docs/Testing-Checklist.md` Phase 4 — leave the doc as-is. It's outdated but not code.

---

## 5. Verification

After changes, verify:

```bash
# TypeScript: no dead imports remain
pnpm --filter @rdoc-suite/companion build
pnpm --filter @rdoc-suite/fleetplanner build

# No remaining references to the deleted code
grep -rn "fleetplannerAuth\|FleetVoiceModal\|start_fleet_oauth_webview\|fleet-oauth-completed\|fleet-oauth-cancelled\|companion/configure\|companionConfigUrl\|createCompanionSession\|loadCompanionSession" apps/
```

Expected: zero hits (or only in this handover doc).

The Rust build requires `src-tauri` being buildable on Windows with Rust + VS Build Tools — if you can't build locally, verify no `start_fleet_oauth_webview` reference remains in `lib.rs` by grep.

---

## 6. Open Question (decide before implementing 3.6)

Does the accepted-captain DM currently include a `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` link?
Check `sendAcceptedCaptainVoiceDm` in `apps/fleetplanner/src/services/discord.ts`. If `companionConfigUrl` is currently the ONLY useful link in that DM (and `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` is not set in prod), the DM after cleanup may become less useful. In that case, consider replacing `companionConfigUrl` with nothing (DM still fires, just without the dead link).

Do NOT add a mission-link to the DM here — mission-links are generated separately by the fleetoperator via `/api/ops/:opId/voice-links` after the op starts.
