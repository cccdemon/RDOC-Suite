# Fleetplanner GUI UX - Event Wizard, Join View, Fleet Requirements

**FeatureRequest - Priority 1** (scale 1 highest ... 5 lowest)  
**Status:** Plan, **NOT yet implemented**.  
**Target app:** `apps/fleetplanner`  
**Audience:** Claude-Code / Opus implementation agent

## Dependencies

- Builds on the existing Fleetplanner SSR UI:
  - `apps/fleetplanner/src/web/pages.ts`
  - `apps/fleetplanner/src/web/render.ts`
  - `apps/fleetplanner/src/routes/web.ts`
  - `apps/fleetplanner/src/routes/api.ts`
- Builds on existing models:
  - `Operation`
  - `CompositionGroup`
  - `CompositionRequirement`
  - `FleetUnit`
  - `SeatAssignment`
  - `CrewAssignmentRequest`
- Related docs:
  - `docs/FR-P1-eventcreation-simplification.md`
  - `docs/GUI Architekturplan-Assistenssystem-MissonCreationFlow.md`
  - `docs/composition-rebuild-plan.md`
  - `docs/companion-voice-architecture.md`
- No hard dependency on Event Distribution for the first pass.
- No schema migration in Phase 1.

Cross-cutting rules:

- Mergelog first before code changes.
- All UI copy for new/changed Fleetplanner screens should be English.
- Discord IDs remain strings.
- All POST routes require CSRF.
- Do not weaken tenant visibility or `effectiveOpRole` checks.

## Goal

Make the Fleetplanner GUI easier to understand for two different users:

1. **Fleet Operator / Event Planner**
   - Creates and prepares an operation.
   - Works with event basics, briefing, Discord, Fleet Requirements, visibility, voice, and review.

2. **Player / Participant**
   - Only wants to sign up.
   - Needs event facts, briefing, available options, and one clear join flow.

This plan is intentionally UX-first. The first implementation should reuse the current data model and avoid starting a broad schema rebuild.

## Required Terminology

Use this wording everywhere in the updated UI:

| Old / ambiguous wording | New wording |
|---|---|
| Composition | Fleet Requirements |
| Soll | Requested |
| Ist | Fulfilled |
| Offen | Open Slots |
| freie Sitze inside a ship/team | Open Seats |
| Anmeldung | Signup |
| Spieler | Player / Participant |
| FleetOperator | Fleet Operator |

Important distinction:

- **Open Slots** = missing mission requirements, e.g. one fighter wing still needed.
- **Open Seats** = free crew seats inside an accepted ship or team.

## Phase 1 - Wording and Existing UI Cleanup

Scope:

- No new routes.
- No new Prisma migration.
- No behavior change except clearer display labels.

Files to inspect:

- `apps/fleetplanner/src/web/pages.ts`
- `apps/fleetplanner/src/web/render.ts`
- `apps/fleetplanner/src/routes/web.ts`
- Existing Fleetplanner tests under `apps/fleetplanner/src/__tests__`

Implementation:

1. Rename visible `Composition` labels in operation detail/create/edit UI to `Fleet Requirements`.
2. Rename metrics/table columns:
   - `Requested`
   - `Fulfilled`
   - `Open Slots`
3. Update helper text:

   ```text
   Fulfilled = accepted ships or teams. Open Slots = still needed mission requirements.
   ```

4. Keep `Open Seats` only for individual seat availability inside a `FleetUnit`.
5. Avoid changing database field names in this phase.

Acceptance criteria:

- No player-facing screen shows `Composition`.
- The Fleet Requirements board uses `Requested | Fulfilled | Open Slots`.
- Seat rows still use seat language, not slot language.

## Phase 2 - Fleet Requirements Board Semantics

Goal: make mission demand clear at a glance.

Recommended board columns:

```text
Fleet Requirement | Requested | Fulfilled | Open Slots | Details
```

Calculation:

- `Requested` = `CompositionRequirement.count`
- `Fulfilled` = accepted `FleetUnit`s assigned to that requirement
- `Open Slots` = `max(Requested - Fulfilled, 0)`

Pending behavior:

- Do not count `pending` units as fulfilled.
- Show pending offers separately, e.g. `1 pending`, so the Fleet Operator can see that a requirement may soon be covered.

Rejected behavior:

- Never count `rejected` units.

Overfilled behavior:

- If fulfilled is greater than requested, show `Open Slots = 0` and add a subtle `Overfilled` or `+N extra` indicator.

Acceptance criteria:

- A requirement with 2 requested, 1 accepted, 1 pending shows:
  - `Requested = 2`
  - `Fulfilled = 1`
  - `Open Slots = 1`
  - `1 pending`
- A requirement with 2 requested, 3 accepted shows:
  - `Requested = 2`
  - `Fulfilled = 3`
  - `Open Slots = 0`
  - `+1 extra`

## Phase 3 - Participant Join View

Goal: a normal player should not have to parse the Fleet Operator control surface.

Do not duplicate the operation route unless necessary. Prefer role-aware rendering inside the existing operation detail page.

Player-facing layout:

- Event facts:
  - status
  - visibility
  - scheduled time
  - system
  - rendezvous
  - Discord event voice channel
- Briefing preview.
- Fleet Requirements summary.
- One clear primary action:

  ```text
  I want to join
  ```

Join choices:

1. `Let the operator assign me`
   - Creates or updates a `CrewAssignmentRequest`.
   - Optional note:

     ```text
     Note to Fleet Operator
     ```

2. `Choose an open seat`
   - Shows only claimable open seats from accepted units.
   - Uses existing seat claim route.
   - Uses `Open Seats`, not `Open Slots`.

3. `Offer a ship`
   - Uses existing unit registration flow.
   - In Phase 1, still relies on the current ship/category matching behavior.
   - Later phases can restrict to allowed ships from Fleet Requirements.

Hide from non-operators:

- status transition buttons
- visibility edit controls
- Fleet Requirements edit controls
- unit accept/reject controls
- Discord distribution settings
- voice move controls
- admin diagnostics

Acceptance criteria:

- A crew user sees a compact signup-oriented page.
- A Fleet Operator still sees the operational management controls.
- The primary player action is obvious without reading the whole page.

## Phase 4 - Event Planner Wizard Framing

This phase may stay mostly visual/structural at first.

Recommended steps:

1. `Basics`
   - event name
   - mission type
   - scheduled time
   - rendezvous
   - visibility

2. `Briefing`
   - Markdown text area
   - preview
   - suggested sections:

     ```md
     ## Mission Objective
     ## RoE
     ## Equipment
     ## Notes
     ```

3. `Discord`
   - event voice channel
   - announcement channel placeholder, if not yet implemented

4. `Fleet Requirements`
   - requirements board
   - requirement add/edit controls
   - future template hooks

5. `Review`
   - readiness checklist
   - missing required fields
   - publish/open guidance

Non-goal in this phase:

- Do not implement Event Distribution approval flows.
- Do not implement recurring events.
- Do not implement federation voice.

## Phase 5 - Follow-up Data Model Work

Only after the UX baseline is in place:

- Markdown briefing field separate from `Operation.description`.
- Announcement channel ID.
- Minimum and maximum participant counts.
- `starting` and `finished` status model, or clear UI aliases for existing statuses.
- Operation audit log.
- Fleet Requirement templates.
- Allowed ship rules:
  - explicit allow list
  - explicit deny list
  - size constraints
  - role/career constraints
- Ship offer modes:
  - ship only / loan mode
  - captain or pilot mode
  - alternative suggestion pending Fleet Operator approval

## Suggested Implementation Order

1. Add this plan to docs and link it from the roadmap.
2. Phase 1 wording cleanup.
3. Phase 2 Fleet Requirements board semantics.
4. Phase 3 participant join view.
5. Phase 4 event planner wizard framing.
6. Only then start migrations from Phase 5.

## Verification

Run, if available in the local environment:

```powershell
pnpm --filter @rdoc-suite/fleetplanner test
pnpm --filter @rdoc-suite/fleetplanner build
```

Manual checks:

- Operation detail as Fleet Operator.
- Operation detail as crew user.
- Public operation as logged-out guest.
- Private operation as logged-out guest.
- Partner-visible operation as partner guild member.
- Fleet Requirements board with:
  - no units
  - pending unit
  - accepted unit
  - rejected unit
  - overfilled requirement

If tests are not run, document why in the final implementation handoff.

## Non-goals

- No Prisma migration in Phase 1.
- No Event Distribution implementation.
- No Federation Voice implementation.
- No Recurring Events implementation.
- No item database.
- No rolling seat rotation.
- No rewrite to React; keep the existing Fastify SSR pattern.

## Open Decisions

1. Should `Fulfilled` count only accepted units? Recommendation: yes.
2. Should pending offers appear as a separate chip? Recommendation: yes.
3. Should the player join view be a dedicated route or role-aware rendering in `/ops/:id`? Recommendation: role-aware rendering first.
4. Should `completed` be renamed to `finished` in the DB or only in UI? Recommendation: UI alias first, migration later only if needed.
