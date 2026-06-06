# FR-P4 — Mission-Cover-Microservice (server-render API für den Fleetplanner)

> **FeatureRequest** · **Prio 4**
> **Status:** Steps 1–5 implementiert (2026-06-06) — Service + Render-API + Store + Fleetplanner-Seite
> (`/ops/:id/cover`) + Generate/Delete + Editor-Round-Trip. Offen: Discord-Event-`image` /
> Cross-Post-Synergie (Step 6), optionale Wizard-Integration, Font-Bundling fürs Image.
> **Scope:** neuer Microservice `apps/mission-cover` (`@rdoc-suite/mission-cover`,
> Container `rdoc-suite-mission-cover`) + dünner Client im `apps/fleetplanner`.
>
> **Entscheidung (User, 2026-06-06):**
> - Engine = **MissionCover (Gen 2, React)** — nicht CCO.
> - **Eigenständiger Microservice**, sauber + sicher, **API-getrieben**. Modul bleibt self-contained.
> - **Server-render (Option C)** via headless Chromium → pixelgleich zum Editor.
> - Fleetplanner schickt alle nötigen Daten, Service rendert + speichert + liefert **Bild/Links** zurück.
> - **CCO-Branding bleibt.** Autor **Vi5E** bleibt sichtbar inkl. Links: Website https://www.vi5e.net/ ,
>   Twitch https://www.twitch.tv/vi5e/ , YouTube https://www.youtube.com/@Vi5E_ .
>
> **Dependency-Block:**
> - **Hängt an:** nichts hartes.
> - **Blockiert:** nichts.
> - **Synergie:** FR-P1-event-distribution (Cover-Link beim Cross-Post), Discord-Event-`image`.

---

## 1. Was liegt in `addOns/` (Ausgangslage)

Zwei standalone **Mission-Briefing-Cover-Generatoren** (SC-Poster). Kein Backend, keine
Suite-Anbindung. Zwei Generationen desselben Tools.

- **`addOns/CCO/CCO`** (Gen 1): Vanilla HTML/CSS/JS, **Canvas 2D**, keine Build-Chain. PNG bis 4K +
  21:9 + A4-Print, Marker/Inspector/Snap-Grid/QR, 5 Look-Presets. Branding „CCO / V1SE / Vi5E".
- **`addOns/MissionCover/MissionCover`** (Gen 2): **React 19 + Vite 8** → Single-File-HTML.
  **DOM→Bild** via `html-to-image`. PNG/JPEG/GIF/JSON, 4 Presets, Fonts/FX/Filter, 8 SC-SVG-Logos,
  Layer-Panel, i18n DE/EN, localStorage, Undo/Redo.

Beide tippen Op-Daten **manuell**. Der Fleetplanner hat diese Daten bereits → das ist der Hebel.

**Gewählte Engine: MissionCover (Gen 2).** Build-integriert, JSON-Config (`version 2.0`) =
serialisierbares Datenmodell, themefähige SVG-Logos. CCO bleibt als Stil-/Branding-Referenz
(„CCO SPECIAL OPERATIONS COMMAND", Vi5E-Footer, A4-Print-Größen).

---

## 2. Zielbild

```
┌────────────────┐   M2M HTTPS (Bearer)    ┌──────────────────────────┐
│  fleetplanner  │ ──── POST /v1/covers ──▶│  mission-cover (service) │
│  (Fastify SSR) │     { op-payload }      │  Fastify API             │
│                │                         │   + headless Chromium    │
│  coverService  │◀── { id, urls{ png } } ─│   + MissionCover bundle  │
└────────────────┘                         │   + artifact store (vol) │
        │                                  └──────────┬───────────────┘
        │ speichert nur opId → coverUrl               │ GET /covers/:id.png
        ▼                                             ▼  (read-only, öffentlich
   Op-Detail / Manage / Discord-Event / Cross-Post      über Caddy einbettbar)
```

Fleetplanner **rendert nichts** und hält **keine Bild-Bytes** — nur die zurückgegebene URL/ID.
Der Microservice ist die einzige Stelle, die MissionCover kennt.

---

## 3. Microservice `apps/mission-cover`

### 3.1 Aufbau (Modul bleibt self-contained)

```
apps/mission-cover/
  package.json            # @rdoc-suite/mission-cover
  Dockerfile              # node + headless chromium (playwright base image)
  src/
    index.ts              # Fastify bootstrap, /health, route-register
    config/env.ts         # Zod-validierte env (PORT, SERVICE_SECRET, PUBLIC_URL, store path)
    routes/covers.ts      # POST /v1/covers, GET /v1/covers/:id, GET /covers/:id.png
    services/render.ts    # headless render (Playwright), 1 Browser, page-pool
    services/store.ts     # artifact persistence (Volume), id→meta
    services/prefill.ts   # op-payload → MissionCover-Config (version 2.0)
    schema.ts             # Zod: CoverRequest / CoverResponse
  engine/                 # die MissionCover-App (Gen 2), als Submodul/kopiert
    ...                   # React-Quelle; build → engine/dist/index.html (singlefile)
  __tests__/
```

Die **Engine** (`engine/`) bleibt der unveränderte MissionCover-Code (eigene `package.json`,
eigener Vite-Build). Der Service lädt das gebaute `engine/dist/index.html` in Chromium, injiziert
die Config, screenshottet den Cover-Knoten. So bleibt der Editor 1:1 weiternutzbar (siehe 3.5)
und der Render ist **pixelgleich**.

### 3.2 Warum headless Chromium (Playwright), nicht satori/canvas

MissionCover nutzt schwere CSS-Filter (scanlines, chromatic aberration, vignette, blur, glitch,
`mix-blend-mode`). `satori` unterstützt nur eine CSS-Teilmenge → Look bräche. Playwright rendert
**denselben** DOM/CSS wie der Browser → kein zweiter Renderpfad, keine Drift.
Kosten: schwereres Image (~) + Speicher pro Render. Mitigation: **ein** Browser-Prozess, kleiner
Page-Pool, Render seriell/queued.

### 3.3 API (M2M, Bearer)

Selbe Auth-Form wie `bridgeFetch`/`BRIDGE_FLEET_SECRET`: `Authorization: Bearer <MISSIONCOVER_SERVICE_SECRET>`.

**`POST /v1/covers`** — rendern (idempotent über `opId` + `configHash`):
```jsonc
// Request (alle Felder Zod-validiert an der Boundary)
{
  "opId": "ckxyz...",
  "format": "16:9",                  // 16:9 | 1:1 | 9:16 | 4:3 | custom
  "preset": "fleet-ops",             // optional, sonst Guild-Default
  "data": {                          // Prefill-Quelle (siehe §4)
    "title": "OPERATION DATENKERN",
    "subtitle": "ASD-SICHERHEITSKOMPLEX",
    "objectiveText": "Datenkern sichern ...",
    "dateTime": "2026-06-08T20:00:00Z",
    "location": "STANTON // ARC-L1",
    "assets": [{ "name": "Carrack", "role": "Recon" }],
    "briefingUrl": "https://suite.raumdock.org/fleetplanner/ops/ckxyz",
    "branding": { "footerTitle": "CCO SPECIAL OPERATIONS COMMAND", "guildLogoUrl": "..." }
  },
  "config": null                     // optional: volle MissionCover-Config override (aus Editor)
}
```
```jsonc
// Response
{
  "id": "cov_a1b2",
  "opId": "ckxyz...",
  "width": 1920, "height": 1080,
  "urls": {
    "png":    "https://suite.raumdock.org/cover/covers/cov_a1b2.png",
    "editor": "https://suite.raumdock.org/cover/edit/cov_a1b2"   // optional, §3.5
  },
  "createdAt": "2026-06-06T..."
}
```

- **`GET /v1/covers/:id`** — Metadaten + Config (M2M, für Re-Edit/Anzeige).
- **`GET /covers/:id.png`** — das Bild. **Read-only, ungeratene id**, darf öffentlich über Caddy,
  damit Discord-Event-`image` und Partner-Cross-Post es laden können. Kein Auth (nur unguessable id).

### 3.4 Persistenz (im Service, nicht im Fleetplanner)

- Artefakte in eigenem Volume `mission_cover_data:/app/data/covers/<id>.png` + `meta.json` (oder
  kleine SQLite/JSON-Index). Fleetplanner speichert nur `opId → coverId/coverUrl`.
- So bleibt der Service eigenständig; Fleetplanner-DB bleibt frei von Bild-Bytes.
- Retention/GC: alte Cover ohne Op räumen (Cron im Service oder beim Op-Delete-Webhook).

### 3.5 Editor-Modus (optional, behält manuelles Tuning)

`GET /cover/edit/:id` (oder `/cover/new?token=...`) liefert die MissionCover-SPA, vorbefüllt per
kurzlebigem Token (HS256, wie Companion-JWT-Muster). User feilt am Look, „An Op speichern" schickt
die finale Config an `POST /v1/covers` (über den Fleetplanner-Proxy oder direkt mit dem Token).
MVP kann ohne Editor starten (nur Auto-Render); Editor als Phase 2.

### 3.6 Branding / Autor — bleibt erhalten

- CCO-Branding (Footer „CCO SPECIAL OPERATIONS COMMAND", Vi5E Task Force) als **Default-Branding**
  des Service, überschreibbar per `data.branding`/Guild-Template.
- **Autor-Credit Vi5E bleibt fest sichtbar** (Footer/Info-Badge): Name + Links
  **Website** https://www.vi5e.net/ · **Twitch** https://www.twitch.tv/vi5e/ ·
  **YouTube** https://www.youtube.com/@Vi5E_ .
  → in `engine/` als nicht-entfernbarer Credit + im Service-`/health`/About.

---

## 4. Prefill-Mapping (Op → Cover)

`services/prefill.ts` baut aus dem `data`-Payload eine MissionCover-Config (`version 2.0`):

| Cover-Feld | Op-Quelle (Fleetplanner) |
|---|---|
| `title` / Operation | `op.title` |
| `subtitle` / tagline | `op.subtitle` / Briefing-Auszug |
| `objectiveText` | `op.briefing` |
| `dateTime` | `op.startsAt` (UTC) |
| `location` | `op.location` |
| Asset-/Phasen-Liste | `op.units` (Schiff + Rolle) / Composition |
| Logo / Branding | Guild-Settings (Org-Logo) → Default = CCO/Vi5E |
| QR / briefingUrl | Op-Permalink `…/fleetplanner/ops/:id` |

---

## 5. Fleetplanner-Seite (dünn)

- `apps/fleetplanner/src/services/coverService.ts` — Client analog [bridge.ts](../apps/fleetplanner/src/services/bridge.ts):
  `coverFetch(path, opts)` mit `Bearer MISSIONCOVER_SERVICE_SECRET`, Base = `MISSIONCOVER_SERVICE_URL`
  (`http://mission-cover:3300` im Compose-Netz). Funktionen: `requestCover(opId, data)`,
  `getCover(opId)`.
- DB: nur Referenz, kein Bild. Minimal-Feld an `Op` (oder kleine Tabelle):
  ```prisma
  model OpCover { opId String @id; coverId String; url String; updatedAt DateTime @updatedAt
    op Op @relation(fields:[opId], references:[id], onDelete: Cascade) }
  ```
- UI: Button „Cover erstellen/aktualisieren" im Manage-Workspace + Anzeige auf Op-Detail.
  Gating wie andere Op-Aktionen: schreiben = `GuildMembership.role` captain/fleetoperator, lesen = crew.
- Feature-Flag: nur aktiv wenn `MISSIONCOVER_SERVICE_SECRET` + `MISSIONCOVER_SERVICE_URL` gesetzt
  (sonst Button versteckt) — selbes Muster wie `BRIDGE_FLEET_SECRET`-Gate.

---

## 6. Deploy / Compose

Neuer Service in [docker-compose.prod.yml](../docker-compose.prod.yml):

```yaml
  mission-cover:
    build:
      context: .
      dockerfile: apps/mission-cover/Dockerfile
    image: rdoc-suite-mission-cover:latest
    container_name: rdoc-suite-mission-cover
    restart: unless-stopped
    env_file: .env
    environment:
      HOST: "0.0.0.0"
      PORT: "3300"
      MISSIONCOVER_PUBLIC_URL: "https://suite.raumdock.org/cover"
    # nur Loopback publishen — Caddy reicht /cover ran; intern via docker-DNS erreichbar
    ports:
      - "127.0.0.1:3300:3300"
    volumes:
      - mission_cover_data:/app/data
# volumes: + mission_cover_data:
```

- Caddy/Traefik: `suite.raumdock.org/cover/*` → `mission-cover:3300`. Nur `GET /covers/*.png` +
  (optional) Editor öffentlich; `/v1/*` **nur intern** (nicht über Proxy exposen).
- `.env`: `MISSIONCOVER_SERVICE_SECRET` (≥32, ≠ andere Secrets), `MISSIONCOVER_SERVICE_URL=http://mission-cover:3300`.
- Build self-bootstrapping (kein lokales pnpm/npm — siehe Projektregel). Playwright-Base-Image
  bringt Chromium mit; Fonts (Orbitron, Russo One, Rajdhani …) **ins Image bündeln** (deterministischer
  Render, keine Google-Fonts-Netzabhängigkeit zur Laufzeit).

---

## 7. Sicherheit

- **`/v1/*` nie öffentlich.** Nur docker-internes Netz + Bearer `MISSIONCOVER_SERVICE_SECRET`.
- **Alle Inputs Zod-validieren** an der Boundary (`schema.ts`). Größen kappen: max Bildmaße,
  max Payload, max Asset-Anzahl.
- **Headless-Härtung:** Render in isolierter Page; **Netz-Egress blocken** außer Whitelist
  (Guild-Logo-Domain) → kein SSRF/Datenabfluss über injizierte URLs. Uploads/Bilder nur als
  vom Fleetplanner gelieferte/validierte data-URLs oder Whitelist-Hosts. `--no-sandbox` vermeiden;
  falls Container es erzwingt, seccomp/AppArmor + non-root user.
- **`/covers/:id.png`:** unguessbare id (cuid/random), read-only, kein Listing, Rate-Limit am Proxy.
- **Keine Secrets loggen.** Render-Fehler ohne Payload-Dump.
- Reine Grafik — **keine Discord-ToS-/Audio-Themen** berührt.

---

## 8. Reihenfolge

1. **Engine importieren:** MissionCover → `apps/mission-cover/engine/`, Build verdrahten, CCO/Vi5E-Branding fix einbauen. (klein)
2. **Service-Skeleton:** Fastify + `/health` + Playwright-Render + `POST /v1/covers` + `GET /covers/:id.png` + Volume-Store. (mittel)
3. **Compose + Caddy + .env**, Fonts ins Image, M2M-Secret. (klein)
4. **Fleetplanner-Client** `coverService.ts` + `OpCover`-Referenz + Button/Anzeige, Feature-Flag. (mittel)
5. **Editor-Modus** `/cover/edit/:id` (Token-Prefill, Re-Edit). (mittel, optional)
6. **Synergie:** Cover-Link in Discord-Event-`image` + FR-P1-Cross-Post-Anhang. (später)

---

## 9. Offene Punkte (vor Umsetzung klären)

- **Engine-Verknüpfung:** `addOns/MissionCover` kopieren oder als git-Submodul einbinden?
- **Editor jetzt oder später** (Phase 5) — MVP geht ohne (nur Auto-Render).
- **Image-Größe akzeptabel?** Playwright/Chromium-Image ist groß; Alternative satori nur falls
  Look-Verlust ok (nicht empfohlen).
- In [docs/ROADMAP.md](ROADMAP.md) eintragen.

---

*Erstellt 2026-06-06. Reine Planung — nichts implementiert.*
