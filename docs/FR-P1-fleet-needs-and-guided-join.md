# FR-P1 — Fleet-Needs-Redesign + geführter Anmelde-Wizard

> **FeatureRequest** · **Prio 1**
> **Status:** Plan, **kein Code**. Umsetzung erst nach Freigabe.
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
- **Role-Need** (`kind=role`) — *Köpfe* einer Rolle werden gebraucht ("8× FPS-Infanterie",
  "6× Jägerpiloten", "2× Sanitäter"). Erfüllt durch **Einzelpersonen** (`RoleSignup`). Der
  FleetOperator **bündelt** mehrere Signups in benannte **Squads/Wings/Staffeln** (`CompositionGroup`
  mit `kind=squad`). Ein Squad ist damit ein **Operator-Konstrukt**, nicht vom Einzelnen angelegt.

Darstellung als Soll/Ist je Achse (erweitert das geplante Composition Board):

```
HULL-NEEDS        SOLL IST OFFEN  BELEGUNG
Capital            2   1   1      [Idris ✓] [____ offen]
Light Fighter      4   3   1      [Gladius][Arrow][Hornet] [__]

ROLE-NEEDS        SOLL GEMELDET   OPERATOR-BÜNDELUNG
Jägerpilot          6     8       [Staffel "Vanduul-Bane": 4] [Reserve: 4]
FPS Infanterie      8     5       [Alpha Squad: 5]
Sanitäter           2     1       (offen)
```

### 3.2 Geführter Anmelde-Wizard — Reihenfolge B (löst D, E)

Eine Frage pro Screen; der Wizard berechnet aus dem Op-Zustand, **welche Schritte überhaupt zählen**,
und überspringt den Rest. Reihenfolge **B**: konkrete Beiträge zuerst, "zuweisen lassen" zuletzt,
plus **immer sichtbarer "Überspringen — platziert mich"-Button** (Casual = 1 Klick).

```
Klick Event-Link
  └─[nicht eingeloggt] → Discord-Login → zurück in den Flow
Q1 "In ein FPS-Team?"          (nur wenn Role-Need fps offen)
   Ja → RoleSignup(role=fps) → Operator bündelt → FERTIG
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
| Q1 FPS-Team | Op hat offenen Role-Need `fps` (`SOLL > gemeldet`) |
| Q2 Sitz claimen | `openSeats.length > 0` |
| Q3 Schiff | Sign-up offen **und** Hull-Needs vorhanden (bzw. Schiffe erlaubt) |
| Q4 Zuweisen / Skip | immer (außer Viewer hat schon Sitz/Schiff) |

**Mehrfachbeitrag:** pro Durchlauf = ein Beitrag; danach "Noch etwas beitragen?" → Wizard erneut.
Hält jeden Screen simpel. **Sonderzustände** (schon Sitz / schon Schiff angeboten / Sign-up zu /
nicht eingeloggt) blenden passende Schritte aus — Logik teils schon vorhanden in `pages.ts`.

**Backend-Anbindung (Wege existieren, nur neu verdrahtet):**
- Q1 → **neu** `POST /api/ops/:id/role-signups` (`RoleSignup`)
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
| **Fleet & Personal Management** | `Fleet` + `Crew` | **Fleet** (Schiffe/Hull-Needs, Composition) + **Personal** (Sitze/Crew-Requests/Role-Signups, Squad-Bündelung) |
| **Voice** | `Voice` + `Voice Access` | **Voice Setup** (Channels/Bots) + **Voice Access** (Commander-Roster, manage-only) |
| **Admin** | (unverändert) | Fragen/Genehmigungen |

- Reine **View-/Tab-Restrukturierung** — Panels existieren bereits (fleetPanel, crew, voice,
  commanders), werden nur unter gemeinsamen Tabs als Sub-Sektionen gestapelt. Kein Schema, keine
  Daten betroffen.
- Tab-`attn`-Flags (offene Sitze, Voice-Access etc.) werden auf den zusammengefassten Tab gemappt.
- Namensgebung: "Personal" = Personal/Mannschaft (deckt Crew **und** Role-Signups) → konsistent zur
  Hull-vs-Role-Trennung.

### 3.5 Grafik: Sitz-/Turm-Karte + Bildquellen

- **Stufe 1 (jetzt, ohne neue Daten):** abstrakte **Sitz-/Turm-Karte** aus `Ship.maxCrew /
  weaponCrew / operationCrew`: gelabelte Chips `[Pilot][Co-Pilot][Turm 1][Turm 2][Engineer]`,
  Farbe = belegt/offen. Keine echte Hull-Geometrie, aber sofort lesbar "wer sitzt wo, was frei".
- **Stufe 2:** Schiffsfoto (`Ship.imageUrl`, Wiki) als Card + Sitz-Karte; optional Fleetyards-
  Top-down-Silhouette als Hintergrund.
- **Stufe 3 (teuer, optional, nur Flaggschiffe):** echte Turm-Positionen — **nicht** im Wiki/Bild-
  Feed; nur aus extrahierten Spieldaten (scunpacked / SC-Open-Data) oder hand-SVG. Für >200 Schiffe
  unrealistisch.

**Bildquellen:** star-citizen.wiki API (genutzt; Store-Bild) · **Fleetyards.net API** (Bilder +
Top-down-"fleetchart"-Silhouetten + Hardpoint-Liste — beste Silhouette-Quelle) · RSI ship-matrix
(Fallback) · scunpacked/SC-Open-Data (nur Stufe 3, Hardpoint-Positionen). Attribution/Lizenz der
Fan-Quellen beachten.

## 4. Datenmodell-Delta

Minimal-invasiv, bestehende Daten bleiben gültig:

```prisma
// NEU: Einzelperson meldet sich für eine Rolle; Operator bündelt in eine Gruppe (Squad).
model RoleSignup {
  id              String   @id @default(cuid())
  operationId     String
  userId          String
  role            String   // fps | fighter-pilot | medic | engineer | …  (offene Rollen-Taxonomie)
  note            String?
  status          String   @default("pending") // pending | accepted | rejected
  assignedGroupId String?  // → CompositionGroup(kind=squad), vom Operator gesetzt
  createdAt       DateTime @default(now())
  // relations + @@unique([operationId, userId, role])
}

model CompositionGroup {
  // + kind String @default("fleet") // fleet | squad   (squad = Operator-gebündelte Personen)
}

model CompositionRequirement {
  // + kind String @default("hull") // hull | role
  // category bleibt String, Wertebereich an Katalog-Klassen angeglichen (kein Typ-Change)
}
```

→ **Eine** Migration (neue Tabelle `RoleSignup` + zwei optionale `kind`-Spalten mit Default →
abwärtskompatibel).

## 5. Betroffene Dateien

- `prisma/schema.prisma` + Migration (`RoleSignup`, `kind`-Spalten).
- `web/pages.ts`: Join-Wizard (Reihenfolge B, Skip-Logik) ersetzt die Radio-Liste (~4415);
  Composition Board (Hull/Role getrennt); Sitz-/Turm-Karte; Offer-Flow bebildert.
- `routes/api.ts`: `POST /api/ops/:id/role-signups`; Operator-Route "Signups → Squad bündeln";
  Wizard-Submit-Pfade.
- `services/composition.ts` (neu/erweitert): Klassen-Mapping, `suggestSlot(ship, op)`,
  Role-Need-Soll/Ist-Aggregation, Sitz-/Turm-Karten-Ableitung aus `Ship`-crew-Feldern.
- ggf. `services/shipImages.ts` (neu): Fleetyards-Silhouette-Lookup (Stufe 2, optional/cachen).

## 6. Rollout-Reihenfolge

1. **Composition Board (Anzeige, Hull/Role getrennt)** — nur Lesen, kein Schema. Sofort-UX-Gewinn.
2. **Sitz-/Turm-Karte Stufe 1** — reine Ableitung aus crew-Daten, risikolos.
3. **Geführter Join-Wizard (B)** — verdrahtet bestehende Endpunkte neu, kein Schema (außer Q1).
4. **RoleSignup + Operator-Bündelung** — Migration + neue Routes (löst Pain B vollständig).
5. **Dynamische Klassen + Auto-Match-Warnung** — Festliste ablösen.
6. **Grafik Stufe 2** (Fleetyards-Silhouette) — optional.

Schritte 1–3 weitgehend ohne Migration/Breaking-Change.

## 7. Offene Entscheidungen (vor Umsetzung klären)

- **Rollen-Taxonomie** für Role-Needs: feste kleine Liste (fps/fighter-pilot/medic/engineer/gunner)
  oder frei pro Op definierbar?
- **Auto-Match**: nur Warnung (Empfehlung) oder harte Sperre? (Vorschlag: Warnung.)
- **Squad-Bündelung**: Operator-Drag (wie Seat-DnD) reicht, oder zusätzlich Auto-Vorschlag
  (gleiche Rolle → ein Squad)?
- **Fleetyards-Integration** jetzt (Stufe 2) oder später? Lizenz/Rate-Limit prüfen.
- **`category` ↔ Klassen-Mapping** zentral in `composition.ts` (mit composition-rebuild-plan teilen).

---

*Erstellt 2026-06-08. Reine Planung — nichts implementiert. Konsolidiert die Join-/Needs-Themen aus
composition-rebuild-plan.md + FR-P1-eventcreation-simplification.md.*
