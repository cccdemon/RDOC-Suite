# STAND — RDOC-Suite Deployment Status

Target host: LXC 10.10.10.97 (Commander LXC)  
Public URLs: `https://suite.raumdock.org` (bridge + admin + fleetplanner + monitoring), `wss://voice.raumdock.org` (LiveKit)

## Services

| Service | Image | Port | Status |
|---------|-------|------|--------|
| `rdoc-suite-bridge` | built from `apps/bridge/Dockerfile` | 8787 (loopback) | ✅ deployed |
| `rdoc-suite-bot` | built from `apps/bot/Dockerfile` | — | ✅ deployed |
| `rdoc-suite-livekit` | `livekit/livekit-server:latest` | 7880 (loopback), 7881, 7882/udp | ✅ deployed |
| `rdoc-suite-fleetplanner` | built from `apps/fleetplanner/Dockerfile` | 3200 (loopback) | ✅ deployed |
| `rdoc-suite-monitoring` | built from `apps/monitoring/Dockerfile` (Prometheus) | 9090 (loopback) | ✅ deployed |
| `rdoc-suite-relay-bots` | built from `apps/relay-bots/Dockerfile` | 8788 (loopback) | ⬜ not yet deployed (step 11) |

## Reverse proxy

TLS termination is done by **Traefik** on the LXC host (not inside Docker).  
LXC 101 nginx does TCP SNI passthrough on `:443` → `10.10.10.97:8443` (Traefik websecure).  
WebRTC media (7881/tcp, 7882/udp) is iptables-DNAT'd from LXC 101 directly to 10.10.10.97.

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
`DATABASE_URL` must point to `/app/data/prod.db` (the Docker volume), NOT `/app/prisma/prod.db`.

## Open decisions (from mergelog)

- Package namespace: still `@dccc/*`; recommended final namespace `@rdoc-suite/*` or `@rdoc-sc/*`.
- Room model: guild-room and session-room both work; one shared `RoomRegistry`.
- Voice-to-All permission: relay button visible when bridge grants `canUseRelay: true`;
  enable by setting `RELAY_REQUIRED_ROLE_ID` (or leave unset for no role check).
- Session model: invite-based ops rooms (step 3) — no change planned.
