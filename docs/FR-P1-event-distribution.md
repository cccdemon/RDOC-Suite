# Event Distribution — cross-post ops to partner Discords

**FeatureRequest — Priority 1** (scale 1 highest … 5 lowest)
**Status:** Plan approved 2026-06-05, **NOT yet implemented**. No schema/code exists.
**Split from:** the former combined `partner-events-plan.md` (now one file per feature).

## Dependencies
- **Depends on:** already-live `GuildPartnership` + `getActivePartnerGuildIds()` + Discord scheduled events (see infra below). **No dependency on F2/F3.** This is the base feature.
- **Depended on by:** [FR-P3-federation-voice.md](FR-P3-federation-voice.md) (F2 needs `EventDistribution` + accept/opt-in), and the *series-distribution* part of [FR-P3-recurring-events.md](FR-P3-recurring-events.md) (F3 decision 4 approves a whole series here).

## Infra this builds on (already live)
- **Partnerships** — `GuildPartnership` (status `pending|active|revoked`), `getActivePartnerGuildIds(guildId)`, mint/accept/revoke in [apps/fleetplanner/src/services/partnerships.ts](apps/fleetplanner/src/services/partnerships.ts). `partners` op-visibility is live.
- **Discord scheduled events** — `createScheduledEvent` / `updateScheduledEvent` / `deleteScheduledEvent` in [apps/fleetplanner/src/services/discord.ts](apps/fleetplanner/src/services/discord.ts) via the single **Fleetplanner bot** (`DISCORD_FLEETPLANNER_BOT_TOKEN`), installed in every partner guild → one token can create an event in any partner guild's Discord. `Operation.discordEventId` today stores **one** host-guild event id only.
- **DMs** — `sendDiscordDm(userId, content)` (REST). Plain-text only; **no Discord interaction (button) handling exists yet** in the Fleetplanner bot.

Cross-cutting rule: every change starts with a `docs/RDOC-SUITE-MERGELOG.md` Queued entry. Permission source for "fleetoperator of target guild" is `GuildMembership.role` (per-guild), NOT global `User.role`. Validate all Discord inputs with Zod; Discord IDs always strings.

---

## Goal
A host guild creates an op with a Discord scheduled event. The event is offered to **all active partner guilds**. Each target guild's Discord gets its own scheduled event — but only after that guild **confirms** (host guild is auto, never asks itself). Confirmation policy is per-partnership configurable: some partners are allow-listed (auto-share), others require **per-event approval**.

## Data model (new)
- **`EventDistribution`** — one row per (operation, targetGuild):
  - `id`, `operationId`, `sourceGuildId`, `targetGuildId`
  - `status`: `pending | approved | declined | auto | revoked`
  - `contactUserId String?` — the **named contact person** for this target guild (decided per event, see below). Must be a member of `targetGuildId`.
  - `discordEventId String?` — the scheduled-event id created in the target guild (null until approved+posted)
  - `decidedByUserId String?`, `decidedAt DateTime?`
  - `@@unique([operationId, targetGuildId])`
- **`federationOptIn Boolean`** on `EventDistribution` is added by F2 — not needed for F1 alone, but reserve the name.

## Contact person (per event × target guild) — DECIDED
The approval recipient is **a named contact person chosen per event for each target partner guild**, NOT a guild-wide default and NOT a host-side op role. Rationale: whoever accepts/declines must hold the rights on that **partner** Discord, so the host designates a real liaison who is a member of that partner guild.

- Surfaced in the op as a mission role label per partner, e.g. **"Contact Person — <Partner Discord A>"**, **"Contact Person — <Partner Discord B>"**.
- Set per event when distribution is configured: for each active partner guild, the host picks a `contactUserId` from that guild's `GuildMembership` (validated: the user must belong to `targetGuildId`). Only `manual` (non-allow-listed) partners need a contact; allow-listed/auto partners may omit it.
- The contact (and only the contact) receives the approval DM + appears in the web inbox for that guild; their Teilen/Ablehnen sets `EventDistribution.status`.
- Optional convenience: remember the last contact per (sourceGuild, targetGuild) to pre-fill next time (a `PartnerSharePolicy.defaultContactUserId`), but it stays **per-event overridable**.

## Partnership sharing policy (allowlist)
- Directional policy: B decides whether A's events auto-post into B. Since `GuildPartnership` is a single row for the A↔B pair, use a dedicated **`PartnerSharePolicy { ownerGuildId, partnerGuildId, autoShare Boolean, defaultContactUserId? }`** table — cleaner directional semantics, avoids A/B-order confusion (same trap as the existing partnership A/B duplicate-user gotcha).

## Flow
1. Host opens op / toggles "distribute to partners" (or visibility ≥ `partners`). System enumerates `getActivePartnerGuildIds(hostGuildId)`.
2. For each target guild, read its `PartnerSharePolicy.autoShare` for the host:
   - **auto** → create `EventDistribution(status="auto")`, immediately `createScheduledEvent` in the target guild, store `discordEventId`.
   - **manual** → create `EventDistribution(status="pending")`, send approval prompt (below).
3. On op edit/cancel/delete → `updateScheduledEvent` / `deleteScheduledEvent` fan out to every distribution with a `discordEventId`.

## Approval UX — Discord DM with buttons ("Teilen" / "Ablehnen")
DM the target guild's designated **contact person** with an **event preview embed** + two buttons.

**Key design gap:** the Fleetplanner bot is REST-only (no gateway/interaction listener). Buttons need Discord **message component interactions**. Two options:

| Option | How | Trade-off |
|---|---|---|
| **A. HTTP Interactions endpoint** | Register an Interactions URL on the Fleetplanner Discord app; verify Ed25519 with `DISCORD_FLEETPLANNER_PUBLIC_KEY`; Fastify route `/discord/interactions` handles button `custom_id` (`evt-share:<distId>` / `evt-decline:<distId>`). | No persistent connection; fits the Fastify/stateless model; signature verify already done in bridge for RDOC-RTC. **Recommended.** |
| **B. Gateway client** | Add a discord.js gateway client listening for `interactionCreate`. | New long-lived connection + intents; heavier; duplicate bot presence. |

- DM goes to `EventDistribution.contactUserId` only — not a guild-wide broadcast.
- `custom_id` carries the `EventDistribution.id`; handler checks the clicker **is** that `contactUserId` (still a member of `targetGuildId`), then sets `approved`→post event, or `declined`. If no contact was set for a manual partner, distribution stays `pending` and only surfaces in the web inbox.
- **Web fallback** (always): a "Shared with you" inbox under `/guilds/...` listing pending `EventDistribution`s where the viewer is the contact (or a fleetoperator of the target guild), with Teilen/Ablehnen buttons (server-rendered, CSRF) — covers a missed DM and is the source of truth if interactions fail.
- Preview embed reuses the op's OG fields (When/System/Rendezvous/Org/host) — see `opDetailPageV2` in [pages.ts](apps/fleetplanner/src/web/pages.ts).

## Decisions (F1) — 2026-06-05
1. **Approval recipient:** a named **contact person per event × target guild** (mission role "Contact Person — <Discord>"), member of the target guild.
2. **Decline is per-event only.** Declining one event never mutes future events from that partner — those keep arriving as proposals. Silencing a partner is explicit via `PartnerSharePolicy`, not by declining.
3. **Partner-guild event entity = EXTERNAL**, `entity_metadata.location` = the host op page URL. One clear anchor; cross-guild voice is F2's concern, never baked into the F1 event type.

## Build order (within F1)
1. Schema (`EventDistribution`, `PartnerSharePolicy`) + fan-out create/update/delete — **auto-share only** (no approval yet) → cross-posting works for allow-listed partners.
2. Approval — **web inbox first** (source of truth), then Discord DM buttons (HTTP interactions endpoint).

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
