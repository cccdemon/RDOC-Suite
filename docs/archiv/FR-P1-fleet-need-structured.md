# FR-P1 — Fleet-Need Redesign (strukturierte Bedarfe statt Freitext)

> **FeatureRequest, Prio 1.** **Status:** Plan, **kein Code**. Entscheidungen User 2026-06-09.
> **Ersetzt** das Freitext-`category/label`-Requirement-Modell aus
> [FR-P1-fleet-needs-and-guided-join.md](FR-P1-fleet-needs-and-guided-join.md). **Nicht
> abwärtskompatibel**, aber alte Requirements werden automatisch migriert.
> **Baut auf:** CQB-Squads mit `targetSize` + Direkt-Join (Commit `ee98350`, 2026-06-09) +
> Fleetyards-Sync (`FleetyardsShip`, FR-P1 §6).

## Problem

Der Fleet-Need ist heute Freitext: `CompositionRequirement(category, label, count)` mit einem
"What do you need"-Feld. Der Operator muss frei beschreiben, was gebraucht wird — unklar, redundant
(ergibt sich aus Mission + Schiffsklasse) und nicht maschinell auswertbar.

## Zielbild (User-Vorgaben 2026-06-09)

Der Operator gibt **keinen** Freitext mehr ein. Drei **strukturierte** Bedarfsarten:

| Bedarf | Eingabe | Einheit / Gruppierung | Größe |
|---|---|---|---|
| **Ship-Need** | Schiffstyp(en) per **Mehrfachauswahl**; jeder gewählte Typ = **genau 1 Schiff** | Schiff agiert **solo** (kein Squad) | Crew-Sitze aus Schiffsdaten |
| **Fighter-Need** | Anzahl **Squads** (z.B. "3 Squads") | Fighter agieren als **„Wingman + Wingman"** | Squad = **2** |
| **CQB-Need** | Anzahl **FPS-Teams** (z.B. "5 Teams") | CQB-Team | immer **4 oder 5** |

- **Keine** "What do you need"-Beschreibung. Maximal **eine optionale „Details"-Zeile** pro Eintrag.
- Schiffstypen kommen **aus Fleetyards** (size × career × role), nicht handgepflegt.
- „Mehrfachauswahl = je 1": für 2 Gunships den Typ 2× hinzufügen (jede Anforderung = 1 Hull).

## Datenmodell (Vorschlag)

`CompositionRequirement` wird strukturiert (Freitext `category`/`label` raus, neue Felder rein):

```prisma
model CompositionRequirement {
  id        String  @id @default(cuid())
  groupId   String
  needType  String  // "ship" | "fighter_squad" | "cqb_team"
  shipType  String? // Fleetyards-Typ-Slug (nur needType=ship), z.B. "heavy_fighter","gunship"
  count     Int     @default(1) // ship: immer 1; fighter_squad/cqb_team: Anzahl Squads/Teams
  squadSize Int?    // fighter_squad=2, cqb_team=4|5; ship=null
  details   String? // optionale Detailzeile (ersetzt label/category)
  order     Int     @default(0)
  // ... bestehende Relationen (fleetUnits) bleiben
}
```

**Squads/Teams** (fighter + CQB) werden als `CompositionGroup(kind=squad|fighter_squad)` mit
`targetSize` materialisiert — **dieselbe Mechanik wie das gerade gebaute CQB-Join** (Spieler treten
direkt bei, kapazitätsgeprüft). Ein `fighter_squad`-Need mit `count=3` → 3 Gruppen à `targetSize=2`.
Ein `cqb_team`-Need mit `count=5, squadSize=4` → 5 Gruppen à `targetSize=4`.

**Ship-Need** bleibt hull-/sitzbasiert: ein akzeptiertes Schiff des Typs erfüllt den Need; Spieler
claimen die Crew-Sitze (bestehendes SeatAssignment-System).

### Offene Modell-Frage
- Fighter-Squads: treten Spieler als **Pilot bei** (jeder bringt eigenen Fighter) → Gruppe à 2
  Piloten? Oder zählt nur „2 Fighter-Hulls"? Annahme: **2 Pilot-Slots** (Join wie CQB), Schiff egal.
- Werden Squads/Teams **eager** beim Anlegen des Needs materialisiert, oder **lazy** beim ersten
  Beitritt? Annahme: **eager** (sichtbare leere Teams zum Beitreten), passend zum Join-Flow.

## Migration alt → neu (automatisch, nicht abwärtskompatibel)

Daten-Migration (SQL + Backfill-Skript) über bestehende `CompositionRequirement`:
- `category`/`label` enthält `fps`/`ground`/`cqb` → `needType=cqb_team`, `squadSize=5` (default),
  `count` = altes `count` (oder 1).
- `category` enthält `fighter`/`jäger`/`snub` → `needType=fighter_squad`, `squadSize=2`.
- sonst → `needType=ship`, `shipType` aus `label`/`category` per Fleetyards-Fuzzy-Match (Fallback:
  `null` = „beliebiges Schiff"), `count=1` pro Hull (alte `count>1` → in `count` Hull-Anforderungen
  aufsplitten).
- `details` = altes `label`, falls informativ.
Migration in eigenem Schritt + idempotentes Backfill (Pattern wie frühere Heal-Skripte).

## Operator-UI (Need-Editor)

Drei kompakte Blöcke statt Freitext-Tabelle:
1. **Ships**: Multiselect der Fleetyards-Typen (ohne Fighter) → Chips „je 1"; Typ mehrfach = mehr Hulls.
2. **Fighter squads**: Zahl-Input „N Squads" (Squad = 2).
3. **CQB teams**: Zahl-Input „N Teams" + Größe 4/5.
- Pro Eintrag optional **eine** Detailzeile. Kein „What do you need".

## Spieler-UI (Join)

- **Ship-Need** → Schiff anbieten / Crew-Sitz claimen (bestehend).
- **Fighter-/CQB-Squads** → „Join a squad/team"-Karte (bereits gebaut für CQB) — auf Fighter-Squads
  erweitern. Voller Squad = „Full", eigener = „You're in".

## Manage-Bereich: Verbände & Einbettung (User-Vorgaben 2026-06-09)

Im Operator-Manage-View, per **Drag & Drop**:
1. **Verbände bilden** — angemeldete/akzeptierte Schiffe zu einem **Verband** zusammenführen
   (z.B. „Task Force Alpha"). Modell: neue Entität `Formation` (oder `CompositionGroup(kind=formation)`)
   gruppiert mehrere `FleetUnit(ship)`. Schiff kann max. in einem Verband sein (`formationId` auf
   FleetUnit, nullable). Reines Operator-Konstrukt, kein Spieler-Join.
2. **FPS-Team → Schiff einbetten** — ein CQB-Team (`CompositionGroup(kind=squad)`) in ein Trägerschiff
   stecken (**alles außer Fighter**). Modell: `CompositionGroup.carrierUnitId` (→ FleetUnit ship).
   Drop eines Teams auf ein Schiff setzt den Carrier; Anzeige „rides in <Schiff>". Gate: Zielschiff ist
   `unitType=ship` und **kein Fighter** (Fleetyards-Klasse).
3. **Fahrzeug → Schiff einbetten mit Passprüfung** — bestehende `carrierUnitId`-Mechanik für
   `unitType=vehicle` um eine **Fit-Prüfung** erweitern: passt das Fahrzeug in den
   Vehicle-/Cargo-Bay des Schiffs? Datenquelle Fleetyards (Vehicle-Größe vs. Schiff-Bay/Hardpoints
   bzw. cargo grid). Drop schlägt fehl mit klarer Meldung, wenn es nicht passt. (Heute existiert
   `addVehicleForm` + `shipCanCarryVehicle` ohne echte Größenprüfung.)

Alle drei: Drag&Drop im Manage-View; Backend-Routen setzen `formationId`/`carrierUnitId` mit
serverseitiger Validierung (Fighter-Ausschluss, Fit-Check). Anzeige als verschachtelte Roster-Karten.

## Umsetzungsschritte (Plan)

1. Schema: `CompositionRequirement` strukturieren + `CompositionGroup.kind` um `fighter_squad`
   erweitern. Migration + Backfill alt→neu.
2. Fleetyards-Typ-Taxonomie ableiten (size × career × role) → Auswahlliste.
3. Need-Service: Needs anlegen/ändern; Squads/Teams eager materialisieren (`targetSize`).
4. Operator-UI Need-Editor (3 Blöcke).
5. Spieler-Join für Fighter-Squads (CQB-Join generalisieren).
6. Fleet-Needs-Board (Hull/Fighter/CQB getrennt, Soll/Ist) auf neues Modell umstellen.
7. **Manage Drag&Drop**: (a) Verbände (`Formation`/`formationId`), (b) FPS-Team→Schiff
   (`CompositionGroup.carrierUnitId` + Fighter-Ausschluss), (c) Fahrzeug→Schiff mit Fit-Check
   (Fleetyards-Größen). Je eine Backend-Route + Validierung + verschachtelte Roster-Anzeige.
8. Alte Freitext-Pfade entfernen (Code + UI).

## Entschieden (2026-06-09)
- Ship-Menge: **Multiselect = je 1**. · Typen: **aus Fleetyards**. · Fighter-Squad = **2**. ·
  Kein Freitext-Bedarf; max. 1 Detailzeile. · Alt→Neu **auto-migriert**.
- **Fighter-Join: jeder bringt seinen eigenen Fighter** → Squad = **2 Pilot-Slots**, jeder Slot =
  ein Pilot mit eigenem Fighter-Hull (kein reiner Zähler). Join wie CQB (kapazitätsgeprüft, =2).
- **Squads/Teams eager materialisiert**: leere Teams sind sichtbar und beitretbar (nicht lazy).
- **CQB-Team-Größe: Default 4, erweiterbar bis max 8** (Operator kann pro Team hochsetzen).
  → `clampSize` Squad-Range bleibt 1..24, aber CQB-UI-Default 4, Vorschlag/Max 8.

## Noch offen (klein, beim Bau entscheidbar)
- Fleetyards-Typ-Granularität (welche Achsen size × career × role die Auswahlliste ergeben).
- Backfill-Heuristik-Feinschliff für bestehende Freitext-Requirements.
