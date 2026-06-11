# FR-P2 - Microservice API/Frontend Split: Claude Code Opus Implementation Plan

> **FeatureRequest · Priorität 2 · Status: PLAN, kein Code.**
> Umsetzung nur nach expliziter Freigabe. Ziel: Fleetplanner aus dem heutigen Fastify+Prisma+SSR-Monolithen in ein API-only Backend und ein API-only Frontend trennen.

## Dependency-Block

- **Hängt ab von:** bestehendem Fleetplanner-Service (`apps/fleetplanner`), Prisma-Schema, Auth-Session, Services in `apps/fleetplanner/src/services/*`, bestehendem `FR-P3-frontend-split.md`.
- **Blockiert:** neues interaktives Frontend, saubere externe Integrationen, stabile API-Verträge.
- **Nicht im Scope:** Bridge/LiveKit/Relay-Bots neu schneiden; diese bleiben eigene Services. Mission-Cover bleibt eigenständiger Microservice.
- **Risiko:** hoch, weil `routes/web.ts` aktuell Geschäftslogik, Auth, Form-Redirects und SSR eng verbindet.

## Zielarchitektur

```text
Browser
  |
  | HTTPS
  v
Traefik/Caddy
  |-- /fleetplanner/           -> fleetplanner-web      (Frontend, statische Assets)
  |-- /fleetplanner/api/v1/*    -> fleetplanner-api      (Fastify JSON API)
  |-- /fleetplanner/auth/*      -> fleetplanner-api      (OAuth/session endpoints)
  |-- /cover/*                  -> mission-cover         (bestehend)
  |-- /metrics, /health         -> jeweilige Services

fleetplanner-web
  - Vite + React oder Svelte
  - kein direkter DB-Zugriff
  - kein SSR
  - liest/schreibt ausschließlich über /api/v1

fleetplanner-api
  - Fastify + Prisma
  - keine HTML-Renderer, keine web/pages.ts-Abhängigkeit
  - OpenAPI 3.1 aus Zod-Schemas
  - Cookie-Session bleibt same-site unter suite.raumdock.org

fleetplanner-db
  - PostgreSQL, unverändert
```

## Harte Architekturregeln

1. Backend liefert keine HTML-Seiten mehr, nur JSON, Redirects nur für OAuth/Auth-Handshake.
2. Frontend importiert nichts aus `apps/fleetplanner/src/services`, `db`, `auth` oder `web`.
3. Alle API-Request/Response-Modelle liegen in einem gemeinsamen Contract-Paket oder API-Modul mit Zod-Schemas.
4. Jede mutierende API hat AuthZ-Tests und Audit-/CSRF-Entscheidung dokumentiert.
5. API-Dokumentation ist Build-Artefakt und öffentlich lesbar für Entwickler, aber keine Secrets/Interna.
6. Production-E2E testet echte Deploy-Pfade auf `https://suite.raumdock.org/fleetplanner`, nicht localhost.

## API-Sicherheit

Die API-Sicherheit ist ein eigener Akzeptanzblock, nicht nur "kommt mit Auth". Opus muss jeden neuen Endpoint gegen diese Punkte prüfen.

### Authentifizierung

- Browser-Frontend nutzt weiterhin HttpOnly Secure SameSite-Cookies. Keine Session-, OAuth- oder API-Tokens im LocalStorage oder in Query-Strings.
- OAuth-Redirects bleiben auf `auth/*`; JSON-API-Routen geben bei fehlender Session `401` zurück, keine HTML-Loginseite.
- Session-Cookies müssen `HttpOnly`, `Secure`, `SameSite=Lax` oder strenger und klaren `Path=/fleetplanner` haben.
- Companion-/M2M-Endpunkte bleiben getrennt von Browser-API-Endpunkten und nutzen eigene Secrets/Bearer-Validierung.

### Autorisierung

- Jede Route deklariert explizit: public, optional auth, user auth, guild role, op role oder superadmin.
- Guild-Rollen kommen aus `GuildMembership.role`; `User.role` ist nur für globale Superadmins maßgeblich.
- Object-Level-Authorization ist Pflicht: `operationId`, `guildId`, `unitId`, `seatId`, `templateId` werden immer gegen die aktuelle Session geprüft.
- Keine "ID erraten reicht"-Zugriffe: private/guild Ops müssen für fremde User 403/404 liefern, ohne Details zu leaken.

### CSRF und CORS

- Bevorzugt same-origin: `/fleetplanner` und `/fleetplanner/api/v1` liegen auf derselben Origin, damit kein breites CORS nötig ist.
- Mutationen brauchen entweder bewussten CSRF-Schutz oder einen dokumentierten SameSite-basierten Entscheid. Wenn CSRF-Token genutzt werden, liefert `GET /api/v1/session` das Token nur an authentifizierte Browser-Sessions.
- CORS darf nicht `*` mit Credentials erlauben. Falls später externe Clients kommen, nur explizite Origins per Env-Allowlist.

### Input Validation und Output Hygiene

- Alle `params`, `query`, `body` und `response` werden mit Zod/OpenAPI-Schemas validiert.
- IDs werden formatvalidiert, Paginierung und Suchstrings haben harte Limits.
- Datei-/Bild-Uploads bleiben größen- und typbegrenzt; niemals Pfade vom Client übernehmen.
- Responses dürfen keine Secrets, Bot-Tokens, OAuth-Tokens, internen M2M-Secrets, Stacktraces oder Prisma-Fehlerdetails enthalten.

### Rate Limits und Abuse-Schutz

- Login/OAuth-callback-nahe Endpunkte, Suchendpunkte, Mutationen und Uploads bekommen Rate-Limits.
- Rate-Limits werden pro Session und IP geplant; hinter Traefik/Caddy muss `trustProxy` korrekt bleiben.
- Mutationen sollen idempotente Konflikte sauber melden (`409`) statt mehrfach Seiteneffekte auszulösen.

### Fehler, Logging und Audit

- Fehlerformat ist stabil und knapp; interne Details nur im Serverlog.
- Jede sicherheitsrelevante Mutation schreibt Audit-Information: Actor, Guild/Operation, Aktion, Zielobjekt, Ergebnis.
- Logs dürfen keine Session-Cookies, Authorization-Header, OAuth-Codes, Bot-Tokens oder Voice-Bot-Secrets enthalten.
- `requestId` wird in Fehlerantworten und Logs korreliert.

### Security Headers und API Docs

- Frontend setzt CSP, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Frame-Options`/`frame-ancestors`.
- API-Dokumentation darf keine Beispiele mit echten Tokens, Guild-Secrets, User-Cookies oder internen URLs enthalten.
- OpenAPI beschreibt Security-Schemes korrekt: Cookie-Session für Browser-API, Bearer nur für dedizierte M2M-APIs.

### Security Exit-Kriterien

- Negative AuthZ-Tests existieren für jede mutierende Route.
- Ein Test prüft, dass API-Fehler keine Stacktraces/Prisma-Details enthalten.
- Ein Test prüft, dass OpenAPI keine bekannten Secret-Env-Namen oder Beispiel-Tokens enthält.
- Production-E2E enthält read-only Security-Smoke-Checks für 401/403, API-JSON-Content-Type und keine HTML-Leaks auf `/api/v1`.

## Empfohlene Umsetzung für Claude Code Opus

### Claude-Code-Startprompt

```text
Arbeite in RDOC-Suite. Lies zuerst CLAUDE.md und docs/RDOC-SUITE-MERGELOG.md.
Halte die Merge-Log-Regel ein. Ziel: FR-P2 Microservice API/Frontend-Split.

Implementiere inkrementell, nicht Big-Bang:
1. API-Contract + OpenAPI-Grundlage.
2. API-only Backend-Slices für Health, Auth Session, Ops Read Model.
3. Frontend-Skeleton als eigenes Workspace-Package.
4. Eine produktionsreife erste Seite: Operations-Overview + Op-Detail read-only.
5. Danach mutierende Op-Detail-Aktionen als JSON.
6. SSR-Routen erst entfernen, wenn die jeweilige FE-Parität getestet ist.

Jede Phase braucht Tests, Build, Changelog, Mergelog. API-Security aus dem Plan ist ein Pflicht-Gate.
Keine Voice-/Bridge-Änderungen ohne neue Freigabe.
```

## Phasenplan

### Phase 0 - Safety Baseline

- Aktuellen Fleetplanner unverändert baubar machen.
- Route-Inventar erzeugen: `routes/web.ts`, `routes/api.ts`, `routes/auth.ts`, `routes/guilds.ts`, `routes/bridgeAdmin.ts`.
- SSR-Seiten nach Domain gruppieren: public, auth/account, ops, guilds, admin, bridge-admin, companion.
- Entscheiden: erstes Strangler-Segment ist **Operations Overview + Op Detail read-only**, weil es den wichtigsten User-Flow abdeckt.

**Exit-Kriterien**
- `pnpm --filter @rdoc-suite/fleetplanner build`
- `pnpm --filter @rdoc-suite/fleetplanner test`
- Liste aller SSR-Routen mit Zielstatus: `keep temporarily`, `api replacement`, `delete after FE`.

### Phase 1 - API Contracts und Dokumentation

- Neues Contract-Modul anlegen, bevorzugt `apps/fleetplanner/src/api/contracts`.
- Zod-Schemas für Standardfehler, Session, Guild, OperationSummary, OperationDetail, FleetUnit, Seat, ResourceLink.
- OpenAPI-Erzeugung hinzufügen, z.B. `@asteasolutions/zod-to-openapi` oder Fastify Swagger mit Zod-Bridge.
- API-Dokumente:
  - `GET /api/v1/openapi.json`
  - `GET /api/v1/docs` oder statische Swagger UI
  - `docs/api/fleetplanner-v1.md` als menschenlesbare Übersicht

**Exit-Kriterien**
- OpenAPI validiert in Test.
- Jede neue Route hat Schema für `params`, `query`, `body`, `response`.
- Fehlerformat ist einheitlich:

```json
{
  "error": {
    "code": "forbidden",
    "message": "You do not have access to this operation.",
    "requestId": "req-..."
  }
}
```

### Phase 2 - API-only Backend Slice

Neue Routen unter `/api/v1`:

| Route | Zweck | Auth |
|---|---|---|
| `GET /api/v1/health` | API health | public |
| `GET /api/v1/session` | current user, memberships, csrf mode | optional |
| `GET /api/v1/operations` | Operationsliste wie Home | optional |
| `GET /api/v1/operations/:id` | Op-Detail read model | optional/authz |
| `GET /api/v1/guilds` | nutzerbezogene Guilds | auth |
| `GET /api/v1/ships/search?q=` | Schiffssuche | optional/auth |

Wichtig: Services wiederverwenden, aber HTML-spezifische Datenformen aus `web/pages.ts` nicht übernehmen. Falls Datenaufbereitung in `routes/web.ts` steckt, in reine Presenter/Query-Funktionen auslagern.

**Exit-Kriterien**
- API-Tests per Fastify `app.inject`.
- Kein API-Handler importiert aus `../web/*`.
- Bestehende SSR-Tests bleiben grün.

### Phase 3 - Frontend Workspace

- Neues Workspace-Package: `apps/fleetplanner-web`.
- Stack: Vite + React + TypeScript empfohlen, weil Design-Bundles leicht portierbar sind.
- API-Client aus OpenAPI generieren oder minimal typisiert aus Contract-Schemas ableiten.
- Frontend-Routen:
  - `/fleetplanner/`
  - `/fleetplanner/ops/:id`
  - `/fleetplanner/login`
  - Fehlerseiten 401/403/404/503
- Auth bleibt Cookie-basiert auf derselben Origin; kein Token im LocalStorage.

**Exit-Kriterien**
- Frontend kann ohne Backend-Mocks gebaut werden.
- MSW-Mocks erlauben isolierte UI-Tests.
- Dockerfile und Compose-Service existieren, aber Prod-Proxy kann zunächst noch auf SSR zeigen.

### Phase 4 - First Vertical Slice in Production Shadow Mode

- Frontend unter verstecktem Pfad aktivieren, z.B. `/fleetplanner-next`.
- API unter `/fleetplanner/api/v1`.
- Operations Overview und Op Detail read-only gegen echte API.
- Kein alter Flow wird entfernt.

**Exit-Kriterien**
- E2E gegen `/fleetplanner-next` in Prod liest echte Operationen.
- Screenshot-/DOM-Checks bestehen für Desktop und Mobile.
- Kein API-Endpoint gibt HTML zurück.

### Phase 5 - Mutations und SSR-Ablösung

Priorisierte mutierende Endpunkte:

| Endpoint | Ersetzt alten Flow |
|---|---|
| `POST /api/v1/operations/:id/seats/:seatId/claim` | Sitz übernehmen |
| `DELETE /api/v1/operations/:id/seats/:seatId/claim` | Sitz freigeben |
| `POST /api/v1/operations/:id/units` | Einheit anbieten |
| `PATCH /api/v1/operations/:id/units/:unitId` | Einheit bearbeiten |
| `POST /api/v1/operations/:id/cqb/signup` | CQB anmelden |
| `POST /api/v1/operations/:id/hangar-share` | Hangar-Freigabe |
| `POST /api/v1/operations/:id/resource-links` | Operator-Link hinzufügen |

Nach jedem migrierten Flow:
- API-Test
- Frontend component/integration test
- Playwright e2e
- SSR-Route erst dann auf neue FE-Route umleiten oder löschen.

### Phase 6 - Backend wird API-only

- `routes/web.ts`, `web/pages.ts`, `web/render.ts`, `web/missionBoard.ts` entfernen oder archivieren, sobald vollständige Parität erreicht ist.
- `app.ts` registriert nur noch API/Auth/Metrics/Health/Discord callbacks.
- `fleetplanner` Container in `fleetplanner-api` umbenennen.
- `fleetplanner-web` wird Public Entry Point.

**Exit-Kriterien**
- Repo enthält keine HTML-Renderer im API-Service.
- Production-Proxy routet `/fleetplanner` auf Web und `/fleetplanner/api` auf API.
- OpenAPI ist aktuell und Teil der Release-Checks.

## Teststrategie

### Unit Tests

| Bereich | Testcases |
|---|---|
| Contracts | Zod akzeptiert gültige Fixtures, lehnt fehlende Pflichtfelder ab |
| Error Mapper | Prisma/Auth/Validation-Fehler werden zu stabilem API-Fehlerformat |
| Presenters | Operation-DB-Modell wird zu `OperationDetailResponse` ohne HTML-Felder |
| AuthZ Helpers | superadmin, fleetoperator, captain, crew, guest pro Operation |
| API Client | korrekte URL, Credentials include, Fehler werden typisiert |

### Backend Integration Tests

Mit Fastify `app.inject`:

| Test | Erwartung |
|---|---|
| `GET /api/v1/health` | 200 JSON, kein HTML |
| `GET /api/v1/session` anonym | 200 `{ user: null }` |
| `GET /api/v1/operations` anonym | nur public Ops |
| `GET /api/v1/operations` auth | eigene + Partner + public Ops |
| `GET /api/v1/operations/:id` forbidden | 403 stabiles Fehlerformat |
| Mutation ohne Session | 401 |
| Mutation mit falscher Rolle | 403 |
| Mutation mit gültiger Rolle | 200/201, DB-Zustand korrekt |
| Fremde `operationId`/`guildId` in Mutation | 403/404 ohne Datenleck |
| Fehlerfall | JSON-Fehler ohne Stacktrace, Prisma-Code oder Secret |
| CSRF/CORS | keine credentialed wildcard CORS; mutierende Route geschützt/dokumentiert |
| OpenAPI | 200, JSON parsebar, enthält alle v1-Routen |

### Frontend Tests

Mit Vitest + Testing Library + MSW:

| View | Mock | Erwartung |
|---|---|---|
| Overview anonym | public ops fixture | Karten rendern, Login CTA sichtbar |
| Overview auth | member ops fixture | Guild marker, joined/waitlist status |
| Op Detail guest | public op fixture | read-only, join controls gated |
| Op Detail crew | op + seats fixture | claim buttons aktiv |
| Op Detail operator | op + admin fixture | operator controls sichtbar |
| API error 401 | MSW 401 | Login screen/state |
| API error 503 | MSW 503 | Maintenance state |

### Mockups für Tests

Fixtures unter `apps/fleetplanner-web/src/test/fixtures`:

```ts
export const sessionGuest = { user: null, memberships: [] };

export const sessionCrew = {
  user: { id: "user_crew", username: "Crew One", role: "crew", locale: "de" },
  memberships: [{ guildId: "guild_1", guildName: "RDOC", role: "crew" }],
};

export const opDetailFixture = {
  id: "op_1",
  title: "Xenothreat Logistics",
  visibility: "guild",
  scheduledAt: "2026-06-20T18:00:00.000Z",
  guild: { id: "guild_1", name: "RDOC" },
  userRole: "crew",
  units: [
    {
      id: "unit_1",
      name: "Perseus",
      unitType: "ship",
      status: "accepted",
      seats: [
        { id: "seat_1", label: "Pilot", claimedBy: null },
        { id: "seat_2", label: "Gunner", claimedBy: { id: "user_2", username: "Mira" } }
      ]
    }
  ],
  resourceLinks: [
    { id: "link_1", label: "Briefing", url: "https://example.com/briefing", kind: "link" }
  ]
};
```

MSW handler example:

```ts
import { http, HttpResponse } from "msw";
import { opDetailFixture, sessionCrew } from "./fixtures";

export const handlers = [
  http.get("/fleetplanner/api/v1/session", () => HttpResponse.json(sessionCrew)),
  http.get("/fleetplanner/api/v1/operations/op_1", () => HttpResponse.json(opDetailFixture)),
  http.post("/fleetplanner/api/v1/operations/op_1/seats/seat_1/claim", () =>
    HttpResponse.json({ ok: true, seatId: "seat_1" }),
  ),
];
```

### Contract Tests

- Generate OpenAPI in CI.
- Fail build when generated `openapi.json` differs from committed artifact.
- Validate representative request/response fixtures against OpenAPI.
- Optional: Schemathesis/Dredd later for fuzzing.

## Production E2E Plan

Production E2E runs must be read-only by default. Mutating tests require a dedicated test guild/op and explicit env flag.

### Environment

Required variables:

```bash
E2E_BASE_URL=https://suite.raumdock.org/fleetplanner
E2E_API_BASE_URL=https://suite.raumdock.org/fleetplanner/api/v1
E2E_TEST_USER_STORAGE_STATE=.auth/rdoc-prod-user.json
E2E_TEST_ADMIN_STORAGE_STATE=.auth/rdoc-prod-admin.json
E2E_TEST_OPERATION_ID=<dedicated-test-op-id>
E2E_ALLOW_PROD_MUTATIONS=0
```

### Read-only Production Tests

| Test | Steps | Pass |
|---|---|---|
| Health | GET `/api/v1/health` | 200 JSON |
| OpenAPI | GET `/api/v1/openapi.json` | valid OpenAPI, no secrets |
| Frontend boot | open `/` | no console errors, API calls use `/api/v1` |
| Login state | use storage state, open `/` | username visible via API session |
| Op detail | open `/ops/:id` | title, date, units render |
| Mobile | 390x844 screenshot | no overlapping controls |
| Unauthorized | clear cookies, private op | 401/403 UI, no stack traces |
| API content type | call `/api/v1/*` directly | JSON response, never HTML login page |
| API docs hygiene | scan OpenAPI | no secret env names, no token examples |

### Mutating Production Tests

Only when `E2E_ALLOW_PROD_MUTATIONS=1` and `E2E_TEST_OPERATION_ID` points to a disposable test operation:

| Test | Cleanup |
|---|---|
| claim free test seat | unclaim same seat |
| add resource link as operator | delete created link |
| toggle hangar share | reset to previous value |
| create draft op from template | delete draft op |

Guardrails:
- Test data names start with `E2E-`.
- Every mutation stores created IDs and cleans up in `afterEach`.
- If cleanup fails, test prints exact API call for manual cleanup.
- Never run mutating prod tests against real mission ops.

## CI Gates

1. `pnpm --filter @rdoc-suite/fleetplanner build`
2. `pnpm --filter @rdoc-suite/fleetplanner test`
3. `pnpm --filter @rdoc-suite/fleetplanner-web build`
4. `pnpm --filter @rdoc-suite/fleetplanner-web test`
5. OpenAPI generation and diff check
6. Playwright against local compose
7. Optional manual approval before Production E2E

## API Documentation Standard

Each endpoint must document:

- method and path
- auth mode
- role requirements
- request schema
- response schema
- error codes
- side effects
- audit events
- idempotency behavior
- example request/response

Example:

```md
### POST /api/v1/operations/{operationId}/seats/{seatId}/claim

Claims a free seat for the current user.

Auth: required cookie session
Roles: crew or higher with access to operation
Side effects: creates/updates SeatAssignment, writes audit entry

Responses:
- 200 ClaimSeatResponse
- 401 unauthenticated
- 403 forbidden
- 409 seat_already_claimed
```

## Definition of Done

- Frontend and backend are separate workspace packages and separate Docker images.
- Backend is API-only for migrated surface and has a documented removal path for remaining SSR.
- Frontend has no server/service/db imports and communicates only through `/api/v1`.
- OpenAPI docs are generated, tested, and served.
- Local unit/integration/e2e tests pass.
- Production read-only E2E passes.
- Mutating Production E2E exists but is guarded and cleanup-safe.
- `CHANGELOG.md`, `docs/RDOC-SUITE-MERGELOG.md`, and `docs/ROADMAP.md` are updated.
