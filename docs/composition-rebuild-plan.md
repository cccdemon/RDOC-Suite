# Composition-Rebuild — Plan

> Status: **Planungsdokument, kein Code geändert.** Umsetzung erst nach Freigabe.
> Auslöser: Composition-Teil "stellenweise unlogisch / nicht intuitiv".
> Priorisierte Pain-Points (User): (1) Darstellung/Übersicht, (2) Zuordnung Units→Requirement,
> (3) Gruppen/Requirements-Struktur.

## 1. Ist-Zustand

### Datenmodell (`prisma/schema.prisma`)

```
Operation 1───* CompositionGroup 1───* CompositionRequirement 1───* FleetUnit
                (name, order)          (category, label,            (requirementId?, unitType,
                                        count, note, order)           shipId?, status, …)
```

- `CompositionGroup` (Z.318): nur `name` + `order`.
- `CompositionRequirement` (Z.328): `category` (fixe Liste), `label`, `count`, `note`, `order`.
- `FleetUnit.requirementId` (Z.373): optionaler Verweis auf den "Slot", den die Unit füllt.
- `Ship` (Z.170) hat `size` (Small/Medium/Large/Capital/Vehicle), `career`, `role`, `min/maxCrew` —
  **wird aktuell nicht** mit `requirement.category` abgeglichen.

### Kategorien (`pages.ts:626`)

`capital, subcapital, fighter, support, ground, transport, mining, salvage, exploration, any` —
freitext-artige Taxonomie, unabhängig von `Ship.size`/`career`/`role`.

### UI-Flow

- **Management** (`pages.ts:639` `groupsSection`): Fleetoperator legt erst eine *Gruppe* an
  (toggle-form), dann je Gruppe *Requirements* (zweites toggle-form mit label/category/count/note).
  Zwei Verschachtelungsebenen, mehrere versteckte Formulare.
- **Zuordnung** (`pages.ts:806` `registerForm`, Slot-Select `:893`): der **Captain** wählt beim
  Registrieren seiner Unit optional einen Slot aus `availableSlots` (`:810`) — ein flaches Dropdown
  `"Gruppe: Label (gefüllt/count)"`. Es gibt **keine** Validierung, ob der gewählte Slot zum
  Schiffstyp passt; Leader können Units nachträglich nur über das Slot-Select der Unit umhängen
  (`pages.ts:1810`).
- **Anzeige** (`groupsSection` + fleetPanel ~`:1929`): pro Requirement `gefüllt/count` + Unit-Cards.
  Overview-Metrik `Compositions: filled/total` (`pages.ts` Hero-Bar) summiert nur grob über alle
  Requirements (count vs. non-rejected units).

### Routes (`routes/api.ts`)

- `POST /api/ops/:id/groups` (`:1087`), `…/groups/:groupId/delete` (`:1110`)
- `POST /api/ops/:id/groups/:groupId/requirements` (`:1130`), `…/requirements/:id/delete`
- Unit-Registrierung setzt `requirementId` aus dem Formular.

## 2. Probleme (warum unlogisch)

| # | Pain | Konkret |
|---|------|---------|
| P1 | **Darstellung** | Kein Soll/Ist auf einen Blick pro Kategorie. „filled/total" ist eine Zahl ohne Aufschlüsselung; offene Slots sieht man nur durch Scrollen durch alle Requirements. |
| P2 | **Zuordnung** | Captain muss selbst den richtigen Slot raten; keine Prüfung Schiff↔Kategorie. Leader hat kein zentrales „diese Unit in diesen Slot"-Werkzeug (nur pro-Unit-Select). Schiffe ohne Slot (`unslottedUnits`, `:449`) hängen lose daneben. |
| P3 | **Struktur** | Zwei Pflicht-Ebenen (Gruppe *und* Requirement) für oft simple Bedarfe; `category` ist eine zweite, parallele Taxonomie neben `Ship.size/career/role` und wird nirgends genutzt. Viel Klick-Overhead (toggle-forms je Gruppe). |

## 3. Soll-Konzept

Leitidee: **Bedarf (Soll) und Belegung (Ist) als eine Matrix**, Zuordnung **leader-getrieben mit
Auto-Vorschlag** aus Schiffsdaten, Struktur **optional einstufig** (Gruppe = reine Kategorisierung).

### 3.1 Darstellung (P1) — „Composition Board"

Eine Übersicht pro Op (eigener Abschnitt im Overview-/Fleet-Tab):

```
KATEGORIE        SOLL   IST   OFFEN   BELEGUNG
Capital            2     1      1     [Idris ✓] [____ offen]
Fighter Wing       6     4      2     [Gladius][Arrow][Hornet][Gladius] [__][__]
FPS Boarding       2     2      0     [Alpha Squad][Bravo Squad]
─────────────────────────────────────────────
GESAMT            10     7      3
```

- Soll/Ist/Offen je Requirement **und** als Summe. Offene Slots als leere „Chips".
- Farbe: voll = grün, teilbesetzt = gelb, leer = grau. (nutzt bestehende `tag-*`-Klassen.)
- Ersetzt die grobe Hero-Metrik durch verlinkte Aufschlüsselung; ergänzt die neuen
  Ship/FPS-Seat-Metriken (bereits umgesetzt).

### 3.2 Zuordnung (P2) — leader-getrieben + Auto-Match

- **Pro offenem Slot ein „Assign"-Picker** (analog Seat-Assign, `pages.ts:1606`): Leader wählt aus
  den registrierten, noch nicht zugeordneten Units (`unslottedUnits`).
- **Auto-Match-Vorschlag**: beim Registrieren/Zuordnen wird anhand `Ship.size`/`career`/`role`
  der **am besten passende** Slot vorgeschlagen (Mapping-Tabelle Kategorie→Schiffsattribute,
  s. 3.4). Captain kann übersteuern; Leader sieht „passt nicht zur Kategorie"-Hinweis statt
  harter Sperre.
- **Drag-&-Drop optional** (es gibt bereits `data-drop-seat` Crew-DnD, `pages.ts:1584` — gleiches
  Muster für Unit→Slot wiederverwendbar).
- Klare „Unzugeordnet"-Spalte mit One-Click-Zuweisung in offene Slots.

### 3.3 Struktur (P3) — Gruppe optional, Kategorie = Schiffstaxonomie

- **Gruppe wird optional** (eine Default-Gruppe „Fleet"): einfache Ops kommen ohne manuelle
  Gruppenanlage aus; Requirements können direkt an die Op (Default-Gruppe) hängen.
- **`category` an `Ship`-Taxonomie koppeln**: Auswahl aus `Ship.size` + `career`/`role` statt
  freier Parallel-Liste. Dadurch wird Auto-Match (3.2) erst sinnvoll. FPS-Squad-Requirements
  bekommen eine eigene, klar getrennte Kategorie (`fps`).
- **Schnellanlage**: ein Inline-„+ Slot"-Feld (Label + Anzahl + Kategorie) ohne separates
  Gruppen-Setup; Gruppen nur für große Ops als Bündelung.

### 3.4 Kategorie ↔ Schiff-Mapping (Vorschlag)

| Kategorie | Match-Regel (Ship) |
|-----------|--------------------|
| `capital` | `size = Capital` |
| `subcapital` | `size = Large` |
| `fighter` | `role ~ Fighter` ODER `size = Small & career = Combat` |
| `support` | `career = Support` |
| `transport` | `career = Transport` |
| `mining/salvage/exploration` | `career = <gleich>` |
| `fps` | `unitType = squad` (kein Schiff) |
| `any` | alles |

Mapping als Tabelle in `services/seats.ts` o.ä.; nur **Vorschlag/Warnung**, keine Sperre.

## 4. Datenmodell-Änderungen

Minimal-invasiv (bestehende Daten bleiben gültig):

- `CompositionGroup`: keine Pflicht mehr → beim ersten Requirement ohne Gruppe eine Default-Gruppe
  „Fleet" lazy anlegen (kein Schema-Change nötig, nur Logik). **Alternativ** `groupId` auf
  `CompositionRequirement` optional machen (Schema-Change + Migration).
- `CompositionRequirement.category`: Wertebereich an Schiffstaxonomie angleichen. **Kein**
  Spaltentyp-Change nötig (bleibt `String`), nur UI-Auswahl + Validierung.
- Optional neu: `CompositionRequirement.shipSize`/`role`-Filter-Felder, falls feineres Auto-Match
  gewünscht. (Entscheidung offen — siehe §7.)

→ Voraussichtlich **eine** kleine Migration (nur falls `groupId` optional wird). Sonst rein
Code-/UI-seitig.

## 5. Betroffene Dateien

- `web/pages.ts`: `groupsSection` (`:639`), `registerForm` Slot-Select (`:893`), fleetPanel
  Composition-Render (`~:1929`), neue „Composition Board"-Komponente, Auto-Match-Hinweise.
- `routes/api.ts`: Requirements-Routes (Default-Gruppe-Logik), neue Route „Unit→Slot zuweisen"
  (Leader), Auto-Match-Berechnung beim Registrieren.
- `services/seats.ts` (oder neu `services/composition.ts`): Kategorie↔Schiff-Mapping +
  `suggestSlot(ship, op)`-Helper.
- `prisma/schema.prisma` + Migration: nur falls `groupId` optional wird.

## 6. Rollout-Reihenfolge

1. **Mapping-Helper** (`composition.ts`) + Tests der Match-Logik (reine Funktion, risikolos).
2. **Composition Board** (nur Anzeige, P1) — sofortiger UX-Gewinn, keine Datenänderung.
3. **Leader-Assign + Auto-Vorschlag** (P2) — neue Route + Picker, nutzt §1-Daten.
4. **Struktur-Vereinfachung** (P3) — Default-Gruppe + Kategorie-Auswahl an Schiffstaxonomie;
   ggf. Migration für optionales `groupId`.
5. Alte freie `CATEGORIES`-Liste entfernen, wenn Schritt 4 live ist.

Schritte 1–3 sind ohne Migration und ohne Breaking-Change deploybar.

## 7. Offene Entscheidungen (vor Umsetzung klären)

- **Gruppen behalten oder ganz weg?** Vorschlag: behalten, aber optional (Default-Gruppe). Alternative:
  Gruppen-Konzept streichen, nur flache Slot-Liste je Op.
- **Auto-Match: nur Warnung oder harte Sperre?** Vorschlag: nur Warnung (Flexibilität für
  Edge-Cases).
- **Eigene Kategorie-Felder am Requirement** (`shipSize`/`role`) für feineres Match — oder reicht
  die grobe `category`-Tabelle? (Migration-Frage.)
- **Wo lebt das Composition Board** — Overview-Tab, Fleet-Tab, oder eigener „Composition"-Tab?

---

**Nächster Schritt:** Freigabe der offenen Punkte (§7), dann Umsetzung in der Reihenfolge §6.
Empfehlung: mit Schritt 1+2 (Mapping + Board) starten — größter Übersichts-Gewinn, null Risiko.
