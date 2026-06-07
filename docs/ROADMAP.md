# RDOC-Suite Roadmap

Single overview of planned FeatureRequests (FR), their priority (1 highest … 5 lowest), dependencies, and the recommended work order. Detail lives in each `FR-P*-*.md`. Past work = [CHANGELOG.md](../CHANGELOG.md); ground-truth log = [RDOC-SUITE-MERGELOG.md](RDOC-SUITE-MERGELOG.md).

> Convention: one feature per file, `docs/FR-P<n>-<feature>.md`, with a dependency block. New features get added here.

## Planned features

| Prio | Feature | Doc | Depends on | Status |
|---|---|---|---|---|
| P1 | Event Distribution (cross-post to partner Discords) | [FR-P1-event-distribution.md](FR-P1-event-distribution.md) | live partnerships only | ✓ Done (2026-06-07: Phase 1 auto-share + Phase 2 approval inbox + DM buttons). Recipients = all target-guild fleetoperators |
| P1 | Event Creation Simplification (Mobile join + Admin wizard) | [FR-P1-eventcreation-simplification.md](FR-P1-eventcreation-simplification.md) | — (sight "Vi5E Tools") | ✓ Core done (guided wizard + dedicated join view live); pending: sight "Vi5E Tools" |
| P1 | Fleetplanner GUI UX (Join view + Fleet Requirements wording) | [FR-P1-fleetplanner-gui-ux-implementation.md](FR-P1-fleetplanner-gui-ux-implementation.md) | existing Fleetplanner SSR + Composition/FleetUnit models | ✓ Done (2026-06-06) |
| P2 | Fleet Import via JSON (CCU-Game) | [FR-P2-fleet-import-json.md](FR-P2-fleet-import-json.md) | UserShip + ship catalog (= Backlog #1) | ✓ Done |
| P2 | Discord-event "Interested" → auto needs-assignment | [FR-P2-discord-event-interest.md](FR-P2-discord-event-interest.md) | per-op Discord event (live); bot REST poll, no privileged intent | ✓ Done (2026-06-07) |
| ~~P3~~ | Federation Voice (homeoffice party, multi-event) | [FR-P3-federation-voice.md](FR-P3-federation-voice.md) | — | ✗ **Abgelehnt** (Begründung folgt) |
| P3 | Recurring Events (RRULE) | [FR-P3-recurring-events.md](FR-P3-recurring-events.md) | core standalone; series-distribution soft → FR-P1 | ✓ Done (2026-06-06; series-distribution deferred → FR-P1) |
| P3 | Roadmap Tab (+ Discord feedback auto-ingest) | [FR-P3-roadmap-tab.md](FR-P3-roadmap-tab.md) | existing feedback channel/settings | Plan |
| P3 | Language Switch / i18n (Fleetplanner + Companion + MissionCover) | [FR-P3-language-switch.md](FR-P3-language-switch.md) | `User` profile as single source of truth | Plan (large/phased) |
| P3 | Org Fleet (guild ship roster — who owns what) | [FR-P3-org-fleet.md](FR-P3-org-fleet.md) | UserShip + GuildMembership + ship catalog (exists) | Plan |
| P3 | Member Last-Seen + 6-month inactivity alert | [FR-P3-inactivity-alert.md](FR-P3-inactivity-alert.md) | Fleetmanager bot **gateway** + GUILD_MEMBERS intent | Plan |
| P4 | Mission-Cover Microservice (server-render API, op→cover image) | [FR-P4-mission-cover-service.md](FR-P4-mission-cover-service.md) | — (standalone svc; synergy → FR-P1 cross-post) | ✓ Done (incl. Discord-event image); partner cross-post → FR-P1 |
| P5 | Item Database (loot/distribution) | [FR-P5-item-database.md](FR-P5-item-database.md) | **blocked: no items API** | Plan |

## Recommended order (open items only)
*Done: FR-P1 gui-ux, FR-P1 eventcreation (core), FR-P2 fleet-import, FR-P3 recurring-events, FR-P4 mission-cover.*
1. ~~**FR-P1 event-distribution**~~ — ✓ Done (Phase 1+2, 2026-06-07).
2. ~~**FR-P2 discord-event-interest**~~ — ✓ Done (2026-06-07).
3. **FR-P3 org-fleet** — light, most infra exists (needs `UserShip.quantity`).
3. **FR-P3 roadmap-tab** — surfaces everything else + feedback intake.
4. **FR-P3 inactivity-alert** — gateway bot + GUILD_MEMBERS intent.
5. **FR-P3 language-switch / i18n** — large/phased; cross-app.
6. **FR-P5 item-database** — blocked on data source.

*Rejected:* **FR-P3 federation-voice** (Begründung folgt).

Also pending (no FR doc): sight **"Vi5E Tools"** to finalize the eventcreation wizard scope.

## Bugs / improvements (tracked in [FLEETPLANNER-BACKLOG.md](FLEETPLANNER-BACKLOG.md))
| Item | Source | Status |
|---|---|---|
| PTT custom press/release sound | Feedback (Mimosenherkules) | ✓ Done — commit 1efbb17 (Companion, local build pending) |
| 404 on accepted link when not logged in → show login note | Feedback (exrelax) | ✓ Done (loginRequiredPage) |
| Fleet naming: non-capital lead = "Pilot" not "Captain" | Feedback (Mimosenherkules) | ✓ Done (unitLeadTitle) |
| Mission cover editor: edits/positions persist, style-switch keeps inputs, cancel fix, save-bar overlap | Bug (HEADWiG) | ✓ Done 2026-06-06 |
| Bug Reporter: attach screenshots | Feature request (HEADWiG) | ✓ Done 2026-06-07 — `/feedback` accepts up to 4 images (≤8 MB), forwarded as Discord attachments |

## Needs sighting / clarification (no doc yet)
- **"Vi5E Tools"** — tools to be reviewed before locking the eventcreation admin wizard scope.
- **"silentknight: Paul Content nachliefern"** — unclear; needs clarification before it can be triaged.
