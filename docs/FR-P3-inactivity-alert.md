# Member Last-Seen + 6-Month Inactivity Alert (RDOC-Fleetmanager Bot)

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured 2026-06-07.

## Context
The org wants to spot members who've gone quiet. Today the Fleetmanager bot (`apps/fleetplanner`)
talks to Discord **REST-only** — it can fetch a member by id but sees **no** activity (no gateway,
no presence/voice/message events). `User.lastSeenAt` only updates on a Fleetplanner OAuth login
([identity.ts:42](apps/fleetplanner/src/auth/identity.ts#L42)), so it can't answer "is this Discord
member active?". To track real activity the Fleetmanager bot needs a **gateway** connection.

## Dependencies
- **Hängt an:** `DISCORD_FLEETPLANNER_BOT_TOKEN` (vorhanden) + **GUILD_MEMBERS** privileged intent
  (Portal-Toggle der RDOC-Fleetplanner App `1509191397264064689`; <100 Guilds = nur Toggle).
- **Blockiert:** nichts.
- **Reuse:** `sendDiscordChannelMessage` ([discord.ts:484](apps/fleetplanner/src/services/discord.ts#L484));
  scheduler-Pattern `start*Scheduler` ([reminderScheduler.ts](apps/fleetplanner/src/services/reminderScheduler.ts),
  [recurrence.ts](apps/fleetplanner/src/services/recurrence.ts)); guild-settings UI (guilds.ts + guildSettingsPage).
- **Quer:** mergelog-first; Discord IDs als String; Zod an der Boundary; per-guild Tenant-Scoping.

## Decisions (2026-06-07)
1. **Echte Discord-Aktivität** (nicht nur Fleetplanner-Login) — Gateway-Bot.
2. **Alert in einen konfigurierten Discord-Channel** (pro Guild).
3. **Schwelle pro Guild konfigurierbar, default 6 Monate.**

## Approach
Embed a lightweight **discord.js gateway client** in the Fleetplanner process using the existing
Fleetmanager bot token. Record a per-member `lastActiveAt`; a daily scheduler posts an inactivity
report to the configured channel. (discord.js auto-reconnects across deploys; a brief gap is
irrelevant against a 6-month window. Extractable into an `apps/fleet-activity` worker later if the
web/gateway coupling becomes a concern.)

### Activity signals (bump `lastActiveAt`)
- `messageCreate` — **GuildMessages** (NOT privileged; author + timestamp only, never content → no
  MessageContent intent).
- `voiceStateUpdate` — **GuildVoiceStates** (not privileged).
- `interactionCreate` — slash/button use.
- `guildMemberAdd` — seed at join.
- **Baseline seed:** on startup enumerate members (**GuildMembers**, privileged) and seed
  `lastActiveAt = member.joinedAt` if nothing newer → meaningful data from day 1.
- Presence (`GuildPresences`) **skipped** v1 (privileged, noisy, often hidden).

### Intents
`Guilds, GuildMembers (privileged), GuildMessages, GuildVoiceStates`.

## Data model (new + migration)
- **`GuildMemberActivity`** keyed `(guildId, discordUserId)` (members ≠ Fleetplanner users):
  `displayName String?`, `lastActiveAt DateTime`, `lastActivityType String?`
  (message|voice|interaction|join|seed), `inactivityAlertedAt DateTime?` (dedupe; cleared when active
  again), `leftAt DateTime?` (guildMemberRemove; excluded), timestamps. `@@unique([guildId,
  discordUserId])` + index on `(guildId, lastActiveAt)`.
- **`Guild`** config: `inactivityAlertEnabled Boolean @default(false)`,
  `inactivityThresholdMonths Int @default(6)`, `inactivityAlertChannelId String?`.
- Migration under `apps/fleetplanner/prisma/migrations/`; `db:generate` after.

## Components (new unless noted)
- `apps/fleetplanner/package.json` — add **discord.js**.
- `services/memberActivity.ts` — `touchActivity(guildId, discordUserId, type, displayName?)` (upsert +
  clear alert flag), `seedRoster`, and a **pure** `selectInactive(members, thresholdMonths, now)`
  (unit-testable).
- `services/fleetGateway.ts` — discord.js `Client` (intents above) wiring events → `touchActivity` +
  startup roster seed; only starts when the token is set (feature-flag).
- `services/inactivityScheduler.ts` — daily `start*Scheduler`; per enabled guild → `selectInactive` →
  skip already-alerted → `sendDiscordChannelMessage` report → set `inactivityAlertedAt`.
- `index.ts` — start gateway + scheduler with the others.
- `routes/guilds.ts` + `guildSettingsPage` — enable toggle, threshold months, alert-channel input.
  Optional read-only "Inactive members" list.
- `docs/privacy.md` — data-inventory entry (member activity timestamps).
- `CLAUDE.md` — update Fleetmanager-bot row: now a **gateway** bot needing GuildMembers (privileged) +
  GuildMessages + GuildVoiceStates.

## Dedupe / lifecycle
- One alert per inactivity episode: set `inactivityAlertedAt` on report; clear in `touchActivity` on
  new activity → re-alert only after a fresh gap. `guildMemberRemove` → `leftAt`, excluded.

## Build order
1. Schema + migration + pure `selectInactive` + unit tests.
2. `fleetGateway` (discord.js, intents, event→touchActivity, roster seed).
3. `inactivityScheduler` + channel report + dedupe.
4. Guild-settings UI (enable/threshold/channel) + optional inactive list.
5. Portal intent enable + privacy.md + CLAUDE.md; prod smoke.

## Verification
- Build + tests; unit-test `selectInactive` (6-month boundary, dedupe, `leftAt` exclusion) — no Discord.
- Prod smoke (gated): enable GUILD_MEMBERS intent, deploy, watch logs for gateway `ready` + seed
  counts; temporarily lower a guild threshold against a **test channel** to confirm the post, restore to 6.

## Risks / notes
- **Privileged intent** must be toggled in the portal before deploy or gateway login fails (prereq, not code).
- **Privacy:** storing all members' activity timestamps is sensitive → documented in privacy.md.
- **No back-history:** activity accrues from deploy; baseline = joinedAt (members who joined >6mo ago
  and did nothing alert immediately; others mature over time).

---
*Design doc only. Implement on explicit instruction, mergelog-first. Effort medium — gateway + roster
seed + scheduler; the only net-new integration is the gateway connection on the Fleetmanager bot.*
