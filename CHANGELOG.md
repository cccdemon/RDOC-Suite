# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added - FR-P2: SPA superadmin guild management (2026-06-12)

- New superadmin API: `GET /api/v1/admin/guilds` (all guilds incl. inactive/banned with member
  counts) and `POST /api/v1/admin/guilds/:id/{ban,unban}`. Instance-superadmin only. SSR twins:
  web.ts /admin + /admin/guilds/:id/{ban,unban}.
- Contract AdminGuild/AdminGuildsResponse + OpenAPI + inject tests (anon 401, bad id 400).
  prod-e2e-readonly: admin anon-gate.
- SPA `/admin` page (superadmin only): server list with active/inactive/banned status and
  ban/unban actions; linked from the profile page for superadmins. MSW tests. (The rest of the
  SSR admin panel — ship/location catalog, user roles, maintenance, bridge — stays on SSR.)

### Added - FR-P2: SPA make-operation-recurring (2026-06-12)

- New `POST /api/v1/operations/:id/recurrence` (fleet operator): turn an existing operation into
  a recurring series (freq weekly/biweekly/monthly_nth/yearly + optional seriesCount/seriesEnd);
  the pattern is derived from the op's own date and guild timezone. 409 if already recurring.
  Complements the existing recurrence/stop. SSR twin: the /ops/new recurrence fields.
- Contract SetRecurrenceRequest + OpenAPI + inject tests (anon 401, bad freq 400).
  prod-e2e-readonly: recurrence anon-gate.
- SPA: a "Serie erstellen" form (frequency + optional count/until) in the op-editor admin area,
  next to the stop-series button. MSW test.

### Added - FR-P2: SPA fleet import (2026-06-12)

- New `POST /api/v1/hangar/import` {fleetJson}: bulk-import owned ships from a CCU-Game JSON
  export (importUserFleet); returns {total, added, already, unmatched[]}. SSR twin:
  web.ts /profile/fleet-import.
- Contract FleetImportRequest/FleetImportResponse + OpenAPI + inject tests (anon 401, empty 400).
  prod-e2e-readonly: import anon-gate.
- SPA: a "Flotte importieren" section on the profile page (paste JSON → import, result summary
  with unmatched names, hangar reload). MSW test. (The opstyle/locale profile sub-forms stay on
  SSR — they are SSR-render preferences with no SPA effect.)

### Fixed - Calendar agenda showed past events (2026-06-12)

- The calendar agenda listed past operations by default. It now shows only upcoming events,
  with a "Nur anstehende ⇄ Vergangene sichtbar" toggle (and an inline reveal link in the empty
  state). The month grid is unchanged (past days stay visible, dimmed).

### Added - FR-P2: SPA guild partnerships (2026-06-12)

- New guild-scoped partnership API (fleet operator of that guild / superadmin):
  `GET /api/v1/guilds/:id/partnerships` (partner list with auto-share flags + the incoming
  shared-event inbox), `POST …/partnerships/invite` (mint a single-use token, returned once),
  `POST …/partnerships/accept` (redeem a token), `PUT …/partnerships/:partnerGuildId/auto-share`,
  `POST …/partnerships/:partnershipId/revoke`, and `POST …/partnerships/events/:eventId/{approve,
  decline}` (the approve/decline re-check the operator role against the distribution's own target
  guild). SSR twins: routes/partnerships.ts.
- Contracts Partnership / IncomingDistribution / PartnershipsResponse + MintInvite/AcceptToken/
  SetAutoShare requests + OpenAPI paths + inject tests (anon 401, bad id/label/partner-id 400).
  prod-e2e-readonly: partnerships anon-gate check.
- SPA `/guilds/partnerships` page: incoming inbox (approve/decline), partner list (auto-share
  toggle, revoke), mint-invite (one-time token reveal) and redeem-token forms; linked from the
  server settings page. MSW tests.

### Added - FR-P2: SPA op editor — publish-template + recurrence (2026-06-12)

- New `POST /api/v1/operations/:id/publish-template` (fleet operator): publish the operation
  as a marketplace template (name/summary/visibility guild|partners|public). SSR twin:
  api.ts /api/ops/:id/publish-template.
- New `POST /api/v1/operations/:id/recurrence/stop` (fleet operator): deactivate a recurring
  series (idempotent — returns stopped:false when the op is not recurring). SSR twin:
  web.ts /ops/:id/recurrence/stop.
- Contract PublishTemplateRequest + OpenAPI paths + inject tests (anon 401, bad id / bad
  visibility 400). prod-e2e-readonly: publish anon-gate check.
- SPA: an "Admin" section on `/ops/:id/edit` with the publish-as-template form and a
  stop-series button. MSW tests. Rounds out the op-editor; remaining advanced composition
  (formations, CQB bundling, unit edit) stays on SSR for now.

### Added - FR-P2: SPA op editor — Bedarfe/needs (2026-06-12)

- New `GET /api/v1/operations/:id/needs` (fleet operator) read model: current ship-hull needs,
  fighter-squad count and CQB-team count/size, plus the ship-type picker catalog + constants.
- New mutations (fleet operator, CSRF-gated): `POST …/needs/ships` (one hull per picked type,
  optional name/note), `PATCH …/needs/:reqId` (rename a ship need), `DELETE …/needs/:reqId`
  (remove a ship need), `PUT …/needs/fighters` (N squads) and `PUT …/needs/cqb` (N teams ×
  size 1–8). SSR twins: api.ts /api/ops/:id/needs/{ships,fighters,cqb} + needs/:reqId/*.
- Contracts NeedsResponse / ShipNeed / AddShipNeedsRequest / RenameNeedRequest /
  SetFighterSquadsRequest / SetCqbTeamsRequest + OpenAPI paths + inject tests (anon 401, empty
  list / negative count 400). prod-e2e-readonly: needs anon-gate check.
- SPA NeedsEditor on the `/ops/:id/edit` page: ship-type multi-pick + named ship needs with
  remove, fighter-squad and CQB-team count/size controls. MSW tests.

### Added - FR-P2: SPA op editor — lifecycle (2026-06-12)

- New `PATCH /api/v1/operations/:id` (fleet operator) editing title/description/opType/
  schedule/meeting/visibility; keeps an open op's Discord scheduled event + distributed
  partner events in sync (best-effort), mirroring the SSR /ops/:id/edit + /visibility forms.
- New `POST /api/v1/operations/:id/status` (draft/open/locked/starting/in_progress/completed/
  cancelled): open creates the Discord event + distributes to partners, cancelled tears them
  down. Audit logged. Mirrors SSR /api/ops/:id/status.
- New `DELETE /api/v1/operations/:id` (destructive): partner-event teardown before the cascade
  delete, Discord event removed after. Mirrors SSR /ops/:id/delete.
- Contracts EditOperationRequest / SetStatusRequest + OpenAPI paths + inject tests (anon 401,
  bad id 400, bad status/visibility 400). prod-e2e-readonly: anon-gate checks.
- SPA `/ops/:id/edit` operator page: prefilled edit form, status control and a guarded delete
  with confirm; reachable via a new "Bearbeiten" link in the op detail operator view. MSW tests.
- First slice of the op-editor strangler; Bedarfe/Needs and advanced composition (formations,
  CQB bundling, unit edit) follow in later slices.

### Added - FR-P2: SPA guild/server settings (2026-06-12)

- New `GET /api/v1/guilds/:id/settings` (fleet operator of that guild / superadmin) returning
  the non-voice guild settings (org name, timezone, Discord invite, admiral role, owner,
  canRemove) plus the member list (userId, username, role, isOwner).
- New `PATCH /api/v1/guilds/:id/settings` with the same field validation as the SSR form
  (orgName ≤80, snowflake admiral role, discord-invite-only URL, IANA timezone) and
  `PUT /api/v1/guilds/:id/members/:userId/role` to set fleetoperator/crew — the guild owner is
  protected and stays a fleet operator (409 on demote). CSRF-gated, rate-limited. Contracts
  (GuildSettings / GuildSettingsMember / GuildSettingsResponse / UpdateGuildSettingsRequest /
  SetMemberRoleRequest) + OpenAPI + inject tests.
- SPA `/guilds/settings` page (admiral console): guild picker, settings form and member list
  with a role toggle; the nav "Server" link now points at the SPA route. Removing a server
  (owner/superadmin, destructive) stays on the SSR surface for now.

### Added - FR-P2: SPA roadmap (2026-06-12)

- New public `GET /api/v1/roadmap` serving the curated player-facing roadmap; RoadmapItem /
  RoadmapResponse in the shared contracts package; OpenAPI + test.
- SPA `/roadmap` page grouping items by status (planned/blocked/rejected/done) with notes and
  rejection rationale, wired into the nav as an SPA route. BE 64 API tests, FE 35.

### Added - FR-P2: SPA templates marketplace (2026-06-12)

- New `GET /api/v1/templates?guildId=&q=&opType=` (membership-gated) and
  `POST /api/v1/templates/:id/apply` {guildId, scheduledAt, title?} (fleet operator only)
  to browse and instantiate operation templates into a fresh draft. Contracts + OpenAPI +
  tests.
- SPA `/templates` page: guild picker, search and template cards with an "Anwenden" →
  datetime → new op flow; reachable from the nav and the create page. Publishing/deleting
  templates stays on the SSR manage surface. BE 63 API tests, FE 34.

### Added - FR-P2: SPA ships database + feedback (2026-06-12)

- SPA `/ships` page: a debounced search table over the existing `GET /api/v1/ships/search`
  (name, manufacturer, size, role, crew). Read-only, no backend change.
- New `POST /api/v1/feedback` {subject, message} sends to the configured Discord feedback
  channel (SSR parity, minus image uploads); 409 on send failure. SPA `/feedback` form (anon
  callers get a sign-in prompt). Both wired into the nav as SPA routes. BE 62 API tests, FE 33.

### Added - FR-P2: SPA profile / hangar management (2026-06-12)

- New `POST /api/v1/hangar` {shipId} and `DELETE /api/v1/hangar/:shipId` to add/remove the
  current user's own ships (catalog-checked, auth-only). Contracts + OpenAPI + tests.
- SPA `/profile` page: lists the user's hangar with remove buttons and a debounced catalog
  search to add ships (with an "IM HANGAR" badge for owned ones). The nav user chip links to
  the profile; anonymous visitors get a sign-in prompt. This fills the hangar that the
  "offer own ship" flow picks from. BE 61 API tests, FE 30.

### Added - FR-P2: create operations from the SPA (2026-06-12)

- New `POST /api/v1/operations` — fleet operators (or superadmins) create a draft operation
  in a guild they manage (membership-gated, 403 otherwise). CreateOperationRequest added to
  the shared contract package; OpenAPI + tests.
- SPA: `/ops/new` create page (guild picker limited to operator guilds, type/visibility
  selects, objective, system/meet point, datetime-local, min participants) that posts and
  navigates to the new op detail. An "+ NEUE OPERATION" link appears on the overview for
  operators; non-operators get a clear denied state. BE 60 API tests, FE 28.

### Changed - FR-P2 Phase 6: shared contracts package (2026-06-12)

- Extracted the API v1 contracts into a shared workspace package
  `@rdoc-suite/fleetplanner-contracts` (zod 4): zod schemas, inferred types and a
  `toOpenApiJsonSchema` helper. The backend re-exports them (imports unchanged) and the
  OpenAPI generator uses the helper; the SPA now imports the types directly (type-only, so
  zod is not bundled — bundle size unchanged), replacing the hand-mirrored `types.ts`. Both
  Dockerfiles build the package before the app. This removes the contract duplication that
  was the standing Phase-6 prerequisite; the SSR teardown / container rename stays deferred
  until the SPA reaches full parity. BE 57 + FE 26 green.

### Added - FR-P2: operator leadership management (2026-06-12)

- New `POST /api/v1/operations/:id/leaders` + `DELETE .../leaders/:userId` (fleet operator
  only — leaders can't self-appoint; parity with the SSR gate). Audit + OpenAPI + tests.
- SPA operator console: the LEITUNG rail gains a remove ✕ per leader and a "+ Leiter" picker
  that appoints op participants (anyone who claimed a seat and isn't already a leader). Only
  shown to fleet operators. The slot editor and needs editor stay linked to the SSR manage
  shell (full CRUD there; no SPA duplication). BE 57 API tests, FE 26.

### Added - FR-P2: SPA operator Triage layout + drag & drop (2026-06-12)

- The operator console gains a Befehlsstand / Triage layout toggle. Triage is board-first with
  a right-hand action queue (flex signups, open needs, questions, operator actions). The
  panels, fleet board and tools drawer are now shared between both layouts.
- Drag & drop: flexible signups are draggable onto open seats (green ring while dragging or in
  place-mode); dropping assigns via the same PUT assignment endpoint, with a dataTransfer
  fallback so a synchronous drop still resolves the dragged user. FE 24/24.

### Added - FR-P2: SPA operations calendar (2026-06-12)

- New `/calendar` route in the SPA, ported from the Operations-Kalender design bundle: month
  grid (158px day cells with event chips, "+N mehr", HEUTE/op-count), agenda view (auto on
  mobile), prev/today/next month nav, seven type filter chips, selected-day detail grid +
  month stats + legend, status (ABGESCHLOSSEN / VOLL / FAST VOLL / OFFEN) from the schedule
  and occupancy, and a global GRÜN-CRT console-mode toggle in the nav. Op cards link to
  /ops/:id; reachable from the nav and an Overview switcher.
- Backend: `OperationSummary` gains `filledSeats` / `totalSeats` (claimed/total seats across
  accepted units) to drive the calendar occupancy bars; the list loaders now select unit
  seats. BE 56 API tests, FE 23.

### Changed - FR-P2: SPA operator console redesigned to the Befehlsstand layout (2026-06-12)

- The operator panel is now the design bundle's "Befehlsstand" console: sticky left control
  rail (88px conic fill ring, status pill, per-category occupancy bars, operator actions
  linking the SSR manage tabs, leadership list with avatars), hero panels FLEXIBEL / OFFENE
  BEDARFE / FRAGEN, and the fleet board with operator seat rows.
- Place-mode assignment as designed: "Einteilen" on a flexible signup shows the sticky
  EINTEILEN-MODUS banner, open seats glow green ("HIER →") and assign on click; clicking an
  open seat without place-mode opens the "WER SOLL HIER REIN?" picker. Claimed seats show
  avatar + name + free button; pending units keep accept/reject. Tools drawer (activity log,
  hangar shares with ship chips) is collapsible. FE 21/21. Triage layout + drag-and-drop
  remain follow-ups.

### Changed - FR-P2: SPA redesigned to the Operationsdetail design bundle (2026-06-11)

- fleetplanner-web now matches the claude.ai/design "Operationsdetail" look: hero section
  with status/visibility/date tags and icon meta row, mission objective + signups card with
  progress bar, join card with icons, seat-kind legend, and the fleet board as category
  lanes (ships/ground/vehicles) with accent borders, icon chips, role icons and FEST/OFFEN
  tags. Lanes collapse 4(3)->2->1 via CSS grid media queries (replacing the prototype's JS
  width detection). Share Tech Mono + Rajdhani loaded via Google Fonts (CSP already allowed).
- Operator panel gains the console KPI strip (BESETZT/OFFEN/FLEX/FRAGEN). Overview cards
  get the status dot + units/op-type line. FE 20/20, bundle 199 kB.

### Added - FR-P2: guarded mutating production E2E (2026-06-11)

- `scripts/prod-e2e-mutating.sh` — refuses to run without `E2E_ALLOW_PROD_MUTATIONS=1`,
  a disposable `E2E_TEST_OPERATION_ID` and a test-user `E2E_SESSION_COOKIE` (validated
  read-only before any mutation). Covers cqb signup/withdraw, hangar-share toggle+restore,
  seat claim/unclaim (skips without a free seat) and resource-link add/delete (skips
  without operator role). Cleanup registry runs via trap even on failure and prints the
  manual curl when cleanup itself fails. Test data is prefixed `E2E-`.

### Added - FR-P2: SPA operator panel (2026-06-11)

- Op detail gains an "Operator-Ansicht" toggle (canManage only) revealing the operator
  panel against the new operator API: accept/reject pending units, assign flexible signups
  to open seats via a seat picker, answer open questions inline, and view hangar shares.
  In operator mode, foreign-claimed seats (except the captain seat) show a free-seat ✕.
- 4 new MSW tests (panel render, assign payload, answer payload, accept). FE 20/20.

### Added - FR-P2: operator API v1 (2026-06-11)

- `GET /api/v1/operations/:id/operator` — operator-only read model: flexible signups,
  questions, hangar shares (exposed nowhere else) and the activity log.
- Operator mutations (session + CSRF, audit, 409 mapping): `POST .../units/:unitId/accept`
  (with optional accept-into-slot, skipped gracefully when full/mismatched) and `/reject`
  (frees the unit's seats incl. carried vehicles), `PUT/DELETE .../seats/:seatId/assignment`
  (assign clears the player's flexible request + sends the seat DM; captain seat protected
  on free), `POST .../questions/:qid/answer`.
- Gate parity with SSR: fleetoperator or op leader (`canApproveUnits`, now exported).
  Tests: +8 inject. Suite 314/314, tsc clean.

### Added - FR-P2: SPA squad + vehicle offers (2026-06-11)

- The SPA offer form now has mode segments Schiff / Squad / Fahrzeug over the single
  `POST /operations/:id/units` mutation: squads with name + size (2–8), vehicles with a
  catalog search filtered to vehicle-class entries and a mandatory carrier select fed from
  the operation's accepted ship units. Client-side guards surface as the inline notice;
  server conflicts (duplicate squad name etc.) arrive as 409 envelopes. FE 16/16.

### Added - FR-P2: SPA "offer own ship" flow + GET /api/v1/hangar (2026-06-11)

- New `GET /api/v1/hangar` — the caller's own ships (auth required, 401 envelope).
- SPA Mitmachen card gains "Eigenes Schiff anbieten": pick from the hangar or search the
  catalog (debounced, with "store in my hangar" option), add a captain note, submit via
  `POST /operations/:id/units` (ship units). Success closes the form and reloads the read
  model (unit appears pending); errors surface as the inline notice. Squad/vehicle offers
  stay on the SSR flow for now.
- Tests: +1 BE inject (hangar 401), +2 FE MSW (hangar submit payload, 409 keeps form open).
  BE API tests 48 green, FE 14/14.

### Added - FR-P2: SPA parity for CQB signup + hangar share (2026-06-11)

- `GET /api/v1/operations/:id` now reports the caller's participation flags
  `viewerCqbSignedUp` / `viewerHangarShared` (computed from the already-loaded relations,
  no extra queries; anonymous ⇒ false).
- SPA op detail gains a "Mitmachen" card for signed-in users on open ops: flexible signup
  toggle ("Teilt mich ein" ⇄ withdraw) against `POST/DELETE /cqb/signup`, and the
  operator-hangar-visibility checkbox against `PUT /hangar-share`. Errors surface as the
  inline notice. 3 new MSW tests; FE 12/12, BE 305/305.

### Added - FR-P2: rate limits on /api/v1 mutations + search (2026-06-11)

- In-memory sliding-window limiter (no new dependency; single container): mutations
  20/min, `/ships/search` 60/min, keyed by session cookie (string only, no DB hit) or
  client IP. Over budget ⇒ `429` envelope (`rate_limited`) + `retry-after` header.
  Plugin-scoped preHandler — SSR routes untouched. Reads stay unlimited.
- Tests: 4 limiter unit tests + 2 inject (429 after budget incl. envelope/header, reads
  unlimited). Suite 305/305.

### Fixed - OpenAPI $defs refs broke Swagger UI resolution (2026-06-11)

- `z.toJSONSchema` emits sub-schemas carrying a `.meta({id})` as local `$defs` with
  `#/$defs/X` refs inside each component schema; Swagger UI resolves refs against the
  document root and failed (SessionUser, Membership, …). The generator now hoists all
  `$defs` into `components/schemas` and rewrites the refs. Tightened test: no `$defs`
  anywhere, every `$ref` must target `#/components/schemas/`.

### Added - FR-P2: public API docs for external developers (2026-06-11)

- `GET /api/v1/docs` — interactive Swagger UI rendering the live `openapi.json` (public,
  no secrets; the OpenAPI hygiene tests guard the document). Listed in the OpenAPI paths.
- `docs/api/fleetplanner-v1.md` brought up to date: external-client quickstart (cookie
  session from the Discord OAuth flow, `csrfToken` from `GET /session` sent as the
  `x-csrf-token` header on mutations), all phase-5 mutation endpoints documented.
- Read-only prod E2E now checks `/api/v1/docs`.

### Added - FR-P2 Phase 5 (slice 2): JSON mutations units + resource-links (2026-06-11)

- `POST /api/v1/operations/:id/units` — offer a ship/squad/vehicle with the full SSR
  validation chain (catalog/hangar ship required for ship-likes, carrier required for
  vehicles, unique squad name, size 2–8, requirement-fit check, optional hangar persist).
  Returns `{ok, unitId}`.
- `PATCH /api/v1/operations/:id/units/:unitId` — subset edit (captain note, squad rename);
  full ship-swap/seat-rebuild editing intentionally stays on the SSR flow until FE parity.
  `DELETE` withdraws a unit (captain or fleetoperator).
- `POST /api/v1/operations/:id/resource-links` + `DELETE .../:linkId` — operator-gated
  (effectiveOpRole fleetoperator), URL normalization/limit via the existing service; invalid
  URL or limit → 409.
- Shared the previously-private `assertUniqueSquadName`/`assertRequirementFitsUnit` helpers
  from routes/api.ts instead of duplicating them. Same session+CSRF gates and audit entries
  as slice 1. Tests: +7 inject (401 per route, schema-400s, OpenAPI coverage). BE 297/297.

### Added - FR-P2 Phase 5 (slice 1): JSON mutations claim/cqb/hangar-share (2026-06-11)

- New `/api/v1` mutation endpoints (JSON in/out, cookie session + `x-csrf-token` header
  checked against the session token, stable error envelope, audit entries):
  `POST/DELETE /operations/:id/seats/:seatId/claim`, `POST/DELETE /operations/:id/cqb/signup`,
  `PUT /operations/:id/hangar-share`. Reuse the existing services (claimSeat/unclaimSeat,
  cqb createSignup/withdrawSignup, setHangarShare) incl. the captain-vacated leader DM;
  conflicts map to 409 instead of redirect flashes. Object-level checks: seat must belong to
  the operation, `effectiveOpRole` tenant gate as in SSR. SSR form-POST routes untouched.
- The v1 error handler now keeps framework 4xx (body parse etc.) as `bad_request` envelopes
  instead of opaque 500s.
- SPA: seat claim/release buttons on the op detail (signed-in users, open ops) with CSRF
  token from `/session`, reload after success, 409 notice. Testing-Library cleanup fix
  (vitest runs with globals:false).
- Tests: +8 backend inject (401 per mutation route, 400 validation, OpenAPI documents the
  routes), +2 FE MSW (claim → seated re-render, 409 notice). BE 290/290, FE 9/9 green.

### Added - FR-P2 Phase 4: /fleetplanner-next shadow mode (2026-06-11)

- Caddy now routes `https://suite.raumdock.org/fleetplanner-next/` to the `fleetplanner-web`
  SPA container. The SSR app stays the public entry point; nothing was removed.
- Added `scripts/prod-e2e-readonly.sh` — strictly read-only production smoke per the FR-P2
  E2E plan (API JSON/error-envelope/validation checks, OpenAPI secret scan, SPA index +
  hashed bundle + deep-link fallback, metrics guards, SSR alive). Run result: 23/23 green
  against production.

### Added - FR-P2 Phase 3: fleetplanner-web SPA workspace (2026-06-11)

- New workspace package `apps/fleetplanner-web` (Vite + React + TS): read-only strangler
  frontend against `/api/v1` — routes `/` (operations overview), `/ops/:id` (detail with
  units/seats/resource links), `/login` (links the existing same-origin Discord OAuth) and
  shared 401/403/404/503 error states. Cookie-session auth, no tokens in the client.
- Typed API client (`src/api/client.ts`) with the stable error envelope; contract types
  mirrored in `src/api/types.ts` (server contracts stay the source of truth; shared package
  is a Phase-6 candidate). No imports from fleetplanner server code.
- Tests: Vitest + Testing Library + MSW (7 — guest/auth overview, joined badge, 503
  maintenance, op detail incl. read-only assertion, API-404/401 states, login link).
- Docker: multi-stage build → nginx static with security headers (CSP, nosniff,
  frame-ancestors none) and immutable asset caching. Compose service `fleetplanner-web`
  bound to 127.0.0.1:3210 only — the public proxy still serves the SSR app; the
  `/fleetplanner-next` shadow path is Phase 4.

### Added - FR-P2 Phase 0–2: API contracts + /api/v1 read slice (2026-06-11)

- Started the FR-P2 microservice split (strangler, no big-bang). SSR is untouched and keeps
  serving everything; the new JSON API runs in parallel.
- **Phase 0:** route inventory with target states per SSR route in
  `docs/api/fleetplanner-route-inventory.md`; fixed the test baseline (removed orphaned
  voice-service test files, updated primaryUnits expectations).
- **Phase 1:** contract module `apps/fleetplanner/src/api/contracts/` (Zod v4 via the
  `zod/v4` subpath — no new dependency) with ApiError envelope
  `{error:{code,message,requestId}}`, Session, Guild, OperationSummary/Detail, FleetUnit,
  Seat, ResourceLink, ShipSummary + bounded query/id schemas. OpenAPI 3.1 generated from the
  contracts (`z.toJSONSchema`), served at `GET /api/v1/openapi.json`; human-readable docs in
  `docs/api/fleetplanner-v1.md`.
- **Phase 2:** JSON-only read routes in `src/routes/apiV1.ts` — `/api/v1/health`, `/session`,
  `/operations`, `/operations/:id`, `/guilds`, `/ships/search`. Reuses the existing services;
  presenters (`src/api/presenters.ts`) map DB rows to contract types with no `web/*` imports
  and no secret/HTML fields. Object-level AuthZ mirrors the SSR gates (anonymous only for
  public ops; no role ⇒ 404 without leaking). Plugin-scoped error handler fails closed with
  the stable envelope (no stack traces/Prisma details).
- Tests: 24 new (contracts, presenters, OpenAPI hygiene incl. secret-leak scan, route inject
  incl. 401-as-JSON and fail-closed 500). Suite: 282/282 green, `tsc` clean.

### Added - Operator backend console on the op-detail mission board (2026-06-11)

- Added an in-page **Operator-Ansicht** to the op-detail mission board (`web/missionBoard.ts`),
  replacing the former link to `/ops/:id/manage` with a Spieler ⇄ Operator toggle (`?view=operator`).
  Implements the Claude-Design `Operationsdetail.dc.html` operator backend.
- Two switchable console layouts (`?lay=a|b`): **Befehlsstand** (left control rail — fill ring,
  per-category bars, operator actions, leadership — over the Flexibel/Bedarfe/Fragen panels and the
  4-column Flotten-Board) and **Triage** (board-first with a right-hand action queue).
- Fully interactive seat assignment: place-mode (Einteilen a flexible signup → click an open seat),
  inline seat-picker, and drag & drop of waiting players onto open seats; claimed seats can be freed
  with ✕. Commits go through hidden forms (server redirect + re-render), so they round-trip back to
  the operator view/layout via `opReturnUrl`.
- Operator can answer player questions inline (reuses `POST /ops/:id/questions/:qid/answer`), and the
  Tools drawer surfaces the audit-log activity feed and operator-only hangar-freigaben.
- New endpoint `POST /api/seats/:seatId/unassign` to free an occupied seat (op-scoped auth via
  `effectiveOpRole`/leaders; the captain seat, order 0, is protected). No Prisma schema change.
- i18n: added `mb.op*` strings (de + en). Player view, claim modal, hangar-share and `/ops/:id/manage`
  are unchanged; voice/LiveKit/relay code untouched.

### Added - Microservice API/Frontend split Opus plan (2026-06-11)

- Added `FR-P2-microservice-api-split-opus-plan.md`: a Claude Code Opus implementation plan for splitting Fleetplanner into an API-only Fastify backend and separate API-only frontend, including OpenAPI documentation requirements, test cases, mocks, and guarded production E2E checks.
- Added an explicit API-security gate to the split plan: cookie/session handling, object-level authorization, CSRF/CORS policy, validation, rate limits, safe errors/logging, audit requirements, security headers, OpenAPI hygiene, and production security smoke tests.

### Added - Mission resource links + Template marketplace (2026-06-11)

- **Mission resource links (FR-P3):** operators can attach curated tutorial/guide links to an operation — a YouTube guide, an RSI Community-Hub one-pager, a Google-Doc, an image. The link `kind` (and its icon) is derived from the URL; only `http(s)` URLs are accepted. Links appear in a "Briefing & Tutorials" card on the player view (join page + both mission-board styles) and in the operator overview, with add/remove in the operator Admin tab. Helps crews prep for complex missions (TSG, Vanduul Tech Smugglers, Xenothreat, Siege of Orison).
- **Template marketplace (FR-P4):** an operator can **publish an operation as a reusable template** — a scrubbed, instance-free blueprint of the settings, fleet needs (composition groups + requirements) and resource links, with no participants, dates or Discord/voice references carried over. A new **Marketplace** tab lets operators search/filter templates and instantiate one into a fresh draft op in a click (then just set date + location). Visibility is `Server only` / `Partners` (active partnerships) / `Public`; templates show a usage count, and owners can delete their own. The blueprint serializer is shared with the recurring-events seed.
- de + en translations for both features.

### Added - Language preference (i18n) — full Fleetplanner web (de + en) (2026-06-10)

- Each user can now pick their interface **language** (Deutsch, English, English (US), Français, Español) in their profile. The preference is stored on the account and is the single source of truth for all surfaces.
- Logged-out visitors get the closest language from their browser's `Accept-Language`, defaulting to German.
- The **entire Fleetplanner web UI** is now translated — operations calendar, op detail/manage (fleet, crew, voice, admin), the player join page + sign-up assistant, the create-event wizard, profile, ship database, feedback, admin panel, the bridge admin pages, server settings, install tests, partnerships, login/account/error and the SC Tools / changelog / roadmap / license / why-unsigned pages.
- **de + en are complete**; `en-US` is a thin override over `en`, and `fr`/`es` are stubs that fall back to English until a native pass. Star Citizen proper nouns and RDOC voice terms ("Command Net", "Global Radio Net", ship names) are kept in English everywhere.
- Long-form reference/legal pages (the detailed How-To guide, Impressum, Datenschutz) stay in their authored language; the "What is this?" explainer is already bilingual via its own toggle. The Companion app and mission covers read the same preference in a follow-up.

### Changed - Fleet Needs rows are colour-tinted; slot picker only offers matching needs (2026-06-09)

- Each Fleet Needs row is now tinted by status — green (fully met), gold (partly), red (none yet) — with a matching left accent.
- The "assign to slot" picker for an unassigned unit now only lists needs the unit can actually fill (a ship no longer sees CQB soldier needs like "Fireteams"). A need that's already full isn't offered — raise its count to add more.

### Added - "?" help tooltips across the Fleet Operator area (2026-06-09)

- Each operator control/section now has a small **?** bubble with a plain-language ("for dummies") explanation of what it does and why — Fleet Needs (ships/fighters/CQB), CQB Personnel, Formations, Fleet Units, Need Assignment, Participants, and the per-team controls.

### Changed - Fleet Needs board shows "✓ Requirement fulfilled" when complete (2026-06-09)

- A fully-met requirement now shows a green **✓ Requirement fulfilled** tag instead of the row of green chip squares.

### Added - Wizard final step: share the operation to a Discord channel (2026-06-09)

- The create-operation wizard has a new last step **Share to Discord** with a channel picker. On finish, an announcement (title, time, location, link) is posted to the chosen channel. Optional ("— don't share —"); needs the bot in the server with send permission.

### Changed - Players can add a ground vehicle to their own ship while it's still pending (2026-06-09)

- The "Your offered ships" section now has **Add ground vehicle** too (it was only on accepted ships), so a player can pack a vehicle into their own ship right when they offer it — not just after the operator accepts it.

### Added - Assign any player to a CQB team (2026-06-09)

- CQB teams now have the same operator **Assign…** picker as ship seats — pick any assignable user to add them straight into a (even empty) team.

### Changed - Participants list groups all positions per member (2026-06-09)

- The operator Participants list now shows **one row per member** with all their positions as tags side by side, instead of a duplicate row per seat/team.

### Added - Place "let the operator place me" crew into teams or seats (2026-06-09)

- In the operator's Need Assignment list, each "let the operator place me" member now has **Place in team…** (CQB squad) and **Place in seat…** (open ship seat) pickers, so they can actually be assigned (their pending request clears once placed).

### Changed - Clearer nesting of attached units on the join page (2026-06-09)

- Units carried by a ship are now grouped under labelled sub-sections — **Attached Vehicles**, **Attached Fighters**, **Attached Ships** — and a ship's (or vehicle's) CQB teams show under a bigger **Fireteams** heading, so it's obvious what belongs to which ship (e.g. the MDC and fireteams under the Ironclad).

### Fixed - Ground vehicles always register as vehicles; carried units show on the join page (2026-06-09)

- Anything that is a **ground vehicle** in the catalog (e.g. MDC, MTC, Mule) is now always created as a *vehicle* unit, even via "Register Unit" — it no longer ends up as a "ship". Vehicles may also be registered without a ship and assigned later.
- The **player signup page** now nests carried units (vehicles and carried ships/fighters) under their carrier, so e.g. an MDC added to the Perseus shows under it. Fighters can be carried by ships too.

### Added - Attach any existing ship/vehicle to a carrier ship (2026-06-09)

- A ship card has an **"Attach existing unit…"** picker: any vehicle **or ship** already in the mission (e.g. an MDC registered as a ship) can be put inside a carrier ship like the Perseus — it then nests under that ship. Previously only catalog-new vehicles could be added and only "vehicle"-typed units were attachable. Also fixed the misaligned Add vehicle / Edit / Seat Setup buttons.

### Changed - Async edits + vehicle carrier assignment + manage polish (2026-06-09)

- Editing a squad's **name or size**, **reassigning** a soldier, embedding a team, or moving a vehicle no longer reloads the whole page — these now submit asynchronously with a small ✓/✕ confirmation. (Moves show in the list after the next refresh.)
- **Vehicles can be (re)assigned to a ship** after the fact: each vehicle has a carrier dropdown (move/detach) and unassigned vehicles get an "Unassigned vehicles" section with an "Assign to ship…" picker — fixes a vehicle that was added without a ship.
- Polish: long member names are clipped to 30 chars in the list; per-team size is a 2–8 dropdown; guest seats show **Sign in** (like teams) instead of a passive "open"; the unit action buttons (Add vehicle / Edit / Seat Setup) sit side by side.

### Changed - Better readability of secondary ("dim") text (2026-06-09)

- The dim/secondary text colour is now a solid lighter blue-grey instead of a 45%-opacity overlay, so subtitles, meta and hints stay readable on tinted/blue panels (not just the plain dark background).

### Added - Secondary ship seat for CQB members, squad rename, prominent re-join CTA (2026-06-09)

- Operators can give a CQB soldier a **secondary position**: a per-member "Reassign secondary position…" dropdown assigns them an open ship seat (in addition to their team).
- Operators can **rename a CQB squad** ("CQB Team N" is just the default).
- When you're already signed up, the assistant's re-open prompt is now a prominent **gold banner button** ("➕ Want to contribute something else, or claim another seat?").

### Changed - Operator "Participants" tab lists everyone with their position (2026-06-09)

- The operator **Crew** tab is now **Participants**: a single list of every participant with their position (ship + seat, CQB/fighter team, CQB pool, requested placement, or pending ship offer). Multi-seated members appear once per seat.
- The CQB reassign dropdown now starts with a clear **"Reassign to…"** placeholder.

### Added - Ship thumbnails in Accepted Units, free vehicle carrying, CQB reassign (2026-06-09)

- Accepted ships in the roster now show their **silhouette thumbnail** (same image as the wizard).
- The **vehicle-fit restriction is lifted** — any ship can carry any ground vehicle now (a vehicle still attaches to a ship; no more cargo-bay/size check).
- Operators can **reassign a CQB soldier** to another team or back to the pool from the CQB Personnel panel (a per-member "move to" dropdown).

### Fixed - Confirmed headcount + FPS/CQB metrics count team members (2026-06-09)

- The **Gemeldet / Bestätigt** counter now treats a player who claimed a slot in a CQB/fighter **team** as confirmed (not only ship-seat holders). Players in the unassigned CQB pool stay "signed up" until the operator places them.
- The operator metrics **"FPS Teams" / "FPS Seats"** (which read legacy squad units and always showed 0 / 0) are replaced by **"CQB Teams"** (number of teams) and **"CQB Slots"** (filled / total slots across teams).

### Added - "Star Citizen Tools" page (community links as OG cards) (2026-06-09)

- New **SC Tools** page (nav link after Roadmap) listing useful community tools (SC Deutsch INI, SCMDB, Erkul, SPViewer, UEX, Cornerstone Finder, SC Cargo, SC Deutsch Launcher) as cards. Each card uses the site's OpenGraph image/title/description (fetched once, cached 24h), with a curated fallback when a site has no OG.

### Changed - Top navigation reordered; Bridge removed; Profile moved to the username (2026-06-09)

- Nav order is now: Operations · Servers · Feedback · Admin (superadmin only) · Changelog · Was ist das? · How to · Unsigned Binary · Roadmap.
- The **Bridge** link is removed from the nav (the admin/bridge pages stay reachable by direct URL).
- **Profile** is no longer a separate nav item — your **username** in the top-right is now the link to your profile (next to your role, before Logout).

## [fleetplanner 0.3.5] - 2026-06-09

### Added - Formations (Verbände) + embed CQB teams into ships (2026-06-09)

- Operators can group accepted ships into named **formations** in the Fleet tab: create a formation, assign ships to it, see its members, and dissolve it.
- A **CQB team can be embedded into a non-fighter ship** ("rides in …") from the CQB panel — fighters are rejected as carriers.
- **Vehicle ↔ ship fit check**: adding a ground vehicle to a ship now verifies the vehicle actually fits the ship's cargo-bay opening (with a 90° rotation allowance); a vehicle that's too big is rejected with a clear message. Completes the Phase 4 manage features.

### Added - Join fighter squads + fleet-needs board on the structured model (2026-06-09)

- Players can now **join a fighter squad** on the op join page (wingman pairs of 2 — bring your own fighter), alongside CQB teams. Both are capacity-gated; full shows "Full", your own shows "You're in".
- The operator **Fleet Needs** board is rebuilt on the structured model: three axes — **Hull-Need** (ships, from requirements), **Fighter-Need** and **CQB-Need** (from the materialized squads/teams, showing Soll/Ist/Offen per team).

### Changed - Signup banner shows each claimed seat's ship and position (2026-06-09)

- The "You're signed up" banner now lists every seat you hold with its ship/vehicle and position (e.g. "seat: Gunner 3 on Ironclad Assault") instead of a generic "seat claimed" — useful when multi-seated — and names your CQB team ("CQB soldier in CQB Team 2").

### Added - Embarked CQB teams shown under their carrier ship (2026-06-09)

- A CQB team embedded into a ship now appears as an **"Embarked CQB"** block nested under that ship in the player view (with its joinable seat strip), like ground vehicles. Embedded teams no longer show in the standalone "Join a CQB squad" list — that one keeps only the free teams.

### Changed - CQB / fighter teams shown as a seat strip like a ship (2026-06-09)

- Joining a CQB squad or fighter wing now looks like a ship's seat row: each team shows its slots (Soldier 1…N / Pilot 1…N) with per-slot **Claim** (or "Sign in"), your own slot shows **You / Leave**, taken slots show the member (or "Taken" for guests). Much easier to read than the old vertical list.

### Fixed - Op join page: guests no longer see names; FPS/fighter teams now visible to everyone (2026-06-09)

- **Privacy:** a not-signed-in visitor on a public op no longer sees other members' names in the roster (seats show "Taken", teams show "N belegt") — matching the guest banner's promise. Signed-in members still see names.
- **FPS / fighter teams are now shown to players (and guests)** with their filled/open count and a Join button (guests get "Sign in to join"). Previously only ship seats were visible.
- Teams a need asks for are **materialized on view**, so ops created before this (with only a requirement count) now show joinable teams.

### Changed - New ops created via the wizard now use the structured needs (2026-06-09)

- Operations created through the create wizard now produce **structured fleet needs** with eagerly materialized, joinable fighter/CQB teams (the same as the manage editor), instead of plain free-text requirements. The wizard UI is unchanged; the conversion happens server-side.

### Removed - Legacy free-text fleet-need entry in the manage view (2026-06-09)

- The old free-text need editing is gone from the Fleet tab: the per-need "What do you need? / type / count" edit form is replaced by a plain delete, and the "Advanced: Groups" block (free-text groups + requirement add) is removed. The structured Fleet Needs editor is now the only way to define needs. (The create-op wizard still uses the older template flow — a separate follow-up.)

### Changed - Structured Fleet Needs editor replaces free-text requirements (2026-06-09)

- The operator no longer writes a free-text "What do you need". The Fleet tab now has a structured **Fleet Needs** editor with three blocks: **Ships** (pick types — each pick = exactly one hull), **Fighter squads** (a number; 2 pilots each, everyone brings their own fighter), and **CQB teams** (a number × team size, default 4, max 8). CQB/fighter teams are created **eagerly** so players can see and join empty teams. (Part of the fleet-need redesign — see [docs/FR-P1-fleet-need-structured.md](docs/FR-P1-fleet-need-structured.md).)

### Changed - Op join page: briefing moved into the hero (2026-06-09)

- The **Briefing** is now the right-hand column of the event hero (same height as the hero on wide screens, stacked below on mobile) instead of a separate card further down the page.

### Added - CQB squads get a target size and players can join one directly (2026-06-09)

- CQB squads (operator-bundled fireteams) can now have a **target size**. The operator sets it when creating a squad or via a small size field on each squad row; auto-bundle uses its chunk size as the target. Squad rows show **members / target** and a **full** tag.
- Players can **join a named squad directly** from the op join page — a new **"Join a CQB squad"** card lists sized squads with their current/target headcount and a **Join squad** button (capacity-gated; full squads show "Full", your own shows "You're in"). No operator bundling step required. (Previously a squad was a pure operator construct with no seats, so there was nothing to claim — see the Stormbreaker "chaos team 1" report.)
- New column `CompositionGroup.targetSize` (migration `20260609120000_squad_target_size`); routes `POST /api/ops/:id/cqb/squads/:groupId/size` (operator) and `…/join` (player).

### Changed - Op join page: scheduled time as its own fact box (2026-06-09)

- The op time now has its own **"Time"** box in the top fact row (next to Rendezvous / System / Voice / Participants), not just the hero badge.

### Changed - Op join page: status on top, assistant collapses, headcount + direct claim (2026-06-09)

- When you're already signed up, the **"I want to join" assistant is now collapsed** behind a one-line prompt — *"Want to contribute something else to the mission, or additionally claim another seat?"* — with your green signed-up banner above it. Not-yet-signed-up users still see it expanded.
- The top fact row gained a **"Gemeldet / Bestätigt"** box (signed-up / confirmed headcount): confirmed = people holding a seat; signed up = everyone who joined in any form (seat, crew request, CQB, or own pending ship offer).
- New **"Claim a seat directly"** card right under the assistant — pick an open seat without going through the assistant at all.

### Fixed - Your own signup status is now always visible (2026-06-09)

- You couldn't tell you were already signed up — especially after a **CQB signup**. Two gaps:
  - **Op join page**: the "My Signup" status only lived in the right-hand aside, which drops to the very bottom on mobile, while the top still said "I want to join". A new green **"✓ You're signed up — …"** banner now sits at the very top of the join column (covers seat / pending ship / CQB / awaiting placement). The assistant card previously never even hinted at a CQB signup.
  - **Start page (op cards)**: the **✓ Joined / Waitlisted** badge was driven by a signup map that only knew about claimed seats and crew requests. CQB signups and your own pending ship offers are now included, so a CQB-only signup finally shows a badge on the overview.

### Changed - Root host redirects to the Fleetplanner (2026-06-08)

- `https://suite.raumdock.org/` now **302-redirects to `/fleetplanner`**, the public entry point. Caddy-only change (`deploy/caddy-rdoc/Caddyfile`): an exact-path `handle /` block in front of the catch-all; every other path is unaffected. Deploy: rebuild/reload the `caddy-rdoc` container.

### Changed - Voice temporarily disabled in the GUI while it is reworked (2026-06-08)

- The whole voice part is hidden in the web GUI while **Command Net / Global Radio Net** are being overhauled. **Containers (LiveKit, relay-bots, bridge) keep running** — this is a UI-only change; no routes, backends or infra were touched.
- **Operation page**: the **"Voice Access"** tab is removed and the **"Voice"** tab now shows a maintenance banner ("Command Net / Global Radio Net is being reworked … the relay and signaling services keep running") instead of the live voice panel.
- **Fleetplanner Admin → Bridge**: the **Discord Voice** and **Relay Bots** tabs are removed from the guild nav (the pages stay reachable by direct URL).
- **Bridge Admin UI**: the **RELAY BOTS** and **DISCORD VOICE** nav items are removed (routes stay live).
- Revert is a one-liner per surface — the original `voicePanel` / `commandersPanel` and the nav items are kept in place, just not rendered.

### Changed - Join: sign-up assistant as a centered overlay over the classic view (FR-P1, 2026-06-08)

- The classic in-page "I want to join" view (all options visible) is kept. On top of it, a **centered modal sign-up assistant** asks one question at a time (Yes/No): **Take an open seat? → Offer a ship? → Join as CQB? → Let the operator place you?** (order B). **Yes** opens the matching option on the page and closes the overlay; **No** strictly advances (never loops back). The overlay **auto-opens on first visit** (when you haven't signed up yet) and can be **re-opened any time via a "Sign-up assistant" button** once you've claimed a seat / offered a ship / etc. It has a **"Disable assistant (Cancel)"** button (plus Esc / backdrop) that closes it and leaves the classic view fully usable, and a one-click **"Skip — just let the operator place me"**. Answering **Yes** to "Let the operator place you?" (and Skip) now **submits the request immediately** (it created a crew request that shows under the operator's *Need Assignment*) instead of only opening the form.

### Added - Ship class, seat/turret map, Fleetyards cache, CQB drag (FR-P1 steps 5/6 + follow-up, 2026-06-08)

- **Ship class** is now shown on every fleet unit (a `shipClass()` label derived from catalog `size×career×role`), and the operator already sees category mismatch hints on the board + an auto-match "✓" when accepting into a slot. (FR-P1 step 5.)
- **Seat/turret map**: each unit card now has a compact chip strip — one chip per seat, coloured filled / open / off — for an at-a-glance "who sits where, what's free" above the detailed seat list. (FR-P1 step 6, stage 1.)
- **Fleetyards cache**: new `FleetyardsShip` + `FleetyardsSyncState` tables + `services/fleetyards.ts` sync (top-down silhouette + hardpoints), seeded/refreshed on boot (best-effort, like the ship catalog). Migration `20260608180000_fleetyards`. (Rendering the silhouette into the seat/turret card is a small follow-up — the cache is in place.)
- **CQB drag**: operators can drag a pooled soldier onto an existing squad (in addition to checkbox-select + auto-bundle). New `/api/ops/:id/cqb/assign` endpoint.
- **Join wizard's "Take an open seat" step now shows each ship as a card** with a large Fleetyards silhouette + derived class + per-seat claim buttons, so the people signing up actually see the ship they're joining. (Moved off the manager view — the manager keeps the compact seat chips. Silhouette matched by ship name against the local Fleetyards cache.) The join wizard also stays available after you've already registered, so you can keep adding contributions.
- Deferred: voice-channel/participants for CQB squads; the interactive offer-time mismatch warning; improving the ~73% Fleetyards name-match rate.

### Added - CQB personnel pool + operator squad bundling (FR-P1, 2026-06-08)

- Players can now **sign up as a CQB soldier** as an individual (no role taxonomy — "they are soldiers, nothing more"); the Fleet Operator **bundles signups into squads**. New `CqbSignup` model + `CompositionGroup.kind` (`fleet`/`squad`); migration `20260608170000_cqb_signups`. Operator gets a **CQB Personnel** panel in the Fleet tab: pick unassigned soldiers to **create a squad**, **auto-bundle into squads of N**, dissolve squads, remove signups. New endpoints `/api/ops/:id/cqb-signups` (+ `/withdraw`) and operator `/api/ops/:id/cqb/{bundle,auto-bundle,unbundle/:groupId}`. The guided join wizard's CQB step now creates a signup instead of a whole squad unit.
- **CQB, claiming a seat, and offering a ship are explicitly NOT mutually exclusive** — the join wizard stays available after you already hold a seat or have a ship pending, so you can contribute in several ways. (Previously a seat/ship signup hid the whole wizard.)
- Deferred to a follow-up: drag-and-drop bundling (checkbox select + auto-bundle ship now), and voice-channel/participants integration for CQB squads (a squad is a `CompositionGroup`, not a `FleetUnit`).

### Fixed - Monitoring: RelayNoAudioWhileActive false-firing on cold relay (2026-06-08)

- `RelayNoAudioWhileActive` was firing with nonsense durations ("Last relay audio was 20612d ... ago") whenever commanders were connected but the relay had not yet received any audio. Root cause: `relay_last_audio_timestamp_seconds` is emitted as `0` when the relay never got audio since start (`adminServer.ts:189`), so the expr `time() - 0` ≈ 56 years, always `> 300`. Guarded the expr with `relay_last_audio_timestamp_seconds > 0` so it only fires for the intended case — relay *had* audio then went silent ≥5m. ([apps/monitoring/alerts.yml](apps/monitoring/alerts.yml))
- Added `RelayNeverReceivedAudio` (`rate(relay_frames_received_total[5m]) == 0 and on() dccc_commanders_active > 0`, for 10m) to cover the "broken from process start" case the old alert was accidentally catching — frame-rate based, no epoch-0 arithmetic.

### Changed - Guided join wizard on the signup page (FR-P1, 2026-06-08)

- The operation join page's "I want to join" assistant is now a **guided, order-B wizard**: concrete contributions first (**take an open seat → offer a ship → bring a CQB team**), with **"Let the operator place me"** as the final fallback. Steps that don't apply are hidden (the seat step only shows when seats are actually open). The old single "Offer a Ship / CQB Team" form is split into **two separate, clearer forms** (ship vs CQB) — addresses the feedback that offering was hard to read. Uses existing endpoints; no schema change. (The CQB path still creates a `unitType=squad` unit for now; it switches to per-person `CqbSignup` in FR-P1 step 4.)

### Changed - Fleet Needs board split into Hull vs CQB (FR-P1, 2026-06-08)

- The operation overview's "Fleet Requirements" board is now **"Fleet Needs"** and split into two clearly separated groups: **Hull-Need (Schiffe)** and **CQB-Need (Soldaten)**, each with its own Soll/Ist/Offen subtotal, plus a grand total. Directly addresses the feedback that Fleet Needs was hard to understand by separating the two fundamentally different demand types (ships vs soldiers). Read-only display change; no schema/migration. New `isCqbCategory` helper in `services/composition.ts`. First step of [FR-P1-fleet-needs-and-guided-join.md](docs/FR-P1-fleet-needs-and-guided-join.md).

### Fixed - Mission-Cover editor: element positions not saved correctly (2026-06-08)

- Dragging the badges / QR in the cover editor could silently drop the move (positions came out wrong or unsaved). Root cause was the engine's `useHistory` hook: `setState` read the history `pointer` from a stale `useCallback` closure, so the two state updates a drag fires per mousemove (X then Y, batched by React) clobbered each other — the second sliced history at the stale pointer and discarded the first. Sliders masked it (single field); drag (X+Y) exposed it. Fixed by keeping `{stack, pointer}` in one state object and reading the pointer inside the functional updater. Engine-only change (`apps/mission-cover/engine/src/hooks/useHistory.js`); render/save round-trip was already correct.

### Added - Fleetplanner: share a public operation (2026-06-07)

- Public operation pages now have a **Share** row. On mobile it uses the **Web Share API** (`navigator.share`) → the native OS share sheet, which covers every installed app (Instagram, Snapchat, TikTok, WhatsApp, …); when a mission cover exists and the device allows it, the **cover PNG is attached as a file** so image-first apps get the actual picture, not just a link.
- Desktop / no Web-Share fallback: explicit buttons for **X, Facebook, Threads, WhatsApp, Telegram** + **copy link**. (Instagram/Snapchat/TikTok have no web share-intent URL and are reachable only via the native sheet — by design.)
- Shown only for `public` ops (the link has to work for logged-out guests). The existing OG meta (mission cover as `og:image`) already drives the rich link previews on X/Facebook/Threads/WhatsApp/Discord.

### Changed - Fleetplanner: mission cover as the op-header background (2026-06-07)

- The mission cover is now the **background image of the operation hero**, dimmed with a semi-transparent dark overlay (`linear-gradient(180deg, rgba(5,8,16,.45)→.85)`) so the foreground text stays readable. Replaces the earlier cropped inline `<img>` (which `object-fit:cover` cut to a thin slice). When no cover exists, the generic opType image is used as before.

### Added - Fleetplanner: Discord-event "Interested" → auto needs-assignment (FR-P2) (2026-06-07)

- A pilot who clicks **"Interested"** on an op's Discord scheduled event now shows up in the op's **Need Assignment** list automatically — no manual Fleetplanner signup first. Withdrawing interest on Discord removes them again **and frees any seat** they were holding (decision: the Discord RSVP is the source of truth for bare interest).
- Pilots **without** a Fleetplanner account appear as **shadow** participants (Discord name only) and are surfaced separately as a **"Dem System bisher unbekannte Nutzer"** count; they don't count toward participant min/max until linked. On their first Discord login the shadow is claimed/merged into the new account.
- Mechanism: a 5-minute scheduler polls `GET /guilds/{guildId}/scheduled-events/{eventId}/users` (REST, bot token, **no privileged intent**) and diffs against `EventInterest` rows. New `EventInterest` model + migration `20260607160000_event_interest`; new `services/eventInterest.ts` (`syncOpInterest` / `claimInterestShadows` / `interestSummary` / scheduler) + `discord.ts` `listScheduledEventUsers`. Privacy: the new data class is documented in `docs/privacy.md`.

### Added - Fleetplanner: event distribution approval — Phase 2 (FR-P1) (2026-06-07)

- Non-auto partners now get a real **approval flow**. **Recipients = every fleetoperator of the target guild** (per-guild role) — not a single named contact (user decision, diverges from the FR doc's contact-person model). Any of them can decide; decline is per-event only and never mutes future invites.
- **Web inbox (source of truth):** a "Shared with us" section on the Partnerships page lists pending incoming events (op title, host org/Discord, when) with **Teilen / Ablehnen** (server-rendered, CSRF). A badge on the Server-Settings "Partnerships" button shows the pending count.
- **Discord DM buttons:** when a pending distribution is created, every target-guild fleetoperator is DM'd an embed (From / When / Where) with Teilen/Ablehnen buttons. New `POST /discord/interactions` endpoint verifies the Ed25519 signature (`DISCORD_FLEETPLANNER_PUBLIC_KEY`, Node `crypto`, no new dep) in an encapsulated raw-body parser, maps the clicker's Discord id → fleetplanner user, re-checks the fleetoperator role against the distribution's own target guild, then approves/declines and updates the message. Set the app's Interactions Endpoint URL to `<WEB_PUBLIC_URL>/discord/interactions`.
- New service fns: `approveDistribution` / `declineDistribution` (idempotent on `pending`, role-guarded) / `listIncomingDistributions` / `countIncomingDistributions` / `getTargetFleetoperators` / `isTargetFleetoperator`; `notifyTargetFleetoperators` (DM fan-out on new pending). New `discord.ts` `sendDiscordDmComponents` + `verifyDiscordInteraction`. New env `DISCORD_FLEETPLANNER_PUBLIC_KEY` (optional — web inbox works without it).

### Added - Fleetplanner: event distribution to partner Discords — Phase 1 (FR-P1) (2026-06-07)

- A host op with visibility `partners`/`public` is now offered to every **active partner guild** when it's opened. Each target guild gets its own **EXTERNAL** Discord scheduled event linking back to the host op page (decision F1.3). Op edits fan out to the partner events; cancel/delete tears them down (before the cascade so partner events aren't orphaned).
- **Auto-share only this phase.** Per-partner directional policy `PartnerSharePolicy { ownerGuildId, partnerGuildId, autoShare, defaultContactUserId? }`: a guild toggles **Auto-share** for each partner on the Partnerships page (owner decides whether that partner's events auto-post into *its* Discord). Auto partners post immediately (`EventDistribution.status="auto"`); non-auto partners get a `pending` row and **no** post yet — the approval inbox + Discord DM buttons land in Phase 2.
- New `EventDistribution` model (one row per op×target guild, `@@unique([operationId,targetGuildId])`) + migration `20260607120000_event_distribution`. New `services/eventDistribution.ts` (`distributeOperation` / `updateDistributedEvents` / `deleteDistributedEvents` / `getAutoShareMap` / `setAutoShare`). New `discord.ts` `createPartnerScheduledEvent` / `updatePartnerScheduledEvent`. All partner fan-out is best-effort/non-fatal — the host event and op lifecycle never depend on it.

### Added - Fleetplanner: attach screenshots to feedback (HEADWiG FR) (2026-06-07)

- The `/feedback` form now accepts **image attachments** (up to 4, max 8 MB each: PNG/JPG/GIF/WebP). They are forwarded to the Discord feedback channel as message attachments alongside the text.
- Added `@fastify/multipart` (registered in `app.ts` with a hard 8 MB / 4-file limit). The `POST /feedback` route parses multipart in one stream pass (text fields + image parts, mime-allowlist + per-file size guard, filename sanitised). `sendDiscordChannelMessage(channelId, content, attachments?)` now sends multipart (`payload_json` + `files[n]`) to Discord when attachments are present, JSON otherwise.

### Fixed - How-to/What-is: role model corrected to match the app (2026-06-07)

- The How-to "Roles" table was outdated (listed `Superadmin / Fleetadmin / Captain / Crew`). The app only has **three** roles — `superadmin` (tag **ADMIRAL**), `fleetoperator` (tag **FLEET OP**), `crew` (tag **CREW**) — and "Captain" is **not** a role but a per-unit/per-op status you get by registering a ship/CQB team. Rewrote the table around the actual tags and added that clarification. Renamed the bogus "Fleetcommander" voice row to "Fleet Op (operator)". Aligned the "Was ist das?" beginner page accordingly.

### Fixed - Mission-cover: editor bugs (HEADWiG bug report) (2026-06-06)

- **Edits now persist:** the engine config (+ background) is stored alongside the rendered artifact; reopening the editor loads the last saved cover via the new `GET /v1/covers/:id/config` instead of rebuilding from op data (positions/texts/logo/bg were lost every session).
- **Style switch keeps inputs:** `handleSelectPreset` now merges only the visual style fields (colors/fonts/effects); it no longer replaces the whole config and wipe the user's texts and placements.
- **"Abbrechen" fixed:** the editor now has a separate `cancelUrl` (the cover page); cancel previously navigated to the save callback without a token and hit the 5xx error page.
- **Save bar no longer overlaps** the editor: it shrinks the engine app shell to `calc(100vh - 56px)` instead of relying on body padding (ignored by the fixed-height layout).
- **Back-to-Fleetmanager button:** after a successful save the editor shows a confirmation + an explicit "Zurück zum Fleetmanager" button (the link finalises the cover on the Fleetmanager side); auto-follows after a few seconds as a fallback.
- **Clear way back to the mission:** the Mission Cover page now has a prominent "← Zurück zur Mission" button at the top (returns to the op manage page) instead of an easy-to-miss text link.

### Added - Fleetplanner: recurring events (FR-P3) (2026-06-06)

- An operation can **repeat** (weekly / every 2 weeks / monthly on the same weekday / yearly) — set "Repeat" in the create wizard; the pattern follows the start date you pick. Each occurrence becomes its own operation with its own roster, and the Discord scheduled event shows the native recurring badge.
- A scheduler rolling-spawns the next occurrence ahead of time (timezone- and DST-correct). Optionally end the series after N occurrences or a date. Operators can **Stop series** from the manage Admin tab (already-created occurrences stay).

### Changed - Fleetplanner: complete GUI overhaul (player-first + assistant manage workspace) (2026-06-06)

A full front-end redesign of the operation experience (the individual entries below detail each step):

- **Player event page** (`/ops/:id`) is now the default, player-first view: mission hero, fact strip, a **radio-driven "I want to join" assistant** (let the operator place me / take an open seat / offer a ship-or-CQB-team), **Accepted Units roster** with inline claim/release, full-width Fleet Requirements, rendered Markdown briefing, and a "My Signup" panel — all self-service (no edit mode), with a Manage Event entry point for operators.
- **Operator manage shell** rebuilt from the old tabbed V2 look into a workflow workspace: mission-art hero, **status spine** (Draft→Open→Locked→Starting→Live→Done), a sticky command rail (Next step / Open tasks / Readiness / Delete), and **attention tabs** (active = yellow, tabs needing action = gold-outlined) covering Overview / Fleet / Crew / Voice / Voice Access / Admin. Composition board with accept-into-slot + auto-match.
- **Element-level updates** — operator actions (accept/assign/claim/move…) submit via fetch and swap only the work area, keeping the active tab, instead of a full page reload.
- **Event creation = single guided wizard** (the classic form is gone): stepped Basics → Briefing (with Markdown help) → Discord → Fleet Requirements (templates) → Review, landing the operator in the manage shell.
- Full-width layouts (dropped the centered max-width caps), consistent card/tab styling, readable Fleet Requirements table.

### Changed - Fleetplanner: fleet-import matching, manual-assign resolver, sortable Owned Ships (2026-06-06)

- **Better import matching:** a CCU short name now matches the fuller catalog name by **token subset** (all input words present, order-independent, most-specific name wins) — e.g. "Ares Ion" → *Ares Star Fighter Ion*, "Merchantman" → *Banu Merchantman*, "G12" → *Greycat G12*.
- **Unmatched resolver:** any import name that still doesn't match is listed on the profile with a row to **search the local ship database and assign the right ship**, or **Skip** it.
- **Sortable Owned Ships:** the table headers (Ship / Nickname / Manufacturer / Size / Career / Role / Crew) are click-to-sort — Size by class rank, Crew numeric, others alphabetical, asc/desc toggle.

### Added - Fleetplanner: JSON fleet import on profile (2026-06-06)

- The profile page can **import a CCU-Game JSON export** ("Import fleet (JSON)") to bulk-add owned ships. Each model is matched to the ship catalog (case-insensitive); the import reports how many were added, already owned, and unmatched. (FR-P2.)

### Added - Fleetplanner: only vehicle-capable ships carry a ground vehicle (2026-06-06)

- A ground vehicle can only be attached to a ship with a big-enough cargo bay (cargo-grid opening ≥ 2.4 × 2.4 × ≥4 m) — e.g. Perseus / Asgard yes, Paladin and fighters no. Enforced on attach; "Add a ground vehicle" only appears on capable ships. The operator can also attach/remove a vehicle from the manage shell, where vehicles now nest under their carrier ship.

### Added - Mission-cover render microservice (FR-P4, Step 1+2) (2026-06-06)

- New self-contained microservice **`@rdoc-suite/mission-cover`** (`apps/mission-cover`, container `rdoc-suite-mission-cover`). Engine = the **MissionCover** Star-Citizen briefing-cover generator copied into `engine/` (built to a single-file bundle). Author **Vi5E** credited in the engine header (vi5e.net / Twitch / YouTube) — fixed attribution; CCO branding kept as default cover branding.
- **Server-side render** via headless Chromium (Playwright): seeds the engine's own localStorage config → loads the bundle → screenshots the `#mission-cover-canvas` node. No engine logic change needed for config injection.
- **M2M API** (Bearer `MISSIONCOVER_SERVICE_SECRET`): `POST /v1/covers` (op payload → render + store), `GET /v1/covers/:id` (metadata). **Public** `GET /covers/:id.png` (read-only, unguessable id) served via Caddy `/cover/covers*`; `/v1/*` never exposed. Artifacts in volume `mission_cover_data`.
- Egress lockdown in the renderer (anti-SSRF): only `file:`/`data:` + font CDNs + a configurable host allowlist; everything else aborted. Inputs Zod-validated, dimensions/payload capped, runs as non-root.
- **Fleetplanner** stays thin: client `services/coverService.ts` (mirrors `bridge.ts`), env-gated via `MISSIONCOVER_SERVICE_SECRET` (`coverServiceConfigured()`); compose wires `MISSIONCOVER_SERVICE_URL`.

### Fixed - Mission-cover: editor save HTTP 413 on large images (2026-06-06)

- The editor "save to operation" posts full-res background + custom-logo data URLs; the 8 MB request-body limit rejected them with HTTP 413. Raised the mission-cover body limit to 32 MB (`MAX_PAYLOAD_BYTES`). Verified: a 10 MB body now returns 201.

### Added - Mission-cover: image cleanup service (2026-06-06)

- The mission-cover service gained `DELETE /v1/covers/:id` (M2M). A fleetplanner scheduler (`coverCleanup`, every 6h) purges the rendered image **and** the `OpCover` pointer for operations that are **completed or cancelled and whose event date is older than 14 days**. Manually removing a cover now also deletes the artifact in the service (previously only the DB pointer was dropped).

### Fixed - Mission-cover: uploaded images missing from the rendered cover (2026-06-06)

- Uploaded background and custom-logo images (large data URLs) blew the engine's localStorage quota, so they were silently dropped and never appeared in the final PNG. The engine now hydrates from `window.__MC_CONFIG__` / `window.__MC_BG__` and publishes live state to `window.__MC_STATE__`; the server render seeds those globals and the editor's save bar reads live state — no localStorage quota on the render/save path. Verified: background + custom logo now render headless.

### Added - Mission-cover: fleetplanner integration + editor (FR-P4, Step 4+5) (2026-06-06)

- **Operator cover page** `GET /ops/:id/cover` (operator-only = fleetoperator or op leader): shows the current cover, a quick **generate-from-op-data** form (format + preset), and an **Open editor** button. Linked from a new "Mission Cover" card in the manage workspace command rail.
- **Generate** `POST /api/ops/:id/cover` maps op fields (title, briefing, system/location, scheduled time, accepted units → asset list, op permalink → QR) to the render service and stores the returned image link in a new **`OpCover`** table (migration `20260606140000_op_cover`; the fleetplanner keeps only the pointer, not the bytes). `POST /api/ops/:id/cover/delete` clears it.
- **Editor round-trip (Step 5):** `GET /ops/:id/cover/edit` mints a short-lived HMAC capability token (shared `MISSIONCOVER_SERVICE_SECRET`) and redirects to the service editor. The service serves the MissionCover SPA prefilled (seeded localStorage) with an injected **"In Operation speichern"** bar; saving renders + stores and redirects back to `GET /ops/:id/cover/saved` with a signed result token the fleetplanner verifies to persist the `OpCover` row. Capability tokens both directions — no cross-service CORS/CSRF.
- Caddy now also exposes the token-gated editor (`/cover/edit*`); the M2M render API (`/cover/v1*`) stays blocked from the public.
- **The cover is actually used for the mission:** rendered as the hero image on the player op page (`/ops/:id`), set as the page's Open-Graph image (link-preview when the op URL is shared), and pushed as the **Discord scheduled-event cover** — on event creation (cover preferred over the generic opType image) and patched live whenever the cover is (re)generated or edited.
- **Optional wizard step:** the Create-Event wizard has an optional "open mission cover after creating" checkbox; when ticked, creation lands on `/ops/:id/cover` instead of the manage shell.

### Added - Fleetplanner: ground vehicles carried by a ship (2026-06-06)

- A captain can **add a ground vehicle to their ship** (catalog pick). The vehicle is a crewable sub-unit with its own seats, nested under the carrier ship on the event page; players claim/release vehicle seats like ship seats.
- The operator accepts/rejects the **ship together with its vehicles** — accept/reject cascades to carried vehicles (reject also frees their seats). Captains can withdraw a vehicle.
- The "Offer" option renamed (Offer — Ship / CQB Team / Ground vehicle); when no seat is open the join assistant defaults to Offer and disables the Seat choice.

### Fixed - Fleetplanner: reject frees seats; edit/withdraw own ship before accept (2026-06-06)

- Rejecting a unit now **frees its seats** — you no longer "hold a seat" in a rejected ship (and "You hold a seat" only counts accepted units).
- You can **configure your offered ship's seats while it's still pending** (before the operator accepts) and **withdraw the ship** from the operation — both shown on the player page for ships you captain (pending or accepted).

### Changed - Fleetplanner: seat moves, captain-leave guard, player seat editing (2026-06-06)

- Claiming another seat **in the same ship** now moves you (the old seat is released) instead of double-booking.
- If you're the **captain**, claiming a different seat asks for confirmation (it empties the pilot seat / you may lose Command Net voice); when a captain actually leaves the pilot seat, the **operation leaders are notified** (Discord DM + audit entry).
- A captain can **edit their offered ship's seats on the player page** — rename seats and enable/disable them (e.g. a Paladin with only one active turret gunner). The pilot seat stays active.

### Changed - Fleetplanner: player event page shows accepted units + inline self-edit (2026-06-06)

- The player event page now has an **Accepted Units** section: each accepted ship/fireteam with its seats and who's in them. **Open seats have a Claim button and your own seat a Release button, directly on the page** — no edit mode. Waitlisted players get a **Withdraw request** button.

### Changed - Fleetplanner: manage actions update in place (no full reload) (2026-06-06)

- Operator actions in the manage work area (accept / reject / claim / assign / offer ship / voice move / requirement edits, drag-to-seat) now submit via fetch and **swap only the work area** — the active tab is preserved and a transient success banner is shown, instead of a full page reload. Status changes and delete still reload (they affect the page-wide spine), and any error falls back to a normal submit.

### Changed - Fleetplanner: assistant-like manage page with attention tabs (2026-06-06)

- The operator manage page is now tabbed (Overview / Fleet / Crew / Voice / Voice Access / Admin) with **client-side switching — no page reload**. The **active tab is yellow**, and any tab with open tasks gets a **gold outline + dot**; the page opens on the first tab that needs attention.
- The rail's task list ("Open tasks") is action-phrased (Accept/decline pending, Assign units, Fill seats, Answer questions) and **jumps to the relevant tab**.
- Voice channels moved into the **Voice tab** (no longer at the bottom of a long scroll); "Need Assignment" now lives inside the Crew tab instead of an always-present panel.

### Changed - Fleetplanner: manage board collapsibles + status row (2026-06-06)

- The Fleet Requirements board's **Pending review** and **Unassigned accepted** lists are now collapsible; Pending is expanded by default (and Unassigned expands too whenever there are pending units).
- The status-change row shows the **current status as a solid green chip**, and the other status buttons are full-size (were too small).

### Changed - Fleetplanner: briefing Markdown, richer Review, composition category as hint (2026-06-06)

- Mission briefings now render as formatted **Markdown** (headings, bold, italic, code, lists, links) on the player event page and the operator manage shell (were raw text). New XSS-safe `renderMarkdown` helper.
- The Create-Event **Briefing** step gained a Markdown help cheatsheet, and the live preview renders headings/bold/links/lists.
- The wizard **Review** step is now a full pre-publish recap (facts + participants + Fleet Requirements list + briefing preview), not a duplicate of the Summary aside.
- **Composition category is a hint, not a hard gate.** Assigning a ship to a slot whose category it doesn't strictly match (e.g. a subcapital into a capital slot) is no longer blocked — the board flags the mismatch and the Fleet Operator decides. Structural guards (slot ownership, full, valid category, FPS-squad-only-into-fps/ground/any) remain.

### Fixed - Fleetplanner: Create-Event wizard was non-functional (2026-06-06)

- The wizard JavaScript crashed at init (`filterLoc()` → `updateAside()` read the `summary` const before it was declared — temporal dead zone), so **Continue/Back, the requirement template picker, and the composition editor never worked**; only the native "Save as Draft" submit fired (which is why it submitted from any step). Deferred the init call past the const declarations; the wizard now steps correctly.
- Removed the always-visible "Save as Draft" (it bypassed the wizard) and added a submit guard so Enter advances the step; only the final Review step submits ("Create Event" → draft → manage).

### Changed - Fleetplanner: greenfield manage workspace (2026-06-06)

- Rebuilt the `/ops/:id/manage` operator UI as a workflow workspace, replacing the old tabbed V2 shell: a **status spine** (Draft → Open → Locked → Starting → Live → Done), a **sticky command rail** (Next step / Needs you / Readiness / Delete), and a single-scroll work column with anchored sections. The former tab panels (overview/fleet/crew/voice/voice-access/admin) are reused as stacked sections. "Needs you" surfaces pending units, unassigned accepted units, open seats and unanswered questions as jump links.
- **Accept-into-slot + auto-match.** The Fleet Requirements board lists pending units and unassigned accepted units with a slot dropdown defaulted to the auto-matched requirement (✓ marks a category match); one click accepts (or slots) a unit into a requirement. `POST /api/ops/:id/units/:id/accept` now takes an optional `requirementId` (idempotent, no re-pending; full/mismatched slots are skipped → accepted unslotted).
- **Edit-on-demand briefing.** The Briefing section renders the briefing read-first with a collapsible "✎ Edit event details" form, instead of an always-open edit form.

### Changed - Fleetplanner: operator manage shell modernized (2026-06-06)

- The `/ops/:id/manage` operator shell still wore the old `opv2-*` terminal styling (1180px width cap, mono/cyan/uppercase hero title, terminal tabs). Restyled the `opv2-*` CSS (used only by this shell) to match the player event page: full content width, large sans hero title, normal-case tabs. No markup change.

### Changed - Fleetplanner greenfield redesign (branch feat/fleetmanager-redesign) (2026-06-06)

- **Event page join assistant.** The 3 anchor "I want to join" links are now a CSS-only radio assistant that reveals the relevant sub-form inline (let the operator place me / take an open seat / offer a ship). Open Seats + ship offer moved into the assistant; Fleet Requirements is full-width.
- **Voice access admin.** The per-op Commanders tab is now a "Voice Access" panel that makes the two-net model explicit per `companion-voice-architecture.md`: a Command Net chip per person (always) + a Global Radio Net toggle, plus net counts.
- **Operations overview.** Op cards gained a unit-fill bar and a per-viewer signup badge (Joined / Waitlisted), plus a client-side filter bar (search / status / type / my signups).
- **Composition board.** Surfaces accepted units not yet assigned to a requirement (manage-only), linking to the Fleet tab.

### Fixed - Fleetplanner: player event page layout (2026-06-06)

- Fleet Requirements table was unreadable — labels wrapped one character per line and the header columns overlapped ("REQUIREREQUESTED"). Removed the `overflow-wrap: anywhere` char-shredding on requirement names and gave the label column a real minimum width (`minmax(8rem, 1fr)`, narrower numeric columns).
- Event page now uses the full content width (removed the `.event-shell` max-width cap, which was the sole cause of the large dead margins — `.main` is already full-width with page padding).

### Removed - Fleetplanner: classic event-create form (2026-06-06)

- The guided wizard (`/ops/new/wizard`) is now the only event-creation UI. `GET /ops/new` redirects to it; the `/ui-mode` toggle + `fpui` cookie and the "Classic form" / "Assistent (neu)" switch links are gone. `opFormPage` remains as the edit form (`/ops/:id/edit`).

### Fixed - Fleetplanner: player/operator UI design-fix (post-Codex review) (2026-06-06)

- **Ship-offer flow now works.** The player page "Offer a ship" action led nowhere (anchored to the crew-request box, no ship form existed). Added a real ship/fireteam offer form (`#offer-ship`) on the player page — owned-ship picker + catalog search + optional composition slot, posting to the existing `POST /api/ops/:id/units` and returning to the player page.
- **Player page is player-only.** Removed the Audit-Log and question answer-forms that bled into the player signup page for leaders. Moved Questions (with answer) + Audit Log into the manage shell's **Admin tab** (`/ops/:id/manage?tab=admin`), where they belong.
- **Single canonical player route.** `/ops/:id/join` now redirects to `/ops/:id`; the former `?view=player` preview and the divergent prop-passing across the two routes are gone. Crew and management redirects point at `/ops/:id`.
- **Removed dead `viewAs` role-simulator** from `opDetailPageV2` (superseded by the explicit Operator/Player switch).
- **Guests no longer see the operator shell.** A logged-out guest opening a public op's `/ops/:id/manage` is redirected to the player page `/ops/:id`.
- **Event creation lands the operator in the manage shell.** After creating an op (wizard or classic form) the operator is redirected to `/ops/:id/manage` (to open it / add leaders / launch voice), not the player signup page.

### Changed - Fleetplanner: event links are now player-first (2026-06-06)

- `/ops/:id` now renders the final player signup event UI by default: hero, event facts, join assistant, Open Seats, Fleet Requirements table, briefing, questions, and My Signup.
- Fleet Operators get a clear **Manage Event** entry point; the legacy operation management shell moved to `/ops/:id/manage`.
- Management tabs and management form redirects now stay under `/manage`; player signup forms return to the player event page.

### Fixed - Fleetplanner: Fleet Operators can open the real player signup preview (2026-06-06)

- Replaced the ambiguous operator-only "View as" role selector with an explicit **Operator / Player Signup** switch. The player signup preview links to `/ops/:id/join?view=player`, hiding leader-only join-page extras so Fleet Operators can verify the actual player-facing flow.

### Fixed - Fleetplanner: regular event links now open the player signup view (2026-06-06)

- Authenticated regular players opening `/ops/:id` are redirected to the focused `/ops/:id/join` signup page. Fleet Operators and operation leaders keep the operator/detail view; explicit tabs such as `?tab=fleet` remain reachable for seat selection.

### Changed - Fleetplanner: player signup and Fleet Requirements wording polish (2026-06-06)

- Renamed remaining player/operator-facing "Composition" and "Fleet Needs" wording to **Fleet Requirements**.
- The requirements overview now uses **Requested**, **Fulfilled**, and **Open Slots**; fulfilled counts accepted ships or teams, while pending and extra units are shown separately.
- Cleaned the participant join page to stay fully English: event facts, join choices, Open Seats, Fleet Requirements, questions, and signup status.

### Changed — Fleetplanner: wizard + join view aligned to the operator/player design spec (2026-06-06)

- **Wizard:** 5 steps now (Basics — incl. rendezvous + visibility — / Briefing / Discord / Fleet Requirements / Review), English labels, "Ready to Open" readiness items (Event Voice Channel, Announcement Channel, Fleet Requirements, Minimum Participants, Commander Net), "Save as Draft" as the primary action, live Summary. "Composition" is now "Fleet Requirements".
- **Join view (player):** English throughout — "I want to join" with the three paths (Let the operator assign me / Choose an open seat / Offer a ship), "Mission Needs" chips, "Open Seats" with inline claim, and a "My Signup" sidebar (state, Join, Ask a question, **Available Seats** summary). Terminology per spec (Requested / Open Seats).

### Added — Fleetplanner: audit log, ask-the-operator, min/max participants, "starting" status, inline seat claim (Mission Creation Flow Phase 4/5, 2026-06-06)

- **Schema migration** (`20260606120000_phase5_…`): `Operation.minParticipants/maxParticipants`, plus `AuditLog` and `OpQuestion` tables (actor/asker denormalised — no User FK).
- **Audit log:** op creation and every status change are recorded; the join page shows the log to leaders.
- **Ask the FleetOperator:** participants post questions from the join page (`POST /ops/:id/questions`); leaders answer inline (`…/answer`); both see the Q&A thread.
- **Min/Max participants:** wizard Composition step gains the inputs; the "Bereit zum Öffnen" panel shows a Min-Teilnehmer check (planned roles vs minimum).
- **"starting" status:** added to the status flow (dropdown + API validation) — voice/Squad-Link links handed out while final Discord prep happens.
- **Phase 4:** the join page "Freie Plätze" now lists individual open seats with an inline **Claim** button (reuses `/api/seats/:id/claim`).

### Added — Fleetplanner: composition step in the creation wizard + alt/neu UI switch (Mission Creation Flow Phase 3, 2026-06-06)

- The wizard gains a **Composition** step: load a starter template (Tactical Strike Groups / Hator / Rockbreaker / Stormbreaker), add/remove requirement rows (category + label + count), serialized to a hidden field. `POST /ops/new` creates a "Fleet Requirements" group + requirements from it (validated, capped, failures ignored so creation never breaks). The right "Bereit zum Öffnen" panel now shows the composition row count. No schema change — min/max participants + audit log stay Phase 5.
- **Alt/neu UI switch:** the "✨ Assistent (neu)" / "↩ Klassisch (alt)" links now persist the choice via an `fpui` cookie (`/ui-mode?to=new|classic`); `/ops/new` honours it (new → wizard).

### Added — Fleetplanner: dedicated participant join view (Mission Creation Flow Phase 2/4, 2026-06-06)

- New `/ops/:id/join` page (mobile-first): status/visibility badges + When/System/Voice meta, an "Ich will teilnehmen" card with the three sign-up paths (vom Operator zuweisen lassen / freien Sitz wählen / Schiff stellen), "Freie Plätze" per unit, "Mission braucht" composition chips, the briefing, and a "Meine Anmeldung" sidebar with state + a crew-request form (Notiz → Teilnehmen). Reuses the existing crew-request + seat-claim endpoints; "Frage stellen" is stubbed for Phase 5. The op-detail "Mitmachen?" CTA now links here.

### Changed — Fleetplanner: op-creation wizard restyled to 3-column layout (Mission Creation Flow, 2026-06-06)

- The `/ops/new/wizard` assistant now matches the target design: a vertical step rail (Basisdaten → Ort → Sichtbarkeit & Voice → Briefing → Review), the form in the centre, and a right "Bereit zum Öffnen" readiness panel + live "Zusammenfassung" that update as you type. Briefing step gains a Markdown preview toggle. Still posts to the existing `POST /ops/new` — no backend change. Composition + min-participants readiness land with Phase 3/5.

### Added — Fleetplanner: participant join CTA on op-detail (Mission Creation Flow Phase 2, 2026-06-06)

- Op-detail now shows a logged-in non-leader their join state at a glance, above the tabs: "✓ Du bist eingeteilt", "✓ Anmeldung eingegangen", or — while the op is open — a single clear "Mitmachen?" card with **Sitz claimen** (→ Fleet tab) and **Als Crew anmelden** (→ Crew tab). Locked ops show "Anmeldung geschlossen". Mobile: full-width stacked actions. Pure additive (no schema/route change); reuses the existing seat/crew controls. FR-P1 mobile/join focus.

### Added — Fleetplanner: guided op-creation wizard (Mission Creation Flow Phase 1, 2026-06-06)

- New stepped admin assistant at `/ops/new/wizard`: Grundlagen → Ort → Sichtbarkeit/Voice → Briefing → Vorschau, with a progress stepper, per-step validation, and a review before publish. Posts to the existing `POST /ops/new` (same field names) — no backend/schema change. A "✨ Assistent" link sits on the classic `/ops/new` form; the wizard links back to the classic form. First slice of FR-P1-eventcreation-simplification (branch `feat/mission-creation-wizard`).

### Fixed — Fleetplanner: accepted-link 404 for logged-out users (2026-06-06)

- Opening an op link (e.g. the accepted-captain Discord link) while logged out returned a 404 "Operation not found" for private/partner ops, which looked like a broken URL (feedback: exrelax). Guests now get a clear "Login required" page (HTTP 401) with a login link, without leaking op details.

### Changed — Fleetplanner: unit lead title is "Pilot" for non-capital ships (2026-06-06)

- The unit lead was always labelled "Captain". Now only Capital ships (Idris etc.) show "Captain"; smaller hulls show "Pilot" (feedback: Mimosenherkules). Centralised in a `unitLeadTitle(ship)` helper based on ship size.

### Added — Fleetplanner: richer share embeds (OpenGraph) for public ops + Guild `orgName` (2026-06-05)

- Shared op links now unfurl on Discord/social with a structured `og:description`: When, System, Rendezvous, Leaders, Event Voice, Org and the Discord invite — mirroring the op's Action Details. Previously only title/description/image were emitted.
- New optional `Guild.orgName` (SC org name, ≤80 chars) editable under server settings → Discord integration. Falls back to the Discord server name in the embed when empty.
- Privacy unchanged: embeds render only for `public` ops. Private/partner ops still 404 to guests, so their details are never exposed via OG.

### Fixed — Companion: OBS could not capture SquadLink audio (1.0.3, 2026-06-05)

- OBS "Application Audio Capture" recorded silence because Tauri/WebView2 (Chromium) renders audio in a separate out-of-process audio service, outside the SquadLink window's process tree.
- Set the window's `additionalBrowserArgs` to add `--disable-features=AudioServiceOutOfProcess` (keeping Tauri's three default disabled features) so audio renders in the main WebView2 process. OBS app-capture on the SquadLink window now picks up the sound. Config-only change.

### Fixed — Companion: stale mission-token deadlock silently killed Bridge audio (1.0.2, 2026-06-05)

- Symptom: two commanders shown in the bridge roster but nobody could hear anyone. LiveKit prod logs showed each companion joining the bridge room **alone** and leaving after ~1 s — the roster count came from the WS squad list, not LiveKit.
- Root cause: a stale persisted `missionToken` + the Bridge↔Mission exclusivity gate (`missionEngaged = !!missionToken`) kept Bridge LiveKit torn down. The mission poll only cleared a token when an op was pinned in memory (null after restart), and an expired token returned `401` → `if (!res.ok) return` → never cleared. Backend overloaded `op: null` for both "mission ended" and "voice not opened yet", so the client couldn't tell them apart.
- Backend (`fleetplanner`): `/api/companion/mission-voice` now returns an `ended` discriminator on `op: null` — `true` = definitively over, `false` = pending (op active, voice not opened yet).
- Companion: the mission poll clears the token and falls back to Bridge Mode on `401` or `op: null && (ended === true || pinned)`, and keeps waiting on pending / transient errors. Stale tokens now self-heal within one 5 s poll; Bridge audio resumes from the remembered creds — no manual `settings.json` edit needed. Backward compatible with an old backend (missing `ended` → treated as pending; expired tokens still clear via 401).

### Fixed — Relay bots: buffer-overflow cascade + simultaneous-speaker distortion (2026-06-05)

- The relay audio path wrote PCM straight into one PassThrough per bot at whatever rate it arrived. Faster-than-realtime input overflowed the ~1 s buffer → drop + watchdog restart. Two causes: (1) `LivekitSubscriber` never tore down a track's reader loop, so reconnects/restarts left stale loops pushing duplicate PCM; (2) `pushPcm` concatenated every simultaneous speaker into the same stream (2 speakers = 2× realtime + garbled).
- `subscriber.ts`: per-track reader loops are tracked by sid, deduped on re-subscribe, and cancelled on `TrackUnsubscribed` / `ParticipantDisconnected` / disconnect / reconnect.
- `bot.ts`: a 20 ms output clock now mixes per-speaker jitter buffers (sample-summed, clamped) into one realtime stream — input rate == playback rate (no overflow), and simultaneous speakers are mixed instead of concatenated. Per-speaker buffers are capped (~200 ms, drop-oldest); idle speakers are reaped.
- Server-side only (relay-bots container); deploy with `docker compose -f docker-compose.prod.yml up -d --build relay-bots`.

## [1.0.1] — 2026-06-05

### Changed — Companion: new app icons / symbols (1.0.1)

- Release carrying the updated app icons + symbols (`src-tauri/icons`). No code changes vs 1.0.0.

## [1.0.0] — 2026-06-05

### Changed — Companion: mission voice UI polish + new app icons (1.0.0)

- The two mission voice indicators are restyled: each is a bordered label chip (PTT-button style) with the status dot, name, hotkey and connection meta, and the PTT button directly beside it. Relabelled to "Command Net (<hotkey>)" and "Global Radio Net : Permission Granted (<hotkey>)".
- New app/installer icons (`src-tauri/icons/icon.png`, `icon.ico`, size variants). The mode-bar keeps the "RDOC // SQUAD LINK" wordmark.
- First stable release: Command Net + Global Radio Net verified working end-to-end (bidirectional command audio, publish-only relay, Bridge↔mission exclusivity). Companion 0.6.1 → 1.0.0.

## [Unreleased]

### Fixed — Companion: Global Radio Net double audio (Relay room was subscribed, not publish-only) (2026-06-05)

- A commander with Global Radio Net permission was heard twice, and was still heard after the listener muted the RelayBot. Root cause: `RelayAudio` wrapped the shared `LivekitAudio`, which auto-subscribes and plays every remote track — so companions heard each other directly in the mission Relay room (`fg-…`) on top of the RelayBot broadcast in their Discord channel. The Relay room is publish-only (only RelayBots may consume it; per companion-voice-architecture.md §3 Global Radio Net is a RelayBot broadcast).
- `LivekitAudio` gains a `publishOnly` mode (connects with `autoSubscribe: false` and never attaches remote audio); `RelayAudio` uses it. Command Net (commander room) keeps subscribing. Companion 0.6.0 → 0.6.1.
- Follow-up (relay-bots, server-side): `subscriber.ts` lacks TrackUnsubscribed/ParticipantDisconnected handling and mixes all PCM into one PassThrough; watchdog restarts (buffer overflow) can leave stale reader loops → in-channel doubling. Tracked separately.

### Changed — Companion: Bridge and mission rooms are now mutually exclusive (2026-06-05)

- Enforces the `companion-voice-architecture.md` rule that Bridge Mode and the mission rooms never run at once. The Bridge LiveKit room is now gated on `missionToken`: it is left/never-connected the moment a mission link is engaged (not only after the commander room finishes connecting), and resumes only after the mission ends (subject to the Bridge role gate). Closes the window where the Bridge room transiently connected during a mission — the coexistence that produced the v0.5.21 one-way audio bug. Companion 0.5.21 → 0.6.0.

### Fixed — Companion: Command Net stable one-way audio (disconnect() nuked coexisting room's audio elements) (2026-06-05)

- In Command Net you could be heard but heard nobody. Root cause: in mission mode two `LivekitAudio` instances run side by side (the bridge/guild room and the mission commander room), both attaching remote `<audio>` elements with `data-dccc-track`. When the bridge room tore down, `LivekitAudio.disconnect()` ran `document.querySelectorAll("audio[data-dccc-track]").forEach(el => el.remove())` — a **global** removal that also deleted the commander room's remote audio elements, silencing the other commander while your own mic kept publishing (one-way).
- `disconnect()` now removes only the elements in its own `attachedRemotes`, leaving a coexisting instance's audio intact. Companion 0.5.20 → 0.5.21.

### Fixed — Companion: Command Net flapping one-way audio (Discord-voice gate hysteresis) (2026-06-05)

- Commander Net audio dropped intermittently ("whoever joined last is heard, others not"; speaking indicator flickering; one side mutes mid-talk). Root cause: the 5s mission poll tore the commander LiveKit room down on a *single* `discordVoice.ok=false` poll, and the backend gate derives from the Bot's flaky/stale Discord voice-state. Members sitting in their own per-unit relaybot channels (the normal in_progress state) flapped the gate and churned the room.
- Companion now applies `COMMANDER_GATE_GRACE_MS` (20s) hysteresis: the commander room + PTT-1 transmit stay alive for 20s after the last genuine gate pass, so a transient blip no longer drops audio. Grace only starts after the first real pass (a user who never qualifies gets none); a real channel-leave (>20s) still drops. Global Radio / relay path unchanged. Companion 0.5.19 → 0.5.20.
- Follow-up (separate): harden the server-side voice-state source (Bot logged 0 `voiceStateUpdate` events — GuildVoiceStates intent / stale `UserVoiceState`).

### Removed — Bridge: native Admin operation pages (Dashboard / Raid Planer / Konfig) (2026-06-02)

- Native Bridge Admin operation UI is removed now that Fleetplanner covers it: `GET /admin/` Dashboard (→ redirects to `/admin/sessions`), `GET /admin/raid-planer`, `GET /admin/config` + `POST /admin/api/config`, and the dashboard live feeds `GET /admin/api/live` and `GET /admin/api/live-stream`. Dashboard/Raid Planer/Konfig nav links removed in all modes.
- The native Bridge Admin UI is now **diagnostics-only** (Sessions, Relay Bots, Monitoring, Audit, Discord Voice, Admins) plus auth. All backend routes (`/internal/fleet/*`, `/sessions/*`, `/download/*`, `/updater/*`, relay, WS) are unaffected; the `strategyChannels` service + GC stay (used by the Fleetplanner M2M endpoints).

### Added — Fleetmanager: Raid-Planer parity (channel reorder + strategy channels) (2026-06-02)

- **Bridge `/internal/fleet/*` M2M API** gains two endpoints: `POST .../discord/channels/reorder` (reorder allowed voice channels, mirroring the native `/admin/api/channels/reorder` allowed-list validation + position mapping) and `POST .../discord/strategy-channel` (create a temporary voice channel and pull selected members in, auto-GC'd after 15 min idle). Both reuse the existing bridge services unchanged.
- **Fleetplanner Discord Voice panel** (`/admin/bridge/:guildId/discord-voice`) now offers channel reorder (▲/▼ controls over allowed channels) and a strategy-channel form (name + member checkboxes), superadmin-gated with CSRF like the existing move/role actions. This closes the last gap before native Bridge Admin Raid Planer can be removed.

### Changed - Fleetmanager: Bridge Admin legacy control plane (2026-06-02)

- Fleetplanner is documented as the primary UI for normal Mission Voice and operation control, while Bridge remains the backend control plane for Discord, LiveKit, relay bots, sessions, downloads, updater, audit, monitoring, and internal APIs.
- Bridge native Admin UI can now be gated with `BRIDGE_ADMIN_UI_MODE=full|legacy|disabled`; `disabled` skips only `/admin/*` UI registration and leaves Fleetplanner/Companion backend routes active.
- Bridge native Admin legacy mode now removes Dashboard, Raid Planer, and Konfig from the primary navigation while keeping diagnostic and Bridge Mode pages reachable.
- Companion Admiral session management now opens Fleetplanner Bridge Sessions when `fleetplannerUrl` and `guildId` are known, with the old Bridge Admin sessions URL kept only as fallback.

### Changed - Fleetmanager: Mission Voice Companion enforcement (2026-06-02)

- Mission voice links are now operation-bound and use the HTTPS `/companion/mission?token=...` wrapper, with `/companion/download` as the stable Fleetmanager download entry point for GitHub Actions-built Companion installers.
- Mission start DMs now target accepted Unit Captains, Operation Leaders/FleetCommanders, and Commanders-tab users, with a clickable configuration link plus raw `rdoc://mission?...` fallback.
- Companion mission polling now receives Discord voice presence state, disconnects LiveKit, and disables Commander/Relay PTT when the user leaves the advised Discord voice channel.
- Fleetmanager prevents duplicate squad names, blocks unit/squad structure changes after mission start, cleans up mission voice on operation delete, and exposes pull-crew voice controls in the new UI.
- Relay Discord channel names now come from the assigned unit/squad while RelayBot display names stay on their configured bot labels.

### Removed — Dead-code cleanup: Fleet-Auth, captainRoleId, eventChannelId (2026-06-02)

- **Companion: removed dead Fleetplanner OAuth flow.** `src/lib/fleetplannerAuth.ts`, `src/components/FleetVoiceModal.tsx`, and the Rust `start_fleet_oauth_webview` Tauri command are deleted. The `dccc://fleet-auth` companion login was replaced by the mission-link system in the Companion overhaul but the backend and Rust shims were never cleaned up.
- **Fleetplanner: removed dead companion OAuth routes.** `GET /auth/discord/companion/start`, `GET /auth/discord/companion/callback`, and `GET /companion/configure` are removed from `apps/fleetplanner/src/routes/auth.ts`. These generated `dccc://fleet-auth?token=…` deep links that the current Companion ignores (it only processes URLs with both `token` and `url` params).
- **Fleetplanner: fixed unit-accept DM.** On unit accept, the server was creating a full-scope `CompanionSession` and sending the captain a `companion/configure` link — a dead link that the Companion silently dropped. Removed `createCompanionSession` call + `companionConfigUrl` from the accept flow; DM now fires without the dead link. `createCompanionSession` / `loadCompanionSession` (full-scope) and `FULL_TTL_MS` removed from `companionSession.ts`.
- **Fleetplanner: removed `captainRoleId` guild setting.** The `captain` GuildRole gated no route guard in the codebase (all guards are `crew` or `fleetoperator`). The Discord role was only a visual badge on unit-accept; `commanderVoiceRoleId` + the voice session system now handle all Discord role lifecycle. Removed: `Guild.captainRoleId` (schema + migration `20260602020000_guild_remove_captain_role_id`), `assignCaptainDiscordRole`, `removeCaptainDiscordRoles`, `configuredCaptainRoleIds`, `CaptainDiscordRole` type, `captainsWhoseEventRolesCanBeRemoved`, and Commander/Admiral buttons in the fleet panel UI. Env vars `DISCORD_COMMANDER_ROLE_ID` and `DISCORD_ADMIRAL_ROLE_ID` removed.
- **Fleetplanner: removed `eventChannelId` guild setting.** The guild-level default Discord event voice channel is superseded by the per-op `eventVoiceChannelId` selector (already implemented on the op create/edit forms). Removed from schema (migration `20260602010000_guild_remove_event_channel_id`), guild settings form, and Discord service. Env var `DISCORD_EVENT_CHANNEL_ID` removed.

### Changed — Guild settings: Mission Voice panel (2026-06-02)

- `commanderVoiceRoleId` and `globalVoiceRoleId` moved out of the generic "Discord integration" form into a dedicated **"Mission Voice — Companion & Relay"** section in guild settings. Panel is only rendered when `voiceEnabled = true`, making it clear these fields are voice-feature-specific and irrelevant until RDOC Voice Permission is granted.

### Added — Bridge + Fleetplanner: DB-backed Raumdock role gates (2026-06-01)

- **`GlobalSettings` singleton in bridge SQLite.** New model `GlobalSettings` (id `"global"`, `raumdockGuildId?`, `bridgeRequiredRoleId?`, `relayRequiredRoleId?`) stores cross-guild access gates.
- **Bridge access gate:** when `bridgeRequiredRoleId` and `raumdockGuildId` are configured, the OAuth callback fetches the user's Raumdock guild member roles and rejects non-members with `403 missing_bridge_role` before any tenant-level check.
- **Relay gate:** `RELAY_REQUIRED_ROLE_ID` env var replaced by `GlobalSettings.relayRequiredRoleId`, checked against the Raumdock guild. The env var is no longer read.
- **Fleetplanner superadmin UI:** "Global / Bridge Settings" page at `/fleetplanner/admin/bridge` — form gated to the `protected` (bootstrap) admiral only. Fields: `raumdockGuildId`, `bridgeRequiredRoleId`, `relayRequiredRoleId`.
- Bridge exposes `GET|POST /internal/fleet/global-settings` (M2M, Bearer `BRIDGE_FLEET_SECRET`).

### Fixed — Companion: Mission voice lifecycle (builds 0.5.4–0.5.6, 2026-06-02)

- **Mission close kicks instead of switching (build 0.5.5).** `missionOpIdRef` now pins the `opId` on the first successful poll. If the poll returns `op: null` or a different `opId`, the mission ends and the Companion returns to bridge mode — no silent switch to the "next active op". `missionOpIdRef` is reset on `onMissionDisconnect`.
- **Mission-mode shows wrong roster (build 0.5.6).** In mission mode the bridge-connected pane (showing `activeCommanders`) was rendering in parallel with the mission panel. The bridge pane is now hidden when `missionOwnsLocal` (`missionActive && missionHasCommander`). Participant count for the mission commander room is surfaced via `FleetAudio.participantsChanged` → `commanderParticipants` app state and shown in `MissionVoicePanel` as "N im Kanal".
- **Self excluded from mission presence count (build 0.5.6+).** `FleetAudio` now counts only remote participants (`room.numParticipants` excludes the local participant). Previously the count was off by one.

### Added — Companion: Voice routing strip (build 0.5.4, 2026-06-02)

- New FUNK strip below the status bar shows the connected room and speaking target for both PTTs at a glance. LOKAL lane: commander room (mission) or session/guild-bridge; GLOBAL lane: Discord relay. Colour: green = actively sending, cyan = connected, dim = disconnected. Hotkey label shown per lane. Derived from existing state (`missionOwnsLocal`, `localRoomLabel`, relay status) — no new protocol messages.

### Changed — Fleetplanner: Mission Commander rules + DM + Global Voice (2026-06-01)

- **Squad captains are now automatic mission commanders; ship captains are not.** `listMissionCommanders` and `isMissionCommander` in `services/missionCommanders.ts` check for `unitType = "squad"`. Ship-unit captains can be added manually as `MissionVoiceParticipant` by a fleetoperator.
- **Global Voice per commander.** New `MissionVoiceParticipant.globalVoice` boolean (migration `20260602003000_mission_voice_global_voice`). Toggled via the Commanders tab; when a voice session is live the Discord `globalVoiceRoleId` is granted/revoked immediately.
- **Mission start DM.** When op transitions to `in_progress`, each mission commander receives a Discord DM with: (a) download link if `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` is set, (b) personal `rdoc://mission?token=…&url=…` Companion link.
- **New `missionCommanders.ts` service** extracted from `api.ts` — `listMissionCommanders`, `isMissionCommander`, `missionVoiceAccessUsers`.

### Added — Fleetplanner: Commanders tab + mission metrics (2026-06-01)

- **Commanders tab** on the op detail page — lists accepted squad captains and manually-added `MissionVoiceParticipant` entries, with add/remove controls and per-commander Global Voice toggle.
- **Mission overview metrics** — ship count, FPS squad count, total seat count, filled/open breakdown shown in the op overview header.
- **Copy button** on each mission voice link in the voice links panel.

### Changed — Companion: Mission-First 2-PTT Architecture (build 0.5.3, 2026-05-31)

Major architectural simplification. The old multi-mode companion (Bridge-PTT + Fleet-Voice-PTT + Fleet-Voice-Global + up to 4 hotkeys, 3 auth flows) is replaced by a focused 2-PTT design.

- **Two hotkeys only.** `localHotkey` (default Mouse4) and `globalHotkey` (default R). Old `hotkey` and `relayHotkey` store keys migrated on load.
- **PTT-LOCAL is context-dependent.** Without active mission → guild Bridge room (Squad Link, unchanged). With active mission + commander room → mission `commanderRoom` LiveKit room. Bridge WS + guild roster stay connected in mission mode; only the audio send-target switches.
- **PTT-GLOBAL is always Discord relay.** Connects as soon as `canUseRelay` is granted — independent of mission state.
- **Mission-link flow replaces Fleetplanner OAuth.** Separate Fleetplanner Discord login removed entirely. Entry point is `rdoc://mission?token=…&url=…` (deep link from Discord DM / op page). Legacy `dccc://fleet-voice?token=…` accepted during transition. App polls `GET /api/companion/mission-voice` (30s interval) to track op state.
- **`missionOwnsLocalRef` transition guard** prevents double-connect/double-disconnect churn when the bridge:joined event fires while mission mode is active.
- Old `/api/companion/voice` (20s polling, unit rooms + global LiveKit floor) removed from Fleetplanner.
- Settings simplified: 2 hotkey fields instead of 4; Fleetplanner-Auth section removed from SettingsModal.
- `docs/companion-app-opus.md` added — full architecture reference for the new design.

### Added — RDOC Squad Link app icon (build 125, 2026-05-27)

- Companion EXE now ships with the real RDOC Squad Link brand mark (gold/silver astronaut helmet over "SL" wordmark, transparent background) instead of the 89-byte placeholder. Affects the EXE icon (taskbar, desktop shortcut, Alt-Tab) and the main window title-bar icon. Source PNG kept at `apps/companion/src-tauri/icons/squadlink.png` — re-run `pnpm tauri icon icons/squadlink.png` to regenerate the icon set after any brand update.

### Fixed — Keyboard PTT auto-repeat debounce (build 123, 2026-05-27)

- **Keyboard PTT no longer re-fires the local "click" sound while held.** Win32 Raw Input delivers a `WM_INPUT` for every Windows auto-repeat tick (~30/s) with `RI_KEY_BREAK` unset, so the previous dispatcher emitted "pressed" on every repeat — replaying the synthesized radio-static cue continuously while the hotkey was held. Mouse hotkeys (Mouse4/Mouse5) were unaffected because mouse buttons have no OS auto-repeat. The window-focused fallback path was also unaffected (`KeyboardEvent.repeat` filtered out).
- Added a `hotkey_down: bool` guard in [apps/companion/src-tauri/src/lib.rs](apps/companion/src-tauri/src/lib.rs)'s `handle_raw_key`: "pressed" only fires on the rising edge (first Down after the last Up), "released" only fires when a matching "pressed" had been observed. WS state + mute toggles were already idempotent, so the only user-visible delta is the audio cue firing once per press instead of once per repeat tick.

### Added

- **Voice-channel enforcement** — the bridge now rejects commanders whose current Discord voice channel is not in `GuildConfig.allowedVoiceChannelIds` (configured via `/cc channel add`). Check runs both at WebSocket connect time and in the existing 60-second permission-recheck loop, so a commander who leaves the allowed channel mid-session is kicked within 60 s with WS close code `4403`. Empty list = no restriction (backwards-compatible with deployments that never set `/cc channel add`).
- New error codes on the WS `error` payload: `outside_allowed_voice_channel`, `not_in_voice`.
- Bot now uses the `GuildVoiceStates` intent (non-privileged — no Discord Developer Portal toggle needed) and persists every `voiceStateUpdate` into a new `UserVoiceState` Prisma table. On `ClientReady` it backfills `guild.voiceStates.cache` for every guild, so commanders who were in voice before the bot started are recognized immediately.
- New Prisma model `UserVoiceState` with composite primary key `(guildId, userId)` and index on `(guildId, channelId)`. Migration `20260523195614_add_user_voice_state`.
- New service function `checkAllowedVoiceChannel({userId, guildId, allowedIds})` in `apps/bridge/src/services/permissions.ts`, separate from `recheckCommanderRole` so the cheap DB lookup doesn't get coupled to the expensive Discord API call.
- 5 new unit tests in `apps/bridge/src/__tests__/permissions.test.ts` and 5 new integration tests in `ws.test.ts`. Total bridge suite: 34 tests (was 25 — wait, 29 before + 5 new = 34, accounting for the redundant new ws case names ≈ 34).

### Fixed

- `packages/shared` `parseServerMessage` test for `bridge:joined` had been failing since the sticky-LiveKit refactor added the required `speaking: boolean` field to `commanderInfoSchema`. Test fixture updated.
- **Prod docker-compose mount path**: bridge + bot volume now mounts on `/app/data` (where `DATABASE_URL` already pointed via the production `.env`), not `/app/prisma`. The old mount silently shadowed the image's `prisma/schema.prisma` and `prisma/migrations/`, which broke our deploy when a parallel `better-architecture` branch had previously baked its own schema into the same volume — our main-branch Phase A migration was being silently ignored at runtime. Comments in `docker-compose.prod.yml`, `STAND.md`, and `CLAUDE.md` updated to explain why this is load-bearing.
- **Prod LiveKit `--node-ip`**: prod compose now passes `--node-ip ${LIVEKIT_NODE_IP}` so LiveKit advertises the deployer's real public IP to WebRTC clients. Without it, LiveKit's STUN-based auto-detection returns an unreachable internal address (e.g. the LXC bridge gateway `10.10.10.1` on a Proxmox host), ICE never establishes, and audio fails with "could not establish pc connection". New env var documented in `.env.prod.template`. Verified on `commander.raumdock.org` with `LIVEKIT_NODE_IP=85.215.253.135`.

### Added — instant voice-channel toggle (Phase A.1)

- **Bot → Bridge real-time push.** After every `voiceStateUpdate` upsert, the bot fires a fire-and-forget HTTP POST to `${BRIDGE_INTERNAL_URL}/internal/voice-state-changed` with the bridge's `X-Internal-Auth` shared secret. Bridge re-evaluates `checkAllowedVoiceChannel` for the user's open WebSocket and immediately pushes `audio:enable` (if now valid) or `audio:disable` (if no longer valid). Result: audio cuts within ~100 ms of leaving the allowed channel and resumes within ~100 ms of rejoining, instead of the previous 0–60 s window from the polling-only design.
- New WebSocket server messages `audio:enable {roomId, livekitUrl, livekitToken}` and `audio:disable {reason}`. The companion handles them by (re)connecting / disconnecting its LiveKit session while keeping the WS open as the persistent control channel.
- `bridge:joined.livekitUrl` and `bridge:joined.livekitToken` are now optional — absent when the user is not yet in an allowed voice channel at connect time. The companion waits for an `audio:enable` instead of being kicked with `4403` as in v0.2.
- New bridge env var `INTERNAL_BRIDGE_SECRET` (optional, min 16 chars). When unset the new endpoint 503s and the system falls back to the 60s recheck loop. New bot env vars `BRIDGE_INTERNAL_URL` and `INTERNAL_BRIDGE_SECRET` (both optional with the same fallback).
- 5 new bridge tests covering: 503 when secret unset, 401 on wrong header, 200 noop when no open WS, audio:enable push round-trip, audio:disable push round-trip. Existing voice-rejection tests rewritten to assert the new no-kick-at-connect semantics. Bridge suite now 39 green.

### Changed

- Bridge 60-second permission-recheck loop now only re-verifies the Discord **role** (slow-changing, not pushed by bot). The voice-channel check at WS-connect time still runs but its failure no longer closes the socket — it just defers `audio:enable`. The 60s loop keeps role-loss as the only kick reason; voice-state changes are handled in real time by the push endpoint.
- `apps/companion/src/App.tsx` now distinguishes "audio paused — join an allowed voice channel" from a hard error, so leaving the allowed channel doesn't look like a connection failure.

### Added — Phase B1: three-tier auth backend (Admin → Admiral → Commander)

- **New Prisma models** in [prisma/schema.prisma](prisma/schema.prisma): `AdminUser` (per-guild Discord-userId whitelist for the upcoming web admin UI), `ApiCredential` (Admiral "key:secret" pairs, sha256-hashed at rest), `Session` (Admiral-created LiveKit room with a finite lifetime), `InviteToken` (one-shot per-session, per-Discord-user invitation, sha256-hashed at rest). Migration `20260523214956_add_admin_session_invite_models`.
- **New service layer** in [apps/bridge/src/services/](apps/bridge/src/services/): `admins.ts`, `apiCredentials.ts`, `sessions.ts`, `inviteTokens.ts` — all with secure random-secret generation, sha256-hex storage, constant-time hash verification, no plaintext persistence.
- **New REST API** at `/api/v1/*` in [apps/bridge/src/routes/api.ts](apps/bridge/src/routes/api.ts) — HTTP Basic Auth via `key:secret`, all endpoints scoped to the credential's guild. Endpoints: `POST /sessions`, `GET /sessions`, `GET /sessions/:id`, `POST /sessions/:id/end`, `POST /sessions/:id/invites`, `GET /guild/:id/members` (Discord-REST on-demand, no privileged GuildMembers intent needed).
- **WebSocket auth extended** in [apps/bridge/src/signaling/ws.ts](apps/bridge/src/signaling/ws.ts): now accepts three auth styles — `?token=<oauth-jwt>` (legacy, for the old companion until Phase B3 ships), `?invite=<raw-token>&name=<display>` (new Commander path), `?adm=<key:secret>&session=<id>&name=<display>` (new Admiral path). New room namespace `commander-session-<sessionId>` for B-style sessions, distinct from the per-guild legacy `commander-bridge-<guildId>` room.
- **Two new helpers** in [apps/bridge/src/services/livekit.ts](apps/bridge/src/services/livekit.ts): `sessionRoomName()` + `issueSessionLivekitToken()` — issue per-session tokens with the user's chosen display name as the LiveKit `name` field.
- **Bot bootstrap commands** in [apps/bot/src/commands/cc.ts](apps/bot/src/commands/cc.ts): `/cc admin add|remove|list @user` for managing the admin whitelist (Discord Manage Guild permission required, same gate as the rest of `/cc`); `/cc generate-credential label:<text>` to issue an Admiral API credential without waiting for the web admin UI (Phase B2). Credentials are returned as `key:secret` plaintext in an ephemeral reply, shown once.
- 16 new bridge tests in [apps/bridge/src/__tests__/sessions.test.ts](apps/bridge/src/__tests__/sessions.test.ts) covering credential lifecycle, invite-token mint + verify (including session-ended + token-expired rejection), REST surface (create/list/end session, mint invite, guild scoping), and the new WS auth paths. Bridge suite goes 39 → 55 green.

### Changed

- Kicking sockets on session-end uses a new `rooms.findAllInRoom(roomId)` helper (RoomRegistry) — pull the list once, close 4403 with reason `session_ended` on each.

### Added — Phase B (2026-05-24): Web Admin UI, replaces the B1 admiral-tier experiment

- **New admin web UI at `/admin/*`** in the bridge — server-side rendered HTML (no React/Vite build step), styled with the Chaos Crew Voice Console design system (Cyan/Gold, Share Tech Mono + Rajdhani, sharp borders, scanlines, corner-tick cards). Pages: `/admin/login`, `/admin/` (dashboard with 5-second live polling), `/admin/config` (guild config editor — bridge-mode, commander roles, allowed voice channels, enable/disable), `/admin/admins` (admin list + invite-link mint/revoke).
- **Single-use Discord-OAuth admin invite links.** Existing admin clicks "Neuen Admin einladen" + types a label → bridge mints a 32-byte raw token, returns it once with a `https://<host>/admin/invite/<token>` URL. New admin opens the URL → Discord OAuth → atomic consume-the-invite + insert-into-AdminUser → lands signed-in on the dashboard. Single-use, 7-day TTL by default, used invites stay for audit, unused can be revoked.
- **New Prisma model `AdminInviteLink`** with sha256-hashed token storage. Migration `20260523233020_drop_admiral_models_add_admin_invite_links` also drops the three B1 tables (`ApiCredential`, `Session`, `InviteToken`) which weren't used in production yet.
- **New env vars** (both optional with sensible fallbacks): `ADMIN_SESSION_SECRET` (min 32 chars; falls back to `SESSION_SECRET` for single-secret deployments). Admin session cookie TTL is 24h, HS256 JWT via jose.
- **Reuses the existing `apps/bridge/src/auth/discord.ts` helpers** for Discord OAuth (no duplication) and the existing `addAdmin/isAdmin/listAdmins` from `services/admins.ts`.
- **New dependency:** `@fastify/static` to serve the admin CSS/JS bundle. Static files copied from `src/admin/static/` to `dist/admin/static/` via a small `node -e` step in the bridge's `build` script (no extra build tool).
- 14 new tests (`adminInvites.test.ts` covering the service contract + smoke tests for the admin routes — login redirect, static file serving, OAuth state cookie, gated API endpoints). Bridge suite goes 39 → 53.

### Added — Companion Auto-Updater (2026-05-24)

- **Notify-only auto-updater for the Companion.** On startup (3 s after sign-in), the companion calls the new bridge endpoint `GET /updater/companion/check?token=<jwt>`. Bridge fetches the latest GitHub release via the GitHub Releases API (PAT-authenticated), compares against the companion's locally-baked `${APP_VERSION}-build${APP_BUILD}` string, and returns version + release notes if newer. Companion then shows a chaos-crew-styled `UpdateModal` with the notes and a "DOWNLOAD IM BROWSER ÖFFNEN" button. Clicking it `POST`s back to `/updater/companion/mint-download-token` — bridge mints a fresh single-use download token (labelled `[auto-update] <userId>`, 1-day TTL) and returns the public landing-page URL. Companion opens the URL in the system browser via `@tauri-apps/plugin-opener`; user follows the regular SmartScreen flow and replaces the portable EXE manually.
- **Does NOT bypass the admin-mintable single-use-token mechanism** — same `mintDownloadToken()` service, same token-table, same audit trail. The auto-updater path just bypasses the human in the admin UI; the cryptographic guarantees are identical.
- **New bridge env vars** (already in service code from earlier download work, now load-bearing for the updater): `GITHUB_REPO=<owner/repo>`, `GITHUB_TOKEN=<PAT classic, scope=repo>` (required for private repos, optional for public — rate-limit risk without it), `COMPANION_ASSET_PATTERN` (default `.exe`).
- **New bridge route file** `apps/bridge/src/routes/updater.ts` with `setCors()` helper — both endpoints serve `access-control-allow-origin: *` so the companion's WebView2 (`tauri.localhost` origin) can call `commander.raumdock.org` without a CORS preflight failure. OPTIONS preflight handlers included for paranoia.
- **New companion files** `src/lib/updater.ts` (HTTP client + `parseVersion`/`isNewer` semver-ish comparison) and `src/components/UpdateModal.tsx` (chaos-crew card with release notes, busy/opened/error states).
- **`LOCAL_VERSION = ${APP_VERSION}-build${APP_BUILD}`** composed in the companion so existing GitHub release tags following `v<semver>-build<N>` compare correctly. Without the build suffix every existing release looked "newer" forever; without including build numbers in `parseVersion` (`/(\d+)/` to match digits anywhere in a segment), every `buildN` suffix parsed as 0 and 91 always equalled 92.
- **End-to-end-verified live on 2026-05-24:** companion build 94 installed locally → release `v0.5.0-build95` published on GitHub → update popup appeared within 3 s of next sign-in.
- **Release workflow stays manual** — no CI yet. Build EXE locally with `pnpm --filter @dccc/companion tauri:build`, draft a GitHub release with tag `v<APP_VERSION>-build<N>`, upload the EXE as an asset. CI-on-tag-push explicitly deferred (user decision 2026-05-24: "lass es erstmal manuell").

### Fixed — Etappe 1 Bugfixes (2026-05-26)

- **PTT-Hotkey survived Settings-Save (Bug #2).** `onSettingsSave` in [apps/companion/src/App.tsx](apps/companion/src/App.tsx) used to call `setupHotkey(next.hotkey, () => { /* no-op */ })`, with a misleading comment claiming the real PTT handler was "re-attached via the listener registered at mount". That was false — `setupHotkey()` internally tears down the prior `listen()` handler before installing the new one, so the no-op callback overwrote the mount-time PTT logic. PTT silently stopped working after any settings save until the next app restart. Extracted the PTT handler into a stable `useCallback` (`handlePttEvent`) and now pass it to both call sites.
- **PTT works in DirectX-exclusive-fullscreen games (Bug #1).** Keyboard hotkeys used to go through `tauri-plugin-global-shortcut`, which wraps Win32 `RegisterHotKey`. That API is silently swallowed by DirectX-exclusive-fullscreen apps because the game owns input capture. Reworked [apps/companion/src-tauri/src/lib.rs](apps/companion/src-tauri/src/lib.rs): keyboard + mouse hotkeys now both go through the same `rdev` low-level Windows hook (`SetWindowsHookEx(WH_KEYBOARD_LL)` / `WH_MOUSE_LL`), which sees events even when a game owns capture. New Tauri commands `set_hotkey` / `clear_hotkey` let the JS side hot-swap the active hotkey via shared `Arc<Mutex<…>>` state, without restarting the listener thread. Added `parse_accelerator()` / `key_to_accelerator()` covering letters, digits, F1–F12, navigation/editing keys, numpad, and the common punctuation set. Dropped `@tauri-apps/plugin-global-shortcut` (npm) + `tauri-plugin-global-shortcut` (cargo) + the `global-shortcut:*` capabilities. Note: if a game runs as Admin, the companion needs Admin too — Windows blocks low-level hooks installed from a less-privileged process.
- **Self-hearing protection + diagnostic (Bug #3).** Added an `isSelfByIdentity || isSelfByName` check in `RoomEvent.TrackSubscribed` ([apps/companion/src/lib/livekit.ts](apps/companion/src/lib/livekit.ts)). An SFU should never deliver our own published track back to us, but if it ever does (LiveKit bug, identity-suffix race during fast PTT cycles) the track is refused with a loud `WARN` in the log instead of attaching silently. The "connected" log line now also prints the local participant's `identity` and `name` so users can verify the self-check against any `track subscribed` event. If users still report self-hearing without the `REFUSING to attach` warn appearing, the source is outside LiveKit — typically Discord echoing the user's voice back via another commander's open Discord mic, or a Windows-side audio loopback (Stereo Mix / "Listen to this device").

### Fixed — Etappe 1 follow-up: drop requireAdministrator manifest, fixes Discord-PTT (build 112, 2026-05-26)

Build 103's `requireAdministrator` manifest fixed keyboard PTT on the test system where rdev's WH_KEYBOARD_LL hook initially didn't deliver events. Live testing in build 110 uncovered the cost: Windows UIPI prevents a non-elevated Discord (the typical case) from receiving keyboard or mouse input while the elevated Companion window has focus. Symptoms: Discord's own push-to-mute on the same hotkey stops working whenever Companion has focus, and a Mouse4 hotkey grabs Companion focus mid-press (because the click lands on the Companion window), so even the release is swallowed and Discord stays muted.

The trade-off favored the wrong direction. Discord, TeamSpeak and similar apps work fine without elevation by using `RegisterHotKey` or Raw Input — they accept the small Exclusive-Fullscreen blind spot rather than break input for the rest of the system. Reverted: build.rs falls back to tauri-build's default manifest (asInvoker). The build-100 channel-based fix for the rdev WH_KEYBOARD_LL timeout still ships, so on most systems rdev keyboard works without elevation now anyway; on systems where it still doesn't, we'll migrate keyboard to Raw Input (WM_INPUT) in a follow-up rather than requiring elevation. Mouse PTT is unaffected on every system.

### Refined — Etappe 4 follow-ups: Raid-Planer tab, cache, drag-drop, multi-select, custom modal (2026-05-27)

After the initial Channel-Mirror landed on the dashboard, six successive refinements based on live user feedback:

- **Caching**: the dashboard polling (5s) was triggering three Discord REST calls per tick (members + channels + roles) and the card occasionally went blank on a Discord hiccup. New `apps/bridge/src/services/discordMetaCache.ts` holds an in-process TTL cache for guild channels + roles (60s fresh, 30 min stale-while-error). On a Discord fail the stale value is returned, so the card stays populated. Successful channel rename invalidates the cache so the new name shows on the next tick instead of after the 60s window. Single-flight wrapping dedupes concurrent admin sessions.
- **Better mutation error mapping**: new `mapDiscordError()` helper translates 403/404/400/429/401 into specific client-facing codes (`missing_manage_channels`, `discord_not_found`, `discord_bad_request`, `discord_rate_limited`, `discord_unauthorized`). The raw Discord response body is included in a `detail` field so the admin UI can show it. Frontend now has `formatMutationError()` that turns `{ error, detail }` into German user-facing text — including a specific message for `discord_rate_limited` that parses Discord's `retry_after` and explains the 2-per-10-min channel-rename limit. `fetchWithRateLimit` cap raised from 5s to 15s so the channel-rename retry can wait out Discord's ~10s quote.
- **"Raid Planer" tab**: Channel-Mirror moved out of the dashboard onto its own page at `/admin/raid-planer` with a dedicated nav entry. Dashboard goes back to live commander state only. New `renderRaidPlaner()` view + GET route; the same `/admin/api/live` polling powers both pages.
- **Role-assign whitelist + colour indicator**: only the roles listed in `GuildConfig.commanderRoleIds` can be granted or revoked through the Raid-Planer (enforced both client-side and server-side with a `role_not_in_commander_whitelist` error). The dropdown is gone, replaced by a right-click context menu showing "Vergebe X" or "Entferne X" depending on whether the user already holds the role. New `DashboardData.primaryCommanderRoleId` carries the FIRST role-id of the whitelist to the client, which uses it for a green/red name-colour indicator (admin picks which role lights up names by ordering the textarea). Per-member `channelMirror[].members[].currentCommanderRoleIds` lists which whitelisted roles each user has, so the menu labels itself correctly.
- **Drag-and-drop member move + multi-select**: replaced the per-row "Verschieben…" dropdown with HTML5 drag-and-drop between channel tiles. Drop targets get a cyan border highlight. Click (with or without Ctrl) on a member toggles them in a module-scoped `SELECTED_USERS` set; clicking outside the member rows or context menu clears the whole selection. Right-click on a selected member fans the role-action out to all selected users in parallel via `Promise.allSettled`. The add/remove label is computed against "do ALL selected users already have it", so a mixed selection adds the role to the ones missing it first.
- **Bot member separator**: members whose displayName contains "funkrelais" OR whose Discord `user.bot` flag is true are collapsed under a "RELAIS-BOTS" separator at the bottom of each channel tile. They render with just a "BOT" label and no per-row controls — they're protocol participants, not humans to manage.
- **Custom rename modal**: replaced `window.prompt()` with a Promise-based chaos-crew-styled modal (`.dccc-modal*`) — cyan corner-tick, mono title, ghost+cyan action buttons. Enter confirms, Escape / Cancel / backdrop click dismiss with null.

### Added — Etappe 4: Admin Channel-Mirror with rename / move / role / DM-link (2026-05-27)

New "CHANNEL MIRROR" card on the admin dashboard, one tile per voice channel that's in `GuildConfig.allowedVoiceChannelIds`. Each tile lists who is currently sitting in that channel (driven by the existing `UserVoiceState` table) and exposes four direct-control affordances per member:

- **Channel rename** (click on the channel name → prompt → PATCH `/admin/api/channels/:id/rename`)
- **Move member** (per-row dropdown → POST `/admin/api/members/:userId/move {channelId}`)
- **Assign role** (per-row dropdown → POST `/admin/api/members/:userId/role {roleId, action: "add"}`)
- **DM Companion-download link** (per-row button → mints a single-use `companionDownloadToken` + POSTs to `/users/@me/channels` then `/channels/:id/messages` via the bot, recipient gets a self-explanatory message with the public landing URL)

Implementation:

- **New Discord-REST helpers** in [apps/bridge/src/auth/discord.ts](apps/bridge/src/auth/discord.ts): `addGuildMemberRole` (PUT), `moveGuildMember` (PATCH `/guilds/:gid/members/:uid` with `channel_id`), `modifyChannel` (PATCH `/channels/:id`), `fetchGuildChannels`, `fetchGuildRoles`, `sendDirectMessage` (two-step `/users/@me/channels` → `/channels/:id/messages`).
- **DashboardData type** in [apps/bridge/src/admin/views.ts](apps/bridge/src/admin/views.ts) extended with `channelMirror[]`, `allVoiceChannels[]`, `allRoles[]`; the move/role dropdowns get pre-populated name → id lists so admins don't deal with raw snowflakes.
- **Admin mutation endpoints** in [apps/bridge/src/admin/routes.ts](apps/bridge/src/admin/routes.ts): four new POSTs under `${ROUTE_PREFIX}/api/...` all scoped to the admin's session guild — including a server-side check that the channel being renamed is in *this* guild's allowlist (an admin of guild A can't rename channels in guild B by URL-poking). Discord 403 responses are surfaced with specific error codes (`missing_manage_channels`, `missing_manage_roles`, `missing_move_members`, `dm_closed_by_user`) so the admin UI tells the user *what's missing* instead of just "HTTP 502".
- **Admin frontend** in [apps/bridge/src/admin/static/admin.js](apps/bridge/src/admin/static/admin.js) + [admin.css](apps/bridge/src/admin/static/admin.css): the existing 5-second `/admin/api/live` polling now also redraws the Channel-Mirror grid; `wireChannelMirrorHandlers` attaches click-to-rename + change-to-move + change-to-role + click-to-DM handlers. Pure DOM, no framework, idempotent across polling re-renders via `__wired` flags.
- **DM landing URL** is built from the inbound request's `x-forwarded-proto` + `x-forwarded-host` headers (Traefik in prod, falls back to `request.headers.host` locally) so we don't need a `PUBLIC_HOST` env var.

**Bot permission prerequisites** (deploy step, not code): the bot needs `Manage Channels`, `Move Members`, `Manage Roles` on the target guild. Sending DMs has no permission cost beyond being a member of a shared guild. Existing bot intents (`Guilds` + `GuildVoiceStates`) are unchanged — DMs go via REST, not the gateway.

### Added — Etappe 2: per-user status flags (output-mute + AFK, 2026-05-26)

Two new optional status fields on the squad roster so peers can see when a commander has muted their incoming audio or has flagged themselves AFK. Both are manual toggles (no auto-idle detection) and persist across Companion restarts.

- **Protocol surface** ([packages/shared/src/types.ts](packages/shared/src/types.ts), [protocol.ts](packages/shared/src/protocol.ts), [validation.ts](packages/shared/src/validation.ts)): `CommanderInfo` gained two optional booleans `outputMuted?` and `afk?`. Two new client→server messages: `{ type: "status:output-mute", muted: boolean }` and `{ type: "status:afk", afk: boolean }`. The snapshot builder only spreads the flags when truthy so the wire payload stays compact and pre-Etappe-2 clients parse cleanly.
- **Bridge state** ([apps/bridge/src/services/rooms.ts](apps/bridge/src/services/rooms.ts), [signaling/ws.ts](apps/bridge/src/signaling/ws.ts)): `Participant` carries `outputMuted` + `afk` (default false). New `setOutputMuted(socket, muted)` and `setAfk(socket, afk)` setters mirror the existing `setSpeaking` shape. The WS message switch routes the new messages through the setters and rebroadcasts `commander:list`.
- **Companion store** ([apps/companion/src/lib/store.ts](apps/companion/src/lib/store.ts)): `Settings` now persists `outputMuted` + `afk`. New `saveOutputMuted` / `saveAfk` helpers; `loadSettings` migrates missing fields to false.
- **Companion LiveKit** ([apps/companion/src/lib/livekit.ts](apps/companion/src/lib/livekit.ts)): new `setOutputMuted(muted)` method sets `.muted` on every attached remote `<audio>` element and remembers the flag so newly-subscribed tracks (joining mid-mute) inherit it. Subscription stays alive — we just don't play the audio locally — so speaking flags still flow in the roster.
- **Companion UI** ([apps/companion/src/App.tsx](apps/companion/src/App.tsx)): two new header buttons "MUTE" + "AFK" (cyan/gold-tinted when active). Roster rows now show `AFK` (cyan) and `MUTED` (gold) pills next to the existing TALKING/IDLE state, so other commanders see at a glance who can hear them.
- **Tests**: 2 new bridge tests in [ws.test.ts](apps/bridge/src/__tests__/ws.test.ts) verifying the toggle round-trip + that re-setting to false drops the field from the snapshot. Bridge suite: 53 → 55 green. Shared suite: 13 green (unchanged — new schemas are covered by the existing parseClient/Server tests).

### Fixed — Etappe 1 follow-ups: making Bug #1 actually work in production (builds 99-103, 2026-05-26)

Build 98's rdev migration compiled and ran, but live-testing exposed three additional issues that took four more builds to resolve. Net result: keyboard PTT now works in fullscreen games, in any focus state, without manual elevation.

- **LowLevelHooksTimeout silently killed our keyboard hook.** Build 98's rdev callback called `app.emit("hotkey", …)` synchronously, which goes through Tauri's IPC channel and can stall under contention. Windows enforces a `LowLevelHooksTimeout` (default 5000ms; some anti-cheat / gaming-perf tooling drops it to 250ms) on `WH_KEYBOARD_LL` callbacks — overrun once and Windows silently removes the hook for the rest of the process lifetime. `WH_MOUSE_LL` is a separate hook, so mouse-side-buttons kept working. Symptoms: first F press worked, all subsequent keypresses (even across full app restarts) were never delivered, but Mouse4 always worked. Fix in build 100: funnel every emit through `std::sync::mpsc::channel` into a dedicated emitter thread, so the hook callback does ONLY mutex+compare+send (a few μs) and stays well under any plausible timeout.
- **`WH_KEYBOARD_LL` requires elevation on the user's system.** Build 100's channel fix removed the timeout failure, but keyboard events still never reached our hook at all — diagnostic logging in builds 99/101/102 proved the callback was never invoked for keyboard events even though it was for mouse. Some combination of anti-cheat / input-protection / security tooling on the user's machine refuses to let a non-elevated process install `WH_KEYBOARD_LL` (mouse uses a less restrictive path). Verified by manually right-click → "Run as administrator" — that made the hook deliver events. Fix in build 103: embed a Windows app manifest with `requireAdministrator` via `tauri_build::WindowsAttributes::app_manifest`. The OS now prompts for UAC at launch, no manual right-click needed. New tradeoff: UAC prompt every time the user starts the Companion. Documented in the release notes.
- **WebView2 swallows keystrokes while the Companion window has focus.** Even running as Admin, keyboard PTT didn't fire when the user clicked into the Companion window — yet Mouse4/5 still worked. Webview-keyboard-capture-specific: when the window is focused, WebView2 captures keystrokes at the document level before they reach our global LL-hook. Fix in build 103: add a window-level `keydown`/`keyup` listener in App.tsx that also routes through `handlePttEvent`, so the focused-window path catches what the LL-hook misses. Both paths converge on the same `setMuted` call, making a duplicated event idempotent. Extracted `formatKeyboardAccelerator` + new `isMouseHotkey` / `keyReleaseMatchesAccelerator` helpers into `src/lib/hotkey.ts` so the React handler and `HotkeyCapture` share the same parsing.

### Removed — Phase B rollback of the B1 admiral-tier

- Three Prisma models that backed the unused admiral-creates-sessions flow (`ApiCredential`, `Session`, `InviteToken`) — all empty in production, atomic drop in the same migration as the AdminInviteLink add.
- Service files `apps/bridge/src/services/{apiCredentials,sessions,inviteTokens}.ts`.
- REST surface `apps/bridge/src/routes/api.ts` (the entire `/api/v1/*` namespace).
- WebSocket auth-paths `?invite=<token>` and `?adm=<key:secret>` — companion now uses only the existing `?token=<jwt>` OAuth path from Phase A.1.
- LiveKit helpers `sessionRoomName` + `issueSessionLivekitToken`.
- Bot slash command `/cc generate-credential` (the others — `/cc admin add|remove|list`, `/cc setup`, `/cc enable|disable|status`, `/cc role/channel add|remove` — stay until the web UI is verified live, then get removed in a follow-up commit).
- Test file `apps/bridge/src/__tests__/sessions.test.ts`.

## [0.1.0] - 2026-05-22

First end-to-end working MVP: a single commander can sign in via Discord, hold a configurable hotkey (mouse-button or keyboard), and reach **Audio: connected** on a local LiveKit room — verified live on Windows + Docker Desktop.

### Added (since previous milestone, sign-in + audio path)

- README rewritten with architecture diagram (Mermaid + ASCII), quickstart, repository layout, and scripts table.
- `docs/admin-guide.md` — full step-by-step Discord Developer Portal setup and operating notes.
- `docs/commander-guide.md` — commander-facing setup, hotkey reference, and troubleshooting.
- `docs/privacy.md` — data inventory and deletion instructions.
- Companion `Paste sign-in code` button + bridge HTML success page with copyable base64 code. Fallback for environments where the `dccc://` deep link doesn't fire (notably Windows Tauri dev mode).
- Diagnostic `[deep-link] / [hotkey raw]` logging in the companion to make sign-in and hotkey issues debuggable from the DevTools console.
- Single-instance plugin (`tauri-plugin-single-instance` with `deep-link` feature) so the OAuth redirect activates the running companion process instead of spawning a duplicate.
- Runtime registration of the `dccc://` URL scheme via `app.deep_link().register_all()` (dev-mode equivalent of the installer's Windows-registry write).
- Bridge `/auth/callback` now renders an HTML success page with the sign-in code; the deep-link redirect is attempted opportunistically via a 200ms `setTimeout`.

### Changed (live-test fixes)

- LiveKit tokens carry a random 8-char suffix in `identity` (`<userId>-<hex>`), so rapid press/release/press cycles do not collide on LiveKit's still-async server-side cleanup (was producing `DUPLICATE_IDENTITY` / reason 2 kicks). The real Discord user id is preserved as the `name` field and in our own `RoomRegistry` for active-commander tracking.
- `docker-compose.yml`: explicit `ports:` mappings instead of `network_mode: host` (the latter is broken on Docker Desktop for Windows). LiveKit is also launched with `--node-ip 127.0.0.1` so it advertises localhost as its WebRTC endpoint — without this, ICE candidate-pair establishment fails because the browser cannot NAT-hairpin to the host's external IP.
- React `StrictMode` removed from the companion entry. Its dev-mode double-mount triggered two parallel `BridgeWs` + `LivekitAudio` instances, which then collided on LiveKit identity. A cancelable-effect refactor is the proper fix and is tracked as a follow-up.

### Added (stabilisation)

### Added

- Server-side commander-role recheck while a PTT session is active: bridge re-verifies the role every 60 s and kicks (close 4403) with an `error` payload if it disappeared, was revoked, or the guild was disabled.
- Discord API rate-limit handling: a single retry honoring `Retry-After` on HTTP 429, capped at 5 s total wait.
- Bot logs lifecycle events: shard disconnect / reconnecting / resume / error and top-level client errors.
- Companion: explicit session-expiry handling — on WS close 4401 the persistent token is cleared, LiveKit is disconnected, and the UI shows "session expired — please sign in again".
- 5 new vitest tests for `RoomRegistry` (join/leave snapshots, broadcast, empty-room cleanup, no-op leave). Bridge suite now 20 tests, total 33/33.

### Added

- LiveKit voice bridge — actual cross-channel audio between commanders:
  - `livekit-server-sdk` in the bridge mints short-lived access tokens scoped to `commander-bridge-<guildId>` rooms (publish + subscribe, no recording).
  - In-memory `RoomRegistry` tracks who is currently in which room and broadcasts `commander:list` updates to everyone in the room on join/leave.
  - `bridge:joined` now carries `livekitUrl` + `livekitToken` so the companion can connect to the SFU directly.
  - `commander:list` now includes the `roomId` it refers to (multi-room awareness).
  - PTT guildId is verified against the session token's guildId — a commander can only PTT into their own server's bridge room.
  - Bridge cleans up room membership and broadcasts an updated commander list on every WS close.
- Companion `LivekitAudio` wrapper: connects on `bridge:joined`, publishes microphone with echo cancellation + noise suppression, attaches remote audio tracks to `<audio>` elements, disconnects on `bridge:left`.
- New "Audio" status field in the companion UI.
- `docker-compose.yml` adds a local LiveKit server (`--dev` mode) on host network with built-in dev credentials.
- Environment: `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` (defaults to the dev container's values).

### Changed

- Default hotkey is now `Mouse4` (back-side mouse button). Keyboard hotkeys still work; the value `MouseN` is treated specially by the hotkey layer.
- Tauri-plugin-global-shortcut handles keyboard hotkeys; an always-on `rdev` listener thread (Windows only for now) handles mouse-button hotkeys. The event filter ensures only the configured accelerator triggers PTT.
- (Earlier:) attempted to use `Alt+F1` as a default before settling on `Mouse4`. Before that we tried `Alt+CapsLock`, which Windows' `RegisterHotKey` refuses to bind because CapsLock is a toggle key.

### Added

- Companion now drives a real PTT round-trip end-to-end:
  - Global hotkey (default `Alt+F1`, user-configurable) emits Rust → JS events with `pressed`/`released` state.
  - `BridgeWs` client with auto-reconnect (exponential backoff, capped at 30 s), 20 s heartbeat, structured server message dispatch.
  - OAuth flow: "Sign in with Discord" opens the bridge in the system browser; `dccc://auth?token=…&guildId=…` deep link is captured and the session is persisted via `@tauri-apps/plugin-store`.
  - Settings store: `token`, `guildId`, `hotkey` survive app restarts.
  - UI now reflects real state: connection status, signed-in flag, active commanders, hotkey label, error banner; "Sign in / Sign out" and "Change hotkey" actions.
- Tauri plugins enabled: `global-shortcut`, `deep-link`, `opener`, `store`; Cargo + JS deps added in parallel.
- `dccc://` registered as a desktop URL scheme; plugin capabilities scoped to the `main` window.
- Companion app skeleton (`@dccc/companion`) built with Tauri 2 + React 18 + Vite 6.
- Status UI: server name, connection status, commander role, hotkey, microphone, active commander count (all mock values for now).
- Dark theme; live banner "COMMANDER BRIDGE LIVE" toggles on `pttActive` state.
- Tauri config: window 520×640, identifier `com.head87x.dccc.companion`, bundle metadata, minimal default capability (`core:default`).
- Rust crate `dccc-companion` (lib + bin) with a placeholder `greet` command and dev-tools auto-open in debug builds.
- Minimal 32×32 placeholder PNG icon — replaced with real artwork in chapter 11.
- Pnpm overrides pin `@types/react@^18.3.18` to avoid React 19 leaking in via Prisma Studio transitives.
- Esbuild added to `pnpm.onlyBuiltDependencies` so Vite's native binary installs cleanly.

### Added

- Discord OAuth2 login on the bridge:
  - `GET /auth/start?guildId=…` → 302 redirect to Discord with `identify guilds.members.read` scope.
  - `GET /auth/callback?code=…&state=…` → exchanges code, fetches `/users/@me`, checks guild membership via bot token, matches against `GuildConfig.commanderRoleIds`, issues session token, redirects to `COMPANION_REDIRECT_URI` (default `dccc://auth`).
- CSRF protection via signed state cookie (httpOnly, sameSite=lax, 10-min TTL).
- Read-only `readGuildConfig()` in bridge (writes stay on the bot).
- Discord API client (`exchangeCodeForToken`, `fetchCurrentUser`, `fetchGuildMember`, `buildAuthorizeUrl`) — all Zod-validated, access tokens never logged.
- Optional OAuth env (`DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, `OAUTH_REDIRECT_URI`, `COMPANION_REDIRECT_URI`) — when missing, OAuth routes return 503 with a helpful error.
- 8 new vitest tests for OAuth flow (success path, state mismatch, missing cookie, guild disabled, missing commander role, not-a-member).
- Generator output moved from `packages/db/src/generated/` to `packages/db/generated/` so the relative import path resolves the same way in `src/` and `dist/`.

### Changed

- Bridge no longer passes a pre-built pino instance to Fastify (type incompatibility); Fastify builds its own pino with the same level/redact options.

- Bridge backend skeleton (`@dccc/bridge`) built on Fastify 5 and `@fastify/websocket`.
- `GET /health` returns `{ ok: true, service: "bridge" }`.
- `GET /ws` (WebSocket) accepts `?token=<jwt>` for session-token authentication.
- JWT session tokens via `jose` (HS256, 15-minute default TTL, issuer + audience claims, revocation list).
- Server-side validation of all incoming WS messages with `parseClientMessage` from `@dccc/shared`.
- Heartbeat loop (server pings every 20s, terminates connection if no pong).
- Defined WebSocket close codes: `4401` for auth failure, `4400` for protocol violation.
- Zod-validated bridge environment (`SESSION_SECRET ≥ 32 chars`, `BRIDGE_HOST`, `BRIDGE_PORT`, `LOG_LEVEL`).
- Pino logger with token redaction (shared style with bot).
- Graceful shutdown on SIGINT/SIGTERM.
- Vitest suite for bridge: 7 end-to-end WebSocket tests covering health check, auth rejection, protocol validation, JSON-parse rejection, and PTT round-trip.
- Test setup file seeds env vars before any module import (fixes eager `getEnv()` in logger).
- `.env` now includes `SESSION_SECRET`, `BRIDGE_HOST`, `BRIDGE_PORT`, `LOG_LEVEL` for local dev.
- Discord bot MVP (`@dccc/bot`) with `/cc` slash command tree:
  - `/cc setup mode:<external_voice|discord_channel|bot_relay>` — initialise configuration.
  - `/cc role add|remove <role>` — manage commander roles.
  - `/cc channel add|remove <voice channel>` — manage participating voice channels.
  - `/cc status` — embed showing current configuration.
  - `/cc enable` / `/cc disable` — toggle the system per server.
- All `/cc` commands are gated by Discord's `Manage Guild` permission and refuse DM use.
- Zod-validated bot environment (`DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `LOG_LEVEL`).
- Pino logger with redaction of tokens and secrets.
- `GuildConfig` service backed by `@dccc/db` (upserts, JSON-encoded ID lists, snowflake-safe).
- Global slash command registration via REST API on bot startup.
- Graceful shutdown (SIGINT/SIGTERM) closes Discord client and Prisma connection.
- `@dccc/db` package wrapping Prisma client (lazy singleton via `getPrisma()`, `disconnectPrisma()`).
- Prisma 6 schema (`prisma/schema.prisma`) with `GuildConfig` and `CommanderSession` models on SQLite.
- Initial migration `20260521194606_init` (creates both tables).
- Root scripts: `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:studio`.
- Prisma client generated into `packages/db/src/generated/` (gitignored, regenerated on demand).
- `.env` (gitignored) with `DATABASE_URL="file:./dev.db"` for local development; `.env.example` updated to match.
- `@dccc/shared` package with domain types (`GuildConfig`, `CommanderSession`, `BridgeRoom`, `CommanderInfo`), WebSocket protocol (`ClientMessage`, `ServerMessage`), and Zod validators (`parseClientMessage`, `parseServerMessage`).
- Discord snowflake ID validation (17–20 digit numeric strings).
- Vitest test suite for shared package (13 tests covering positive and negative parse cases).
- Root `pnpm test` script (recursive, `--if-present`).
- pnpm workspace with four packages: `apps/bot`, `apps/bridge`, `apps/companion`, `packages/shared`.
- Root `package.json` (`build`, `lint`, `format` scripts), pinned `pnpm@10.33.0`, Node >=20.
- `tsconfig.base.json` with TypeScript strict mode, `noUncheckedIndexedAccess`, ES2022 target.
- ESLint flat config (typescript-eslint + Prettier integration) and `.prettierrc.json`.
- `.env.example` listing all environment variables from CLAUDE.md.
- `.gitattributes` enforcing LF line endings for source files (CRLF for `.bat`/`.cmd`/`.ps1`).
- Placeholder entry points and `tsconfig.json` for each workspace package (build green, no logic yet).
- Initial repository scaffolding: `.gitignore`, `README.md`, `LICENSE` (MIT), `CHANGELOG.md`.
- Project specification in `CLAUDE.md` describing the Discord Channel Commander Voice Bridge architecture (Bot + Bridge + Companion).
