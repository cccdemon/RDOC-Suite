# Testing — RDOC-Suite

One rule: **everything runs locally, against a local stack, with Discord simulated.** No test needs
production, a live Discord app, or a backdoor open on a public host.

```bash
./scripts/test-stack.sh up      # build + start the local stack
./scripts/test-stack.sh up --with-cover   # ... plus the mission-cover renderer
./scripts/test-stack.sh all     # up → unit → unit:web → db → smoke → e2e → down
./scripts/test-stack.sh down    # stop and delete everything
```

**The cover renderer is opt-in.** `mission-cover` pulls a ~800 MB Chromium image, which nobody
needs to test navigation, so a plain `up` leaves it out — and `e2e/tests/19-cover.spec.ts` then
**skips with that reason** instead of timing out on an image that was never going to render. Pass
`--with-cover` (to `up` or to `all`) to have the renderer started, waited for, and the three cover
tests actually run. Note that the backend is always pointed at the service, so the skip is about
the renderer being absent, not about the feature being off.

## The four levels

| Level | Command | What it proves | Needs |
|---|---|---|---|
| **1 Unit** | `./scripts/test-stack.sh unit` | Backend service logic in isolation (Prisma mocked, `fetch` stubbed) | Docker |
| **1b SPA unit** | `./scripts/test-stack.sh unit:web` | SPA components, navigation model and routing (vitest + jsdom + msw) | Docker |
| **2 DB integration** | `./scripts/test-stack.sh db` | Real Prisma against a real Postgres, app via Fastify `.inject()` | Docker |
| **3 E2E** | `./scripts/test-stack.sh e2e` | The real SPA + backend + nginx + Discord simulator in a browser | running stack |
| **4 Smoke** | `./scripts/test-stack.sh smoke` | HTTP surface, security headers, auth gate | running stack |

`unit` covers `@rdoc-suite/fleetplanner`, `unit:web` covers `@rdoc-suite/fleetplanner-web` — two
separate vitest projects, two images (`tests/Dockerfile.unit`, `tests/Dockerfile.web-unit`). `all`
runs both.

Unit and DB tests run **in Docker** by default. A half-written local pnpm store breaks module
resolution in ways that look exactly like real test failures — the container removes that whole class
of confusion. `unit:local` / `db:local` use the local install when you want the faster loop.

The DB suite has two modes, picked by `TEST_DATABASE_URL`:

- **set** (what `test-stack.sh db` does) → use that server. The `fleetplanner_test` database is
  created if missing and `db push --force-reset` gives every run the same empty-schema guarantee a
  throwaway container used to. Guarded: the database name must contain `test`.
- **unset** (`db:local`) → `globalSetup` starts a throwaway Postgres through the docker CLI on port
  55433. That is why the historical harness could not run inside a container: it *is* the thing that
  starts containers.

## The local stack

`docker-compose.test.yml` mirrors production's shape and replaces the two things that must not be
real: Discord, and TLS.

```
browser → fleetplanner-web (nginx :8099) → fleetplanner (:3299) → postgres (tmpfs)
                                                 ↓
                                         discord-mock (:4400)
```

| Port | Service | Use |
|---|---|---|
| 8099 | fleetplanner-web | the app — what the browser and the E2E suite talk to |
| 3299 | fleetplanner | backend directly (API-level checks, log tailing) |
| 4400 | discord-mock | Discord simulator + `/__mock` control plane |
| 3399 | mission-cover | cover render service — **opt-in**: `./scripts/test-stack.sh up --with-cover` (pulls a ~800 MB Chromium image). Without it `19-cover` skips. |
| 55432 | postgres | throwaway DB (tmpfs — gone on `down`) |

Config lives in `tests/stack/env.test`. Its secrets are committed on purpose: the stack must come up
on any machine with Docker and nothing else. **Never copy it to `.env`** — it points Discord at a
simulator and opens the E2E login seam.

## Discord is simulated, not skipped

`tests/discord-mock/` implements the exact Discord REST subset the app uses, records every request,
and can push **Ed25519-signed** interactions back into the app. See its
[README](../tests/discord-mock/README.md) for the endpoint and control-plane list.

The app reaches it because the Discord endpoints are env-resolved
([`config/env.ts`](../apps/fleetplanner/src/config/env.ts)):

| Env | Default (production) | Test stack |
|---|---|---|
| `DISCORD_API_BASE` | `https://discord.com/api/v10` | `http://discord-mock:4400/api/v10` |
| `DISCORD_AUTHORIZE_BASE` | = `DISCORD_API_BASE` | `http://localhost:4400/api/v10` (browser-visible) |
| `DISCORD_SITE_BASE` | `https://discord.com` | `http://localhost:4400` |

Any non-default value is logged loudly at boot (`assertDiscordEndpoints`), so a redirected Discord
can never sit unnoticed in production.

What the Discord specs cover (`e2e/tests/30`–`34`):

- **30** op lifecycle → scheduled event: create (EXTERNAL, op link, +3h end time), edit → PATCH in
  place, stream-event name prefix, cancel/delete → DELETE, and a 429 outage that must not block
  publishing the op.
- **31** event distribution: partnership, approval DM with buttons, PING handshake, **rejected
  forged signature**, wrong-operator refusal, approve → partner event, double-press refusal, cancel
  → teardown.
- **32** messaging: feedback ticket, screenshot upload as multipart, a Discord 403 surfacing as an
  error, op announcement, cross-guild channel refusal.
- **33** "Interested" sync: linked pilot, unknown pilot kept as a shadow row, withdrawal, revival.
- **34** Discord OAuth login: code flow, bearer profile read, guild scoping, forged callback.

Discord specs `test.skip` themselves when `E2E_DISCORD_MOCK_URL` is unset, so a run against a live
instance skips them instead of failing.

## Writing tests

**Unit** — mock `../../db.js` and the neighbouring services; assert on the arguments the service
builds, not just on its return value. Assert the security-relevant shape too (`allowed_mentions`,
operation-scoped `where` clauses, bot vs. bearer auth).

**E2E** — helpers in `e2e/helpers/`:

- `auth.ts` — `login(username, role, guildRole, { guildId, discordId })` mints a session through the
  env-gated seam. Pass `discordId` (must match `/^3\d{17}$/`) for any Discord-side flow.
  `seedShips()` fills a five-ship catalog: the real one comes from the SC-wiki sync (internet plus
  minutes), so any spec that picks a ship seeds it instead of hoping the catalog is warm.
  `cleanup()` wipes the synthetic guilds' operations **and** their partnerships/share policies —
  a revoked partnership is permanent, so leaving one behind would make a spec unrepeatable.
- `discordMock.ts` — shape (`seedDiscord`, `loginAs`, `setInterested`, `injectFaults`), assert
  (`discordState`, `discordCalls`, `scheduledEvents`, `dmsTo`, `channelMessages`), and drive
  (`pressButton`, `pressButtonUnsigned`, `sendPing`). `waitFor()` polls for fire-and-forget effects.

## Running against a live instance

Possible but explicit — and it opens a backdoor on that host:

```bash
cd e2e
E2E_BASE_URL=https://suite.raumdock.org E2E_BASE_PATH=/fleetplanner \
  E2E_TEST_LOGIN_SECRET=<the instance's secret> npx playwright test
```

**Unset `E2E_TEST_LOGIN_SECRET` on the instance afterwards.** The read-only production smoke
(`scripts/prod-e2e-readonly.sh`) needs no secret and is safe at any time.

## Things the suite deliberately does not test

- **Ban/unban and instance-role changes from the admin console.** `listAllGuildsForAdmin()` hides the
  synthetic E2E guilds and the user list hides `e2e-*` players, both on purpose. The specs assert
  that invisibility instead of poking at real tenants.
- **The real Discord.** Every Discord assertion is against the simulator. Whether the live API still
  behaves the same is what `scripts/prod-e2e-readonly.sh` and the manual checklist are for.
- **TLS/Caddy.** The local stack ends at nginx.

## Troubleshooting

**`z.object(...).meta is not a function` / vitest cannot resolve a package.** The local pnpm store has
a half-written entry (`node_modules/.pnpm/zod@4.4.3/node_modules/zod` empty, for example). Run
`pnpm install` to repair it, or just use `./scripts/test-stack.sh unit` / `db`, which build their own
tree in Docker. Only the `:local` variants need a healthy local install.

**Port already in use.** `./scripts/test-stack.sh down` removes the containers and their volumes.
`db:local` uses its own container (`fp-vitest-pg`, port 55433), separate from the stack.

**A spec that passed alone fails in a full run.** Something upstream left state behind. `cleanup()`
in `beforeAll` is the fix; if the state is not an operation or a partnership, extend the seam
(`apps/fleetplanner/src/routes/e2eAuth.ts`) rather than working around it in the spec.
