# STAND — RDOC-Suite Deployment Status

Target host: LXC 103 (10.10.10.99) — public services LXC  
Public URLs: `https://suite.raumdock.org` (bridge + admin + fleetplanner + monitoring), `wss://voice.raumdock.org` (LiveKit)

## Services

| Service | Image | Port | Status |
|---------|-------|------|--------|
| `rdoc-suite-bridge` | built from `apps/bridge/Dockerfile` | 8787 (loopback) | ✅ deployed |
| `rdoc-suite-bot` | built from `apps/bot/Dockerfile` | — | ✅ deployed |
| `rdoc-suite-livekit` | `livekit/livekit-server:latest` | 7880 (loopback), 7881, 7882/udp | ✅ deployed |
| `rdoc-suite-fleetplanner` | built from `apps/fleetplanner/Dockerfile` | 3200 (loopback) | ✅ deployed (now on Postgres) |
| `rdoc-suite-fleetplanner-db` | `postgres:16-alpine` | 5432 (compose-internal only) | ⬜ new — set `FLEETPLANNER_DB_PASSWORD` in `.env` |
| `rdoc-suite-monitoring` | built from `apps/monitoring/Dockerfile` (Prometheus) | 9090 (loopback) | ✅ deployed |
| `rdoc-suite-relay-bots` | built from `apps/relay-bots/Dockerfile` | 8788 (loopback) | ⬜ not yet deployed (step 11) |

## Reverse proxy

TLS termination is done by **Traefik** on LXC 103 (10.10.10.99).  
LXC 101 nginx does TCP SNI passthrough on `:443` → `10.10.10.99:<TRAEFIK_PORT>` (Traefik websecure).

### SNI routes needed on LXC 101

Add to `/etc/nginx/stream.d/minecraft.raumdock.org.conf`:
```
# in the map block:
suite.raumdock.org   rdoc_suite_lxc;
# new upstream:
upstream rdoc_suite_lxc { server 10.10.10.99:<TRAEFIK_WEBSECURE_PORT>; }
```

`voice.raumdock.org` already routes to `10.10.10.99:3101` (old RDOC-RTC Caddy).  
If RDOC-Suite LiveKit takes over `voice.raumdock.org`, update that upstream to point at Traefik's LiveKit route instead.  
If running alongside old RDOC-RTC, pick a different hostname or port.

WebRTC media (7881/tcp, 7882/udp): add iptables DNAT on LXC 101 → `10.10.10.99`.

The `Caddyfile` in the repo root is an alternative config kept for reference — **not active in production**.

## Operator actions needed before first deploy of relay-bots

Create `relay-bots.config.json` in the repo root on the host (do NOT commit it):

```json
{
  "bridge": {
    "url": "http://bridge:8787",
    "serviceSecret": "<value of RELAY_BOTS_SECRET from .env>"
  },
  "livekit": {
    "url": "wss://voice.raumdock.org",
    "apiKey": "placeholder",
    "apiSecret": "placeholder",
    "relayRoomName": "voice-relay"
  },
  "discord": {
    "guildId": "0",
    "bots": []
  }
}
```

The `livekit` and `discord` sections above are placeholders — the bridge will overwrite them at runtime via `GET /relay-bots/service-config`. Configure actual bot tokens via the bridge admin UI at `https://suite.raumdock.org/admin/relay-bots`.

## Build + deploy

```bash
# Rebuild all services and restart
docker compose -f docker-compose.prod.yml up -d --build

# Rebuild a single service without downtime for others
docker compose -f docker-compose.prod.yml up -d --build bridge

# Check logs
docker compose -f docker-compose.prod.yml logs -f bridge
```

## Environment

Copy `.env.example` to `.env` on the host and fill in all required values.  
`DATABASE_URL` (bridge/bot, SQLite) must point to `/app/data/prod.db` (the Docker volume), NOT `/app/prisma/prod.db`.

### Fleetplanner = PostgreSQL (since 2026-05-30)

Fleetplanner moved off SQLite onto its own `postgres:16-alpine` container
(`fleetplanner-db`). Set **`FLEETPLANNER_DB_PASSWORD`** in `.env`; compose builds
`DATABASE_URL=postgresql://fleetplanner:<pw>@fleetplanner-db:5432/fleetplanner` for
the app. Migrations run via the app entrypoint (`prisma migrate deploy`) once the
DB healthcheck passes. The old SQLite `fleetplanner_data` volume is gone — this is a
fresh DB; ship catalog re-syncs from the SC wiki automatically, ops/users start empty.
Ship catalog auto-refreshes (default weekly, configurable) and can be triggered
manually at `…/fleetplanner/admin`.

## Open decisions (from mergelog)

- Package namespace: still `@dccc/*`; recommended final namespace `@rdoc-suite/*` or `@rdoc-sc/*`.
- Room model: guild-room and session-room both work; one shared `RoomRegistry`.
- Voice-to-All permission: relay button visible when bridge grants `canUseRelay: true`;
  enable by setting `RELAY_REQUIRED_ROLE_ID` (or leave unset for no role check).
- Session model: invite-based ops rooms (step 3) — no change planned.
