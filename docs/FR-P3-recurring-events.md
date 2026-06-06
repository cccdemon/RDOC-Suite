# Recurring Events — RRULE series that spawn op instances

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** Plan approved 2026-06-05, **NOT yet implemented**. No schema/code exists.
**Split from:** the former combined `partner-events-plan.md`.

## Dependencies
- **Core is standalone** — single-guild recurring ops need only the Operation model + a scheduler. No dependency on F2.
- **Soft depends on [FR-P1-event-distribution.md](FR-P1-event-distribution.md):** only the *series-distribution* behaviour (decision 4 — approve a whole series once) needs F1. Recurrence works without F1; if F1 isn't built yet, the scheduler simply doesn't fan out to partners.
- **Reuses live infra:** scheduler pattern `startVoiceSessionScheduler` + the reminder scheduler ([voiceSession.ts](apps/fleetplanner/src/services/voiceSession.ts)); Discord events in [discord.ts](apps/fleetplanner/src/services/discord.ts); tz helpers in [lib/timezone.ts](apps/fleetplanner/src/lib/timezone.ts) (`Guild.timezone`).

Cross-cutting: mergelog-first; Discord IDs always strings; validate inputs with Zod.

---

## Goal
An op can recur (e.g. "every Saturday 20:00 CEST"). Each occurrence is materialised as a real `Operation` instance with its own roster/seats/voice and (optional) distribution.

**Discord DOES support native recurring scheduled events** (`recurrence_rule` on the Guild Scheduled Event API). The Discord UI exposes exactly: *Wiederholt sich nicht / Jeden Freitag / Jeden zweiten Freitag / Am ersten Freitag jedes Monats / Jährlich am <Datum>*. But it's a **constrained RRULE subset** and gives **no per-occurrence op pages**, so we still materialise op instances on our side. Two layers:
1. **Discord side** — set `recurrence_rule` on the scheduled event so Discord shows the native "recurring" badge + auto-lists upcoming occurrences.
2. **Fleetplanner side** — a template + scheduler spawns concrete `Operation` instances (seats/roster/voice/distribution are all per-op and per-occurrence).

## Discord `recurrence_rule` constraints (verified against the API docs)
- `frequency`: `YEARLY(0) | MONTHLY(1) | WEEKLY(2) | DAILY(3)`; `start` (ISO8601) required.
- `interval`: only >1 for **WEEKLY where it must be exactly 2** (every-other-week) and `by_weekday` is a single day; otherwise 1.
- `by_weekday` (0–6 Mon–Sun) **xor** `by_n_weekday` (nth-weekday-of-month, length 1 for MONTHLY).
- `YEARLY` requires both `by_month` + `by_month_day` (each length 1). `DAILY` `by_weekday` limited to preset sets (Mon–Fri, Tue–Sat, …).
- **`count`, `end`, `by_year_day` are NOT externally settable** → a Discord recurring event is open-ended; any series end/count must be enforced **by Fleetplanner**.
- Guild cap: **100** SCHEDULED/ACTIVE events per guild — favours rolling/lazy occurrence creation, not bulk pre-spawning.

## Native-event vs per-occurrence-event — the design choice
| Approach | Discord side | Op-page deep link | Notes |
|---|---|---|---|
| **A. Native recurring event** | one event with `recurrence_rule` | links to the **series/template** page | cheap, native badge, fits the 100-cap; embed link not per-occurrence |
| **B. Per-occurrence single events** | scheduler creates a fresh event per spawned op | each links to its own op page | no native badge; rolling creation stays under the cap |
| **C. Hybrid** | native recurring event + Fleetplanner ops per occurrence | series link | best UX, most moving parts |

## Data model (new)
- **`OperationRecurrence`**:
  - `id`, `guildId`, `createdById`
  - `rrule String` (iCal RRULE) or structured `{ freq, interval, byday, ... }`. A computed `discordRepresentable Boolean` flags whether the pattern maps onto Discord's constrained `recurrence_rule`.
  - `seriesEnd DateTime?` / `seriesCount Int?` — **Fleetplanner-enforced** (Discord can't store these); scheduler stops spawning when reached.
  - `discordRecurringEventId String?` — set in approach A (the single native recurring Discord event).
  - `templateJson` — the op blueprint (title, opType, system, location, visibility, default voice mode, composition snapshot).
  - `nextRunAt DateTime`, `lastSpawnedAt DateTime?`, `active Boolean`, `leadTimeHours Int`.
- Concrete instances: `Operation.recurrenceId String?` back-reference + `Operation.occurrenceAt`.

## Scheduler
- Reuse the existing scheduler pattern. A periodic job: for each active `OperationRecurrence` where `nextRunAt - leadTime <= now`, spawn the next `Operation` from `templateJson`, create its Discord event, trigger F1 distribution if configured (and F1 exists), advance `nextRunAt` per RRULE.
- Timezone-correct: compute occurrences in the guild's IANA tz. DST-aware (RRULE in local tz, not UTC arithmetic).

## Edit semantics (the classic recurrence trap)
- Editing one occurrence = edit just that `Operation` instance.
- Editing the series = edit `templateJson`; only **future, not-yet-spawned** instances change. Already-spawned instances stay unless explicitly bulk-updated.
- Deleting the series stops spawning; existing instances + their Discord events remain unless cascaded.

## Decisions (F3) — 2026-06-05
1. **Approach A — native recurring Discord event.** The recurrence UI is limited to **exactly Discord's option set** so every pattern maps cleanly onto `recurrence_rule`. One native Discord event with the recurring badge; richer custom RRULEs (approach B) deferred.
2. **RRULE handling: use a small `rrule` dependency.** Needed for occurrence math + DST anyway, since `count`/`end` are Fleetplanner-enforced.
3. **Rolling single instance ahead**, controlled by `leadTimeHours`; respects the 100-events/guild cap. No bulk pre-spawn.
4. **Series-level distribution approval (approve once).** For a recurring op, the per-target contact person (F1) approves **once for the whole series** → all future occurrences auto-share to that partner (allow-listed partners stay auto regardless). Overrides F1 decision 2's per-occurrence default **for series only**. A partner can still mute the series via the allowlist, or decline an individual spawned occurrence (per-occurrence decline is the override). *This decision is inert until F1 exists.*

## Build order (within F3)
1. `OperationRecurrence` schema + template capture from an existing op.
2. Scheduler spawns instances + sets Discord `recurrence_rule` (approach A).
3. Edit/delete-series semantics + UI.
4. Series-distribution hook (only once F1 is live).

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
