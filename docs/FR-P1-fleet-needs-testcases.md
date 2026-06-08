# FR-P1 Fleet-Needs — Testcases

Manual QA checklist for the fleet-needs redesign (steps 1–6 + CQB). Automated unit
tests for the pure logic live in `apps/fleetplanner/src/__tests__/services/composition.test.ts`
and `fleetyards.test.ts` (run: `pnpm --filter @rdoc-suite/fleetplanner test`).

Prereqs: an operation in status `open` (or `draft`), a fleetoperator account, and a
crew account. URLs under `https://suite.raumdock.org/fleetplanner`.

## 1. Composition board (step 1)
- [ ] Op overview → **Fleet Needs** panel shows two groups: **Hull-Need (Schiffe)** and **CQB-Need (Soldaten)**, each with Soll/Ist/Offen + a "Summe" row, and a grand **Gesamt** row.
- [ ] A requirement with category `fps`/`ground` appears under CQB-Need; ship categories under Hull-Need.
- [ ] Fully-filled requirement chips are green; partially filled gold; open grey/red.
- [ ] No requirements → "Noch keine Fleet Needs definiert." (operator gets the hint to add them).

## 2. Guided join wizard (step 3, order B)
- [ ] Join page "I want to join" shows steps in order: **Seat** (only if open seats) → **Offer a ship** → **Join as a CQB soldier** → **Let the operator place me**.
- [ ] With no open seats, the Seat step is absent and "Offer a ship" is pre-selected.
- [ ] Ship and CQB are **separate forms** (ship has hangar/catalog search; CQB has just a note).
- [ ] Closed op → "Sign-up is closed."

## 3. Non-exclusivity (user requirement)
- [ ] Claim a seat → reload join page → wizard is **still shown** with a "you already hold a seat" note; you can additionally offer a ship and/or sign up as CQB.
- [ ] Offer a ship (pending) → wizard still shown; can also sign up as CQB / claim a seat.

## 4. CQB signup + bundling (step 4)
- [ ] As crew: "Join as a CQB soldier" → submit → flash "Signed up as CQB".
- [ ] Operator Fleet tab → **CQB Personnel** panel lists the soldier under "Unassigned soldiers".
- [ ] Tick 2+ soldiers + name → **Create squad from selected** → squad row appears with member names; soldiers leave the pool.
- [ ] **Auto-bundle into squads of N** chunks the remaining pool into squads of N.
- [ ] **Dissolve** a squad → members return to the pool.
- [ ] Withdraw (self or operator) removes a signup.
- [ ] Same user signing up twice does not duplicate (idempotent).

## 5. CQB drag (follow-up)
- [ ] As operator with ≥1 squad and ≥1 pooled soldier: drag a pooled soldier chip onto a squad row → soldier joins that squad (page reloads, flash "Soldier assigned").
- [ ] Checkbox-select + auto-bundle still work (drag is additive, not required).

## 6. Ship class + auto-match (step 5)
- [ ] Each ship unit card shows a derived **class** tag (Capital / Fighter / Transport …).
- [ ] Board shows a "mismatch" tag when an accepted ship doesn't fit its slot's category.
- [ ] Accept-into-slot dropdown marks matching slots with "✓"; mismatches are allowed (warning only, no hard block).

## 7. Seat/turret map (step 6, stage 1)
- [ ] Each unit card shows a chip strip above the seat list: one chip per seat, green = filled, gold = open, dimmed = off; hover shows the seat label + occupant.

## 8. Fleetyards cache (step 6)
- [ ] `FleetyardsShip` table is populated after boot (~240 rows) with non-null `silhouetteUrl`.
- [ ] `FleetyardsSyncState.lastResult` = `OK <n> models`.
- [ ] (Deferred) silhouette rendered behind the seat/turret card — not yet wired.

## Deferred (not in scope yet)
- Voice channels + completed-op participants/CSV for CQB squads (squads are CompositionGroups, not FleetUnits).
- Silhouette rendered into the seat/turret card.
- Interactive offer-time class-mismatch warning in the join wizard.
