# FR-P1 — Fleet-Needs-Redesign + geführter Anmelde-Wizard

> **FeatureRequest** · **Prio 1**
> **Status:** Plan, **kein Code**. §7-Entscheidungen geklärt (User 2026-06-08): CQB statt Rollen,
> Auto-Match=Warnung, Squad-Bündelung=Drag+Auto-Vorschlag, Fleetyards jetzt (lokal gecacht).
> Bereit zur Umsetzung — Start mit Rollout-Schritt 1+2 erst nach expliziter Freigabe.
> **Auslöser (User, 2026-06-08):** "Fleet Needs" ist vielen zu unverständlich; Anmeldung soll
> Spieler **Schritt für Schritt** führen; FPS-Kämpfer/Jägerpilot melden sich als **Einzelperson**
> (der FleetOperator macht daraus Squad/Staffel); Schiffsklassen zu statisch; Schiffe/FPS anbieten
> ist schlecht lesbar. Frage-Reihenfolge: **Variante B** (konkrete Beiträge zuerst, "zuweisen
> lassen" als letzter Fallback).
>
> **Scope:** `apps/fleetplanner` (SSR `web/pages.ts`, `routes/api.ts`, `services/*`,
> `prisma/schema.prisma` + Migration). Reiner Web-Flow, keine Companion-/Voice-Änderung.
>
> **Dependency-Block:**
> - **Hängt an:** bestehendes Composition/FleetUnit/SeatAssignment-Modell + Ship-Katalog (gesynct).
> - **Baut auf / löst ab Teile von:** [composition-rebuild-plan.md](composition-rebuild-plan.md)
>   (Board/Auto-Match/Struktur) und [FR-P1-eventcreation-simplification.md](FR-P1-eventcreation-simplification.md)
>   (Mobile-Join — bisher flache Radio-Liste). Dieses Doc ist die **Evolution** dieser Join-View.
> - **Blockiert:** nichts.
> - **Synergie:** FR-P2-discord-event-interest (Interessenten landen im Zuweisungs-Pool),
>   FR-P4-mission-cover.

---

## 1. Ist-Zustand

- **Bedarf** = `CompositionGroup → CompositionRequirement(category, label, count)`; `category` ist
  eine **Festliste** (`fps|capital|subcapital|fighter|support|ground|transport|mining|salvage|exploration|any`,
  [schema.prisma:519](../apps/fleetplanner/prisma/schema.prisma#L519)) **unabhängig** von den echten
  Katalogdaten `Ship.size/career/role`.
- **Einheit** = `FleetUnit(unitType: ship|squad|vehicle)`. FPS = `squad` mit `squadSize`, von **einer**
  Person als fertiges Team angelegt ([schema.prisma:530](../apps/fleetplanner/prisma/schema.prisma#L530)).
- **Anmeldung** (`web/pages.ts` ~4415): flache Radio-Liste "I want to join" mit 3 Optionen
  (assign / claim seat / offer ship-or-fps). Kein geführter, zustandsabhängiger Flow; FPS steckt als
  `unitType=squad` im Schiff-Anbieten-Formular.

## 2. Pain-Points (User)

| # | Problem |
|---|---|
| A | "Fleet Needs" mischt **zwei Bedarfsarten** (Rumpf vs. Person) → unverständlich. |
| B | FPS/Jägerpilot meldet sich real als **Einzelperson**, nicht als fertiges Squad. Operator soll bündeln. |
| C | **Schiffsklassen statisch** (Parallel-Taxonomie statt Katalogdaten). |
| D | Schiff/FPS **anbieten schlecht lesbar**, nicht direkt verständlich. |
| E | Anmeldung soll **geführt Schritt für Schritt** sein (frage-basiert), irrelevante Schritte weglassen. |

## 3. Soll-Konzept

### 3.1 Zwei Bedarfs-Achsen (löst A, B)

Ein Requirement bekommt eine **Art** (`kind`):

- **Hull-Need** (`kind=hull`) — ein *Rumpf* wird gebraucht ("1× Idris", "4× leichte Jäger").
  Erfüllt durch ein **angebotenes Schiff** (`FleetUnit` ship). Crew füllt danach dessen Sitze.
- **CQB-Need** (`kind=cqb`) — *Soldaten* werden gebraucht ("8× CQB"). **Keine Rollen-Taxonomie**
  (Entscheidung User 2026-06-08: "es sind Soldaten, mehr nicht"). Einzelpersonen melden sich als
  CQB (`CqbSignup`); der FleetOperator **bündelt** mehrere Signups in benannte **Squads/Fireteams**
  (`CompositionGroup` mit `kind=squad`). Ein Squad ist ein **Operator-Konstrukt**, nicht vom
  Einzelnen angelegt. (Die alte FPS-`squad`-FleetUnit, von einer Person komplett angelegt, entfällt.)

Darstellung als Soll/Ist je Achse (erweitert das geplante Composition Board):

```
HULL-NEEDS        SOLL IST OFFEN  BELEGUNG
Capital            2   1   1      [Idris ✓] [____ offen]
Light Fighter      4   3   1      [Gladius][Arrow][Hornet] [__]

CQB-NEED          SOLL GEMELDET   OPERATOR-BÜNDELUNG
CQB-Soldaten       12    9        [Alpha Squad: 5] [Bravo Squad: 4]  (3 offen)
```

### 3.2 Geführter Anmelde-Wizard — Reihenfolge B (löst D, E)

Eine Frage pro Screen; der Wizard berechnet aus dem Op-Zustand, **welche Schritte überhaupt zählen**,
und überspringt den Rest. Reihenfolge **B**: konkrete Beiträge zuerst, "zuweisen lassen" zuletzt,
plus **immer sichtbarer "Überspringen — platziert mich"-Button** (Casual = 1 Klick).

```
Klick Event-Link
  └─[nicht eingeloggt] → Discord-Login → zurück in den Flow
Q1 "In ein CQB-Team?"          (nur wenn CQB-Need offen)
   Ja → CqbSignup → Operator bündelt in Squad → FERTIG
Q2 "Einen Sitz claimen?"       (nur wenn freie Sitze existieren)
   Ja → Liste claimbarer Sitze (Schiff · Sitz) → Claim → FERTIG
Q3 "Ein Schiff bereitstellen?" (nur wenn Sign-up offen + Hull-Needs)
   Ja → Schiff wählen (Hangar / Katalog, mit Bild) → Anbieten → FERTIG
Q4 "Einfach zuweisen lassen?"  (Fallback, immer)
   Ja → Notiz optional → Crew-Request → FERTIG (Operator platziert)
[Skip-Button jederzeit → wie Q4 Ja]
```

**Skip-Logik (Schritt nur zeigen wenn real möglich):**

| Schritt | Sichtbar wenn |
|---|---|
| Q1 CQB-Team | Op hat offenen CQB-Need (`SOLL > gemeldet`) |
| Q2 Sitz claimen | `openSeats.length > 0` |
| Q3 Schiff | Sign-up offen **und** Hull-Needs vorhanden (bzw. Schiffe erlaubt) |
| Q4 Zuweisen / Skip | immer (außer Viewer hat schon Sitz/Schiff) |

**Mehrfachbeitrag:** pro Durchlauf = ein Beitrag; danach "Noch etwas beitragen?" → Wizard erneut.
Hält jeden Screen simpel. **Sonderzustände** (schon Sitz / schon Schiff angeboten / Sign-up zu /
nicht eingeloggt) blenden passende Schritte aus — Logik teils schon vorhanden in `pages.ts`.

**Backend-Anbindung (Wege existieren, nur neu verdrahtet):**
- Q1 → **neu** `POST /api/ops/:id/cqb-signups` (`CqbSignup`)
- Q2 → `POST /api/seats/:seatId/claim` (vorhanden)
- Q3 → `POST /api/ops/:id/units` (vorhanden)
- Q4 → `POST /api/ops/:id/crew-requests` (vorhanden)

### 3.3 Dynamische Schiffsklassen (löst C)

Festliste `category` ablösen: Klassen aus Katalog ableiten (`Ship.size × career × role`) +
Mapping-Tabelle (siehe composition-rebuild-plan §3.4). Hull-Need referenziert eine **abgeleitete
Klasse** statt Freitext; ermöglicht Auto-Match-Vorschlag (Schiff↔Slot) als Warnung, keine Sperre.

### 3.4 Operator-View — Tabs konsolidieren (User 2026-06-08)

Heutige Operator-Tabs (`tabDefs`, [pages.ts:2380](../apps/fleetplanner/src/web/pages.ts#L2380)):
`Overview · Fleet · Crew · Voice · Voice Access · Admin` — zu viele, thematisch zerfasert.

Zusammenfassen — passt 1:1 auf die zwei Bedarfs-Achsen (§3.1):

| Neu | Fasst zusammen | Sub-Sektionen |
|---|---|---|
| **Overview** | (unverändert) | Composition Board (Hull + Role getrennt) |
| **Fleet & Personal Management** | `Fleet` + `Crew` | **Fleet** (Schiffe/Hull-Needs, Composition) + **Personal** (Sitze/Crew-Requests/CQB-Signups, Squad-Bündelung) |
| **Voice** | `Voice` + `Voice Access` | **Voice Setup** (Channels/Bots) + **Voice Access** (Commander-Roster, manage-only) |
| **Admin** | (unverändert) | Fragen/Genehmigungen |

- Reine **View-/Tab-Restrukturierung** — Panels existieren bereits (fleetPanel, crew, voice,
  commanders), werden nur unter gemeinsamen Tabs als Sub-Sektionen gestapelt. Kein Schema, keine
  Daten betroffen.
- Tab-`attn`-Flags (offene Sitze, Voice-Access etc.) werden auf den zusammengefassten Tab gemappt.
- Namensgebung: "Personal" = Personal/Mannschaft (deckt Crew **und** CQB-Signups) → konsistent zur
  Hull-vs-CQB-Trennung.

### 3.5 Grafik: Sitz-/Turm-Karte + Bildquellen

- **Stufe 1 (ohne neue Daten):** abstrakte **Sitz-/Turm-Karte** aus `Ship.maxCrew / weaponCrew /
  operationCrew`: gelabelte Chips `[Pilot][Co-Pilot][Turm 1][Turm 2][Engineer]`, Farbe = belegt/offen.
  Keine echte Hull-Geometrie, aber sofort lesbar "wer sitzt wo, was frei".
- **Stufe 2 (JETZT — Entscheidung User 2026-06-08):** Schiffsfoto + **Fleetyards-Top-down-Silhouette**
  als Hintergrund für die Sitz-/Turm-Karte; Fleetyards-Hardpoint-Liste (Anzahl/Größen) ergänzt die
  Sitzableitung. **Daten lokal speichern wie die Schiff-DB** (s. §4): periodischer Sync in eigene
  Tabelle(n) + Sync-State, kein Live-Hotlink. Bild-URLs in DB (wie `Ship.imageUrl`); Silhouette-
  Dateien optional in einen lokalen Asset-Ordner spiegeln (Rate-Limit/Ausfall-Schutz).
- **Stufe 3 (teuer, optional, nur Flaggschiffe):** echte Turm-Positionen — **nicht** im Wiki/Bild-
  Feed; nur aus extrahierten Spieldaten (scunpacked / SC-Open-Data) oder hand-SVG. Für >200 Schiffe
  unrealistisch.

**Bildquellen:** star-citizen.wiki API (genutzt; Store-Bild) · **Fleetyards.net API** (Bilder +
Top-down-"fleetchart"-Silhouetten + Hardpoint-Liste — Hauptquelle Stufe 2, lokal gecacht) · RSI
ship-matrix (Fallback) · scunpacked/SC-Open-Data (nur Stufe 3, Hardpoint-Positionen).
**Attribution/Lizenz + Rate-Limit von Fleetyards beachten** (Sync-Intervall großzügig, wie Ship-Sync).

## 4. Datenmodell-Delta

Minimal-invasiv, bestehende Daten bleiben gültig:

```prisma
// NEU: Einzelne Person meldet sich als CQB-Soldat; Operator bündelt sie in eine Gruppe (Squad).
// KEINE Rolle (Entscheidung: "es sind Soldaten, mehr nicht").
model CqbSignup {
  id              String   @id @default(cuid())
  operationId     String
  userId          String
  note            String?
  status          String   @default("pending") // pending | accepted | rejected
  assignedGroupId String?  // → CompositionGroup(kind=squad), vom Operator gesetzt
  createdAt       DateTime @default(now())
  // relations + @@unique([operationId, userId])
}

model CompositionGroup {
  // + kind String @default("fleet") // fleet | squad   (squad = Operator-gebündelte CQB-Soldaten)
}

model CompositionRequirement {
  // + kind String @default("hull") // hull | cqb
  // category bleibt String, Wertebereich an Katalog-Klassen angeglichen (kein Typ-Change)
}

// NEU: Fleetyards-Daten lokal cachen (analog Ship / ShipSyncState). Bild-/Silhouette-URLs +
// Hardpoints pro Schiff; Sync periodisch, nicht live.
model FleetyardsShip {
  id            String   @id @default(cuid())
  shipId        String?  // → Ship.id (verknüpft, wenn match), sonst nur slug
  slug          String   @unique
  silhouetteUrl String?  // top-down "fleetchart" Umriss
  storeImageUrl String?
  hardpointsJson String  @default("[]") // Anzahl/Größen der Hardpoints
  rawJson       String   @default("{}")
  syncedAt      DateTime @default(now())
}

model FleetyardsSyncState {
  id           String    @id @default("singleton")
  enabled      Boolean   @default(true)
  intervalDays Int       @default(7)
  lastRunAt    DateTime?
  lastResult   String?
  running      Boolean   @default(false)
  shipCount    Int       @default(0)
  updatedAt    DateTime  @updatedAt
}
```

→ **Eine** Migration: neue Tabellen `CqbSignup` + `FleetyardsShip` + `FleetyardsSyncState` und
zwei optionale `kind`-Spalten mit Default → abwärtskompatibel.

## 5. Betroffene Dateien

- `prisma/schema.prisma` + Migration (`CqbSignup`, `FleetyardsShip`, `FleetyardsSyncState`, `kind`-Spalten).
- `web/pages.ts`: Join-Wizard (Reihenfolge B, Skip-Logik) ersetzt die Radio-Liste (~4415);
  Composition Board (Hull/CQB getrennt); Sitz-/Turm-Karte (mit Fleetyards-Silhouette); Offer-Flow
  bebildert; Operator-Tabs konsolidiert (§3.4).
- `routes/api.ts`: `POST /api/ops/:id/cqb-signups`; Operator-Route "Signups → Squad bündeln"
  (+ Auto-Vorschlag); Wizard-Submit-Pfade.
- `services/composition.ts` (neu/erweitert): Klassen-Mapping, `suggestSlot(ship, op)` (Warnung),
  CQB-Need-Soll/Ist-Aggregation, Squad-Auto-Vorschlag, Sitz-/Turm-Karten-Ableitung aus `Ship`-crew.
- `services/fleetyards.ts` (neu): Fleetyards-Sync (Silhouette/Bild/Hardpoints → `FleetyardsShip`),
  `FleetyardsSyncState`-Steuerung analog `shipSync.ts`/`scwiki.ts`; Admin-"Sync now"-Button.

## 6. Rollout-Reihenfolge

1. **Composition Board (Anzeige, Hull/CQB getrennt)** — nur Lesen, kein Schema. Sofort-UX-Gewinn.
2. **Sitz-/Turm-Karte Stufe 1** — reine Ableitung aus crew-Daten, risikolos.
3. **Geführter Join-Wizard (B)** — verdrahtet bestehende Endpunkte neu, kein Schema (außer Q1).
4. **CqbSignup + Operator-Bündelung (Drag + Auto-Vorschlag)** — Migration + neue Routes (löst Pain B).
5. **Dynamische Klassen + Auto-Match-Warnung** — Festliste ablösen.
6. **Fleetyards-Sync + Grafik Stufe 2** — `FleetyardsShip`/Sync-State + Silhouette in der Sitz-Karte.

Schritte 1–3 weitgehend ohne Migration/Breaking-Change. Reihenfolge 4–6 flexibel; Fleetyards-Sync
(6) kann früh parallel laufen, da reine Daten-Pipeline.

## 7. Entscheidungen (User 2026-06-08) — geklärt

- **Rollen-Taxonomie:** ✓ **Keine.** Personal-Achse = nur **CQB** (Soldaten, keine Rollenzuweisung).
  Kein `role`-Feld; `CqbSignup` ist rollenlos.
- **Auto-Match:** ✓ **Nur Warnung** (gelber Hinweis "passt evtl. nicht zu …"), Anbieten bleibt erlaubt.
- **Squad-Bündelung:** ✓ **Beides** — Operator-Drag **und** Auto-Vorschlag (gleiche CQB-Soldaten →
  Squad bis Sollgröße, Operator bestätigt/ändert).
- **Fleetyards:** ✓ **Jetzt** (Stufe 2). Daten **lokal speichern wie die Schiff-DB**
  (`FleetyardsShip` + `FleetyardsSyncState`, periodischer Sync, kein Live-Hotlink).

Verbleibende technische Detailfrage (kein Blocker):
- **`category` ↔ Klassen-Mapping** zentral in `composition.ts` (mit composition-rebuild-plan teilen).

---

*Erstellt 2026-06-08. Reine Planung — nichts implementiert. Konsolidiert die Join-/Needs-Themen aus
composition-rebuild-plan.md + FR-P1-eventcreation-simplification.md.*
