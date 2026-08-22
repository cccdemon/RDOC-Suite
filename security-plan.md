# Security Plan

Stand 2026-08-22. Scope: die RDOC-Suite, wie sie heute läuft — `apps/fleetplanner` (Fastify +
Prisma + PostgreSQL), `apps/fleetplanner-web` (React-SPA hinter nginx), `apps/mission-cover`
(Headless-Chromium-Renderer), Caddy als TLS-Terminierung, der eine Discord-Bot (REST-only) und der
Docker-Compose-Deploy in LXC 103.

> Die frühere Fassung dieses Dokuments beschrieb den Voice-Stack: Bridge-Server, LiveKit-Tokens,
> Discord-Relay-Bots und die Tauri-Companion-App. Nichts davon existiert noch (Voice entfernt
> 2026-06, Companion 2026-08-07). Die alten Befunde sind damit gegenstandslos, nicht offen.
> Die abgearbeiteten Reviews liegen in [`docs/archiv/`](docs/archiv/).

## Was geschützt werden muss

| Wert | Wo er liegt | Schaden bei Verlust |
|---|---|---|
| Discord-Bot-Token | `.env` auf dem Host, nur im Container | Fremder handelt als der Bot in jedem installierten Server |
| OAuth-Client-Secret | `.env` | Login-Flow fälschbar |
| `SESSION_SECRET` | `.env` | Sitzungen fälschbar |
| Sitzungen | `UserSession` (nur SHA-256 des Cookie-Tokens) | Kontoübernahme |
| Spielerdaten | PostgreSQL (`fleetplanner-db`) | Namen, Discord-IDs, Hangar-Inhalte, Teilnahmen |
| `MISSIONCOVER_SERVICE_SECRET` | `.env`, geteilt mit dem Renderer | Fremde Render-Aufträge, SSRF-Fläche |
| `SQUADLINK_ROOM_AUTH_SECRET` | `.env` | Fremde betreten Voice-Räume |

## Aktuelle Lage

Umgesetzt und im Code nachprüfbar:

- **Eine Header-Schicht.** `apps/fleetplanner-web/nginx.conf` setzt CSP, `X-Content-Type-Options`,
  `X-Frame-Options: DENY` und `Referrer-Policy`. Das Backend setzt bewusst keine — zwei Schichten
  hatten sich widersprochen. Jede `location`, die eigene `add_header` braucht, wiederholt den
  ganzen Block, weil `add_header` in nginx nicht additiv erbt. Der Smoke-Test prüft, dass genau
  **ein** CSP-Header ankommt.
- **Sitzungen als Hash.** `UserSession.tokenHash` = SHA-256 des Cookie-Tokens; das Token selbst
  steht nirgends in der DB. Cookie: `httpOnly`, `sameSite=lax`, `secure` in Produktion.
- **CSRF.** Jede Mutation verlangt den `x-csrf-token`-Header, der aus `GET /api/v1/session` kommt;
  ohne Session 401, falscher Token 403.
- **Validierung an der Grenze.** Jeder externe Input geht durch ein Zod-Schema aus
  `packages/fleetplanner-contracts`. Seit dem Wegfall des Form-POST-Layers (2026-08-22) gibt es
  genau **eine** schreibende Oberflaeche — `/api/v1`, JSON-only; der `@fastify/formbody`-Parser
  fuer `application/x-www-form-urlencoded` ist mit ihm entfallen.
- **Objektbezogene Autorisierung.** Private Operationen antworten Fremden mit 404 statt mit einem
  Hinweis auf ihre Existenz. Serverrollen werden **serverseitig** geprüft; die Gates in `nav.ts`
  sind reine Oberflächenführung.
- **Rate-Limits.** In-Memory-Sliding-Window: Mutationen 20/min, Suche 60/min pro Session/IP,
  Überschreitung ⇒ `429` mit `retry-after`.
- **`trustProxy` als Allowlist.** Default sind Loopback + RFC1918, nicht `true` — sonst könnte
  jeder Client, der den Port erreicht, seine IP über `X-Forwarded-For` fälschen und die
  Rate-Limits aushebeln.
- **Discord-Interactions signaturgeprüft.** Ed25519 gegen `DISCORD_FLEETPLANNER_PUBLIC_KEY`, vor
  jeder Verarbeitung. Eine gefälschte Signatur wird im E2E-Test explizit abgewiesen.
- **Fehler-Envelope ohne Interna.** Keine Stacktraces, keine Prisma-Details nach außen;
  Korrelation über `requestId`.
- **Keine öffentlichen Nebenpfade.** Caddy beantwortet `/metrics` und `/fleetplanner/metrics` mit
  404; Prometheus scrapt über das Docker-Netz. `/cover/v1*` (die M2M-Render-API) ist ebenfalls
  404 nach außen. Nach außen offen ist nur 443.
- **Container ohne Root.** `fleetplanner` läuft als `node`, `mission-cover` als `pwuser`;
  Basis-Images sind versioniert (`node:20-alpine`, `nginx:1.27-alpine`,
  `playwright:v1.55.1-noble`), Installationen laufen mit `--frozen-lockfile`.
- **Der Test-Seam ist doppelt verriegelt.** `/e2e/*` existiert nur mit gesetztem
  `E2E_TEST_LOGIN_SECRET`; in `NODE_ENV=production` zusätzlich nur mit explizitem
  `E2E_ALLOW_IN_PROD`, optional zeitlich begrenzt über `E2E_TEST_LOGIN_EXPIRES`.

## Offene Punkte

### 1. Bot-Invite fordert vier Rechte an, die niemand benutzt

`BOT_PERMISSIONS` in [`routes/guilds.ts`](apps/fleetplanner/src/routes/guilds.ts) verlangt neun
Bits, benutzt werden fünf. `MANAGE_CHANNELS`, `CONNECT`, `MOVE_MEMBERS` und `MANAGE_ROLES` sind
Reste der Voice-Ära — der Bot vergibt keine Rollen, er *liest* nur `admiralRoleId`.

**Warum es offen ist:** Least Privilege spricht klar dafür, sie zu streichen; das ändert aber die
Installations-URL. Bewusste Entscheidung, kein Nebenbei-Fix.

### 2. `PUBLIC_BASE_PATH` wird nicht validiert

`z.string().default("")` nimmt jeden Wert. Ein Tippfehler fällt erst an einem kaputten
OAuth-Redirect oder Discord-Link auf. Ein `refine` auf „leer oder mit führendem `/`" wäre billig.

### 3. Rate-Limits sind prozesslokal

Ein In-Memory-Zähler pro Container. Solange genau eine Instanz läuft, ist das korrekt — bei
horizontaler Skalierung zählt jede Instanz für sich. Gleiches gilt für die Hintergrundläufe
(Ship-Sync, Reminder, Interest-Sync): mehrere Instanzen würden doppelt arbeiten.

### 4. Keine automatisierte Dependency-Prüfung in CI

`pnpm audit` und ein Container-Scan laufen heute nur von Hand. Ein regelmäßiger Lauf würde neue
CVEs finden, bevor sie jemand meldet.

### 5. Abhängigkeiten zu Dritten sind unverschlüsselte Vertrauensanker

`DISCORD_API_BASE`, `DISCORD_AUTHORIZE_BASE` und `DISCORD_SITE_BASE` sind konfigurierbar, damit die
Testsuite den Simulator ansprechen kann. Ein umgeleiteter Wert in Produktion würde Bot-Token und
OAuth-Codes an einen fremden Host schicken. Abgesichert ist das über `assertDiscordEndpoints`, das
jede Abweichung beim Boot laut protokolliert — eine Prüfung, kein Verbot.

## Manuelle Kontrolle vor dem Deploy

- [ ] `curl -sI https://suite.raumdock.org/fleetplanner/` → genau ein CSP-Header, dazu nosniff,
      `X-Frame-Options: DENY`, Referrer-Policy
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://suite.raumdock.org/metrics` → 404
- [ ] `curl -s -o /dev/null -w '%{http_code}' https://suite.raumdock.org/cover/v1/render` → 404
- [ ] `POST /e2e/login` → 404 (Seam aus)
- [ ] `/api/v1/guilds`, `/api/v1/account`, `/api/v1/hangar` ohne Session → 401/403
- [ ] Mutation ohne `x-csrf-token` → 403
- [ ] Private Operation als Fremder → 404 ohne Detail
- [ ] `.env` gehört root, Modus 600, und liegt nicht im Git-Status
- [ ] `docker compose -f docker-compose.prod.yml config` zeigt keine Secrets im Klartext-Log

Der Lese-Smoke `scripts/prod-e2e-readonly.sh` deckt davon die Auth-Gates, den Fehler-Envelope und
die beiden `/metrics`-Sperren automatisch ab und ist jederzeit gefahrlos. Header, Cover-API und
Seam-Prüfung bleiben Handarbeit.
