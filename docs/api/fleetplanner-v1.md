# Fleetplanner API v1 (FR-P2 Phase 2 — Read Slice)

Stand 2026-06-11. Maschinenlesbarer Vertrag: `GET /api/v1/openapi.json` (generiert aus den
Zod-Contracts in `apps/fleetplanner/src/api/contracts/`). Diese Datei ist die menschenlesbare
Übersicht. Pfade sind relativ zur Suite-Base `https://suite.raumdock.org/fleetplanner`.

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

## Sicherheits-Gates (umgesetzt)

- 401/403/404 als JSON-Envelope, nie Redirect/HTML (Test: `apiV1.inject.test.ts`).
- ID-Format-Validation gegen Pfad-/Injection-Input (Test: contracts + inject).
- Fail-closed: DB nicht erreichbar ⇒ `500`-Envelope ohne Prisma-/Stack-Details (Test).
- OpenAPI-Hygiene: keine Secret-Env-Namen, Token-Beispiele, internen IPs (Test: `openapi.test.ts`).
- Presenter geben keine Secrets/HTML-Felder aus (Test: `presenters.test.ts`).

## Noch nicht in v1 (Folge-Phasen laut FR-P2)

- Mutationen (claim/units/cqb/hangar-share/resource-links) — Phase 5.
- Operator-/Admin-Read-Models (auditLogs, questions, hangarShares, crewRequests) — role-gated.
- Rate-Limits (kommen mit den ersten Mutationen).
- Frontend-Workspace `apps/fleetplanner-web` — Phase 3.

Routen-Inventar + Zielstatus je SSR-Route: [`fleetplanner-route-inventory.md`](fleetplanner-route-inventory.md).
