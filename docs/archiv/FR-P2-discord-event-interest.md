# Discord-Event "Interested" → auto "needs assignment" in the op

**FeatureRequest — Priority 2** (scale 1 highest … 5 lowest)
**Status:** ✓ **Implemented 2026-06-07** (schema `EventInterest` + migration, `services/eventInterest.ts` 5-min poll/diff, `discord.ts` `listScheduledEventUsers`, shadow-claim on Discord login, manage-board surfacing + "unbekannte Nutzer" metric, privacy.md). Build order steps 1+2 done; step 3 (realtime gateway) intentionally skipped.

## Dependencies
- **Depends on:** the already-live Discord scheduled event per op (`Operation.discordEventId`,
  created on open in [apps/fleetplanner/src/services/discord.ts](apps/fleetplanner/src/services/discord.ts))
  and the existing background scheduler (reminder loop in `index.ts`).
- **Depended on by:** nothing. Self-contained.
- **Not blocked by** FR-P3-inactivity-alert — this needs **no** privileged gateway intent.

## Goal
A pilot who clicks **"Interested"** on the op's Discord scheduled event automatically shows up in
the Fleetplanner op as an **unassigned participant** ("muss zugewiesen werden"), so the operator can
assign them a seat / ask them to bring a ship — without the pilot first having to open the
Fleetplanner and sign up manually. Withdrawing interest on Discord removes them again (unless they
already self-signed-up in the Fleetplanner).

## Can the bot read who is interested? — YES
Discord REST endpoint:
```
GET /guilds/{guildId}/scheduled-events/{eventId}/users?with_member=true&limit=100
```
Returns every user subscribed/"interested" to the scheduled event: `{ user: {id, username, …},
member?: {nick, …} }`. The Fleetplanner bot only needs to be a member of the guild — the same bot
that already created the event.

### Authentication / intents
- **Bot token only.** No OAuth from the pilot, no privileged intent. This is a plain REST read,
  **not** a gateway member scan, so it does **not** need `GUILD_MEMBERS` (that's FR-P3-inactivity's
  cost, a different mechanism).
- The bot is REST-only (no gateway), so there is **no realtime push** when someone clicks. Use
  **polling** on the existing scheduler tick (same model as reminders): list the event's interested
  users, diff against the last-known set.

## Identity mapping (the real design question)
The interested user is a Discord snowflake. To show them in the Fleetplanner op we map it to a
Fleetplanner identity:
1. **Linked account exists** — `UserIdentity(provider="discord", providerId=snowflake)` →
   resolve to the real `User`; the interest attaches to that user.
2. **No account yet** — the pilot has never logged into the Fleetplanner. Create a **shadow
   participant** from the Discord data we already have (snowflake + username + nick). It appears as
   an unassigned interested participant the operator can act on. On the pilot's **first Discord
   login** to the Fleetplanner, the shadow is **claimed/merged** into the new `User`
   (match by the stored Discord snowflake) so history isn't lost.

## Data model (new)
- **`EventInterest`** — one row per (operation, Discord user):
  - `id`, `operationId`
  - `discordUserId String` — the snowflake (always known, even without an account)
  - `userId String?` — resolved Fleetplanner user once linked (null = shadow)
  - `displayName String` — Discord username/nick at time of capture (for shadow display)
  - `status`: `interested | withdrawn | converted` (`converted` once they actually
    register a ship / claim a seat → a real `FleetUnit`/seat supersedes the bare interest)
  - `firstSeenAt`, `updatedAt`
  - `@@unique([operationId, discordUserId])`

## Flow
1. Scheduler tick (per op with a `discordEventId`, while status is open/locked/in_progress):
   list interested users via the REST endpoint.
2. **New interested** → upsert `EventInterest(status="interested")`, resolve `userId` if a Discord
   identity exists, else leave it a shadow.
3. **No longer interested** (in the list before, gone now) → set `status="withdrawn"`. **If the
   pilot was holding a seat, free that seat** (decision 2). Keep the row for history.
4. **Op manage board:** render interested participants in the existing **"Need Assignment"**
   section — name (shadow tag if unlinked), "interested via Discord", and the operator's assign /
   ask-for-ship actions. They are NOT a `FleetUnit` until a ship/seat is involved.
5. **On Discord login:** claim shadows (`UserIdentity` upsert path) → set `EventInterest.userId`.

## Decisions — 2026-06-07
1. **Shadow visibility:** show but **do not count** unlinked interested users toward the op's
   participant min/max. Surface a **separate metric** "Dem System bisher unbekannte Nutzer"
   (= count of `interested` rows with `userId = null`) next to the regular participant count.
2. **Withdraw → free the seat.** If a pilot un-clicks Interested on Discord after being seated,
   remove them from the seat (free it). The Discord RSVP is the source of truth for participation
   here. (Note: a pilot who self-signed-up *in the Fleetplanner* with a real ship/seat is
   `status="converted"` and is NOT governed by the Discord RSVP — only bare Discord-interest seats
   are freed on withdraw.)
3. **Poll every 5 minutes** (300s), dedicated tick (independent of the 60s reminder loop). Only ops
   with a `discordEventId` and status `open | locked | in_progress`; stop once
   `completed | cancelled`.
4. **Privacy:** YES — add the new data class (Discord interest RSVPs: snowflake + display name per
   op) to [docs/privacy.md](../privacy.md) as part of the build.

## Build order
1. Schema `EventInterest` + migration; scheduler poll + diff (no UI yet) — data lands.
2. Manage-board "Need Assignment" surfacing + shadow-claim on Discord login.
3. (Optional) realtime: only if a gateway connection is ever added — not required for MVP.

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
