# Fleetplanner API v1

Stand 2026-06-11 (FR-P2 Phase 2 Read-Slice + Phase 5 Mutations-Slices 1–2). Maschinenlesbarer
Vertrag: `GET /api/v1/openapi.json` (generiert aus den Zod-Contracts in
`apps/fleetplanner/src/api/contracts/`). **Interaktive Doku: `GET /api/v1/docs`** (Swagger UI,
public). Diese Datei ist die menschenlesbare Übersicht. Pfade sind relativ zur Suite-Base
`https://suite.raumdock.org/fleetplanner`.

## Quickstart für externe Clients

1. **Anonym lesen:** `GET /api/v1/operations` liefert public Ops ohne Auth.
2. **Authentifiziert:** Session-Cookie (`fp_sid`) kommt aus dem Discord-OAuth-Login der
   Web-App (`/auth/discord/start`). Es gibt KEINE Token-Auth für die Browser-API; Requests
   laufen same-origin mit `credentials: same-origin`.
3. **Mutationen:** erst `GET /api/v1/session` aufrufen → `csrfToken` → bei jeder Mutation als
   Header `x-csrf-token` mitsenden. Ohne Session ⇒ `401`, falscher Token ⇒ `403`.
4. Fehler kommen IMMER als Envelope (s.u.), nie als HTML/Redirect.

## Grundsätze

- **JSON only.** Kein Endpoint liefert HTML oder redirectet auf eine Loginseite. Fehlende
  Session ⇒ `401` mit Fehler-Envelope.
- **Auth:** same-origin HttpOnly-Session-Cookie (`fp_sid`) aus dem OAuth-Login. Keine Tokens
  in LocalStorage/Query.
- **Fehlerformat (stabil):**

```json
{ "error": { "code": "forbidden", "message": "…", "requestId": "req-…" } }
```

`code` ∈ `bad_request | unauthenticated | forbidden | not_found | conflict | rate_limited | internal`.
Interna (Stacktraces, Prisma-Details) bleiben im Serverlog; Korrelation über `requestId`.

- **Object-Level AuthZ:** private/guild Ops liefern für fremde/anonyme Caller `401`/`404`
  ohne Detail-Leak (gleiches Verhalten wie die SSR-Seite).

## Endpoints

### GET /api/v1/health
Auth: public. Liveness der API.
`200 → { status:"ok", service:"fleetplanner-api", version, time }`

### GET /api/v1/openapi.json
Auth: public. OpenAPI-3.1-Dokument (Build-Artefakt, ohne Secrets/Beispiel-Tokens).

### GET /api/v1/session
Auth: optional. Aktuelle Session.
- Anonym: `{ user: null, memberships: [], csrfToken: null }`
- Authentifiziert: `user {id, username, role, locale}`, `memberships [{guildId, guildName, role}]`,
  `csrfToken` (nur an authentifizierte Browser-Sessions — Basis für spätere Mutations-Endpunkte).

### GET /api/v1/operations?past=bool
Auth: optional. Operationsliste, gleiche Sichtbarkeitsregeln wie die SSR-Home:
- Anonym: nur `visibility=public`.
- Authentifiziert: eigene Guild-Ops + Partner-Ops (partners/public) + alle public Ops,
  dedupliziert, nach `scheduledAt` sortiert; je Op `signupState` (`joined` Sitz/CQB gewinnt
  über `waitlist` Crew-Request/pending Ship-Offer, sonst `null`).
`200 → { operations: OperationSummary[] }`

### GET /api/v1/operations/:id
Auth: optional + object-level AuthZ. Read-Model der Op-Detailseite.
- Anonym nur bei `public`, sonst `401`.
- Authentifiziert ohne `effectiveOpRole` ⇒ `404` (kein Leak).
- `id` formatvalidiert (cuid-artig) ⇒ sonst `400`.
`200 → OperationDetail` (Summary + description, guild{timezone}, leaders, units→seats mit
`claimedBy`, resourceLinks, `viewerRole`, `canManage`). Keine auditLogs/questions/hangarShares —
Operator-Daten kommen später als eigene, role-gated Endpoints.

### GET /api/v1/guilds
Auth: required (`401` sonst). Guild-Mitgliedschaften des Users.
`200 → { guilds: [{ id, name, iconHash, timezone, role }] }`

### GET /api/v1/ships/search?q=&limit=
Auth: optional. Schiffskatalog. `q` max 80 Zeichen, `limit` 1–100 (default 20) ⇒ sonst `400`.
`200 → { ships: [{ id, slug, name, manufacturer, size, role, minCrew, maxCrew }] }`

## Mutationen (Session-Cookie + `x-csrf-token`-Header Pflicht)

Alle Mutationen: `401` ohne Session, `403` bei falschem CSRF-Token oder fehlender Rolle,
`404` bei fremden/unbekannten IDs (object-level, ohne Leak), Konflikte `409`. Jede Mutation
schreibt einen Audit-Eintrag.

### POST /api/v1/operations/:id/seats/:seatId/claim
Freien Platz übernehmen. Seat muss zur Operation gehören; Tenant-Gate via effectiveOpRole.
`200 → { ok: true, seatId }` · `409` Seat belegt / bereits Platz in der Kategorie.

### DELETE /api/v1/operations/:id/seats/:seatId/claim
Eigenen Platz freigeben (Operator darf fremde freigeben). Captain-Seat nur via Unit-Delete.
`200 → { ok: true }`

### POST /api/v1/operations/:id/cqb/signup
Flexible Personal-Anmeldung (`{ note? ≤280 }`). Nur bei Op-Status open/draft (`409` sonst).
`DELETE` zieht die eigene Anmeldung zurück. `200 → { ok: true }`

### PUT /api/v1/operations/:id/hangar-share
`{ allow: boolean, note? ≤280 }` — Operator-Sichtbarkeit des eigenen Hangars für diese Op.
`200 → { ok: true }`

### POST /api/v1/operations/:id/units
Eigenes Schiff/Squad/Fahrzeug anbieten. Body: `{ unitType: ship|squad|vehicle, shipId? |
ownedShipId?, storeOwnedShip?, squadName?, squadSize? (2–8), requirementId?, captainNote?,
carrierUnitId? }`. Volle SSR-Validierungskette (Schiff Pflicht bei ship/vehicle, Carrier
Pflicht bei vehicle, Squad-Name unique, requirement-fit). Nur open/draft.
`200 → { ok: true, unitId }`

### PATCH /api/v1/operations/:id/units/:unitId
Teilmenge: `{ captainNote? | squadName? }` (Captain, Op-Leader oder Fleetoperator).
Ship-Tausch/Seat-Rebuild bewusst NICHT hier — bleibt im SSR-Flow bis FE-Parität.
`DELETE` zieht die Unit zurück (Captain oder Fleetoperator). `200 → { ok: true }`

### POST /api/v1/operations/:id/resource-links
Operator-only (`403` sonst). `{ url, title? ≤120, kind? }` — URL wird normalisiert,
Limit erzwungen (`409` bei ungültiger URL/Limit). `200 → { ok: true, link }`
`DELETE /api/v1/operations/:id/resource-links/:linkId → { ok: true }`

## Sicherheits-Gates (umgesetzt)

- 401/403/404 als JSON-Envelope, nie Redirect/HTML (Test: `apiV1.inject.test.ts`).
- ID-Format-Validation gegen Pfad-/Injection-Input (Test: contracts + inject).
- Fail-closed: DB nicht erreichbar ⇒ `500`-Envelope ohne Prisma-/Stack-Details (Test).
- OpenAPI-Hygiene: keine Secret-Env-Namen, Token-Beispiele, internen IPs (Test: `openapi.test.ts`).
- Presenter geben keine Secrets/HTML-Felder aus (Test: `presenters.test.ts`).

## Operator-API (canManage: Fleetoperator oder Op-Leader; sonst 403)

### GET /api/v1/operations/:id/operator
Operator-Read-Model: `crewRequests` (flexible Anmeldungen), `questions` (inkl. offene),
`hangarShares` (NUR hier sichtbar — Spieler-Freigaben mit Schiffsliste), `auditLogs` (50).

### POST /api/v1/operations/:id/units/:unitId/accept | /reject
Body `{ note?, requirementId? }`. Accept kann direkt in einen Bedarfs-Slot einsortieren
(voller/unpassender Slot wird übersprungen — Unit bleibt angenommen, unslotted). Reject
gibt alle Sitze der Unit (inkl. getragener Fahrzeuge) frei.

### PUT /api/v1/operations/:id/seats/:seatId/assignment
Body `{ userId }` — Spieler auf offenen Platz setzen; löscht dessen flexible Anmeldung,
DM-Benachrichtigung best-effort. `DELETE` gibt den Platz frei (Captain-Seat ⇒ 409).

### POST /api/v1/operations/:id/questions/:qid/answer
Body `{ answer ≤1000 }` — beantwortet eine Spielerfrage.

## Noch nicht in v1 (Folge-Phasen laut FR-P2)

- Unit-Edit voll (Ship-Tausch, Seat-Rebuild, Carrier-Wechsel) — bleibt SSR bis FE-Parität.
- Operator-/Admin-Read-Models (auditLogs, questions, hangarShares, crewRequests) — role-gated.
- Operator-Workflows (accept/reject units, seats/assign, needs, leaders, status) — SSR.
- ~~Rate-Limits~~ → umgesetzt: Mutationen 20/min, `/ships/search` 60/min pro Session/IP;
  Überschreitung ⇒ `429` Envelope (`rate_limited`) + `retry-after`-Header.
- Mutating Prod-E2E (geguarded via E2E_ALLOW_PROD_MUTATIONS) — noch nicht gebaut.

Routen-Inventar + Zielstatus je SSR-Route: [`fleetplanner-route-inventory.md`](fleetplanner-route-inventory.md).
