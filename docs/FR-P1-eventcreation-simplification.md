# Event Creation Simplification — Mobile join view + Admin wizard

**FeatureRequest — Priority 1** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured from roadmap dump 2026-06-06.

## Dependencies
- Touches the existing op-create/edit form (`opFormPage` in [pages.ts](apps/fleetplanner/src/web/pages.ts)) + op-detail (`opDetailPageV2`) + responsive CSS in [render.ts](apps/fleetplanner/src/web/render.ts).
- **No hard dep** on other FRs. Should land before heavy event features so the new flows are the baseline.
- **TODO sighting:** "Vi5E Tools" — a set of helper tools the user mentioned; must be reviewed before finalising the admin wizard scope.

## Goal
Two distinct, purpose-built views instead of one dense form:

### 1. Mobile / Join view (for participants who only sign up)
- Optimised for phones; the common path = browse op → claim a seat / register as crew → done.
- Minimal chrome: When/System/Rendezvous, the roster, one clear "Join / Claim seat" action, voice link.
- Reuses the OG/Action-Details fields already built (`opDetailPageV2`). Focus = responsive layout + reduced cognitive load, not new data.

### 2. Admin / event-administrative view (wizard-guided)
- Step-by-step assistant for the host creating/configuring an op: basics (title/type/when) → location → composition/units → visibility + distribution → voice mode → review.
- Replaces the single long `opFormPage` with a guided multi-step flow (progress like the Discord event UI: Verzeichnis / Eventinformationen / Vorschau).
- Each step validates before "Weiter"; final "Vorschau" before publish.

## Approach (sketch)
- SSR multi-step (Fastify) with step state in query/hidden fields or a draft `Operation(status="draft")` that the wizard fills incrementally (draft already exists in the status enum).
- Mobile view = a responsive variant of op-detail; gate heavy admin controls behind role as today (`canManage`/`canAssignSeats`).
- Test responsive CSS with the existing playwright harness pattern (memory `reference_fleetplanner_css_test_harness`).

## Open decisions
1. Wizard as true multi-page (server round-trips) vs single page with stepped sections (progressive reveal). (Lean: stepped single page first, fewer round-trips; can split later.)
2. Mobile view = same route with responsive CSS, or a dedicated `?view=mobile` / separate template? (Lean: responsive CSS on one template — one source of truth.)
3. Scope of "Vi5E Tools" — needs sighting before locking the admin wizard steps.

---
*Design doc only. Implement on explicit instruction, mergelog-first.*
