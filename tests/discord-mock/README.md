# discord-mock

Discord API simulator for the local test stack (`docker-compose.test.yml`). It implements the
exact subset of the Discord REST API that `apps/fleetplanner` calls, records every request, and
can send **signed** Discord interactions back into the app.

> Test-only. It hands out OAuth tokens for any user id and accepts any bot token unless
> `DISCORD_MOCK_BOT_TOKEN` is set. Never expose it outside the test network.

## How the app reaches it

`apps/fleetplanner/src/config/env.ts` resolves the Discord endpoints at call time:

| Env | Default (prod) | Test stack |
|---|---|---|
| `DISCORD_API_BASE` | `https://discord.com/api/v10` | `http://discord-mock:4400/api/v10` |
| `DISCORD_SITE_BASE` | `https://discord.com` | `http://localhost:4400` (browser-visible) |

The app logs a warning at boot when either is off its default.

## Simulated Discord endpoints

| Method | Path | Used by |
|---|---|---|
| `GET` | `/api/v10/oauth2/authorize` | login redirect — auto-approves, bounces back with `?code=` |
| `POST` | `/api/v10/oauth2/token` | `discordExchange()` |
| `GET` | `/api/v10/users/@me` | bot identity (Bot auth) **or** profile (Bearer) |
| `GET` | `/api/v10/users/@me/guilds` | guild scoping at login |
| `GET` | `/api/v10/guilds/:id` | `fetchGuildBasic`, `checkGuildBotPresence` (404 ⇒ "absent") |
| `GET` | `/api/v10/guilds/:id/members/:uid` | role → fleet-role mapping |
| `GET` | `/api/v10/guilds/:id/roles` | guild settings role pickers |
| `GET` | `/api/v10/guilds/:id/channels` | announcement/feedback channel pickers |
| `POST/PATCH/DELETE` | `/api/v10/guilds/:id/scheduled-events[/:eid]` | op ↔ Discord event sync (validated like Discord: `privacy_level`, `entity_type`, EXTERNAL needs end time + location) |
| `GET` | `/api/v10/guilds/:id/scheduled-events/:eid/users` | interest sync — **paginated** (`limit`, `after`, `with_member`) |
| `POST` | `/api/v10/users/@me/channels` | DM channel creation |
| `POST` | `/api/v10/channels/:id/messages` | DMs, feedback tickets (JSON **and** multipart uploads) |

Anything unimplemented answers `404` with a message naming the route — an unexpected Discord call
fails a test loudly instead of silently passing.

## Control plane

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/__mock/health` | readiness + public key |
| `GET` | `/__mock/keys` | `{ publicKeyHex }` (matches `DISCORD_FLEETPLANNER_PUBLIC_KEY`) |
| `POST` | `/__mock/reset` | wipe back to the seeded baseline |
| `POST` | `/__mock/seed` | merge a state fragment (`guilds`, `users`, `members`, …) |
| `GET` | `/__mock/state` | full state — the assertion surface |
| `GET` | `/__mock/calls?method=&path=&since=` | recorded requests |
| `POST` | `/__mock/calls/clear` | reset the call log without touching state |
| `POST` | `/__mock/login-as` | `{ id, username, guildIds?, roles? }` — who the next OAuth login is |
| `POST` | `/__mock/interest` | `{ guildId, eventId, users:[{id,username,nick}] }` |
| `POST` | `/__mock/faults` | `[{ method, path (glob), status, body, times }]` — fault injection |
| `POST` | `/__mock/interaction` | sign an interaction with Ed25519 and POST it to the app |

`POST /__mock/interaction` with `{ customId: "evt-share:<distId>", discordUserId }` reproduces a
Discord approval-button press. `{ badSignature: true }` proves the app rejects a forged one.

## Keys

The Ed25519 key is derived from `DISCORD_MOCK_KEY_SEED` (32 bytes, default
`rdoc-suite-discord-mock-seed-01!`). The matching public key is

```
7dc71677aeadc6971e9f91d8903345fe531bab14c92ab3dbd55d5a06fdea91f2
```

and must be the app's `DISCORD_FLEETPLANNER_PUBLIC_KEY` in the test stack — it already is in
`tests/stack/env.test`. This is a published test key; it has no production meaning.

## Running it standalone

```bash
node tests/discord-mock/server.mjs           # :4400
curl -s localhost:4400/__mock/health | jq
```
