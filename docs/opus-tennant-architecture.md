# Tenant Architecture Overhaul: Op Visibility + Guild Partnerships

**For:** Claude Opus (implementation agent)  
**From:** Architecture session 2026-06-01  
**Repo root:** `c:\Users\streamer\Documents\Projekte\RDOC-Suite`  
**Status:** Plan approved, NOT yet implemented. Read this file fully before touching anything.

---

## 1. Context & Why

RDOC-Suite is a multi-tenant platform where each Discord server = one tenant. After a prior Codex run (2026-06-01), the bridge layer is now fully guild-scoped (`CompanionDownloadToken.guildId`, `RelayBotsConfig` PK → `guildId`). See git log for those changes — they are done, do not re-implement.

**Remaining gap:** The Fleetplanner has no operation-level visibility control. `listPublicOperations()` currently returns ALL ops with status `open|locked|in_progress` — every tenant's active operations are visible to everyone. There is no way for a guild to keep an operation private.

**Goal of this overhaul:**
1. Add explicit `visibility` flag to `Operation` — default private.
2. Allow guilds to form partnerships so they can share private ops with trusted allies.
3. Allow authenticated users from any guild to participate (register, claim seats) in public ops.
4. DMs (seat assignments, reminders) work cross-guild via the hosting guild's bot.

---

## 2. What Was Already Done (do NOT redo)

Codex already implemented on 2026-06-01:

| Change | File | Done |
|---|---|---|
| `CompanionDownloadToken.guildId` | `prisma/schema.prisma` + migration | ✓ |
| `RelayBotsConfig` PK → `guildId` | `prisma/schema.prisma` + migration | ✓ |
| All bridge admin/service routes guild-scoped | `admin/routes.ts`, `routes/relayBots.ts` | ✓ |
| `relay.ts` requires `?guildId=` | `routes/relay.ts` | ✓ |
| `livekit.issueRelayToken` takes `guildId` | `services/livekit.ts` | ✓ |
| Fleetplanner guild-scoped internal endpoints | `routes/fleetInternal.ts`, `services/bridge.ts` | ✓ |
| `relay-bots/src/index.ts` passes `?guildId=` | `apps/relay-bots/src/index.ts` | ✓ |

**Known minor gap from Codex run (fix in this overhaul):**  
`apps/companion/src/App.tsx:783` — relay effect guard missing `|| !state.guildId`. If guildId is null but token is set, relay shows "error". Fix: add `|| !state.guildId` to the existing guard condition.

---

## 3. Architecture: Op Visibility

### 3.1 Visibility Levels

Three levels, ordered by openness:

| Value | Who can see | Who can participate |
|---|---|---|
| `"private"` | Own guild members only | Own guild members only |
| `"partners"` | Own guild + active partner guilds | Members of own guild + partner guilds |
| `"public"` | Everyone (incl. unauthenticated) | Any authenticated user |

**`private` is the default.** No existing operation becomes visible automatically.

### 3.2 Who Can Change Visibility

- `fleetoperator` role in the hosting guild
- Any user listed as `OperationLeader` for that operation (role `fleet_commander | raid_leader | wing_commander | event_leader`)

Captains (`captain` role) cannot change visibility.

### 3.3 Visibility Is Independent of Status

`status` (`draft | open | locked | in_progress | completed | cancelled`) and `visibility` are orthogonal. A `draft` op can be `public`. A `locked` op can be `private`. No coupling.

---

## 4. Architecture: Guild Partnerships

### 4.1 Model

Partnership is established via a single-use token flow (same pattern as `AdminInviteLink`):

1. **Guild A** (fleetoperator) mints a partner token with a human label (e.g., "Raumdock Alliance"). Bridge returns the raw token once; only `sha256(token)` is stored. `guildBId` is null until accepted.
2. **Guild B** (fleetoperator) enters the token in their UI → it is validated, `guildBId` is written, `status` becomes `active` in a single transaction.
3. Partnership is **bidirectional**: once active, both guilds see each other's `visibility: "partners"` ops.
4. Either guild can **revoke** at any time → `status: "revoked"`. Revoked partnerships never restore to active.

### 4.2 Schema (add to Fleetplanner PostgreSQL)

```prisma
model GuildPartnership {
  id          String    @id @default(cuid())
  guildAId    String                          // Inviting guild (token issuer)
  guildBId    String?                         // null until token is accepted
  tokenHash   String    @unique               // sha256(rawToken) — never store plaintext
  label       String                          // Human label, e.g. "Raumdock Alliance"
  status      String    @default("pending")   // "pending" | "active" | "revoked"
  createdBy   String                          // fleetplanner userId of the minting user
  createdAt   DateTime  @default(now())
  activatedAt DateTime?

  guildA Guild  @relation("PartnershipA", fields: [guildAId], references: [id], onDelete: Cascade)
  guildB Guild? @relation("PartnershipB", fields: [guildBId], references: [id], onDelete: Cascade)

  @@unique([guildAId, guildBId])
  @@index([guildAId])
  @@index([guildBId])
}
```

Add to `Guild` model:
```prisma
model Guild {
  // ... existing fields ...
  partnershipsSent     GuildPartnership[] @relation("PartnershipA")
  partnershipsReceived GuildPartnership[] @relation("PartnershipB")
}
```

---

## 5. Prisma Migration (Fleetplanner)

Two changes in one migration (or two sequential migrations — either is fine):

```sql
-- Add visibility to Operation
ALTER TABLE "Operation" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

-- Create GuildPartnership table
CREATE TABLE "GuildPartnership" (
  "id"          TEXT NOT NULL PRIMARY KEY,
  "guildAId"    TEXT NOT NULL,
  "guildBId"    TEXT,
  "tokenHash"   TEXT NOT NULL,
  "label"       TEXT NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "createdBy"   TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt" TIMESTAMP(3),
  CONSTRAINT "GuildPartnership_guildAId_fkey" FOREIGN KEY ("guildAId") REFERENCES "Guild"("id") ON DELETE CASCADE,
  CONSTRAINT "GuildPartnership_guildBId_fkey" FOREIGN KEY ("guildBId") REFERENCES "Guild"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "GuildPartnership_tokenHash_key" ON "GuildPartnership"("tokenHash");
CREATE UNIQUE INDEX "GuildPartnership_guildAId_guildBId_key" ON "GuildPartnership"("guildAId", "guildBId");
CREATE INDEX "GuildPartnership_guildAId_idx" ON "GuildPartnership"("guildAId");
CREATE INDEX "GuildPartnership_guildBId_idx" ON "GuildPartnership"("guildBId");
```

---

## 6. Service Layer

### 6.1 New: `apps/fleetplanner/src/services/partnerships.ts`

```ts
// mintPartnerToken(guildAId, label, createdBy): Promise<{ id, label, plaintext, expiresAt }>
// — generates 32 random bytes, stores sha256(hex), returns raw hex once
// — NOTE: GuildPartnership has no expiresAt in schema; tokens are valid until accepted or revoked.
//   Return createdAt + 30 days as a UI hint only, do not enforce server-side.

// acceptPartnerToken(rawToken, guildBId): Promise<{ ok: true, label } | { ok: false, reason }>
// — looks up by sha256(rawToken)
// — fails if: not found, already active, already revoked, guildBId === guildAId
// — on success: single transaction sets guildBId, status='active', activatedAt=now()

// listPartners(guildId): Promise<GuildPartnership[]>
// — returns all rows where (guildAId = guildId OR guildBId = guildId) AND status = 'active'

// getActivePartnerGuildIds(guildId): Promise<string[]>
// — helper used by op queries; returns partner guild IDs (the OTHER side of each partnership)

// revokePartnership(partnershipId, requestingGuildId): Promise<boolean>
// — sets status='revoked' only if requestingGuildId is guildAId or guildBId
// — returns false if not found or not authorized
```

### 6.2 Update: `apps/fleetplanner/src/services/operations.ts`

**`listPublicOperations`** — change filter:
```ts
// Before: status IN ['open','locked','in_progress']
// After:  visibility = 'public'   (status is irrelevant for public listing)
where: { visibility: 'public' }
```

**New: `listPartnerOperations(guildId)`**:
```ts
async function listPartnerOperations(guildId: string, includePast = false) {
  const partnerIds = await getActivePartnerGuildIds(guildId);
  if (partnerIds.length === 0) return [];
  // Show ops from partner guilds that are partners-or-public visible
  where: {
    guildId: { in: partnerIds },
    visibility: { in: ['partners', 'public'] },
    // optionally filter by scheduledAt cutoff
  }
}
```

**`createOperation`** — add `visibility` to input type and `data` object.

**New: `setOperationVisibility(opId, visibility, actorUserId, actorRole)`**:
```ts
// Validates actorRole is 'fleetoperator' or actorUserId is an OperationLeader for opId
// Updates Operation.visibility
```

### 6.3 Update: `apps/fleetplanner/src/auth/middleware.ts` — `effectiveOpRole`

Current `effectiveOpRole(userId, userRole, operationId)` is in `services/guilds.ts`. It needs updating:

```ts
// Current: returns null if no GuildMembership in op's guild
// New logic:
//   1. Load op to get guildId + visibility
//   2. If user has GuildMembership in op's guild → return that role (unchanged)
//   3. Else if visibility === 'public' → return 'crew'
//   4. Else if visibility === 'partners' → check getActivePartnerGuildIds(op.guildId)
//      contains any guild where user has a GuildMembership → return 'crew'
//   5. Else → return null (no access)
```

This change makes `requireOpRole(request, reply, operationId, 'crew')` work for cross-guild participants automatically.

---

## 7. Route Changes

### 7.1 `apps/fleetplanner/src/routes/web.ts`

**`GET /` (public overview):**
- Unauthenticated: `listPublicOperations()` (unchanged in behavior, fixed filter)
- Authenticated: `listPublicOperations()` + `listPartnerOperations(activeGuildId)` + `listOperations(activeGuildId)` — deduplicate by op id, sort by scheduledAt
- Add visibility badge to op cards: 🌐 public | 🤝 partners | 🔒 private

**`POST /ops/new`:**
- Add `visibility` field to form (select or toggle): private / partners / public
- Pass to `createOperation`

**`GET /ops/:id`:**
- If unauthenticated AND op is `private` or `partners` → 404 (not public preview)
- If unauthenticated AND op is `public` → existing public preview (unchanged)
- If authenticated AND not member of op guild AND visibility is `private` → 404
- If authenticated AND (visibility is `public` OR partner access) → show full op

**`POST /ops/:id/visibility` (new route):**
- Body: `{ visibility: "private" | "partners" | "public", _csrf }`
- Auth: `requireAuth`; then validate actor is fleetoperator in op guild OR OperationLeader for this op
- Calls `setOperationVisibility`
- Redirect back to op detail with flash

**`GET/POST /admin/guild/partnerships` (new page, superadmin section):**

Actually, partnerships are guild-level settings, not superadmin. They belong in the guild admin area managed by fleetoperators. Add under `routes/guilds.ts` or a new `routes/partnerships.ts`:

```
GET  /guilds/:guildId/partnerships          — list active + pending partnerships (fleetoperator only)
POST /guilds/:guildId/partnerships/invite   — mint token (fleetoperator only), body: { label }
POST /guilds/partnerships/accept            — body: { token }, uses active guild from session
DELETE /guilds/:guildId/partnerships/:id    — revoke (fleetoperator only, must be own guild)
```

### 7.2 `apps/fleetplanner/src/routes/api.ts`

**`POST /ops/:id/register-unit`** (existing):
- Change auth from `requireOpRole(... 'crew')` — this already works once `effectiveOpRole` is updated.
- No route code change needed IF effectiveOpRole is updated correctly.

**`POST /ops/:id/seats/:seatId/claim`** (existing):
- Same — no route change needed if effectiveOpRole is updated.

**DM sends (seat assignment, reminder):**
- `sendSeatAssignmentDm` and reminder scheduler use `UserIdentity` to get Discord user ID.
- Hosting guild's bot token is used → Discord allows DM to any user sharing a server with the bot.
- Cross-guild participants have the bot on their server → DMs work.
- No code change needed here.

---

## 8. UI Components

### 8.1 Visibility Badge + Toggle

On op detail page, add visibility indicator near op title/status:
```
[🔒 Privat] [🤝 Partner] [🌐 Öffentlich]
```
Only fleetoperator / OperationLeader sees the toggle form. Others see read-only badge.

Toggle is a simple `<form method="POST" action="/ops/:id/visibility">` with radio buttons + CSRF.

### 8.2 Partnership Admin Page

New page accessible from guild settings nav (fleetoperator only):

**Section 1 — Active Partners:**
Table: Guild name | Since | Revoke button

**Section 2 — Pending Invites (sent by this guild):**
Table: Label | Token (copy URL: `/guilds/partnerships/accept?token=...`) | Created | Revoke

**Section 3 — Accept an Invite:**
Form: text input for raw token + submit button

### 8.3 Op Create Form

Add visibility selector:
```html
<select name="visibility">
  <option value="private">Privat (nur dieses Discord)</option>
  <option value="partners">Partner (dieses Discord + verbundene)</option>
  <option value="public">Öffentlich (alle authentifizierten User)</option>
</select>
```

---

## 9. Implementation Order

Follow this order to avoid broken intermediate states:

1. **Migration** — add `Operation.visibility` + create `GuildPartnership` table. Run `prisma migrate dev`.
2. **`services/partnerships.ts`** — implement all 5 functions.
3. **`services/operations.ts`** — update `listPublicOperations`, add `listPartnerOperations`, add `setOperationVisibility`, add `visibility` to `createOperation`.
4. **`services/guilds.ts` — `effectiveOpRole`** — update cross-guild logic.
5. **`routes/partnerships.ts`** (new) — 4 routes listed above.
6. **`routes/web.ts`** — overview page, op detail auth, `/ops/:id/visibility` route, op create form.
7. **`web/pages.ts`** — visibility badge, toggle form, partnership admin page HTML.
8. **`apps/companion/src/App.tsx:783`** — add `|| !state.guildId` to relay guard.
9. **Tests** — update `__tests__/services/operations.test.ts`, add partnership tests.

---

## 10. Invariants — Never Break These

- `private` is the default for all new ops — no migration makes existing ops visible.
- Partnership token: only `sha256(token)` stored, never plaintext. Raw token returned once at mint time.
- `revokePartnership` is permanent — `revoked` never goes back to `active`.
- A guild cannot partner with itself (`guildBId !== guildAId` enforced in `acceptPartnerToken`).
- `visibility` change is always logged (add to audit log if/when one exists for fleetplanner).
- `requireOpRole` for mutations still enforces minimum role — cross-guild users get `"crew"` max, they cannot become fleetoperator via visibility.
- DMs always use the **hosting guild's** bot token, not the participant's guild bot.
- `listPublicOperations` is the ONLY function allowed to omit `guildId` scope — all other op queries are guild-scoped.

---

## 11. Files to Touch (complete list)

```
apps/fleetplanner/prisma/schema.prisma                     ← visibility + GuildPartnership + Guild relations
apps/fleetplanner/prisma/migrations/<ts>_visibility_partnerships/migration.sql
apps/fleetplanner/src/services/partnerships.ts             ← NEW
apps/fleetplanner/src/services/operations.ts               ← listPublicOperations, listPartnerOperations, setOperationVisibility, createOperation
apps/fleetplanner/src/services/guilds.ts                   ← effectiveOpRole
apps/fleetplanner/src/routes/partnerships.ts               ← NEW (4 routes)
apps/fleetplanner/src/routes/web.ts                        ← overview, op detail, visibility toggle route, create form
apps/fleetplanner/src/web/pages.ts                         ← visibility badge, toggle UI, partnership page
apps/fleetplanner/src/app.ts                               ← register new partnerships router
apps/fleetplanner/src/__tests__/services/operations.test.ts ← update
apps/companion/src/App.tsx                                  ← line 783 relay guard fix
```

Do NOT touch:
- Bridge SQLite schema (those changes are done)
- `apps/bridge/src/` (unless fixing the relay guard which is in companion, not bridge)
- `apps/relay-bots/` (done)
