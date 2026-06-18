# LiveKit (WebRTC SFU) — removed 2026-06-18, archived for reuse

LiveKit was the SFU for the original voice stack (bridge / bot / relay-bots,
removed 2026-06-12). After that removal nothing in the running suite consumed it
anymore (see mergelog 2026-06-18), so the `livekit` service + all wiring was
removed from the active tree. **This file is the reuse plan**: everything needed
to bring LiveKit back lives here verbatim.

> Current voice direction is **RDOC SquadLink Lite** (serverless P2P WebRTC via a
> separate init-server, repo RDOC-SACompanion) — *not* LiveKit. Only restore the
> below if a redesign deliberately re-adopts a central SFU.

## Restore checklist

1. Re-add `livekit.yaml` at repo root (content below).
2. Re-add the `livekit` service to `docker-compose.prod.yml` (and to dev compose if
   local browser voice testing is needed) and add `livekit` back to
   `caddy-rdoc.depends_on`.
3. Re-add the LiveKit env block to `.env.prod.template` (and real values to `.env`).
4. Re-add the `rdoc-suite-livekit` scrape job to `apps/monitoring/prometheus.yml`.
5. Re-add the `voice.raumdock.org:9443` reverse_proxy to
   `deploy/caddy-rdoc/Caddyfile`.
6. Re-add the consumer's env fields (`LIVEKIT_URL/API_KEY/API_SECRET`, and
   `RELAY_LIVEKIT_ROOM` if relay-bots return) wherever the new voice service reads
   them, plus the `livekit-server-sdk` dependency.
7. Infra (host, outside repo): re-create the LXC-101 iptables DNAT for `7881/tcp` +
   `7882/udp` → the suite host. UDP 7882 must be open in the firewall — docker-proxy
   is not enough (SNAT/ICE breakage on Proxmox/LXC; see CLAUDE.md quirks).

## `livekit.yaml` (repo root)

```yaml
port: 7880
bind_addresses:
  - "0.0.0.0"

rtc:
  # Off because Proxmox/LXC double-NAT makes STUN return an
  # unreachable internal IP. Real public IP comes in via --node-ip on
  # the command line (see docker-compose.prod.yml).
  use_external_ip: false
  tcp_port: 7881
  udp_port: 7882

# NOTE: API keys are NOT in this file. LiveKit reads them from the
# LIVEKIT_KEYS environment variable (set in docker-compose.prod.yml,
# composed from LIVEKIT_API_KEY + LIVEKIT_API_SECRET in .env). This
# avoids the "git pull overwrites my resolved secrets" pain — the file
# in git stays generic, the secrets live exclusively in .env on the
# deployer's host.

log_level: info

# Internal-only Prometheus endpoint. This is not published publicly; Prometheus
# scrapes it on the Docker network as livekit:6789.
prometheus_port: 6789
```

## Prod compose service (`docker-compose.prod.yml`)

```yaml
  livekit:
    image: livekit/livekit-server:latest
    container_name: rdoc-suite-livekit
    restart: unless-stopped
    # --node-ip is load-bearing: without it, LiveKit tries to STUN-detect
    # its public IP, but inside a double-NAT Proxmox/LXC setup STUN returns
    # the LXC-internal gateway (e.g. 10.10.10.1) instead of the actual
    # public IP. LiveKit then advertises that internal address to clients
    # as an ICE candidate, ICE never establishes, and audio fails with
    # "could not establish pc connection". Solution: pass the deployer's
    # real public IP explicitly via env.
    command: --config /etc/livekit.yaml --node-ip ${LIVEKIT_NODE_IP}
    volumes:
      - ./livekit.yaml:/etc/livekit.yaml:ro
    ports:
      - "127.0.0.1:7880:7880"   # signaling, loopback-only (Traefik upstream)
      - "7881:7881"             # WebRTC-Media TCP, external via LXC-101 DNAT
      - "7882:7882/udp"         # WebRTC-Media UDP
    environment:
      LIVEKIT_KEYS: "${LIVEKIT_API_KEY}: ${LIVEKIT_API_SECRET}"
```

`caddy-rdoc.depends_on` also listed `livekit`.

## Dev compose service (was the entire `docker-compose.yml`)

```yaml
services:
  livekit:
    image: livekit/livekit-server:latest
    container_name: rdoc-suite-livekit
    # --node-ip 127.0.0.1 forces LiveKit to advertise localhost as its WebRTC
    # endpoint, so the browser reaches it through Docker's port mappings.
    command: --dev --bind 0.0.0.0 --node-ip 127.0.0.1
    restart: unless-stopped
    ports:
      - "7880:7880"      # WebSocket signaling
      - "7881:7881"      # ICE TCP
      - "7882:7882/udp"  # ICE UDP
    # --dev built-in credentials: api key "devkey", api secret "secret".
    # Local development only — never expose to the internet.
```

## `.env.prod.template` block

```dotenv
# LiveKit credentials
LIVEKIT_URL=wss://voice.raumdock.org
LIVEKIT_API_KEY=replace_with_real_key
LIVEKIT_API_SECRET=replace_with_real_secret

# Public IP of the host serving LiveKit WebRTC media (7881/tcp, 7882/udp).
# Required even single-server: LiveKit's STUN auto-detect breaks behind
# double-NAT (Proxmox/LXC). Find it with:  curl https://api.ipify.org
LIVEKIT_NODE_IP=replace_with_public_ip
```

## `apps/monitoring/prometheus.yml` scrape job

```yaml
  - job_name: rdoc-suite-livekit
    metrics_path: /metrics
    static_configs:
      - targets:
          - livekit:6789
```

## `deploy/caddy-rdoc/Caddyfile` block

```caddyfile
voice.raumdock.org:9443 {
	reverse_proxy 127.0.0.1:7880
}
```

## Grafana dashboard

`deploy/grafana/dashboards/rdoc-suite-overview.json` still contains the LiveKit
panels (`job="rdoc-suite-livekit"`: network, packets, rooms/participants,
goroutines/fds, memory, quality score/rating). Left in place — they render
"No data" without the scrape job and are ready to light up again on restore.
