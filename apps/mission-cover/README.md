# @rdoc-suite/mission-cover

Self-contained **mission-cover render microservice** (FR-P4). Wraps the
**MissionCover** Star-Citizen briefing-cover generator (in [`engine/`](engine/),
author **Vi5E** — vi5e.net / twitch.tv/vi5e / youtube @Vi5E_) and exposes a
server-side render API. The fleetplanner sends an op payload, the service renders
a cover image with headless Chromium and returns a link.

## How it renders

The engine is a browser SPA that hydrates its config from `localStorage`. The
service seeds those keys in a Playwright Chromium context, loads the built
single-file bundle (`engine/dist/index.html`), waits for fonts/QR/background to
settle, and screenshots the `#mission-cover-canvas` node. So the server render is
pixel-identical to the interactive editor with **no second render path**.

## API

M2M endpoints require `Authorization: Bearer <MISSIONCOVER_SERVICE_SECRET>`.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `POST` | `/v1/covers` | Bearer | Render + store a cover. Body = `CoverRequest` (see `src/schema.ts`). → `201 CoverResponse`. |
| `GET` | `/v1/covers/:id` | Bearer | Cover metadata + link. |
| `DELETE` | `/v1/covers/:id` | Bearer | Delete a stored cover (cleanup). |
| `GET` | `/covers/:id.png` | **public** | The rendered image (read-only, unguessable id). Public via Caddy `/cover/covers*`. |
| `GET` | `/health` · `/about` | public | Liveness / author credit. |

`POST /v1/covers` body:

```jsonc
{
  "opId": "ckxyz",
  "format": "16:9",            // 16:9 | 1:1 | 9:16 | 4:3 | custom
  "preset": "fleet-ops",       // fleet-ops | black-ops | exploration | outlaw
  "data": {
    "title": "OPERATION DATENKERN",
    "subtitle": "ASD-SICHERHEITSKOMPLEX",
    "objectiveText": "Datenkern sichern ...",
    "dateTime": "2026-06-08T20:00:00Z",
    "location": "STANTON // ARC-L1",
    "assets": [{ "name": "Carrack", "role": "Recon" }],
    "briefingUrl": "https://suite.raumdock.org/fleetplanner/ops/ckxyz",
    "branding": { "footerTitle": "CCO SPECIAL OPERATIONS COMMAND" }
  }
}
```

## Config (env)

| Var | Default | Notes |
|---|---|---|
| `PORT` / `HOST` | `3300` / `0.0.0.0` | |
| `MISSIONCOVER_SERVICE_SECRET` | — (required, ≥32) | M2M bearer; fail-closed. |
| `MISSIONCOVER_PUBLIC_URL` | `http://localhost:3300` | Base for image links (prod: `https://suite.raumdock.org/cover`). |
| `DATA_DIR` | `<root>/data/covers` | Artifact volume. Prod: `/app/data/covers`. |
| `ENGINE_HTML` | `<root>/engine/dist/index.html` | Built bundle path. |
| `RENDER_SCALE` | `2` | Device pixel ratio of the output. |
| `RENDER_TIMEOUT_MS` | `20000` | Per-render budget. |
| `MAX_DIMENSION` / `MAX_PAYLOAD_BYTES` | `4000` / `8 MiB` | Guardrails. |
| `ALLOWED_IMAGE_HOSTS` | `""` | Extra image hosts the renderer may fetch (font CDNs always allowed; everything else blocked). |

## Build / run

Docker only (project rule — no local pnpm/npm). Built from repo root via
[`apps/mission-cover/Dockerfile`](Dockerfile) or `docker-compose.prod.yml`.
The Dockerfile uses the Playwright base image (Node + matching Chromium); keep
the `playwright` dependency version in lockstep with the image tag.

## Status

Step 1+2 (FR-P4): engine import + render API + store + fleetplanner client.
**Pending:** fleetplanner UI button + `opId→cover` persistence, editor mode
(`/cover/edit/:id`), Discord-event-image / cross-post synergy. See
[`docs/FR-P4-mission-cover-service.md`](../../docs/FR-P4-mission-cover-service.md).
