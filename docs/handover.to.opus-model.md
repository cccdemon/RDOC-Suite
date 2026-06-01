# Handover: Merge Bridge Admin into Fleetplanner (Option B)

**For:** Claude Opus (implementation agent)  
**From:** Architecture session 2026-06-01  
**Repo root:** `c:\Users\streamer\Documents\Projekte\RDOC-Suite`  
**Status:** Plan approved, NOT yet implemented. Read this file first, then read the mergelog.

---

## 1. Context & Why

RDOC-Suite has two separate web UIs:

| Service | URL | Auth | DB |
|---|---|---|---|
| **Bridge** | `suite.raumdock.org` (root) | `AdminUser` table (SQLite) | SQLite `/app/data/prod.db` |
| **Fleetplanner** | `suite.raumdock.org/fleetplanner` | `User.role` (PostgreSQL) | PostgreSQL `fleetplanner-db` |

**Problem:** Two separate logins, two admin surfaces, confusing for operators. The bridge admin UI (`/admin/*`) manages voice-bridge guild config (enable, commander roles, relay bots, sessions, monitoring). Fleetplanner has a `superadmin` role with its own admin section but no bridge control.

**Decision:** Fleetplanner absorbs bridge admin config. Bridge becomes headless API-only for its admin surface. Operators log into fleetplanner once and manage everything there. Bridge keeps: WebSocket signaling, OAuth companion callback, voice-state internal push, relay-bots service-config — just loses the HTML admin UI progressively.

---

## 2. Current Architecture (read before touching anything)

### Bridge admin web UI — complete feature list
All routes under `/admin/`, code in `apps/bridge/src/admin/routes.ts` + `views.ts`.

| Page | Route | Auth | What it does |
|---|---|---|---|
| Login | `/admin/login` | public | Discord OAuth start |
| Dashboard | `/admin/` | any admin | Connected commanders, member roster, strip role |
| **Config** | `/admin/config` | any admin | **Enable guild + set commander role IDs + allowed channel IDs** |
| Admins | `/admin/admins` | admiral only (write) | Manage AdminUser roster, invite links, download tokens |
| Sessions | `/admin/sessions` | any admin | LiveKit invite rooms (separate from fleetplanner mission voice) |
| Relay Bots | `/admin/relay-bots` | any admin | LiveKit + relay-bot service config |
| Monitoring | `/admin/monitoring` | any admin | CPU/RAM/bandwidth/rooms |
| Audit Log | `/admin/audit` | admiral only | All admin actions |
| Raid Planer | `/admin/raid-planer` | any admin | Real-time drag-drop Discord member control |
| Discord Voice | `/admin/discord-voice` | any admin | Live role/channel management |

### Bridge internal endpoints that already exist (do NOT duplicate)
- `POST /internal/voice-state-changed` — bot→bridge voice push, auth: `X-Internal-Auth: INTERNAL_BRIDGE_SECRET`
- `GET /relay-bots/service-config` — relay-bots service, auth: `Bearer RELAY_BOTS_SECRET`

### Fleetplanner role system
- `superadmin` — global `User.role` field in PostgreSQL `User` table
- `fleetoperator` / `captain` / `crew` — per-guild `GuildMembership.role`
- Superadmin gates: `apps/fleetplanner/src/auth/middleware.ts` `requireSuperAdmin()`, page render in `apps/fleetplanner/src/web/pages.ts` `adminPage()`
- Superadmin routes: `apps/fleetplanner/src/routes/web.ts` section around `GET /admin`

### Key existing services to reuse
- Bridge guild config read/write: `apps/bridge/src/services/guildConfig.ts:27` `saveGuildConfig()`, `readGuildConfig()`
- Bridge admin seed: `apps/bridge/src/services/admins.ts` `seedSuperadmin()`, `addAdmin()`, `listAdmins()`, `removeAdmin()`, `setAdminRole()`
- Bridge env: `apps/bridge/src/config/env.ts`
- Fleetplanner env: `apps/fleetplanner/src/config/env.ts`
- Fleetplanner superadmin middleware: `apps/fleetplanner/src/auth/middleware.ts` — look for `requireAuth()` and role check pattern
- Fleetplanner internal HTTP pattern: `apps/fleetplanner/src/services/relayBots.ts:39` calls `http://relay-bots:8788` with BasicAuth — reuse this HTTP call pattern for bridge

---

## 3. Implementation Plan

### Phase 1 — New bridge internal API (bridge side)

**Goal:** Bridge exposes a machine-to-machine HTTP API for fleetplanner to read/write guild config and admin users. Secured by a new shared secret, separate from `INTERNAL_BRIDGE_SECRET` (bot-only).

#### 3.1 New env var in bridge
File: `apps/bridge/src/config/env.ts` — add to `baseEnvSchema`:
```typescript
BRIDGE_FLEET_SECRET: z.string().min(32).optional(),
// When set, enables the /internal/fleet/* endpoints that fleetplanner
// calls to manage guild config without needing the bridge admin web UI.
```

#### 3.2 New internal router: `apps/bridge/src/routes/fleetInternal.ts` (new file)
Create this file. Auth pattern: check `Authorization: Bearer <BRIDGE_FLEET_SECRET>` on every request. Return `503` if secret not configured, `401` if wrong.

Endpoints to implement:

```
GET  /internal/fleet/guilds/:guildId/config
     → readGuildConfig(guildId) | null
     → 200: GuildConfig JSON or {guildId, enabled:false, commanderRoleIds:[], allowedVoiceChannelIds:[], bridgeMode:"external_voice"}

POST /internal/fleet/guilds/:guildId/config
     body: {enabled?:boolean, commanderRoleIds?:string[], allowedVoiceChannelIds?:string[]}
     → saveGuildConfig(guildId, body)
     → 200: {ok:true}

GET  /internal/fleet/guilds/:guildId/admins
     → listAdmins(guildId)
     → 200: AdminRecord[]

POST /internal/fleet/guilds/:guildId/admins
     body: {userId:string, role:"admiral"|"vice_admiral"}
     → addAdmin({guildId, userId, role})
     → 200: {ok:true}

DELETE /internal/fleet/guilds/:guildId/admins/:userId
     → removeAdmin({guildId, byUserId: "system", targetUserId: userId})
     note: bypass the "byUserId must be admiral" check for system calls —
           either add a `force:true` param to removeAdmin() or call
           getPrisma().adminUser.deleteMany() directly with a guildId+userId filter

GET  /internal/fleet/guilds/:guildId/monitoring
     → monitoringSnapshot() from apps/bridge/src/services/monitoring.ts
     → 200: MonitoringSnapshot JSON

GET  /internal/fleet/guilds/:guildId/audit?limit=100&offset=0
     → listRecentAudit(guildId, limit, offset)
     → 200: {entries: AuditEntry[], total: number}
```

Input validation: use Zod, same pattern as existing routes. Snowflake regex: `/^[0-9]{17,20}$/`.

#### 3.3 Register the router in `apps/bridge/src/app.ts`
Find where other route files are registered (look for `registerSuiteRoutes`, `registerRelayBotRoutes`, etc.). Add:
```typescript
import { registerFleetInternalRoutes } from "./routes/fleetInternal.js";
await registerFleetInternalRoutes(app);
```

---

### Phase 2 — Fleetplanner bridge client + new env (fleetplanner side)

#### 3.4 New env vars in fleetplanner
File: `apps/fleetplanner/src/config/env.ts` — add to schema:
```typescript
BRIDGE_INTERNAL_URL: z.string().url().default("http://bridge:8787"),
// Internal Docker network URL for bridge service. Default works in prod compose.
BRIDGE_FLEET_SECRET: z.string().min(32).optional(),
// Shared secret matching bridge's BRIDGE_FLEET_SECRET. When unset,
// bridge config section in fleetplanner admin UI is hidden.
```

#### 3.5 New service: `apps/fleetplanner/src/services/bridge.ts` (new file)
HTTP client for the bridge internal API. Reuse the pattern from `apps/fleetplanner/src/services/relayBots.ts:39` (fetch + bearer auth + timeout).

```typescript
// Helper: fetch with bearer auth + timeout
async function bridgeFetch(path: string, opts?: RequestInit): Promise<Response>

// Exports:
export async function getBridgeGuildConfig(guildId: string): Promise<GuildConfig | null>
export async function saveBridgeGuildConfig(guildId: string, patch: {...}): Promise<void>
export async function listBridgeAdmins(guildId: string): Promise<AdminRecord[]>
export async function addBridgeAdmin(guildId: string, userId: string, role: "admiral"|"vice_admiral"): Promise<void>
export async function removeBridgeAdmin(guildId: string, userId: string): Promise<void>
export async function getBridgeMonitoring(guildId: string): Promise<MonitoringSnapshot>
export async function getBridgeAudit(guildId: string, opts?: {limit?:number, offset?:number}): Promise<{entries:AuditEntry[], total:number}>
export function bridgeConfigured(): boolean  // returns !!getEnv().BRIDGE_FLEET_SECRET
```

Types: define `GuildConfig`, `AdminRecord`, `MonitoringSnapshot`, `AuditEntry` locally (copy from bridge shared types or redeclare inline — do NOT import from the bridge package since fleetplanner doesn't depend on it).

#### 3.6 New routes in fleetplanner: `apps/fleetplanner/src/routes/bridgeAdmin.ts` (new file)
All routes gated by `requireAuth()` + superadmin role check (same pattern as `/admin/ships/sync` etc. in `web.ts`). The fleetplanner superadmin is the bridge admin for all guilds.

Routes to implement:
```
GET  /admin/bridge              → render bridge admin overview page (list guilds where bridge has config)
GET  /admin/bridge/:guildId     → guild detail: config + admins + monitoring link
POST /admin/bridge/:guildId/config      → saveBridgeGuildConfig, redirect back
POST /admin/bridge/:guildId/admins      → addBridgeAdmin, redirect back
POST /admin/bridge/:guildId/admins/:userId/delete → removeBridgeAdmin, redirect back
GET  /admin/bridge/:guildId/monitoring  → render monitoring snapshot
GET  /admin/bridge/:guildId/audit       → render audit log (paginated)
```

Register in `apps/fleetplanner/src/app.ts` alongside other route registrations.

#### 3.7 New pages in fleetplanner: add to `apps/fleetplanner/src/web/pages.ts`

Render functions (SSR HTML, same pattern as existing pages):
- `bridgeAdminOverviewPage(opts)` — list guilds with bridge config status
- `bridgeGuildConfigPage(opts)` — guild config form (enable checkbox, role IDs textarea, channel IDs textarea), admin roster, link to monitoring
- `bridgeMonitoringPage(opts)` — display monitoring snapshot
- `bridgeAuditPage(opts)` — display audit entries table (paginated)

Style: reuse existing CSS classes, same page shell (`basePage()`), same nav.

Add a "Bridge" nav link in the existing admin page nav (shown only when `bridgeConfigured()`).

---

### Phase 3 — Wire and document

#### 3.8 Add env vars to `.env.example` and `.env.prod.template`
Both are in the repo root (they may be permission-blocked for Claude — user must do this manually if so).

Add to bridge section:
```
BRIDGE_FLEET_SECRET=<generate: openssl rand -hex 32>
```

Add to fleetplanner section:
```
BRIDGE_INTERNAL_URL=http://bridge:8787
BRIDGE_FLEET_SECRET=<same value as bridge BRIDGE_FLEET_SECRET>
```

#### 3.9 Update CLAUDE.md
- Admin-UI section: note that bridge config is now accessible via fleetplanner superadmin `/admin/bridge` when `BRIDGE_FLEET_SECRET` is set.
- Add `BRIDGE_FLEET_SECRET` to the "Quirks" section (same secret must be set in BOTH `.env` entries: once for bridge, once for fleetplanner).

#### 3.10 Update mergelog
Before any work: add "Queued / Planned Step - YYYY-MM-DD: ..." entry to `docs/RDOC-SUITE-MERGELOG.md`. Required by project rules.

---

## 4. What NOT to touch in this phase

- Bridge `/admin/*` HTML UI: **keep it running**. Remove only after fleetplanner covers the same. Phased sunset.
- Bridge WebSocket signaling: untouched.
- Raid Planer (`/admin/raid-planer`): real-time drag-drop Discord control. Complex. Defer to Phase 2 (next handover).
- Bridge sessions (`/admin/sessions`): these are bridge-only LiveKit rooms, separate from fleetplanner mission voice. Evaluate separately.
- Fleetplanner auth: don't touch the Discord OAuth flows.
- Bridge `AdminUser` table and seed logic: already done (this session), keep.

---

## 5. Files to create (new)

```
apps/bridge/src/routes/fleetInternal.ts   (new)
apps/fleetplanner/src/services/bridge.ts  (new)
apps/fleetplanner/src/routes/bridgeAdmin.ts (new)
```

## 6. Files to modify

```
apps/bridge/src/config/env.ts             add BRIDGE_FLEET_SECRET
apps/bridge/src/app.ts                    register fleetInternal router
apps/fleetplanner/src/config/env.ts       add BRIDGE_INTERNAL_URL, BRIDGE_FLEET_SECRET
apps/fleetplanner/src/app.ts              register bridgeAdmin router (or web.ts, check pattern)
apps/fleetplanner/src/web/pages.ts        add 4 new render functions
CLAUDE.md                                 update admin section
docs/RDOC-SUITE-MERGELOG.md              queued entry before work starts
```

---

## 7. Project rules (MUST follow)

1. **Mergelog first**: write "Queued / Planned Step" entry BEFORE any code changes.
2. **No local build/test**: no `pnpm build`, `cargo build`, etc. locally. Docker builds on server.
3. **Code first, compile last**: write all features end-to-end, fix TypeScript errors in one batch.
4. **No local pnpm install**: Dockerfile bootstraps server-side.
5. **Commit to master**: project uses a single `master` branch.
6. Deploy: user pushes + pulls on `10.10.10.99`, then `docker compose -f docker-compose.prod.yml up -d --build`.

---

## 8. Verification sequence (server-side after deploy)

```bash
# 1. Check both secrets loaded
docker compose -f docker-compose.prod.yml exec bridge sh -c 'echo ${#BRIDGE_FLEET_SECRET}'       # expect 64
docker compose -f docker-compose.prod.yml exec fleetplanner sh -c 'echo ${#BRIDGE_FLEET_SECRET}' # expect 64
docker compose -f docker-compose.prod.yml exec fleetplanner sh -c 'echo $BRIDGE_INTERNAL_URL'    # http://bridge:8787

# 2. Test bridge internal endpoint directly from fleetplanner container
docker compose -f docker-compose.prod.yml exec fleetplanner sh -c '
  node -e "fetch(\"http://bridge:8787/internal/fleet/guilds/1431307397842079777/config\",
    {headers:{authorization:\"Bearer \"+process.env.BRIDGE_FLEET_SECRET}})
    .then(r=>r.text()).then(console.log)"
'
# expect: JSON with guildId, enabled, commanderRoleIds, etc.

# 3. Open fleetplanner admin as superadmin
# https://suite.raumdock.org/fleetplanner/admin
# Should see "Bridge" nav item → guild config page

# 4. Enable guild + set commander role via fleetplanner UI
# → bridge companion login should work after (guild_not_enabled gone)

# 5. Verify bridge admin UI still works
# https://suite.raumdock.org/admin (bridge direct) — should still function
```

---

## 9. Background context (read if confused)

- `guild_not_enabled` error on companion login = bridge `guildConfig.enabled = false`. Fix: enable in bridge config via new fleetplanner page or existing bridge admin UI.
- `BRIDGE_SUPERADMIN_DISCORD_ID` = your **Discord user ID** (not guild ID). Already added this session. Sets first AdminUser on bridge boot.
- `DISCORD_CLIENT_SECRET` in bridge = RDOC-RTC OAuth client secret (32 chars). Was wrong (bot token, 72 chars) — fixed this session.
- Bridge and fleetplanner are on same Docker network → `http://bridge:8787` resolves from fleetplanner container.
- Two secrets look alike: `INTERNAL_BRIDGE_SECRET` (bot→bridge voice push, min 16) vs `BRIDGE_FLEET_SECRET` (new, fleetplanner→bridge, min 32). Don't confuse them.
- Fleetplanner `superadmin` ≠ bridge `admiral`. They're separate systems. This Phase 1 makes fleetplanner superadmin also control bridge config via HTTP, but the bridge `AdminUser` table still exists for bridge-native admin login.

---

## 10. Commit message template

```
feat(rdoc-suite): fleetplanner absorbs bridge admin config (Phase 1)

Bridge exposes /internal/fleet/* HTTP API (BRIDGE_FLEET_SECRET bearer auth)
for guild config + admin user management. Fleetplanner superadmin section
gains a "Bridge" tab at /admin/bridge/:guildId for enable/roles/admins/
monitoring/audit without opening the bridge admin UI.

Bridge admin web UI kept running; phased sunset in Phase 2.
```
