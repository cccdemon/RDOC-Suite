# RDOC-Suite Roadmap

Single overview of planned FeatureRequests (FR), their priority (1 highest … 5 lowest), dependencies, and the recommended work order. Detail lives in each `FR-P*-*.md`. Past work = [CHANGELOG.md](../CHANGELOG.md); ground-truth log = [RDOC-SUITE-MERGELOG.md](RDOC-SUITE-MERGELOG.md).

> Convention: one feature per file, `docs/FR-P<n>-<feature>.md`, with a dependency block. New features get added here.

## Planned features

| Prio | Feature | Doc | Depends on | Status |
|---|---|---|---|---|
| P1 | Event Distribution (cross-post to partner Discords) | [FR-P1-event-distribution.md](FR-P1-event-distribution.md) | live partnerships only | Plan |
| P1 | Event Creation Simplification (Mobile join + Admin wizard) | [FR-P1-eventcreation-simplification.md](FR-P1-eventcreation-simplification.md) | — (sight "Vi5E Tools") | Plan |
| P1 | Fleetplanner GUI UX (Join view + Fleet Requirements wording) | [FR-P1-fleetplanner-gui-ux-implementation.md](FR-P1-fleetplanner-gui-ux-implementation.md) | existing Fleetplanner SSR + Composition/FleetUnit models | ✓ Done (2026-06-06) |
| P2 | Fleet Import via JSON (CCU-Game) | [FR-P2-fleet-import-json.md](FR-P2-fleet-import-json.md) | UserShip + ship catalog (= Backlog #1) | ✓ Done |
| P3 | Federation Voice (homeoffice party, multi-event) | [FR-P3-federation-voice.md](FR-P3-federation-voice.md) | **FR-P1 event-distribution** + relay-bots multi-session refactor | Plan |
| P3 | Recurring Events (RRULE) | [FR-P3-recurring-events.md](FR-P3-recurring-events.md) | core standalone; series-distribution soft → FR-P1 | ✓ Done (2026-06-06; series-distribution deferred → FR-P1) |
| P3 | Roadmap Tab (+ Discord feedback auto-ingest) | [FR-P3-roadmap-tab.md](FR-P3-roadmap-tab.md) | existing feedback channel/settings | Plan |
| P4 | Mission-Cover Microservice (server-render API, op→cover image) | [FR-P4-mission-cover-service.md](FR-P4-mission-cover-service.md) | — (standalone svc; synergy → FR-P1 cross-post) | ✓ Steps 1–5 (Discord-image/cross-post open) |
| P5 | Item Database (loot/distribution) | [FR-P5-item-database.md](FR-P5-item-database.md) | **blocked: no items API** | Plan |

## Recommended order
1. **FR-P1 event-distribution** — base; unlocks federation voice + recurring series-distribution.
2. **FR-P1 fleetplanner-gui-ux-implementation** — concrete wording and participant join-flow baseline; should land with or before the broader eventcreation wizard.
3. **FR-P1 eventcreation-simplification** — core UX baseline before more event features (sight "Vi5E Tools" first).
4. **FR-P2 fleet-import-json** — concrete data ready, self-contained.
5. **FR-P3 recurring-events** — standalone, low risk.
6. **FR-P3 roadmap-tab** — surfaces everything else + feedback intake.
7. **FR-P4 mission-cover-service** — standalone microservice; can land any time, no hard deps (synergy with FR-P1 cross-post).
8. **FR-P3 federation-voice** — largest/riskiest; needs FR-P1 + relay-bots refactor.
8. **FR-P5 item-database** (blocked on data source).

## Bugs / improvements (tracked in [FLEETPLANNER-BACKLOG.md](FLEETPLANNER-BACKLOG.md))
| Item | Source | Status |
|---|---|---|
| PTT custom press/release sound | Feedback (Mimosenherkules) | ✓ Done — commit 1efbb17 (Companion, local build pending) |
| 404 on accepted link when not logged in → show login note | Feedback (exrelax) | Quick-win — in progress this batch |
| Fleet naming: non-capital lead = "Pilot" not "Captain" | Feedback (Mimosenherkules) | Quick-win — in progress this batch |
| Mission cover editor: edits/positions persist, style-switch keeps inputs, cancel fix, save-bar overlap | Bug (HEADWiG) | ✓ Done 2026-06-06 |
| Bug Reporter: attach screenshots | Feature request (HEADWiG) | Open — feedback form posts to Discord; needs file upload → Discord attachment |

## Needs sighting / clarification (no doc yet)
- **"Vi5E Tools"** — tools to be reviewed before locking the eventcreation admin wizard scope.
- **"silentknight: Paul Content nachliefern"** — unclear; needs clarification before it can be triaged.
