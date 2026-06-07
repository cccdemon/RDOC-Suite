# Federation Voice — cross-Discord voice for partner events

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** ✗ **REJECTED (2026-06-07)** — user decision; not planned. Begründung folgt (to be added).
No schema/code exists. Doc kept for context/history.
**Split from:** the former combined `partner-events-plan.md`.

## Dependencies
- **Hard depends on [FR-P1-event-distribution.md](FR-P1-event-distribution.md):** federation is opt-in *after* a partner accepts the F1 distribution; the opt-in flag lives on `EventDistribution`. Without F1 there is no partner-event to join.
- **Hard depends on the relay-bots multi-session refactor** (described below) — without it, concurrent isolated events are impossible.
- **Reuses live infra:** `GuildVoiceBot` (6×/guild pool), guild-scoped `RelayBotsConfig`, relay-bots worker ([apps/relay-bots](apps/relay-bots)), `openMissionVoiceSession`/`closeMissionVoiceSession` in [voiceSession.ts](apps/fleetplanner/src/services/voiceSession.ts), LiveKit token mint with grant split, Companion mission flow (`createMissionVoiceSession`). Voice modes recap: memory `reference_rdoc_voice_modes`.
- **No dependency on F3** (recurring).

Cross-cutting: mergelog-first; permissions server-side enforced (client checks are UX only); federation tokens use the encrypted BYOK pattern (`VOICEBOT_ENCRYPTION_KEY`); never log secrets.

---

## Goal
Per event, pick a voice mode:
- **"All on one Discord"** — participants from all partner guilds join the **host** guild's voice (today's relay/unit model; cross-guild users come in via Companion or a host invite). Already largely supported — ship this path first.
- **"Homeoffice party"** — everyone **stays on their own guild's Discord**. Each partner guild runs its own relay bot in its own Discord voice channel; all those relay bots bridge a single shared **LiveKit federation room**. An announcement by the host (or a deputy) is heard in **every** guild's channel simultaneously.

Analogy: connected house-parties in different cities — each stays home, the voice line links them, but **only the host + deputies may drive the shared voice line**.

## Architecture (Homeoffice mode)
- New shared room `Operation.federationVoiceRoom String?` (LiveKit), opened alongside the mission voice session.
- **Per partner guild:** that guild's own `GuildVoiceBot` relay bot subscribes to the federation room and outputs into a Discord voice channel in **its** guild. Extension to the worker: a relay bot can target a **federation** room id, not just the host op's room.
- **Publishers ("voice line"):** only **host fleetoperator + designated deputies** publish; everyone else subscribe-only. LiveKit grant split (publish vs subscribe) — same pattern as the bridge relay token `canPublish` split.
- **Companion guests:** partner-guild members who want to actively talk join the federation room via Companion using a cross-guild mission token, gated by a federation-publisher grant. Pure listeners need nothing — they hear it via their guild's relay bot.

## Permission model
- **Voice Line Controller** = host fleetoperator + a per-op deputy list (`OperationVoiceDeputy { operationId, userId }`).
- Grant matrix (server-side at token mint):

  | Actor | Federation room |
  |---|---|
  | Host fleetoperator | publish + subscribe |
  | Deputy (Stellvertreter, may be cross-guild) | publish + subscribe |
  | Partner guild relay bot | subscribe (→ outputs to its Discord channel) |
  | Other participants / Companion guests | subscribe only (publish only if explicitly granted) |

## New vs reuse
- **New:** `Operation.federationVoiceRoom`, `Operation.voiceMode: "host" | "federation"`, `OperationVoiceDeputy`, federation room lifecycle across N guilds, relay-bot "join this federation room" instruction per partner guild, `EventDistribution.federationOptIn`.
- **Reuse:** everything in Dependencies above.

## Concurrent events & isolation (relay-bots refactor) — REQUIRED
**Problem.** Multiple events must run at once and stay isolated: e.g. 2 users in Event A, 3 in Event B; **A participants must NOT hear B**. Today's worker can't: it is single-session per guild and **broadcasts one room's mixed PCM to every bot**.

**Current architecture (single-session, no isolation):**
- One relay-bots worker per guild, bound to one room (`RelayBotsConfig` PK `guildId`, single `roomName`).
- One `LivekitSubscriber` → one room → one mixed PCM stream.
- `BotManager.pushPcm` broadcasts the **same** PCM to **all** bots ([botManager.ts](apps/relay-bots/src/discord/botManager.ts) `pushPcm` loops every bot). Each `RelayBot` = one Discord token + one `channelId`.
- Net: one room → all channels hear the same thing. No per-event separation.

**Three isolation layers needed:**
1. **Room per event** (LiveKit). Each event = its own `federationVoiceRoom`; a subscriber on room A never receives room-B audio.
2. **Distinct Discord bot identity per concurrent channel.** Discord hard limit: **one bot user can occupy only ONE voice channel per guild.** So Event A and Event B in the *same* guild require **different bot tokens** — exactly what the 6× `GuildVoiceBot` pool provides (Bot#1→channel A, Bot#2→channel B).
3. **Per-session routing.** Drop the global broadcast: PCM from room A goes **only** to A's bots.

**Worker changes (single-session → N concurrent sessions per guild):**
- New concept **`RelaySession` = { opId, roomName, members: [{ botUserId/token, channelId }] }`**.
- **One `LivekitSubscriber` per active session** (per room), not one global subscriber.
- Route each session's PCM **only** to that session's bots — group bots by session instead of broadcasting to all.
- **Bot allocator:** reserve distinct `GuildVoiceBot` identities per session+channel; free on event close. `GuildVoiceBot.assignedChannelId` is the existing hook — extend with `assignedOpId` / `assignedRoom`.
- **Lifecycle:** op opens → allocate bots + spawn a subscriber for its room; op closes → free bots + tear down **only that** subscriber (other live sessions keep running).

**Cross-guild federation:** each participating guild runs a session pointing at the **same** federation room but outputting to **its own** channel. Event A's room is relayed by guild-X-bot + guild-Y-bot; Event B uses a different room + different bots. Isolation holds because rooms differ and routing is per-session.

**Caps (concurrency):**
- **Per guild, concurrent: Σ(event channels) ≤ bot pool size (6 today).** 2 events × 1 channel = 2 bots; an event with 3 unit channels + an event with 2 = 5 bots. More simultaneous events/units ⇒ enlarge the per-guild bot pool.
- The **hard cap 16** (decision 3) is *publishers per federation room* — a separate dimension from the relay-bot pool.

**Schema follow-up.** `RelayBotsConfig` (one `roomName` per guild) gains a session dimension: either a **`RelaySession`** table keyed `(guildId, opId)` with its own room + bot/channel assignments, or the bridge `service-config` returns an **array** of sessions. The worker fetches all active sessions for its guild and holds one subscriber per session.

## Decisions (F2) — 2026-06-05
1. **Activation: explicit opt-in per event.** A partner joins federation voice only after (a) accepting the F1 distribution AND (b) separately opting in for that event — and having voice permission + a free relay bot. No surprise hot-mic. Flag: `EventDistribution.federationOptIn`.
2. **Voice line: host + deputies, cross-guild allowed.** Host fleetoperator and a per-op deputy list may publish; deputies **may be members of partner guilds**. Everyone else subscribe-only. Per-op grants via `OperationVoiceDeputy`.
3. **Hard cap 16** active publishers/guilds per federation room (matches the SACompanion mesh ceiling). Enforced server-side at token mint / relay-bot join; reject + clear error beyond 16.
4. Echo/loopback (settled): relay bots are subscribe-only in the federation room and never re-publish their own output — publish-gating guarantees this.

## Build order (within F2)
1. "All on one Discord" path (mostly exists today).
2. Relay-bots multi-session refactor (the isolation work above) — prerequisite for everything multi-event.
3. Federation room lifecycle + deputy model + grant split.
4. Companion guest publish path.

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
