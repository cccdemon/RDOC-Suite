# Fleetplanner — Routen-Inventar

Stand 2026-08-22, direkt aus `apps/fleetplanner/src/routes/` gezogen. Es gibt nur noch **einen**
API-Layer: der aeltere Form-POST-Layer `routes/api.ts` (45 Redirect-Routen ohne Aufrufer) wurde am
2026-08-22 geloescht. Der Vertrag (Fehler-Envelope,
Auth, CSRF, Rate-Limits) steht in [fleetplanner-v1.md](fleetplanner-v1.md); die maschinenlesbare
Fassung von `/api/v1` ist `GET /api/v1/openapi.json`.

Wer bedient was:

| Datei | Routen | Rolle |
|---|---|---|
| `routes/apiV1.ts` | 126 | **Der API-Layer.** JSON, sanitisierter Fehler-Envelope (`sendError`). Alles Neue kommt hierher. |
| `routes/web.ts` | 11 | Die einzige HTML-Ausgabe: Crawler-Dokumente, Feeds, Asset-Proxy. |
| `routes/auth.ts` | 7 | OAuth-Handshake (Discord, GitHub, Google) + Discord-Verknüpfung + Logout. |
| `routes/e2eAuth.ts` | 3 | Test-Seam — **existiert nur mit gesetztem `E2E_TEST_LOGIN_SECRET`**. |
| `routes/guilds.ts` | 2 | Bot-Installation (Redirect zu Discord) und Rücksprung. |
| `routes/discordInteractions.ts` | 1 | Discord→Server, Ed25519-geprüft. |
| `routes/cover.ts` | 1 | Rücksprung des Cover-Editors (Token → Upsert → Redirect in die SPA). |

Dazu registriert `app.ts` direkt `GET /health` und `GET /metrics` (Prometheus; Caddy blockt den Pfad
nach außen mit 404).

---

## /api/v1 — `routes/apiV1.ts`

### /api/v1/health
- `GET /api/v1/health`
### /api/v1/openapi.json
- `GET /api/v1/openapi.json`
### /api/v1/session
- `GET /api/v1/session`
### /api/v1/content
- `GET /api/v1/content/:slug`
### /api/v1/roadmap
- `GET /api/v1/roadmap`
### /api/v1/public
- `GET /api/v1/public/orgs`
### /api/v1/account
- `GET /api/v1/account`
### /api/v1/profile
- `PATCH /api/v1/profile`
### /api/v1/changelog
- `POST /api/v1/changelog/ack`
- `GET /api/v1/changelog/unseen`
### /api/v1/hangar
- `GET /api/v1/hangar`
- `POST /api/v1/hangar`
- `DELETE /api/v1/hangar/:shipId`
- `POST /api/v1/hangar/import`
- `POST /api/v1/hangar/import/fleetyards`
### /api/v1/operations
- `GET /api/v1/operations`
- `POST /api/v1/operations`
- `DELETE /api/v1/operations/:id`
- `GET /api/v1/operations/:id`
- `PATCH /api/v1/operations/:id`
- `POST /api/v1/operations/:id/announce`
- `DELETE /api/v1/operations/:id/cover`
- `GET /api/v1/operations/:id/cover`
- `POST /api/v1/operations/:id/cover/edit-link`
- `POST /api/v1/operations/:id/cover/generate`
- `PATCH /api/v1/operations/:id/cqb-teams/:groupId`
- `DELETE /api/v1/operations/:id/cqb-teams/:groupId`
- `PUT /api/v1/operations/:id/cqb-teams/:groupId/carrier`
- `POST /api/v1/operations/:id/cqb-teams/:groupId/members`
- `DELETE /api/v1/operations/:id/cqb/:signupId`
- `POST /api/v1/operations/:id/cqb/:signupId/assign`
- `PATCH /api/v1/operations/:id/cqb/:signupId/late-arrival`
- `DELETE /api/v1/operations/:id/cqb/signup`
- `POST /api/v1/operations/:id/cqb/signup`
- `POST /api/v1/operations/:id/cqb/auto-bundle`
- `POST /api/v1/operations/:id/documents`
- `DELETE /api/v1/operations/:id/documents/:docId`
- `GET /api/v1/operations/:id/documents/:docId`
- `POST /api/v1/operations/:id/fighter-squads/auto-fill`
- `POST /api/v1/operations/:id/formations`
- `DELETE /api/v1/operations/:id/formations/:fid`
- `PATCH /api/v1/operations/:id/formations/:fid`
- `PUT /api/v1/operations/:id/groups/:gid/parent`
- `PUT /api/v1/operations/:id/hangar-share`
- `POST /api/v1/operations/:id/leaders`
- `DELETE /api/v1/operations/:id/leaders/:userId`
- `PUT /api/v1/operations/:id/member-slot`
- `PUT /api/v1/operations/:id/primary-unit`
- `DELETE /api/v1/operations/:id/primary-unit`
- `GET /api/v1/operations/:id/needs`
- `DELETE /api/v1/operations/:id/needs/:reqId`
- `PATCH /api/v1/operations/:id/needs/:reqId`
- `PUT /api/v1/operations/:id/needs/cqb`
- `PUT /api/v1/operations/:id/needs/fighters`
- `POST /api/v1/operations/:id/needs/ships`
- `GET /api/v1/operations/:id/operator`
- `POST /api/v1/operations/:id/publish-template`
- `POST /api/v1/operations/:id/questions`
- `POST /api/v1/operations/:id/questions/:qid/answer`
- `POST /api/v1/operations/:id/recurrence`
- `POST /api/v1/operations/:id/recurrence/stop`
- `POST /api/v1/operations/:id/resource-links`
- `PUT /api/v1/operations/:id/resource-links/order`
- `DELETE /api/v1/operations/:id/resource-links/:linkId`
- `PATCH /api/v1/operations/:id/seats/:seatId`
- `DELETE /api/v1/operations/:id/seats/:seatId/assignment`
- `PUT /api/v1/operations/:id/seats/:seatId/assignment`
- `DELETE /api/v1/operations/:id/seats/:seatId/claim`
- `POST /api/v1/operations/:id/seats/:seatId/claim`
- `PATCH /api/v1/operations/:id/seats/:seatId/late-arrival`
- `GET /api/v1/operations/:id/squadlink`
- `POST /api/v1/operations/:id/status`
- `POST /api/v1/operations/:id/streams`
- `DELETE /api/v1/operations/:id/streams/:streamId`
- `POST /api/v1/operations/:id/units`
- `DELETE /api/v1/operations/:id/units/:unitId`
- `PATCH /api/v1/operations/:id/units/:unitId`
- `POST /api/v1/operations/:id/units/:unitId/accept`
- `PUT /api/v1/operations/:id/units/:unitId/carrier`
- `PUT /api/v1/operations/:id/units/:unitId/formation`
- `PATCH /api/v1/operations/:id/units/:unitId/late-arrival`
- `POST /api/v1/operations/:id/units/:unitId/reject`
- `GET /api/v1/operations/:id/voice/recipients`
- `PUT /api/v1/operations/:id/voice/recipients`
### /api/v1/templates
- `GET /api/v1/templates`
- `POST /api/v1/templates/:id/apply`
### /api/v1/polls
- `GET /api/v1/polls`
- `POST /api/v1/polls`
- `DELETE /api/v1/polls/:id`
- `GET /api/v1/polls/:id`
- `PATCH /api/v1/polls/:id`
- `POST /api/v1/polls/:id/options`
- `DELETE /api/v1/polls/:id/vote`
- `POST /api/v1/polls/:id/vote`
### /api/v1/guilds
- `GET /api/v1/guilds`
- `GET /api/v1/guilds/:id/channels`
- `GET /api/v1/guilds/:id/diagnostics`
- `GET /api/v1/guilds/:id/fleet`
- `PUT /api/v1/guilds/:id/members/:userId/role`
- `GET /api/v1/guilds/:id/partnerships`
- `PUT /api/v1/guilds/:id/partnerships/:partnerGuildId/auto-share`
- `POST /api/v1/guilds/:id/partnerships/:partnershipId/revoke`
- `POST /api/v1/guilds/:id/partnerships/accept`
- `POST /api/v1/guilds/:id/partnerships/events/:eventId/approve`
- `POST /api/v1/guilds/:id/partnerships/events/:eventId/decline`
- `POST /api/v1/guilds/:id/partnerships/invite`
- `GET /api/v1/guilds/:id/settings`
- `PATCH /api/v1/guilds/:id/settings`
### /api/v1/admin
- `GET /api/v1/admin/guilds`
- `POST /api/v1/admin/guilds/:id/ban`
- `POST /api/v1/admin/guilds/:id/unban`
- `PUT /api/v1/admin/locations/config`
- `POST /api/v1/admin/locations/sync`
- `POST /api/v1/admin/maintenance`
- `GET /api/v1/admin/settings`
- `PUT /api/v1/admin/settings/feedback`
- `PUT /api/v1/admin/ships/config`
- `POST /api/v1/admin/ships/sync`
- `GET /api/v1/admin/system/events`
- `GET /api/v1/admin/system/health`
- `GET /api/v1/admin/users`
- `POST /api/v1/admin/users/:id/active`
- `PUT /api/v1/admin/users/:id/role`
### /api/v1/ships
- `GET /api/v1/ships/search`
### /api/v1/locations
- `GET /api/v1/locations/search`
### /api/v1/feedback
- `POST /api/v1/feedback`

---

## SSR / HTML — `routes/web.ts`

nginx entscheidet per User-Agent: Crawler bekommen dieses HTML, Menschen die SPA.

- `GET /assets/mission-images/:file`
- `GET /assets/ship-images/:id`
- `GET /ops/:id`
- `GET /polls/:id`
- `GET /`
- `GET /handbuch/:section`
- `GET /handbuch`
- `GET /rechtliches/:section`
- `GET /rechtliches`
- `GET /ops/:id/calendar.ics`
- `GET /ops/:id/participants.csv`

## Auth — `routes/auth.ts`

- `GET /auth/:provider/start`
- `GET /auth/:provider/callback`
- `GET /auth/discord/link/start`
- `GET /auth/discord/link/callback`
- `GET /auth/start`
- `GET /auth/callback`
- `POST /auth/logout`

## Discord, Cover, Guild-Installation

- `POST /discord/interactions`
- `GET /ops/:id/cover/saved`
- `GET /guilds/add`
- `GET /guilds/added`

## Test-Seam — `routes/e2eAuth.ts`

Nur registriert, wenn `E2E_TEST_LOGIN_SECRET` gesetzt ist (in Produktion zusätzlich nur mit
`E2E_ALLOW_IN_PROD`). Ohne Secret antworten die Pfade mit 404, weil es sie nicht gibt.

- `POST /e2e/login`
- `POST /e2e/seed-ships`
- `POST /e2e/cleanup`
