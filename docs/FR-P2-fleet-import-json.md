# Fleet Import via JSON — bulk-add user ships (CCU-Game format)

**FeatureRequest — Priority 2** (scale 1 highest … 5 lowest)
**Status:** ✓ **Implemented 2026-06-06** — `services/fleetImport.ts` + `POST /profile/fleet-import`
+ profile "Import fleet (JSON)" UI. Matches CCU-Game JSON to the catalog (case-insensitive + fuzzy),
upserts `UserShip`. NOTE: `UserShip` is unique per (user, model) → duplicate hulls collapse to one
owned entry. **Update 2026-06-07:** [FR-P3-org-fleet.md](FR-P3-org-fleet.md) decision 3 supersedes
this — add `UserShip.quantity` and have the import set the per-model count (collapse to one row *with
a count*), to be done when Org Fleet lands.

## Dependencies
- **= Backlog #1 "CCU Chain Import (Personal Hangars)"** — supersede/merge that backlog item.
- Builds on the existing **UserShip** model + ship catalog (`shipSync` / local ship DB; profile page `/profile` already adds/removes owned ships, `prisma.userShip`). Reuses ship-name → catalog matching that registration/profile already do.
- No hard dep on other FRs.

## Goal
A user (concretely: **Vi5E**) pastes/uploads a JSON export from CCU-Game and gets all their ships added to their profile in one go, instead of adding each by hand.

## Input format (verified sample)
```json
[
  {"name":"600i Explorer","shipname":"Libertalia","type":"ship"},
  {"name":"85X","shipname":"","type":"ship"},
  {"name":"Carrack Expedition","shipname":"Heureka","type":"ship"},
  {"name":"mdc","shipname":"","type":"ship"}
]
```
- `name` = ship model (free-form casing: "f8c lightning", "Carrack Expedition"). Must be matched to the local ship catalog (case-insensitive, fuzzy/alias — catalog uses canonical names).
- `shipname` = optional user nickname → `UserShip.nickname`.
- `type` = always "ship" in the sample; treat non-"ship" defensively.
- **Duplicates are expected** (sample has 7× "mdc", 2× "Polaris", 2× "Buccaneer") → import must support multiple `UserShip` rows of the same model (one per hull), not dedupe.

## Approach (sketch)
- Profile page: "Import fleet (JSON)" → textarea/file → Zod-validate array → per entry: resolve model against catalog, create a `UserShip` (with nickname if present).
- **Match report:** show matched vs unmatched models (e.g. typos, ships not in catalog) before committing; let the user confirm. Unmatched rows skipped with a list.
- Idempotency/safety: import is additive (creates hulls); offer a "replace my fleet" option separately (clears existing UserShips first) — default = append.
- Casing: normalise via the same lookup registration uses; keep an alias map for known oddities ("f7a hornet mk ii" → "F7A Hornet Mk II", "mdc" → "MDC", "atls" → "ATLS").

## Open decisions
1. Append vs replace as default (lean: append, with explicit replace option).
2. How to handle unmatched models — skip + report (lean), or create a placeholder UserShip?
3. Source-format lock-in: only CCU-Game JSON now, or a generic schema others can target later? (Lean: validate the CCU-Game shape, keep the parser isolated so a second format can be added.)

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
