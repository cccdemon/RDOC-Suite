# Partner Events: Distribution + Federation Voice + Recurring — Plan

**FeatureRequest — Priority 2** (scale 1 highest … 5 lowest)

**For:** implementation agent (Claude Opus)
**From:** Architecture session 2026-06-05
**Status:** Plan approved by user, **NOT yet implemented**. No schema/code exists for any of this. Read fully before touching anything.

Builds on already-live infrastructure:
- **Partnerships** — `GuildPartnership` (status `pending|active|revoked`), `getActivePartnerGuildIds(guildId)`, mint/accept/revoke in [apps/fleetplanner/src/services/partnerships.ts](apps/fleetplanner/src/services/partnerships.ts). `partners` op-visibility is live (see [opus-tennant-architecture.md](opus-tennant-architecture.md), now implemented).
- **Discord scheduled events** — `createScheduledEvent` / `updateScheduledEvent` / `deleteScheduledEvent` in [apps/fleetplanner/src/services/discord.ts](apps/fleetplanner/src/services/discord.ts) using the single **Fleetplanner bot** (`DISCORD_FLEETPLANNER_BOT_TOKEN`), which is installed in every partner guild → one token can create an event in any partner guild's Discord. `Operation.discordEventId` currently stores **one** host-guild event id only.
- **DMs** — `sendDiscordDm(userId, content)` (REST). Today only plain-text DMs; **no Discord interaction (button) handling exists** in the Fleetplanner bot.
- **Voice** — Global Radio relay model: `Operation.globalVoiceRoom` (LiveKit) → per-guild relay bots (`GuildVoiceBot`, 6×/guild) → Discord voice channels; `commanderVoiceRoom` for Command Net. Companion mission session via `createMissionVoiceSession` / `/api/companion/mission-voice`. Relay bots and `RelayBotsConfig` are **guild-scoped** (PK `guildId`). Voice modes recap in memory `reference_rdoc_voice_modes`.

Cross-cutting rule: every change starts with a `docs/RDOC-SUITE-MERGELOG.md` Queued entry.

---

## Feature 1 — Event Distribution (cross-post to partner Discords)

### Goal
A host guild creates an op with a Discord scheduled event. The event is offered to **all active partner guilds**. Each target guild's Discord gets its own scheduled event — but only after that guild **confirms** (host guild is auto, never asks itself). Confirmation policy is per-partnership configurable: some partners are allow-listed (auto-share), others require **per-event approval**.

### Data model (new)
- **`EventDistribution`** — one row per (operation, targetGuild):
  - `id`, `operationId`, `sourceGuildId`, `targetGuildId`
  - `status`: `pending | approved | declined | auto | revoked`
  - `contactUserId String?` — the **named contact person** for this target guild (decided per event, see below). Must be a member of `targetGuildId`.
  - `discordEventId String?` — the scheduled-event id created in the target guild (null until approved+posted)
  - `decidedByUserId String?`, `decidedAt DateTime?`
  - `@@unique([operationId, targetGuildId])`

### Contact person (per event × target guild) — DECIDED
The approval recipient is **a named contact person chosen per event for each target partner guild**, NOT a guild-wide default and NOT a host-side op role. Rationale: whoever accepts/declines must hold the rights on that **partner** Discord, so the host designates a real liaison who is a member of that partner guild.

- Surfaced in the op as a mission role label per partner, e.g. **"Contact Person — <Partner Discord A>"**, **"Contact Person — <Partner Discord B>"**.
- Set per event when distribution is configured: for each active partner guild, the host picks a `contactUserId` from that guild's `GuildMembership` (validated: the user must belong to `targetGuildId`). Only `manual` (non-allow-listed) partners need a contact; allow-listed/auto partners may omit it.
- The contact (and only the contact) receives the approval DM + appears in the web inbox for that guild; their Teilen/Ablehnen sets `EventDistribution.status`.
- Optional convenience: remember the last contact per (sourceGuild, targetGuild) to pre-fill next time (a `PartnerSharePolicy.defaultContactUserId`), but it stays **per-event overridable**.
- **Partnership sharing policy** — extend `GuildPartnership` (or a side table keyed per direction) with:
  - `autoShareInbound Boolean @default(false)` on the **receiving** side — "events from this partner auto-publish into my Discord".
  - Decision: policy is **directional** (B decides whether A's events auto-post into B). Since `GuildPartnership` is a single row for the A↔B pair, store two flags (`autoShareAToB`, `autoShareBToA`) OR a dedicated `PartnerSharePolicy { ownerGuildId, partnerGuildId, autoShare }`. **Recommended:** dedicated `PartnerSharePolicy` table — cleaner directional semantics, avoids A/B-order confusion (same trap as the existing partnership A/B duplicate-user gotcha).

### Flow
1. Host opens op / toggles "distribute to partners" (or visibility ≥ `partners`). System enumerates `getActivePartnerGuildIds(hostGuildId)`.
2. For each target guild, read its `PartnerSharePolicy.autoShare` for the host:
   - **auto** → create `EventDistribution(status="auto")`, immediately `createScheduledEvent` in the target guild, store `discordEventId`.
   - **manual** → create `EventDistribution(status="pending")`, send approval prompt (below).
3. On op edit/cancel/delete → `updateScheduledEvent` / `deleteScheduledEvent` fan out to every distribution with a `discordEventId`.

### Approval UX — Discord DM with buttons ("Teilen" / "Ablehnen")
Target: DM the target guild's Admiral(s)/fleetoperators with an **event preview embed** + two buttons.

**Key design gap:** the Fleetplanner bot today is REST-only (no gateway/interaction listener). Buttons require handling Discord **message component interactions**. Two options:

| Option | How | Trade-off |
|---|---|---|
| **A. HTTP Interactions endpoint** | Register an Interactions URL on the Fleetplanner Discord app; verify Ed25519 with `DISCORD_FLEETPLANNER_PUBLIC_KEY`; Fastify route `/discord/interactions` handles button `custom_id` (`evt-share:<distId>` / `evt-decline:<distId>`). | No persistent gateway connection; fits the existing Fastify/stateless model. Needs public key + signature verify (already done in bridge for RDOC-RTC). **Recommended.** |
| **B. Gateway client** | Add a discord.js gateway client to fleetplanner listening for `interactionCreate`. | New long-lived connection + intents; heavier; duplicates bot presence. |

- DM goes to the designated **contact person** (`EventDistribution.contactUserId`) of the target guild — not a guild-wide broadcast.
- `custom_id` carries the `EventDistribution.id`; handler checks the clicking user **is** that `contactUserId` (and still a member of `targetGuildId`), then sets status `approved`→post event, or `declined`. If no contact was set for a manual partner, distribution stays `pending` and only surfaces in the web inbox.
- **Web fallback** (always): a "Shared with you" inbox under `/guilds/...` listing pending `EventDistribution`s where the viewer is the contact (or a fleetoperator of the target guild), with Teilen/Ablehnen buttons (server-rendered, CSRF) — covers a missed DM and is the source of truth if interactions fail.
- Preview embed reuses the op's OG fields (When/System/Rendezvous/Org/host) — see the OG work in [pages.ts](apps/fleetplanner/src/web/pages.ts) `opDetailPageV2`.

### Decisions (F1) — 2026-06-05
1. **Approval recipient:** a named **contact person per event × target guild** (mission role "Contact Person — <Discord>"), member of the target guild. See above.
2. **Decline is per-event only.** Declining one event never mutes future events from that partner — those keep arriving as proposals. Silencing a partner is done explicitly via the allowlist/`PartnerSharePolicy`, not by declining.
3. **Partner-guild event entity = EXTERNAL**, `entity_metadata.location` = the host op page URL. One clear anchor; cross-guild voice is F2's concern, never baked into the F1 event type.

---

## Feature 2 — Federation Voice (cross-Discord voice for partner events)

### Goal
Per event, pick a voice mode:
- **"All on one Discord"** — participants from all partner guilds join the **host** guild's voice (today's relay/unit model; cross-guild users come in via Companion or a host invite). Already largely supported.
- **"Homeoffice party"** — everyone **stays on their own guild's Discord**. Each partner guild runs its own relay bot in its own Discord voice channel; all those relay bots bridge a single shared **LiveKit federation room**. An announcement by the host (or a deputy) is heard in **every** guild's channel simultaneously.

Analogy (user's): connected house-parties in different cities — each stays home, voice line links them, but **only the host + deputies may drive the shared voice line**.

### Architecture (Homeoffice mode)
- New shared room: `Operation.federationVoiceRoom String?` (LiveKit room name), opened alongside the mission voice session (`openMissionVoiceSession`).
- **Per partner guild**: that guild's own `GuildVoiceBot` relay bot (guild-scoped `RelayBotsConfig` already exists) subscribes to the federation room and outputs into a Discord voice channel in **its** guild. Reuse the relay-bots worker ([apps/relay-bots](apps/relay-bots)); it already takes `?guildId=` and per-guild config. Extension: a relay bot can be pointed at a **federation** room id, not just the host op's room.
- **Publishers (the "voice line")**: only **host fleetoperator + designated deputies** may publish to the federation room. Everyone else is subscribe-only (hears announcements). This is a LiveKit grant split (publish vs subscribe) — same pattern as the bridge relay token `canPublish` split.
- **Companion guests**: partner-guild members who want to actively talk (beyond hearing the relayed announcement) join the federation room via Companion using a cross-guild mission token (`createMissionVoiceSession`), gated by a federation-publisher grant. Listeners need nothing — they hear it through their guild's relay bot.

### Permission model
- New concept **"Voice Line Controller"** = host fleetoperator + a deputy list per op (`OperationVoiceDeputy { operationId, userId }`, or reuse `OperationLeader` with a `canControlVoiceLine` flag).
- Grant matrix:
  | Actor | Federation room |
  |---|---|
  | Host fleetoperator | publish + subscribe |
  | Deputy (Stellvertreter) | publish + subscribe |
  | Partner guild relay bot | subscribe (→ outputs to its Discord channel) |
  | Other participants / Companion guests | subscribe only (publish only if explicitly granted) |
- Server-side enforced in the LiveKit token mint (never trust client). Mirrors existing rule "permissions checked server-side, client checks are UX only".

### Reuse vs new
- **Reuse:** `GuildVoiceBot` / guild-scoped `RelayBotsConfig`, relay-bots worker, `openMissionVoiceSession`/`closeMissionVoiceSession`, LiveKit token mint with grant split, Companion mission flow.
- **New:** `Operation.federationVoiceRoom`, federation room lifecycle across N guilds, deputy model, relay-bot "join this federation room" instruction per partner guild, per-event mode flag (`Operation.voiceMode: "host" | "federation"`).

### Concurrent events & isolation (relay-bots refactor) — REQUIRED for F2
**Problem.** Multiple events must run at once and stay isolated: e.g. 2 users in Event A, 3 in Event B; **A participants must NOT hear B**. Today's worker can't: it is single-session per guild and **broadcasts one room's mixed PCM to every bot**.

**Current architecture (single-session, no isolation):**
- One relay-bots worker per guild, bound to one room (`RelayBotsConfig` PK `guildId`, single `roomName`).
- One `LivekitSubscriber` → one room → one mixed PCM stream.
- `BotManager.pushPcm` broadcasts the **same** PCM to **all** bots ([apps/relay-bots/src/discord/botManager.ts](apps/relay-bots/src/discord/botManager.ts) `pushPcm` loops every bot). Each `RelayBot` = one Discord token + one `channelId`.
- Net: one room → all channels hear the same thing. No per-event separation.

**Three isolation layers needed:**
1. **Room per event** (LiveKit). Each event = its own `federationVoiceRoom`; a subscriber on room A never receives room-B audio. (Already in the model.)
2. **Distinct Discord bot identity per concurrent channel.** Discord hard limit: **one bot user can occupy only ONE voice channel per guild.** So Event A and Event B in the *same* guild require **different bot tokens** — exactly what the 6× `GuildVoiceBot` pool provides (Bot#1→channel A, Bot#2→channel B).
3. **Per-session routing.** Drop the global broadcast: PCM from room A goes **only** to A's bots.

**Worker changes (single-session → N concurrent sessions per guild):**
- New concept **`RelaySession` = { opId, roomName, members: [{ botUserId/token, channelId }] }`**.
- **One `LivekitSubscriber` per active session** (per room), not one global subscriber.
- Route each session's PCM **only** to that session's bots — group bots by session instead of `BotManager` broadcasting to all.
- **Bot allocator:** reserve distinct `GuildVoiceBot` identities per session+channel; free them on event close. `GuildVoiceBot.assignedChannelId` is the existing hook — extend with `assignedOpId` / `assignedRoom`.
- **Lifecycle:** op opens → allocate bots + spawn a subscriber for its room; op closes → free bots + tear down **only that** subscriber (other live sessions keep running).

**Cross-guild federation:** each participating guild runs a session pointing at the **same** federation room but outputting to **its own** channel. Event A's room is relayed by guild-X-bot + guild-Y-bot; Event B uses a different room + different bots. Isolation holds because rooms differ and routing is per-session.

**Caps (concurrency):**
- **Per guild, concurrent: Σ(event channels) ≤ bot pool size (6 today).** 2 events × 1 channel = 2 bots; an event with 3 unit channels + an event with 2 = 5 bots. More simultaneous events/units ⇒ enlarge the per-guild bot pool.
- The F2 **hard cap 16** is *publishers per federation room* — a separate dimension from the relay-bot pool.

**Schema follow-up.** `RelayBotsConfig` (one `roomName` per guild) gains a session dimension: either a **`RelaySession`** table keyed `(guildId, opId)` with its own room + bot/channel assignments, or the bridge `service-config` returns an **array** of sessions. The worker fetches all active sessions for its guild and holds one subscriber per session.

### Decisions (F2) — 2026-06-05
1. **Activation: explicit opt-in per event.** A partner joins federation voice only after (a) accepting the F1 distribution AND (b) separately opting into federation voice for that event — and having voice permission + a free relay bot. No surprise hot-mic. Store an opt-in flag on `EventDistribution` (e.g. `federationOptIn Boolean`).
2. **Voice line: host + deputies, cross-guild allowed.** Host fleetoperator and a per-op deputy list may publish; deputies **may be members of partner guilds**. Everyone else subscribe-only. Per-op deputy grants via `OperationVoiceDeputy`.
3. **Hard cap 16.** Max 16 active publishers/guilds in a federation room (matches the SACompanion mesh ceiling). Enforced server-side at token mint / relay-bot join; reject + surface a clear error beyond 16.
4. Echo/loopback (engineering, settled): relay bots are subscribe-only in the federation room and never re-publish their own output — publish-gating already guarantees this.

---

## Feature 3 — Recurring Events

### Goal
An op can recur (e.g. "every Saturday 20:00 CEST"). Each occurrence is materialised as a real `Operation` instance with its own roster/seats/voice and (optional) distribution.

**Discord DOES support native recurring scheduled events** (`recurrence_rule` on the Guild Scheduled Event API — corrected 2026-06-05, earlier plan was wrong). The Discord UI exposes exactly: *Wiederholt sich nicht / Jeden Freitag / Jeden zweiten Freitag / Am ersten Freitag jedes Monats / Jährlich am <Datum>*. But it's a **constrained RRULE subset** and it does **not** give us per-occurrence op pages, so we still materialise op instances on our side. Two layers:
1. **Discord side** — set `recurrence_rule` on the scheduled event so Discord shows the native "recurring" badge + auto-lists upcoming occurrences.
2. **Fleetplanner side** — a template + scheduler still spawns concrete `Operation` instances (seats/roster/voice/distribution are all per-op and per-occurrence).

#### Discord `recurrence_rule` constraints (verified against the API docs)
- `frequency`: `YEARLY(0) | MONTHLY(1) | WEEKLY(2) | DAILY(3)`; `start` (ISO8601) required.
- `interval`: only >1 for **WEEKLY where it must be exactly 2** (every-other-week) and `by_weekday` is a single day; otherwise 1.
- `by_weekday` (0–6 Mon–Sun) **xor** `by_n_weekday` (nth-weekday-of-month, length 1 for MONTHLY).
- `YEARLY` requires both `by_month` + `by_month_day` (each length 1). `DAILY` `by_weekday` limited to preset sets (Mon–Fri, Tue–Sat, …).
- **`count`, `end`, `by_year_day` are NOT externally settable** → a Discord recurring event is open-ended; any series end/count must be enforced **by Fleetplanner** (stop spawning, optionally delete/modify the Discord event).
- Guild cap: **100** SCHEDULED/ACTIVE events per guild — favours rolling/lazy occurrence creation, not bulk pre-spawning.

#### Native-event vs per-occurrence-event — the real design choice
| Approach | Discord side | Op-page deep link | Notes |
|---|---|---|---|
| **A. Native recurring event** | one event with `recurrence_rule` | links to the **series/template** page (one URL, not per-occurrence) | cheap, native badge, fits the 100-cap; but the embed link can't be per-occurrence |
| **B. Per-occurrence single events** | scheduler creates a fresh event per spawned op | each links to its own op page (accurate OG/embed) | no native badge; rolling creation keeps well under the cap |
| **C. Hybrid** | native recurring event for visibility **+** Fleetplanner ops per occurrence | series link | best UX, most moving parts |

**Recommended:** start with **A** for patterns Discord can represent (map our recurrence → `recurrence_rule`), fall back to **B** for patterns Discord can't (e.g. our richer RRULEs, or when a per-occurrence op-page link in the embed matters). Whichever, Fleetplanner still owns occurrence materialisation.

### Data model (new)
- **`OperationRecurrence`** (or fields on a template op):
  - `id`, `guildId`, `createdById`
  - `rrule String` (iCal RRULE, e.g. `FREQ=WEEKLY;BYDAY=SA`) or structured `{ freq, interval, byday, until/count }`. A `discordRepresentable Boolean` (computed) flags whether this pattern maps onto Discord's constrained `recurrence_rule` (→ approach A) or needs per-occurrence events (→ approach B).
  - `seriesEnd DateTime?` / `seriesCount Int?` — **Fleetplanner-enforced** (Discord can't store these); scheduler stops spawning when reached.
  - `discordRecurringEventId String?` — set in approach A (the single native recurring Discord event).
  - `templateJson` — the op blueprint (title, opType, system, location, visibility, default voice mode, composition snapshot)
  - `nextRunAt DateTime`, `lastSpawnedAt DateTime?`, `active Boolean`
  - `leadTimeHours Int` — how far ahead to create the next concrete op (so DMs/distribution/reminders have runway)
- Concrete instances: `Operation.recurrenceId String?` back-reference + `Operation.occurrenceAt`.

### Scheduler
- Reuse the existing scheduler pattern ([voiceSession.ts](apps/fleetplanner/src/services/voiceSession.ts) `startVoiceSessionScheduler`, and the reminder scheduler). A periodic job: for each active `OperationRecurrence` where `nextRunAt - leadTime <= now`, spawn the next `Operation` from `templateJson`, create its Discord event(s), trigger F1 distribution if configured, advance `nextRunAt` per RRULE.
- Timezone-correct: compute occurrences in the guild's IANA tz (`Guild.timezone`, helpers in [lib/timezone.ts](apps/fleetplanner/src/lib/timezone.ts)). DST-aware (RRULE in local tz, not UTC arithmetic).

### Edit semantics (the classic recurrence trap)
- Editing one occurrence = edit just that `Operation` instance.
- Editing the series = edit `templateJson`; only **future, not-yet-spawned** instances change. Already-spawned instances stay unless explicitly bulk-updated.
- Deleting the series stops spawning; existing instances + their Discord events remain unless cascaded.

### Decisions (F3) — 2026-06-05
1. **Approach A — native recurring Discord event.** The recurrence UI is limited to **exactly Discord's option set** (no-repeat / weekly any day / every-other-week single day / nth-weekday-of-month / yearly month+day) so every pattern maps cleanly onto `recurrence_rule`. One native Discord event with the recurring badge; richer custom RRULEs (approach B) deferred — not built now.
2. **RRULE handling: use a small `rrule` dependency.** Needed regardless for occurrence math + DST, since `count`/`end` are Fleetplanner-enforced (Discord won't store them).
3. **Rolling single instance ahead**, controlled by `leadTimeHours`; respects the 100-events/guild cap. No bulk pre-spawn.
4. **Series-level distribution approval (approve once).** For a recurring op, the per-target contact person approves **once for the whole series** → all future occurrences auto-share to that partner (allow-listed partners stay auto regardless). This intentionally overrides F1's per-occurrence default **for series only** — fewer DMs, blanket consent accepted by the user. A partner can still later mute the series via the allowlist.
   - Note interplay with F1 decision 2 (per-event decline): a partner may still decline an individual spawned occurrence; series approval sets the default, per-occurrence decline is the override.

---

## Suggested build order
1. **F1 schema + fan-out create/update/delete** (no approval yet — auto-share only) → cross-posting works for allow-listed partners.
2. **F1 approval** — web inbox first (source of truth), then Discord DM buttons (HTTP interactions endpoint).
3. **F3 recurrence** — independent of voice; reuses scheduler. High value, lower risk.
4. **F2 federation voice** — largest/riskiest; depends on relay-bot federation-room support + deputy model + LiveKit grant work. Ship "All on one Discord" path first (mostly exists), then Homeoffice federation.

## Cross-feature open decisions
- Permission source for "fleetoperator of target guild" is `GuildMembership.role` (per-guild), NOT `User.role` (global superadmin only) — see CLAUDE.md role-scoping note.
- All new Discord interaction inputs validated with Zod at the boundary; Discord IDs always strings.
- Relay/federation tokens follow the existing encrypted BYOK pattern (`VOICEBOT_ENCRYPTION_KEY`); never log secrets.

---
*This is a design doc only. Nothing here is in the codebase. Implement only on explicit instruction, feature by feature, mergelog-first.*
