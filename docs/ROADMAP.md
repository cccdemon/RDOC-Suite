# RDOC-Suite Roadmap

Single overview of planned FeatureRequests (FR), their priority (1 highest … 5 lowest), dependencies, and the recommended work order. Detail lives in each `FR-P*-*.md`. Past work = [CHANGELOG.md](../CHANGELOG.md); ground-truth log = [RDOC-SUITE-MERGELOG.md](RDOC-SUITE-MERGELOG.md).

> Convention: one feature per file, `docs/FR-P<n>-<feature>.md`, with a dependency block. New features get added here.

## Planned features

| Prio | Feature | Doc | Depends on | Status |
|---|---|---|---|---|
| P1 | Event Distribution (cross-post to partner Discords) | [FR-P1-event-distribution.md](FR-P1-event-distribution.md) | live partnerships only | ✓ Done (2026-06-07: Phase 1 auto-share + Phase 2 approval inbox + DM buttons). Recipients = all target-guild fleetoperators |
| P1 | Event Creation Simplification (Mobile join + Admin wizard) | [FR-P1-eventcreation-simplification.md](FR-P1-eventcreation-simplification.md) | — | ✓ Done (guided wizard + dedicated join view live). "Vi5E Tools" = Mission-Cover (FR-P4, done+deployed) — Sichtung aufgelöst 2026-06-24 |
| P1 | Fleetplanner GUI UX (Join view + Fleet Requirements wording) | [archiv/FR-P1-fleetplanner-gui-ux-implementation.md](archiv/FR-P1-fleetplanner-gui-ux-implementation.md) | existing Fleetplanner SSR + Composition/FleetUnit models | ✓ Done (2026-06-06) |
| P1 | Fleet-Needs-Redesign + geführter Anmelde-Wizard (Hull vs Role-Need, Person→Squad, Wizard B, Sitz-/Turm-Karte) | [FR-P1-fleet-needs-and-guided-join.md](FR-P1-fleet-needs-and-guided-join.md) | Composition/FleetUnit/Seat + ship catalog; evolves FR-P1-eventcreation join view | ✗ **Verworfen** (User 2026-06-24) |
| P1 | Security & Implementation Review (CVEs, API hardening, dead code, dependency hygiene) | [FR-P1-SecurityAndImplenetationReview.md](FR-P1-SecurityAndImplenetationReview.md) | current Fleetplanner/Mission-Cover/Companion/Deploy inventory | ✓ Done (2026-06-24: 6 Findings gefixt+deployt — Header-Layer, Session-Token-Hash, E2E-Seam-Härtung, trustProxy-CIDR, Docker non-root/frozen, Deps) |
| P2 | Fleet Import via JSON (CCU-Game) | [FR-P2-fleet-import-json.md](FR-P2-fleet-import-json.md) | UserShip + ship catalog (= Backlog #1) | ✓ Done |
| P2 | Discord-event "Interested" → auto needs-assignment | [FR-P2-discord-event-interest.md](FR-P2-discord-event-interest.md) | per-op Discord event (live); bot REST poll, no privileged intent | ✓ Done (2026-06-07) |
| P2 | Microservice API/Frontend Split (Backend API-only, FE API-only) | [FR-P2-microservice-api-split-opus-plan.md](FR-P2-microservice-api-split-opus-plan.md) | Fleetplanner services + Prisma; expands FR-P3 frontend split | Plan |
| P2 | Fleetplanner Light (Org-Operator vs Operator-Light; jeder legt Light-Ops an, Op-Tier personal/org + Upgrade) | [FR-P2-fleetplanner-light.md](FR-P2-fleetplanner-light.md) | role/tenant model + op ownership (createdById/leaders) + Discord-event flow | Plan (kein Code; Approach A = Op-Tier statt neuer Rolle) |
| ~~P3~~ | Federation Voice (homeoffice party, multi-event) | [FR-P3-federation-voice.md](FR-P3-federation-voice.md) | — | ✗ **Abgelehnt** (Begründung folgt) |
| P3 | Recurring Events (RRULE) | [FR-P3-recurring-events.md](FR-P3-recurring-events.md) | core standalone; series-distribution soft → FR-P1 | ✓ Done (2026-06-06; series-distribution deferred → FR-P1) |
| P3 | Roadmap Tab (+ Discord feedback auto-ingest) | [FR-P3-roadmap-tab.md](FR-P3-roadmap-tab.md) | existing feedback channel/settings | ✗ **Verworfen** (User 2026-06-24) |
| P3 | Language Switch / i18n (Fleetplanner + Companion + MissionCover) | [FR-P3-language-switch.md](FR-P3-language-switch.md) | `User` profile as single source of truth | Plan (large/phased) |
| P3 | Org Fleet (guild ship roster — who owns what) | [archiv/FR-P3-org-fleet.md](archiv/FR-P3-org-fleet.md) | UserShip + GuildMembership + ship catalog (exists) | ✓ Done (2026-06-15: MVP + Discord tier-1; bot-DM relay deferred) |
| P3 | Member Last-Seen + 6-month inactivity alert | [FR-P3-inactivity-alert.md](FR-P3-inactivity-alert.md) | Fleetmanager bot **gateway** + GUILD_MEMBERS intent | Plan |
| P3 | Polls / Umfragen (guild/partner/public scope, single + multi-choice) | [FR-P3-polls.md](FR-P3-polls.md) | Op visibility model (`private/partners/public`) + `GuildPartnership` (exists) | ✓ Done (2026-06-24: UI+API live, e2e-Lifecycle grün) |
| P3 | Mission Resource Links (tutorial/guide links on an op) | [FR-P3-mission-resource-links.md](FR-P3-mission-resource-links.md) | `Operation` + Op-UI (exists) | ✓ Implemented (2026-06-11; tsc+tests green, pending deploy) |
| P3 | Stream-Event-Markierung + Filter (icon list/detail/Discord) | [FR-P3-stream-event.md](FR-P3-stream-event.md) | `Operation` + Op-UI + Discord-Event (exists) | ⏳ Phase A in Arbeit (2026-06-29, branch `feat/stream-event`); Phase B (Streamer-Links) verschoben |
| P4 | Mission-Cover Microservice (server-render API, op→cover image) | [FR-P4-mission-cover-service.md](FR-P4-mission-cover-service.md) | — (standalone svc; synergy → FR-P1 cross-post) | ✓ Done (incl. Discord-event image); partner cross-post → FR-P1 |
| P4 | Template Marketplace (share/discover event blueprints) | [FR-P4-template-marketplace.md](FR-P4-template-marketplace.md) | `Operation`+Komposition; FR-P3 resource-links | ✓ Implemented (2026-06-11; publish/browse/apply/delete + visibility scope; tsc+tests green, pending deploy) |
| P5 | Item Database (loot/distribution) | [FR-P5-item-database.md](FR-P5-item-database.md) | **blocked: no items API** | ✗ **Verworfen** (User 2026-06-24, blockiert ohne Items-API) |
| — | Dead-Code-Cleanup (SSR+Voice-Reste entfernen, knip.json als CI-Gate) | — | knip-Inventar 2026-06-24 | **Behalten** (User 2026-06-24) — neu |

## Offene Roadmap nach Review 2026-06-24 (User-Entscheidung)
**Behalten (offen):**
1. **FR-P3 language-switch / i18n** — voll mehrsprachig, groß/phasiert; Locale-Switch-Teil existiert.
2. **FR-P3 inactivity-alert** — Member Last-Seen + 6-Mon-Warnung; braucht Gateway-Bot + GUILD_MEMBERS-Intent.
3. **FR-P2 microservice-api-split (weiter)** — Rest-Trennung Backend/FE (Großteil schon erfolgt).
4. **Dead-Code-Cleanup** — Phase 1 done (2026-06-24: SSR/Voice-Reste + knip-Gate); Rest = 61 Exports/28 Types per-Symbol-Review.

**Verworfen 2026-06-24:** FR-P1 fleet-needs-redesign, FR-P3 roadmap-tab, FR-P5 item-database, FR-P3 federation-voice (bereits abgelehnt).
**Frisch fertig:** Polls, Security-Review (6 Fixes), Mission-Cover (= "Vi5E Tools", Sichtung aufgelöst).

~~Also pending: sight "Vi5E Tools"~~ — resolved 2026-06-24: "Vi5E Tools" = the Mission-Cover service (FR-P4, done + deployed).

## Bugs / improvements (tracked in [FLEETPLANNER-BACKLOG.md](FLEETPLANNER-BACKLOG.md))
| Item | Source | Status |
|---|---|---|
| PTT custom press/release sound | Feedback (Mimosenherkules) | ✓ Done — commit 1efbb17 (Companion, local build pending) |
| 404 on accepted link when not logged in → show login note | Feedback (exrelax) | ✓ Done (loginRequiredPage) |
| Fleet naming: non-capital lead = "Pilot" not "Captain" | Feedback (Mimosenherkules) | ✓ Done (unitLeadTitle) |
| Mission cover editor: edits/positions persist, style-switch keeps inputs, cancel fix, save-bar overlap | Bug (HEADWiG) | ✓ Done 2026-06-06 |
| Bug Reporter: attach screenshots | Feature request (HEADWiG) | ✓ Done 2026-06-07 — `/feedback` accepts up to 4 images (≤8 MB), forwarded as Discord attachments |
| Partner-Token Copy-Button + Kalender „nächster Monat"-Pfeil | Feedback (Hevcon42) | ✓ Done (war bereits master `ff8cda6` / arrow fix) |
| Stream-Event-Markierung + Filter + optionale Streamer-Links | Feedback (exrelax) | ✓ Done 2026-06-29 (Phase A + B1; Live-Status verworfen) |
| Spieler-Verfügbarkeiten im Profil + Operator-Heatmap | Feedback (exrelax) | ✗ **Abgelehnt** (User 2026-06-29) |
| Org-Operator vs Operator-Light (jeder legt Light-Ops an) | Feedback (exrelax) | Plan — [FR-P2-fleetplanner-light.md](FR-P2-fleetplanner-light.md) (kein Code) |

## Needs sighting / clarification (no doc yet)
- ~~**"Vi5E Tools"**~~ — ✓ resolved 2026-06-24: = the Mission-Cover service (FR-P4, done + deployed).
- **"silentknight: Paul Content nachliefern"** — unclear; needs clarification before it can be triaged.
