# Rolling Crew Positions — rotate multicrew seats on a timer

**FeatureRequest — Priority 5** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured from roadmap dump 2026-06-06 (idea by Vi5E).

## Dependencies
- Builds on the existing **FleetUnit / Seat** model (seats per unit, `seat.order`, `captainId`) in [pages.ts](apps/fleetplanner/src/web/pages.ts) / operations.
- Soft-relates to voice (rotating into a pilot/captain seat may matter for voice control), but the core is seat assignment only.
- Nice-to-have; narrow scope.

## Goal
For a multicrew ship (e.g. Idris), rotate the crew through positions on a fixed interval (default every 30 min) so everyone gets time in each role. **Default OFF**; the event leader can switch it on per op/unit.

## Approach (sketch)
- Per-unit flag `rotateEnabled Boolean @default(false)` + `rotateIntervalMin Int @default(30)` on `FleetUnit`.
- A scheduler tick (reuse the existing scheduler pattern) rotates seat→user assignments within a unit by one step each interval while the op is in progress.
- Notify crew of the new position (in-app and/or Discord DM). Keep an audit of the current rotation offset so reloads are consistent.
- Manual "rotate now" + "stop" controls for the leader.

## Open decisions
1. Rotate scope: within one unit only, or across units? (Lean: within a unit.)
2. Does the captain/pilot seat rotate too, or stay fixed? (Lean: configurable; default rotate all active seats.)
3. Notification channel + spam control (every 30 min DM could annoy) — in-app banner primary, DM optional.
4. Interaction with claimed vs assigned seats — only rotate filled seats; skip empty.

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
