# RDOC Fleetplanner — Feature Backlog

Status legend: `[ ]` open · `[~]` in progress · `[x]` done

---

## #1 — CCU Chain Import (Personal Hangars)

> **2026-06-06: superseded by [FR-P2-fleet-import-json.md](FR-P2-fleet-import-json.md).** Data source resolved — import a **CCU-Game JSON export** (sample provided). See the FR doc for the format + plan.

**Goal:** Pilots can import their ships from their Star Citizen CCU chain / hangar,
so they don't need to manually search and add every ship.

**Open question (blocking):** Where do the CCU chain data come from?
Options under consideration:
- **RSI Hangar API** — No official public API exists. Community scrapers
  (`hangar.link`, `ccu.game`) exist but are unofficial and may break.
- **Manual YAML/JSON import** — User exports their hangar from a third-party tool
  (e.g. Hangar Companion) and pastes/uploads the file.
- **In-app CCU chain builder** — User manually adds base ship + CCU steps;
  Fleetplanner resolves final ship.
- **Paste RSI profile URL** — Scrape public hangar page (unreliable, rate-limited).

**Recommended approach:** Manual JSON/CSV import as MVP; community API integration
later if a stable endpoint is available.

### #1.1 — Seat claim / assignment for imported ships

Once a pilot has a hangar ship, that ship's captain seat must be:
- **Claimable by the pilot himself** (default: auto-assign to owner)
- **Assignable by a fleetoperator** (override if ship is borrowed/delegated)

Implementation: `UserShip` already exists. On unit registration with an owned ship,
optionally pre-assign pilot seat. `assignSeat` endpoint already supports operator
override.

---

## #2 — Discord DM: Unit Accepted Notification

**Goal:** When a fleetoperator accepts a captain's unit, the captain receives a
Discord DM with the operation details.

**Status:** `sendAcceptedCaptainVoiceDm` already exists in `services/discord.ts` and
is called from `routes/api.ts` on accept. DM includes operation title + URL +
optional voice client download/config links.

**Open items:**
- DM only reaches users with a linked Discord identity. Users who signed up via
  GitHub/Google without linking Discord get no DM — consider in-app notification
  as fallback.
- `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` and `FLEETPLANNER_VOICE_CLIENT_CONFIG_URL`
  env vars configure the SquadLink links included in the DM (see #4.3).

---

## #3 — Discord Reminder When Event Starts ✓ Done

**Goal:** X minutes before an operation's `scheduledAt`, all accepted captains and
crew members receive a Discord DM reminder.

**Design:**
- Configurable lead time per guild (e.g. 15 min or 30 min before start).
- A background scheduler checks every minute for operations whose
  `scheduledAt - reminderOffset` has passed and `reminderSentAt IS NULL`.
- New `Operation` field: `reminderSentAt DateTime?` (prevents double-send).
- Sends DM to all users with accepted units + claimed seats.

**Schema addition needed:**
```prisma
model Operation {
  reminderSentAt  DateTime?
  reminderOffsetMin Int @default(15)
}
```

**Guild setting addition needed:** `Guild.reminderOffsetMin Int @default(15)`

---

## #4 — SquadLink + VoiceBot Integration

### Overview

6 Discord voice bots ("Funkrelais") are available. On operation start, each ship/squad
captain gets a private Discord voice channel with their crew. One Funkrelais bot is
assigned per channel. Captains with fleetoperator permission can use `GlobalVoice`
(the bridge's cross-channel audio). Channels and roles are auto-cleaned after the
event ends.

---

### #4.1 — Six VoiceBots (Funkrelais)

6 bot tokens are available. Each bot is a Discord bot that sits in one voice channel
at a time as a relay.

**Config per guild (stored in DB):**
```
GuildVoiceBot {
  id            cuid
  guildId       String
  botUserId     String   // Discord user id of the Funkrelais bot
  botToken      String   // encrypted or via env
  label         String   // "Funkrelais 1" … "Funkrelais 6"
  assignedChannelId String?  // null = available
}
```

Bot tokens should be stored encrypted or referenced via env vars, not plaintext in DB.

---

### #4.2 — Auto-Create Voice Channels + Assign Crew + Assign Bot ✓ Done

**Trigger:** Fleetoperator clicks **"Launch Channels"** button on an accepted operation
(status must be `in_progress` or `open`).

**Flow per accepted unit:**
1. Create a Discord voice channel named after the unit
   (e.g. `"🚀 Polaris — Käpt'n Mueller"`) under a configurable category.
2. Move all crew members of that unit into the channel via
   `PATCH /guilds/{guildId}/members/{userId}` (requires `MOVE_MEMBERS` permission).
3. Assign one available Funkrelais bot to the channel — bot joins via its own token.
4. Write `EphemeralChannel` row (already in bridge schema) or a new
   `FleetChannel` row to track for cleanup.

**Permissions needed (bot):** `MANAGE_CHANNELS`, `MOVE_MEMBERS`, `CONNECT`, `MANAGE_EVENTS`, `ADD_EVENTS`.
Add to bot invite permission bitmask in `routes/guilds.ts`.

**Guild settings needed:**
- `voiceChannelCategoryId` — parent category under which channels are created.
- `voiceBotRoleId` — Discord role controlling Funkrelais bot visibility per channel.

**Cleanup:** When operation status → `completed` or `cancelled`, delete all
`FleetChannel` rows and DELETE the Discord channels + remove crew from them.

---

### #4.3 — Auto-Send SquadLink Download / Config to Captains

**When:** On unit accept (piggybacking on #2 DM flow).

**DM content addition:**
- Download link: `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` (env, already supported)
- Per-captain config link: `FLEETPLANNER_VOICE_CLIENT_CONFIG_URL` (env, already supported)

**Open question:** Should the config link be per-captain (personalised URL with
captain's channel info baked in) or generic? If personalised, Fleetplanner needs
to know the SquadLink config schema to generate it.

**Already implemented:** `sendAcceptedCaptainVoiceDm` sends these links if env vars
are set. **No code change needed for the basic case.**

---

### #4.4 — GlobalVoice Role: Grant + Auto-Remove

**Goal:** A fleetoperator grants a user the Discord `GlobalVoice` role, which allows
that user's SquadLink client to join the cross-channel bridge. Role is automatically
removed when the operation ends.

**Setup (asked when bot is added to a guild, #4.2 guild settings):**
- `Guild.globalVoiceRoleId String?` — Discord role id for GlobalVoice.
- If not set, the GlobalVoice grant button is hidden.

**Grant flow:**
1. Fleetoperator clicks "Grant GlobalVoice" on a user in the operation detail page.
2. Bridge calls `PUT /guilds/{guildId}/members/{userId}/roles/{globalVoiceRoleId}`.
3. DB writes `OperationGlobalVoiceGrant { operationId, userId, grantedAt }` to track.

**Revoke flow (auto):**
When operation → `completed` or `cancelled`:
- For every `OperationGlobalVoiceGrant` row of this operation, call
  `DELETE /guilds/{guildId}/members/{userId}/roles/{globalVoiceRoleId}`.
- Delete the grant rows.

**Schema addition needed:**
```prisma
model OperationGlobalVoiceGrant {
  id          String   @id @default(cuid())
  operationId String
  userId      String
  grantedAt   DateTime @default(now())

  operation Operation @relation(fields: [operationId], references: [id], onDelete: Cascade)
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([operationId, userId])
}
```

**Guild settings needed (asked on guild setup / settings page):**
- `globalVoiceRoleId` — Discord role id
- Shown in guild settings with clear label: "GlobalVoice Discord Role ID"

---

## Guild Setup Wizard — Fields to Collect

When a guild is first installed (`/guilds/added`), or in the guild settings page,
the following Discord IDs must be configurable:

| Field | Purpose | Required |
|---|---|---|
| `admiralRoleId` | Discord role → fleetoperator (auto-sync on login) | optional |
| `eventChannelId` | Voice channel for Discord scheduled events | optional |
| `globalVoiceRoleId` | Discord role granted for cross-channel bridge access | needed for #4.4 |
| `voiceChannelCategoryId` | Parent category for auto-created crew channels | needed for #4.2 |
| `reminderOffsetMin` | Minutes before event to send reminder DM | optional (default 15) |

Currently `admiralRoleId` is settable in `/guilds/settings`. `captainRoleId` was removed because there is no Fleetplanner captain rank.

---

## #5 — Event Completion: Participation Export (DKP Foundation)

**Goal:** When an operation is set to `completed`, a downloadable roster export is
generated — who flew, which ship, which seat, accepted/present status. Designed as a
neutral data foundation for future DKP-like reward or reputation systems.

**Motivation:** RDOC has no DKP system yet, but the raw participation data must be
captured at event close before it becomes unavailable or inaccurate. The export
provides a stable record that any future reward system can consume without
retroactive DB queries.

### Export content per row

| Field | Source |
|---|---|
| `discordId` | `User.id` (snowflake) or linked Discord identity |
| `username` | `User.username` |
| `unitType` | `FleetUnit.unitType` (ship / squad) |
| `shipName` | `Ship.name` or `FleetUnit.squadName` |
| `seatLabel` | `SeatAssignment.label` (Pilot / Gunner 1 / …) |
| `seatType` | `SeatAssignment.seatType` |
| `unitStatus` | `FleetUnit.status` (accepted / rejected) |
| `captainId` | `FleetUnit.captainId` |
| `operationId` | `Operation.id` |
| `operationTitle` | `Operation.title` |
| `scheduledAt` | `Operation.scheduledAt` (UTC ISO-8601) |
| `guildId` | `Operation.guildId` |

Only rows where `SeatAssignment.userId IS NOT NULL` (actually seated crew) and
`FleetUnit.status = 'accepted'` are included. Captain seat always included.

### Download format

- **CSV** (primary) — universally importable into spreadsheets / DKP tools.
- **JSON** (optional second link) — for programmatic consumers.

### UX

- On operation detail page: when `status = 'completed'`, a
  **"Download Participation List"** button appears (fleetoperator+).
- Direct URL: `GET /api/ops/:id/export?format=csv` (or `json`).
- No snapshot stored — generated on demand from live DB data.
  (If the op is later edited, the export reflects the current state, which is
  acceptable for a `completed` op since data is frozen at completion.)

### Future DKP extensions this enables

- Per-user attendance score (count of `completed` ops with claimed seat).
- Ship/seat-type weighting (capital crew worth more points than flex).
- External DKP tool integration via the JSON export endpoint.
- In-app points ledger (new `DkpTransaction` model) — not in scope now.

### Implementation notes

- No new DB model needed for MVP (query on demand).
- Route in `routes/api.ts`: `GET /api/ops/:id/export` — requires
  `requireOpRole(fleetoperator)`, streams CSV or JSON.
- CSV header row + one data row per `SeatAssignment` with `userId != null`
  in accepted units.

---

## Priority Order (Recommendation)

1. **#2 is done** (DM on accept) — verify env vars set on production.
2. **#4.2 is done** (auto-create voice channels + assign bots).
3. **#3 is done** (reminder DMs via Fleetplanner Bot — 60s scheduler, per-guild offset, `reminderSentAt` guard).
4. **#5** (participation export) — no schema change, high value for future DKP; implement alongside first real completed event.
5. **#4.4** (GlobalVoice role) — self-contained.
6. **#1** (CCU chain import) — blocked on data source decision.
7. **#4.3** (SquadLink config link) — already works if env vars are set; personalised
   link requires SquadLink API definition.

---

## Bugs & Feedback (from Discord feedback channel)

Forward-looking features live in [ROADMAP.md](ROADMAP.md) + `FR-P*-*.md`. This section tracks bug reports / small improvements.

- `[x]` **PTT custom press/release sound** (Mimosenherkules) — users can set their own PTT sound. Done in Companion, commit `1efbb17` (local build/ship pending).
- `[~]` **404 on accepted link when not logged in** (exrelax) — the accept-confirmation Discord link 404s for logged-out users; looks like a broken URL. Fix: show a "log in to view this operation" page with a login link (return-to), no op detail leak. (In progress 2026-06-06.)
- `[~]` **Fleet naming: Captain vs Pilot** (Mimosenherkules) — only capital ships (Idris etc.) should show "Captain"; non-capital ship leads should be "Pilot". Centralised `unitLeadTitle(ship)` helper on the unit-lead label. (In progress 2026-06-06.)
- `[x]` **Rolling crew positions** (Vi5E) — DROPPED 2026-06-06, no real use case (user decision). FR doc deleted.

---

*Last updated: 2026-06-06*
