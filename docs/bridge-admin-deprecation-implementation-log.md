# Bridge Admin Deprecation Implementation Log

Date: 2026-06-02

## Step 1 - Documentation

Before touching code, create `docs/bridge-admin-deprecation-plan.md`.

Reason:

- Bridge Admin is only partially obsolete.
- Fleetplanner and Companion still depend on Bridge backend APIs.
- A route-by-route decision prevents accidental deletion of required backend
  capabilities.

Expected result:

- The migration target is explicit.
- Future cleanup work can continue from a documented keep/move/hide/remove
  matrix.

Status: completed.

## Step 2 - Bridge Admin UI mode flag

Before changing routes, add an environment-controlled UI mode:

- `BRIDGE_ADMIN_UI_MODE=full`
- `BRIDGE_ADMIN_UI_MODE=legacy`
- `BRIDGE_ADMIN_UI_MODE=disabled`

Reason:

- Production can hide the native Bridge Admin UI only after Fleetplanner is the
  desired operator surface.
- Backend routes must remain active even when the native Admin UI is hidden.

Expected result:

- `disabled` blocks native `/admin/*`.
- `/internal/fleet/*`, `/sessions/*`, `/download/*`, `/updater/*`, relay routes,
  and WebSocket signaling remain registered.

Planned edit:

1. Extend `apps/bridge/src/config/env.ts` with
   `BRIDGE_ADMIN_UI_MODE=full|legacy|disabled`, default `full`.
2. Update `apps/bridge/src/app.ts` so `registerAdminRoutes(app)` is skipped
   only when the mode is `disabled`.
3. Keep every non-admin route registration unchanged.

Result:

- `apps/bridge/src/config/env.ts` now defines `BRIDGE_ADMIN_UI_MODE`.
- `apps/bridge/src/app.ts` registers native Bridge Admin routes only when the
  mode is not `disabled`.
- No non-admin route registration was changed.

Status: completed.

## Step 3 - Native Bridge Admin legacy banner

Before changing page rendering, add a central banner in the Bridge Admin layout
for `BRIDGE_ADMIN_UI_MODE=legacy`.

Reason:

- Deep links should keep working in legacy mode.
- Operators should see that Fleetplanner is the primary Mission Voice admin UI.
- A central layout banner avoids scattered page edits.

Expected result:

- Every native Bridge Admin page except the login shell shows a legacy notice in
  `legacy` mode.
- `full` mode renders unchanged.
- `disabled` mode still prevents route registration.

Result:

- `apps/bridge/src/admin/views.ts` renders a central legacy banner when
  `BRIDGE_ADMIN_UI_MODE=legacy`.
- `apps/bridge/src/admin/static/admin.css` styles the banner without changing
  page behavior.
- Login remains unchanged.

Status: completed.

## Step 4 - Companion admin-session link

Before changing Companion behavior, inspect the available runtime state.

Reason:

- The old link opens `${bridgeUrl}/admin/sessions`.
- Fleetplanner already exposes Bridge Mode sessions at
  `/admin/bridge/:guildId/sessions`.
- The Companion can only link there safely if it knows the Fleetplanner base URL
  and the active guild ID.

Expected result:

- If Companion has both values, replace the link with Fleetplanner.
- If not, document the missing prerequisite instead of creating a broken URL.

Result:

- Companion state already contains `fleetplannerUrl` and `guildId`.
- `apps/companion/src/App.tsx` now opens
  `${fleetplannerUrl}/admin/bridge/${guildId}/sessions` for Admiral session
  management.
- A Bridge Admin `/admin/sessions` fallback remains for old local states without
  a guild ID.

Status: completed.

## Step 5 - Changelog

Before verification, add the Fleetmanager/Fleetplanner-facing changelog entry.

Reason:

- This cleanup changes operator-facing admin routing and Bridge Admin exposure.
- The user explicitly asked earlier to keep Fleetmanager changelog coverage.

Expected result:

- `CHANGELOG.md` explains that Fleetplanner is now the preferred Bridge Admin
  surface and native Bridge Admin can be gated by `BRIDGE_ADMIN_UI_MODE`.

Result:

- `CHANGELOG.md` has a new Fleetmanager entry for Bridge Admin legacy control
  plane behavior.

Status: completed.

## Step 6 - Verification test for disabled native Admin UI

Before running tests, add a focused Bridge test.

Reason:

- The important safety property is that `disabled` removes only native
  `/admin/*` UI exposure.
- Non-admin routes must still be registered.

Expected result:

- With `BRIDGE_ADMIN_UI_MODE=disabled`, `/admin/login` returns 404.
- The same app still answers `/health`.

Result:

- The added test mutates `process.env` and resets the cached Bridge env while
  other Bridge test files run in parallel.
- That caused unrelated OAuth/relay tests to return 500.
- The route-level disabled-mode test was removed from the parallel Vitest suite.
- Keep verification to builds/tests plus a future refactor if route-level testing
  should be done with an explicit env override passed into `buildApp`.

Status: completed with caveat.

## Step 8 - Testable Admin UI mode without mutating process.env

Before changing code, add a safe verification path for
`BRIDGE_ADMIN_UI_MODE=disabled`.

Reason:

- The first route-level disabled-mode test mutated `process.env` and reset the
  cached Bridge env while Vitest ran other files in parallel.
- That made unrelated OAuth/Relay tests fail with 500 responses.
- The product behavior still needs a focused regression test, but the test must
  not touch global env state.

Planned edit:

1. Add an optional `buildApp({ bridgeAdminUiMode })` override used only for app
   construction.
2. Keep production behavior unchanged: no option means `getEnv().BRIDGE_ADMIN_UI_MODE`.
3. Add a test that builds a second app with `{ bridgeAdminUiMode: "disabled" }`.
4. Verify `/admin/login` is 404 and `/health` remains available.

Expected result:

- The disabled native Admin UI behavior is covered.
- The full Bridge test suite can run without cross-file env races.

Result:

- `apps/bridge/src/app.ts` now accepts optional
  `buildApp({ bridgeAdminUiMode })`.
- Production behavior remains unchanged because the option defaults to
  `getEnv().BRIDGE_ADMIN_UI_MODE`.
- `apps/bridge/src/__tests__/admin.test.ts` now verifies disabled mode without
  mutating `process.env`.

Status: completed.

## Step 9 - Full Bridge verification after safe disabled-mode test

Before moving to additional UI cleanup, rerun Bridge tests/build.

Expected result:

- Full Bridge tests pass or reveal a real unrelated global-settings test issue.
- Bridge build still passes.

Status: pending.

## Step 10 - Bridge test DB GlobalSettings table

Before editing test setup, record the failure cause.

Observed:

- Full Bridge tests still failed after the env-race-safe disabled-mode test.
- All failing OAuth/Relay paths call `getGlobalSettings()`.
- The generated Prisma client and `prisma/schema.prisma` include
  `GlobalSettings`.
- The Bridge SQLite test DB at `prisma/prisma/dev.db` does not contain the
  `GlobalSettings` table.

Planned edit:

1. Update `apps/bridge/src/__tests__/setup.ts`.
2. After setting `DATABASE_URL`, create `GlobalSettings` with
   `CREATE TABLE IF NOT EXISTS`.
3. Keep this limited to test setup; do not change production
   `getGlobalSettings()` behavior.

Expected result:

- OAuth and Relay tests can read empty global settings instead of hitting a
  missing-table 500.

Status: pending.

## Step 7 - Verification

Before finishing, run focused tests and builds:

1. Bridge tests.
2. Bridge TypeScript build.
3. Companion build because `App.tsx` changed.
4. `git diff --check`.

Expected result:

- No test or build regression from the UI gate or Companion link change.

Result:

- `pnpm.cmd --filter @rdoc-suite/bridge exec vitest run src/__tests__/admin.test.ts --reporter=verbose`
  passed: 14 tests.
- `pnpm.cmd --filter @rdoc-suite/bridge build` passed.
- `pnpm.cmd --filter @rdoc-suite/companion build` passed.
- `git diff --check` passed.
- Full `pnpm.cmd --filter @rdoc-suite/bridge test` did not pass. The failures
  are in OAuth/Relay tests that return 500 on paths using `getGlobalSettings()`;
  this was not changed by the Bridge Admin UI gate work. Leave this as a
  separate follow-up unless the user wants the Bridge global-settings test DB
  issue fixed now.

Status: completed with caveat.
