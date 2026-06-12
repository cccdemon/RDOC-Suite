# Fleetplanner E2E (Playwright)

End-to-end browser tests that drive the **real SPA against a live instance**
(default `https://suite.raumdock.org`). Test players sign in through the
env-gated `/e2e/login` seam (see `apps/fleetplanner/src/routes/e2eAuth.ts`).

## Safety

- All test players are synthetic `e2e-*` users in one synthetic **E2E guild**
  (`100000000000000001`). The seam refuses any non-`e2e-*` username.
- The specs **never** perform real-data destructive actions: no maintenance
  toggle, no feedback-channel change, no catalog sync trigger, no real-guild
  ban, and feedback is filled but not submitted. Ban/role tests act only on the
  E2E guild / `e2e-*` users.
- `helpers/auth.cleanup()` (run in `beforeAll`/`afterAll`) deletes only the E2E
  guild's operations via `/e2e/cleanup`.

## Run

```bash
cd e2e
npm install
npx playwright install chromium
E2E_TEST_LOGIN_SECRET=<the instance's E2E_TEST_LOGIN_SECRET> \
  E2E_BASE_URL=https://suite.raumdock.org \
  npx playwright test
```

The instance must have `E2E_TEST_LOGIN_SECRET` set in its env (same value).
**Unset it on the instance after the run** to remove the seam.
