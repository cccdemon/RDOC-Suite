# FR-P3 — Frontend/Backend-Split (API-first + dedizierter FE-Container)

> **FeatureRequest · Priorität 3 (niedrig-mittel) · Status: PLAN, kein Code.**
> Niemals eigenständig implementieren — nur auf explizite Anweisung.

## Dependency-Block
- **Hängt ab von:** nichts hartem. Profitiert von der bereits reinen, testbaren Slot-Logik
  (`apps/fleetplanner/src/services/slotKind.ts`) und dem datengetriebenen Mission-Board
  (`apps/fleetplanner/src/web/missionBoard.ts`).
- **Blockiert:** echte Rich-Interaktivität (Live-Belegung, Drag-Drop-Assign, Offline-Companion-Web).
- **Voice-Scope:** unberührt. LiveKit/Relay/Mission-Voice bleiben Backend-seitig wie heute.

## Kontext / Warum
Der Fleetplanner ist heute ein **Fastify + Prisma + SSR-Monolith**: Seiten werden serverseitig als
tagged-template-HTML gerendert (`web/pages.ts` ~10k Zeilen, `web/render.ts`, `web/missionBoard.ts`),
ohne Frontend-Framework. Die User-Frage: *Was würde die Trennung von Frontend und Backend kosten —
API-first, mit dediziertem Frontend-Container?* Dieses Dokument hält die Antwort als
Entscheidungsgrundlage fest (keine Umsetzung).

## Ist-Zustand
- **Rendering:** SSR direkt aus Prisma. Kein SPA, kein FE-Build.
- **„API" heute:** Form-POSTs auf `/api/*` liefern **Redirects/HTML**, nicht JSON. Echte JSON-Endpunkte
  nur für die Companion-App (`/api/companion/*`, `/suite/capabilities`).
- **Auth:** HttpOnly-Cookie-Session (`fp_sid`) + CSRF-Token in Forms (`auth/session.ts`, `auth/middleware.ts`).
- **i18n:** serverseitig über AsyncLocalStorage (`i18n/index.ts`); Dicts de/en voll, fr/es Fallback.
- **Konsequenz:** Es existiert **keine** saubere JSON-API-Schicht, die ein SPA konsumieren könnte.

## Zielbild
- **Backend:** Fastify wird reine **JSON-API** (`/api/v1/...`), kein HTML mehr. Zod an der Boundary
  (teils vorhanden).
- **Frontend:** eigener Container — Vite + React/Svelte → statische Assets, ausgeliefert via nginx.
  Spricht ausschließlich die JSON-API.
- **Proxy:** Caddy/Traefik splittet `/` → FE-Container, `/api` → Fastify.

## Kosten (Kostentreiber)
| Treiber | Aufwand | Begründung |
|---|---|---|
| **SSR→JSON-Rewrite** | **XL** | Jede Seite (pages.ts, Manage-Tabs, Profil, Admin, Guild-Settings, Cover, Roadmap, Feedback…) braucht JSON-Endpunkte **und** FE-Komponenten neu. Hauptkosten. |
| **Auth/CSRF-Umbau** | M | Cookie cross-Container nur same-site/-domain; sonst CORS + Token-Flow + CSRF-Modell neu. |
| **i18n verschieben** | S–M | ALS-Server → Client-Lib (i18next). Dicts sind als JSON wiederverwendbar — billig. |
| **SSR-Verlust** | M | Kein First-Paint/No-JS; schlechtere Link-Previews für öffentliche Ops (Mission-Cover federt teils ab). |
| **Ops/Infra** | S–M | +1 Container, FE-Build-Pipeline, CI-Image, Compose-Eintrag, Healthcheck, Proxy-Route, CSP. |
| **Design neu** | M | Das frische SSR-Mission-Board würde im Framework nochmal gebaut — aber die `claude.ai/design`-HTML ist quasi 1:1 React, also günstiger als from scratch. |
| **Realtime (optional)** | M | Erst damit lohnt sich FE richtig (Live-Belegung, Drag-Drop, WS). |

**Grobschätzung Big-Bang (volle Parität):** ~**3–6 Personenmonate** + hohes Regressionsrisiko.
Für ein faktisch 1-Personen-Projekt unverhältnismäßig.

## Migrationsstrategien
1. **Big-Bang** (alles neu auf einmal): teuer, riskant, langer Stillstand. **Abgelehnt.**
2. **Strangler (empfohlen):** FE-Container hochziehen, **eine Seite nach der anderen** migrieren.
   Start: **Op-Detail** (bereits datengetrieben/komponenten-nah). Neue Seiten im FE, Rest bleibt SSR;
   Proxy routet per Pfad. Inkrementell, jederzeit lieferbar, jederzeit abbrechbar.
3. **Insel-Hydration** (billigste Mitte): SSR bleibt, nur **interaktive Inseln** (z.B.
   Platz-übernehmen-Modal, Belegungs-Board) werden FE-Komponenten, die JSON ziehen. **Kein** zweiter
   Container nötig, FE-DX trotzdem vorhanden.

## Empfehlung
- **Kein Big-Bang.** SSR liefert, ist günstig, hat gerade frisch ein Design-System bekommen.
- Bei wachsendem FE-Bedarf → **Strangler ab Op-Detail**:
  - JSON-API `GET /api/v1/ops/:id` liefert genau das Slot-Modell, das `missionBoard.ts` schon baut.
  - `slotKind`/Kategorie-Logik ist bereits rein + getestet → direkt FE-tauglich.
- **Trigger zum Loslegen:** echte Interaktivität nötig (Live-Updates, Drag-Drop-Assign, Offline).
  Bis dahin reichen Inseln.

## Phasen (falls Strangler beschlossen)
1. **API-Schnitt Op-Detail:** `GET /api/v1/ops/:id` (JSON aus dem vorhandenen Slot-Modell) +
   Schreib-Endpunkte als JSON-Varianten von claim/units/cqb-join/crew/hangar-share (Wiederverwendung
   der Services, nur Response-Format ändern).
2. **FE-Container-Skeleton:** Vite + Router + Auth (Cookie same-site behalten → kein CORS), i18n-Client
   aus den exportierten Dicts. nginx-Image + Compose-Eintrag + Proxy-Route unter eigenem Pfad.
3. **Op-Detail im FE** (Port der `claude.ai/design`-Komponenten) gegen die API.
4. **Bewerten + weiterstrangeln** (Manage-Board als nächster Kandidat) **oder stoppen** — SSR-Rest bleibt.

## Offene Entscheidungen
- FE-Framework (React vs Svelte) — erst bei Phase 2.
- Auth: Cookie-same-site beibehalten (einfach) vs Token/CORS (flexibler, teurer).
- SSR-Link-Previews: reicht Mission-Cover-OG, oder braucht es serverseitiges Meta-Rendering pro Op?
