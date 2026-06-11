# Fleetplanner Route Inventory (FR-P2 Phase 0)

Stand 2026-06-11. Grundlage für den Strangler-Split (FR-P2). Zielstatus je Route:

- **keep temporarily** — SSR bleibt, bis FE-Parität erreicht ist.
- **api replacement** — bekommt einen `/api/v1`-Ersatz (JSON); SSR-Route bleibt parallel bis FE-Parität.
- **delete after FE** — entfällt ersatzlos, sobald das FE die Funktion übernimmt (reine Form-POST-Redirect-Flows).
- **stays** — bleibt dauerhaft serverseitig (OAuth-Handshake, Dateien, Feeds, Metrics).

Erstes Strangler-Segment (Phase 2/4): **Operations Overview + Op Detail read-only.**

## routes/web.ts — SSR-Seiten (GET)

| Route | Domain | Zielstatus | /api/v1-Ersatz |
|---|---|---|---|
| `GET /` | ops | api replacement | `GET /api/v1/operations` |
| `GET /ops/:id` | ops | api replacement | `GET /api/v1/operations/:id` |
| `GET /ops/:id/manage` | ops/operator | api replacement (später) | Folge-Phase (Operator-API) |
| `GET /ops/new`, `GET /ops/new/wizard` | ops | keep temporarily | Folge-Phase (POST /api/v1/operations) |
| `GET /ops/:id/calendar.ics` | feeds | stays | — (Datei/Feed) |
| `GET /ops/:id/participants.csv` | feeds | stays | — (Datei/Export) |
| `GET /assets/mission-images/:file` | assets | stays | — (Static) |
| `GET /profile` | account | keep temporarily | Folge-Phase (`GET/PATCH /api/v1/profile`) |
| `GET /ships` | catalog | api replacement | `GET /api/v1/ships/search` |
| `GET /templates` | marketplace | keep temporarily | Folge-Phase |
| `GET /feedback` | misc | keep temporarily | Folge-Phase |
| `GET /login`, `GET /account` | auth | keep temporarily | FE-Login-Page + `GET /api/v1/session` |
| `GET /admin` | admin | keep temporarily | Folge-Phase (Admin-API) |
| `GET /guilds/none` | guilds | keep temporarily | `GET /api/v1/guilds` |
| Static: `/was-ist`, `/what-is`, `/how-to`, `/sc-tools`, `/changelog`, `/roadmap`, `/impressum`, `/privacy`, `/license`, `/why-unsigned` | static | keep temporarily | FE-Static-Pages |

## routes/web.ts — Form-POSTs (Redirect-Flows)

| Route | Zielstatus | /api/v1-Ersatz (Phase 5) |
|---|---|---|
| `POST /ops/new` | delete after FE | `POST /api/v1/operations` |
| `POST /ops/:id/edit` (`/visibility`, `/delete`, `/recurrence/stop`) | delete after FE | `PATCH/DELETE /api/v1/operations/:id` |
| `POST /ops/:id/questions`, `POST /ops/:id/questions/:qid/answer` | delete after FE | `POST /api/v1/operations/:id/questions[...]` |
| `POST /profile/*` (opstyle, locale, ships, fleet-import, ships/:id/delete) | delete after FE | `PATCH /api/v1/profile`, `POST /api/v1/profile/ships` |
| `POST /feedback` | delete after FE | `POST /api/v1/feedback` |
| `POST /admin/*` (maintenance, users, ships/locations sync+config, feedback config, guild ban) | delete after FE | Admin-API Folge-Phase |
| `POST /templates/:id/apply`, `POST /templates/:id/delete`, `POST /ops/:id/publish-template` | delete after FE | Template-API Folge-Phase |

## routes/api.ts — Form-POST "API" (Redirect-Antworten, kein JSON)

Alle `api replacement` in Phase 5 (JSON-Varianten, Services unverändert):

| Bestand | /api/v1-Ersatz |
|---|---|
| `POST /api/seats/:seatId/claim` / `unclaim` | `POST/DELETE /api/v1/operations/:id/seats/:seatId/claim` |
| `POST /api/seats/:seatId/assign` / `unassign` | `POST/DELETE /api/v1/operations/:id/seats/:seatId/assignment` |
| `POST /api/ops/:id/units` (+ `:unitId/edit|accept|reject|delete|seats|carrier|formation`) | `POST/PATCH/DELETE /api/v1/operations/:id/units[...]` |
| `POST /api/ops/:id/cqb*` (signups, bundle, place, squads…) | `POST /api/v1/operations/:id/cqb[...]` |
| `POST /api/ops/:id/crew-requests` (+ remove) | `PUT/DELETE /api/v1/operations/:id/crew-request` |
| `POST /api/ops/:id/hangar-share` | `PUT /api/v1/operations/:id/hangar-share` |
| `POST /api/ops/:id/needs/*` | `POST/PATCH/DELETE /api/v1/operations/:id/needs[...]` |
| `POST /api/ops/:id/resource-links*` | `POST/DELETE/PATCH /api/v1/operations/:id/resource-links` |
| `POST /api/ops/:id/leaders` (+ remove) | `PUT/DELETE /api/v1/operations/:id/leaders` |
| `POST /api/ops/:id/status` | `PATCH /api/v1/operations/:id` |
| `POST /api/ops/:id/seats/assign`, `/primary-unit`, `/formations*`, `/groups/*`, `/requirements/*` | Operator-API Folge-Phase |
| `GET /api/ships` | `GET /api/v1/ships/search` (Phase 2) |

## routes/auth.ts

| Route | Zielstatus |
|---|---|
| `GET /auth/:provider/start`, `GET /auth/:provider/callback`, `/auth/discord/*`, `/auth/logout` | stays (OAuth-Handshake; Redirects erlaubt) |
| `GET /companion/download`, `GET /companion/mission` | stays (M2M/Companion, getrennt von Browser-API) |

## routes/guilds.ts

| Route | Zielstatus | Ersatz |
|---|---|---|
| `GET /guilds`, `/guilds/settings`, `/guilds/diagnostics`, `/guilds/added` | api replacement (später) | `GET /api/v1/guilds` (Phase 2, Liste) + Folge-Phase Settings |
| `POST /guilds/add|remove|switch`, `POST /guilds/members/:userId/role` | delete after FE | Guild-API Folge-Phase |

## routes/bridgeAdmin.ts

Bridge-Admin-UI (komplett): **keep temporarily** — nicht Teil des Fleetplanner-FE-Splits
(eigener Service-Scope laut FR-P2 "Nicht im Scope"). Wird ggf. eigener Admin-FE-Schnitt.

## routes/cover.ts, discordInteractions.ts, partnerships.ts

| Route | Zielstatus |
|---|---|
| Cover (`/cover/*`) | stays (eigener Microservice-Pfad, FR-P4) |
| Discord Interactions Webhook | stays (Discord→Server, kein Browser) |
| Partnerships SSR/POSTs | keep temporarily → Folge-Phase |

## app.ts

| Route | Zielstatus |
|---|---|
| `GET /health`, `GET /metrics` | stays; zusätzlich `GET /api/v1/health` (Phase 2) |

## Phase-2-Scope (dieses Increment)

Neu, additiv, read-only — SSR unangetastet:

- `GET /api/v1/health` (public)
- `GET /api/v1/session` (optional auth)
- `GET /api/v1/operations` (optional auth; Sichtbarkeit wie Home)
- `GET /api/v1/operations/:id` (optional auth + object-level AuthZ)
- `GET /api/v1/guilds` (auth)
- `GET /api/v1/ships/search?q=` (optional auth)
- `GET /api/v1/openapi.json` (public, Doku)
