# docs/archiv — implemented FeatureRequests

Archive of FeatureRequest specs whose feature is **implemented (shipped)**. Kept for history;
the code is the ground truth. Planned / rejected / study FRs stay in [`../`](../).

Moved here 2026-06-12:

| FR | Feature | Status |
| --- | --- | --- |
| FR-P1-event-distribution | Partner event auto-share + approval inbox | ✓ 2026-06-07 |
| FR-P1-eventcreation-simplification | Guided op-create wizard | ✓ 2026-06-06 |
| FR-P1-fleet-need-structured | Structured fleet needs (ships/fighters/CQB) | ✓ |
| FR-P1-fleet-needs-and-guided-join | Fleet needs + guided join | ✓ |
| FR-P1-fleet-needs-testcases | Test cases for the above | ✓ |
| FR-P2-discord-event-interest | Discord scheduled-event interest sync | ✓ 2026-06-07 |
| FR-P2-fleet-import-json | CCU-Game fleet JSON import | ✓ 2026-06-06 |
| FR-P2-microservice-api-split-opus-plan | /api/v1 + SPA strangler split | ✓ 2026-06-12 (deployed) |
| FR-P3-recurring-events | Recurring operation series | ✓ 2026-06-06 |
| FR-P3-frontend-split | React SPA (fleetplanner-web) | ✓ |
| FR-P3-language-switch | Per-user UI language | ✓ |
| FR-P3-mission-resource-links | Operator briefing / resource links | ✓ |
| FR-P3-roadmap-tab | Public roadmap tab | ✓ |
| FR-P4-mission-cover-service | Mission-cover render microservice | ✓ 2026-06-07 |
| FR-P4-template-marketplace | Operation template marketplace | ✓ |

Moved here 2026-06-15 (stale "NOT yet implemented" headers; ROADMAP/CLAUDE.md = ground truth):

| Doc | Feature | Status |
| --- | --- | --- |
| FR-P1-fleetplanner-gui-ux-implementation | Event wizard + join view + Fleet-Requirements wording | ✓ 2026-06-06 |
| opus-tennant-architecture | Op visibility (`private/partners/public`) + Guild partnerships | ✓ (design ref/history) |
| FR-P3-org-fleet | Guild ship roster (who owns what) + Discord contact | ✓ 2026-06-15 (MVP; bot-DM relay deferred) |
| composition-rebuild-plan | Composition Board + Leader-Assign + Auto-Match (steps 1+2 in code, 3–5 open) | ⏸ archived 2026-06-15 (rebuild deferred, partial) |

Moved here 2026-08-22 (feature shipped / report closed):

| Doc | Feature | Status |
| --- | --- | --- |
| FR-P3-polls | Umfragen mit Guild-/Partner-/Public-Scope | ✓ 2026-06-24 |
| FR-P3-stream-event | Stream-Markierung + Filter (Phase A + B1) | ✓ 2026-06-29 |
| UI-UX-FUNKTIONS-AUDIT-CLAUDE-OPUS | IA-/Interaktions-Audit der SPA | ✓ 2026-08-22 (alle zehn Schritte + Detailpunkte) |
| security-review-2026-06-01 | Statische Sicherheitsanalyse (0 kritisch, 3 mittel, 4 niedrig) | ✓ Befunde geschlossen 2026-06-24 |
| websecurity-review-2026-06-01 | Externer Passiv-Check des Livestands | ✓ Header-Befund geschlossen (nginx ist die eine Header-Schicht) |

Still open (in [`../`](../)): FR-SPA-PARITY-RESTORE (nur noch FR-D3),
FR-P2-fleetplanner-light (Plan), FR-P3-inactivity-alert (Plan),
orgmodule-implementationplan (Plan).

Deleted rather than archived (rejected or superseded; history in the merge log):
FR-P3-federation-voice, FR-P5-item-database, FR-P1-SecurityAndImplenetationReview,
FR-P2-discord-autarkic-squadlink-lite-feasibility, the 2026-06-08 Claude-Code test report and the
mission-creation-flow brainstorm.
