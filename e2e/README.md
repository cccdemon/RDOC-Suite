# Fleetplanner E2E (Playwright)

Browser tests that drive the **real SPA** against the **local test stack** — nginx front door,
Fastify backend, Postgres, and a simulated Discord. No production instance is involved.

```bash
./scripts/test-stack.sh up      # start the stack (from the repo root)
./scripts/test-stack.sh e2e     # run this suite against it
./scripts/test-stack.sh e2e -g "Discord"   # extra args go straight to playwright
```

The stack's fixed secrets live in `tests/stack/env.test`, so the default run needs no setup at all.
See [`docs/TESTING.md`](../docs/TESTING.md) for the full picture.

## Configuration

| Env | Default | Meaning |
|---|---|---|
| `E2E_BASE_URL` | `http://localhost:8099` | where the app is |
| `E2E_BASE_PATH` | `""` | path prefix (`/fleetplanner` in production) |
| `E2E_TEST_LOGIN_SECRET` | local-stack value | the env-gated `/e2e` seam's secret |
| `E2E_DISCORD_MOCK_URL` | `http://localhost:4400` | Discord simulator control plane |

Without `E2E_DISCORD_MOCK_URL` the Discord specs (`30`–`34`) **skip** instead of failing.

## Helpers

- `helpers/auth.ts` — `login(username, role, guildRole, { guildId, discordId })` mints a session for a
  synthetic `e2e-*` player. Pass `discordId` (`/^3\d{17}$/`) for anything Discord-side: DMs,
  interaction buttons, interest resolution.
- `helpers/discordMock.ts` — shape Discord (`seedDiscord`, `loginAs`, `setInterested`,
  `injectFaults`), assert what the app sent (`discordState`, `discordCalls`, `scheduledEvents`,
  `dmsTo`, `channelMessages`), and drive it back (`pressButton`, `pressButtonUnsigned`, `sendPing`).
  `waitFor()` polls for fire-and-forget effects instead of sleeping.

## Safety

- All test players are synthetic `e2e-*` users in the synthetic E2E guilds
  (`100000000000000001`, `100000000000000002`). The seam refuses any other username.
- `cleanup()` deletes only those guilds' operations.
- Against the local stack nothing is shared and everything is thrown away on `down`.

## Running against a live instance

Possible, but it means opening the login seam on that host:

```bash
cd e2e
npm install && npx playwright install chromium
E2E_BASE_URL=https://suite.raumdock.org \
E2E_BASE_PATH=/fleetplanner \
E2E_TEST_LOGIN_SECRET=<the instance's secret> \
  npx playwright test
```

The instance must have the same `E2E_TEST_LOGIN_SECRET` set.
**Unset it on the instance after the run.** The specs avoid destructive real-data actions (no
maintenance toggle, no feedback-channel change, no catalog sync, no real-guild ban), but the seam
itself is the risk — close it.
