# Item Database — loot tracking & distribution

**FeatureRequest — Priority 5** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured from roadmap dump 2026-06-06.

## Dependencies
- **Blocked / low-prio: no item API available.** Star Citizen has no reliable public items API today, so the catalog would have to be hand-maintained or scraped — the main reason this is P5.
- Soft-relates to the participation/DKP export (Backlog #5) — loot distribution is a natural DKP sink.

## Goal
Track who looted what during an operation and how it should be distributed among participants.

## Approach (sketch, blocked on data source)
- `LootItem` (name, optional category/value) + `LootDrop { operationId, itemId, lootedByUserId, qty }` + a distribution step (assign loot to participants, or a roll/DKP-based allocation).
- Without an items API: start with **free-text item names** (no catalog), optionally a small curated local table for common items; add catalog sync later if an API appears.
- Tie into the participation export (Backlog #5) so loot + attendance feed the same DKP foundation.

## Open decisions
1. Free-text items vs curated local catalog vs wait for an API. (Lean: free-text first, given no API.)
2. Distribution model: manual assignment, roll, or DKP-weighted. (Defer until DKP/export direction is set.)
3. Whether this is worth building before an items data source exists at all (currently: no — hence P5).

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
