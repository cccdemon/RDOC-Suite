# UI/UX-Workflow-Redesign – Implementierungshandoff für Claude Code Opus

> **Adressat:** Claude Code Opus
> **Stand:** 22. August 2026
> **Scope:** `apps/fleetplanner-web` – Informationsarchitektur, Menüführung, visuelle Hierarchie,
> Event-Erstellung, Operationsdetail und Event-Verwaltung
> **Nicht automatisch im Scope:** neue Backend-Fachlogik, neue Datenmodelle, Änderung von Rollen,
> Discord-Semantik oder API-Verträgen
> **Oberste Bedingung:** Keine heute erreichbare Funktion, Berechtigung, URL, Mutation oder
> alternative Bedienmöglichkeit darf durch das Redesign verloren gehen.

---

## 1. Auftrag

Überarbeite den Fleetplanner so, dass er nicht mehr wie eine Sammlung gleich gewichteter Karten und
technischer Module wirkt, sondern wie ein zusammenhängendes Werkzeug für den vollständigen
Lebenszyklus einer Operation:

1. Operation finden oder anlegen.
2. Inhalt und Bedarf planen.
3. Operation freigeben und über Discord verteilen.
4. Teilnehmer, Einheiten, Sitze, CQB und Verbände organisieren.
5. Kommunikation, Fragen, Kommandanten und Subraum koordinieren.
6. Operation durchführen, abschließen, wiederholen oder als Vorlage sichern.

Das Redesign darf Layout, Navigation, Typografie, Karten, Abstände, responsive Struktur und
Interaktionsmuster ändern. Es darf Funktionen neu gruppieren, aber nicht entfernen oder in einem
unauffindbaren Sammelbereich verstecken.

### 1.1 Erfolgskriterien

- Ein neuer Operator versteht ohne Handbuch, was der nächste sinnvolle Schritt ist.
- Crew und Gäste sehen eine ruhige, lesbare Operationsseite ohne Admin-Überladung.
- Operatoren wechseln eindeutig zwischen Teilnehmeransicht und Verwaltungsarbeitsplatz.
- Status, Server, Rolle und ungespeicherte Änderungen sind jederzeit verständlich.
- Jeder eigenständige Zustand bleibt per URL, Reload und Browsernavigation reproduzierbar.
- Desktop und Mobile bilden dieselbe fachliche Struktur ab.
- Touch und Tastatur besitzen vollwertige Alternativen zu Drag-and-drop.
- Die Oberfläche priorisiert offene Arbeit statt bloßer Bestandszahlen.

### 1.2 Nicht verhandelbare technische Grenzen

- Serverseitige Autorisierung bleibt maßgeblich. Client-Gates sind nur UX.
- `User.role` ist global; dort ist nur `superadmin` fachlich besonders. Guild-Rechte kommen aus
  `GuildMembership.role` (`fleetoperator | crew`).
- Kein erfundener Guild-Rang „Captain“. Captain ist eine Rolle innerhalb einer Operation.
- Discord-Snowflakes bleiben Strings.
- Bestehende `/api/v1`-Verträge nicht beiläufig ändern.
- Legacy-Routen und Deep Links erhalten oder explizit, query- und hash-erhaltend umleiten.
- Kein Drag-and-drop als einziger Bedienweg.
- Bestehende Fremdänderungen im Dirty Worktree respektieren.
- Vor jeder Änderung Mergelog-Regel aus `CLAUDE.md` befolgen.

---

## 2. Ausgangsbefund

### 2.1 Was bereits gut funktioniert

- Eigenständige RDOC-Identität mit glaubwürdigem Operations-/Sci-Fi-Charakter.
- Konsistente dunkle Grundfläche, Cyan- und Kupferakzente.
- Desktop-Rail und Mobile-Drawer rendern dasselbe Navigationsmodell.
- Persistenter Serverkontext ist grundsätzlich vorhanden.
- Operationsansichten und Operator-Unterbereiche sind URL-basiert.
- Operatorfunktionen sind weiterhin im Komponentenbaum vorhanden.
- Bestehendes Crew-zu-Sitz-Drag-and-drop besitzt Klick- und Tastaturalternativen.
- Wizard besitzt Validierung, Entwurfsschutz und Post-Create-Funktionen.

### 2.2 Zentrale UX-Probleme

1. **Flache visuelle Hierarchie:** Objekt, Formular, Erklärung, Statistik und Arbeitsbereich sehen zu
   ähnlich aus. Fast alles liegt in einer grauen, abgerundeten Karte.
2. **Zu viel technische Typografie:** Monospace, Versalien und sehr kleine Labels werden auch dort
   verwendet, wo Nutzer lesen oder Entscheidungen treffen müssen.
3. **Zu geringe Sekundärtext-Kontraste:** Besonders mobil sind längere Erklärungen anstrengend.
4. **Eventseite und Arbeitsplatz vermischt:** Operatoren müssen durch die Teilnehmeransicht scrollen,
   bevor die Verwaltung beginnt.
5. **Komponenten statt Workflow:** Die Operator-Konsole gruppiert vorhandene Panels, führt aber nicht
   entlang Planung → Freigabe → Besetzung → Durchführung → Abschluss.
6. **Doppelte Navigationsebene:** Hauptgruppen und Untertabs wirken wie zwei konkurrierende Tabsets.
7. **Wichtige Funktionen versteckt:** Bedarfe erscheinen innerhalb Board/CQB statt als klarer
   Arbeitsschritt.
8. **Mobile Kartenwand:** Öffentliche Startseite und lange Detailseiten erzeugen extrem lange Folgen
   gleichartiger Karten ohne progressive Offenlegung.
9. **Unklare Aktionshierarchie:** Primäre, sekundäre und destruktive Aktionen konkurrieren teilweise.
10. **Navigation verspricht unberechtigte Ziele:** „Neue Operation“ und Vorlagen sind nicht überall
    konsistent auf tatsächliche Operator-Mitgliedschaften gegated.

### 2.3 Vor Implementierung zu korrigierende Funktionsrisiken

- `PRIMARY_ACTION` `/ops/new` muss `needsManagedGuild` verwenden, nicht nur `auth`.
- `/templates` muss entsprechend der Produktentscheidung Operator-only sein oder eine echte
  read-only Gast-/Crew-Sicht bekommen. Aktuell führt das Menü Nicht-Operatoren in einen Abweiszustand.
- Ein ungültiges/fremdes `?guild=` darf nicht zwischen URL- und Fallback-State oszillieren. URL-Guild
  vor Übernahme gegen zulässige Mitgliedschaften prüfen und ungültige URL kanonisch ersetzen.
- Alte absolute Links `/fleetplanner/ops/...` im nicht eingebetteten `OperatorPanel` entfernen oder
  auf router-/base-path-sichere Links migrieren.
- Grün laufende Tests dürfen keine bekannten, ungemockten Requests als Dauerrauschen akzeptieren.

---

## 3. Nutzer und Jobs-to-be-done

### 3.1 Gast

Ziele:

- Verstehen, was der Fleetplanner leistet.
- Öffentliche Operationen finden und lesen.
- Termin, Treffpunkt, Bedarf und Teilnahmeoption verstehen.
- Erkennen, wann eine Anmeldung nötig ist.

Nicht zeigen:

- leere Konto-/Server-/Operatorziele;
- interne Statussteuerung;
- technische Diagnose oder API-Dokumentation in der Hauptnavigation.

### 3.2 Crew

Ziele:

- passende Operation finden;
- Teilnahmezustand sofort erkennen;
- flexibel anmelden, Schiff/Fahrzeug/CQB anbieten;
- Sitz claimen oder freigeben;
- eigenes Angebot zurückziehen;
- Verspätung pflegen;
- Fragen stellen;
- Briefing, Dokumente, Links, Streams und Voice-Zugang finden;
- Hangar und Konten verwalten.

### 3.3 Fleetoperator

Ziele:

- Operation schnell anlegen;
- Entwurf vollständig und veröffentlichungsbereit machen;
- Discord-Ziel und Partnerverteilung kontrollieren;
- Bedarf definieren;
- Einheiten annehmen/ablehnen und Personen zuweisen;
- offene Arbeit erkennen;
- Kommandanten, Fragen und Voice koordinieren;
- Operation starten, sperren, abschließen oder absagen;
- Serie und Vorlage verwalten.

### 3.4 Superadmin

Zusätzlich:

- Instanz, Nutzer und Server verwalten;
- Systemzustand und Logs prüfen.

Superadmin-Funktionen dürfen nicht mit der Event-Verwaltung unter dem generischen Begriff „Admin“
vermischt werden. Innerhalb einer Operation heißt der Bereich „Verwaltung“; „Administration“ bleibt
der globalen Instanzadministration vorbehalten.

---

## 4. Soll-Informationsarchitektur

### 4.1 Globale Navigation

```text
+ Neue Operation                          nur mit verwaltbarer Guild

OPERATIONEN
├── Übersicht                            /operationen
├── Umfragen                             /polls
└── Vorlagen                             /templates, nur Operator

FLOTTE
├── Mein Hangar                          /konto/profil bzw. definierter Hangar-Deep-Link
├── Org-Flotte                           /guilds/fleet, aktiver Server
└── Schiffsdatenbank                     /ships

DISCORD-SERVER                           angemeldet
├── Serverübersicht                      /guilds
└── [Aktiver Server ▾]
    ├── Server-Einstellungen             /guilds/settings, Operator
    ├── Partnerschaften                  /guilds/partnerships, Operator
    └── Diagnose                         /guilds/diagnostics, Operator

KONTO                                   angemeldet
└── Konto                                /konto mit internen Tabs

HILFE
├── Startseite                           /start, sekundär
├── Handbuch                             /handbuch
├── SC-Tools                             /sc-tools
└── Feedback                             /konto/feedback, angemeldet

ADMINISTRATION                          nur Superadmin
├── Admin-Konsole                        /admin
└── System & Logs                        /admin/system

FOOTER
├── API-Dokumentation                    /api-docs
└── Rechtliches                          /rechtliches
```

### 4.2 Navigationsregeln

- Orte stehen im Menü, Aktionen in Buttons.
- „Neue Operation“ ist eine Aktion, kein normaler Menüort.
- Aktiver Hauptpunkt für jede `/ops/*`-Route ist „Operationen“.
- Serverlinks tragen `?guild=`.
- Serverpicker zeigt nur Mitgliedschaften; Verwaltungsseiten nur verwaltbare Guilds.
- Ein nicht verwaltbarer aktiver Server darf die Managementlinks nicht auf einen falschen Kontext
  zeigen lassen. Entweder Links ausblenden oder auf die erste verwaltbare Guild wechseln – Verhalten
  explizit testen.
- Mobile Drawer übernimmt Gruppen, Gates, Reihenfolge und Serverpicker exakt.
- Drawer braucht Overlay, Escape, Fokusfalle, Rückfokus und Schließen nach Navigation.

---

## 5. Operationsübersicht

### 5.1 Seitenkopf

```text
Operationen
Finde eine Operation oder plane eine neue.

[+ Neue Operation]                       nur Operator
```

Darunter ein echter View-Switch:

```text
[Liste] [Kalender] [Agenda]
```

Filter in einer klaren zweiten Zeile:

```text
Typ [Alle ▾]   Stream [Alle ▾]   Status [Aktiv ▾]   [Vergangene anzeigen]
```

Alle Zustände in der URL erhalten: `view`, `typ`, `stream`, `status`, `past`, `m`, `day`.

### 5.2 Operationskachel

Verbindliche Reihenfolge:

1. Status + eigener Teilnahmezustand.
2. Titel.
3. Datum/Uhrzeit.
4. Server/Organisation.
5. System/Treffpunkt.
6. Belegung.
7. sekundäre Aktion, z. B. Discord.

Die gesamte Kachel öffnet genau die Operation. Sekundäre Links stoppen die Kartenaktion.

### 5.3 Leere Zustände

- Aktive Filter benennen.
- „Filter zurücksetzen“ anbieten.
- Bei reinem Vergangenheitsfilter „Vergangene anzeigen“ anbieten.
- Keine generische Meldung „Keine Daten“.

---

## 6. Operationsdetail: zwei eindeutige Modi

### 6.1 Permanenter Objektkopf

Am Anfang jeder Operation:

```text
← Operationen

Operation X
RDOC · Sa., 22.08. · 20:00 · Stanton

[ENTWURF]   18/24 Plätze   3 offene Aufgaben

[Operation ansehen] [Verwalten]           Verwalten nur bei canManage
```

Auf Desktop darf der kompakte Kontextkopf beim Scrollen sticky werden. Auf Mobile nur Titel,
Status und Moduswechsel sticky halten, damit nicht zu viel Höhe verloren geht.

### 6.2 Modus „Operation ansehen“

Dies ist die echte Teilnehmeransicht, nicht eine vereinfachte Fake-Vorschau. Reihenfolge:

1. Status, Termin, Treffpunkt und Primäraktion.
2. Briefing/Beschreibung.
3. Bedarf und Teilnahmeoptionen.
4. Flotten-/CQB-Board.
5. Dokumente und Ressourcenlinks.
6. Fragen und Antworten.
7. Streams.
8. Voice/Subraum, wenn verfügbar.

Operatoren bekommen optional einen rein clientseitigen Vorschauumschalter:

```text
Ansicht prüfen als: [Gast] [Crew] [Ich]
```

Deutlich als Vorschau kennzeichnen. Keine echten Rechte ändern und keine Mutationen unter falscher
Perspektive erlauben.

### 6.3 Modus „Verwalten“

Die Verwaltung ist ein eigener Arbeitsplatz innerhalb derselben Route. Sie steht nicht mehr unter
der vollständigen Teilnehmerseite.

Primärnavigation:

```text
[Planung] [Besatzung & Flotte] [Kommunikation] [Verwaltung]
```

Empfohlenes URL-Modell:

```text
/ops/:id?mode=manage&section=planning&sub=details
```

Bestehende `?op=fleet|formations|cqb|eckdaten|cover|commanders|voice|qa|admin`, `tab=`, `section=`
und `sub=` weiterhin akzeptieren. Während der Migration keine Links brechen. Eine kanonische URL nur
einführen, wenn Weiterleitungen Query, Hash und Flash vollständig bewahren.

Hauptbereiche sind Navigation, nur die sichtbaren Unteransichten sind Tabs. Nicht zwei verschachtelte
Tablists auf dasselbe Panel zeigen lassen.

---

## 7. Event-Verwaltung – verbindliche Funktionszuordnung

### 7.1 Planung

Unteransichten:

```text
[Eckdaten] [Briefing & Medien] [Freigabe & Verteilung]
```

**Eckdaten**

- Titel
- Typ
- Startzeit
- System
- Treffpunkt
- Sichtbarkeit
- Stream-Event
- Voice/Subraum aktivieren, sofern fachlich weiterhin ein Op-Feld
- Autosave-Zustand pro Feld

**Briefing & Medien**

- Beschreibung/Briefing
- Ressourcenlinks hinzufügen, bearbeiten, entfernen und – sofern API vorhanden – sortieren
- Cover erzeugen, Editor öffnen, Cover löschen
- Dokumente hochladen und löschen

**Freigabe & Verteilung**

- aktueller Status
- Discord-Veröffentlichungszustand
- Zielkanal/Ankündigung
- Partnerverteilung
- verständliche Erklärung der Folgen von „Offen“, „Gesperrt“ und „Abgesagt“

Status darf zusätzlich als kompakte Schnellsteuerung im Objektkopf erscheinen. Die ausführliche
Erklärung und Veröffentlichung gehören trotzdem hierher.

### 7.2 Besatzung & Flotte

Unteransichten:

```text
[Offene Arbeit] [Board] [Bedarfe] [CQB] [Verbände]
```

**Offene Arbeit** ist das Standardziel für Operatoren:

- anstehende Einheiten;
- flexible Anmeldungen;
- Discord-Interessenten;
- unbekannte Discord-Nutzer;
- unbesetzte Pflichtsitze;
- lokale Fehler/Pending-Zustände.

**Board**

- akzeptierte Einheiten und Sitze;
- Einheiten annehmen/ablehnen;
- Einheiten bearbeiten, umbenennen und Captain-Notiz, soweit vorhanden;
- Personen einem Sitz zuweisen/verschieben/entfernen;
- eigenes Crew-Angebot zurückziehen;
- Verspätung;
- Partnerherkunft sichtbar;
- Event-Interest-Zuweisung.

**Bedarfe**

- Schiffsbedarfe;
- Fighter-Squads;
- CQB-Teamanzahl/-größe;
- Requirements bearbeiten;
- keine versteckte Zweitanzeige desselben Editors unter Board und CQB.

**CQB**

- Teams, Soldaten, Größe, Träger und vorhandene Zuordnungsaktionen;
- keine UI für Backend-Funktionen vortäuschen, die nicht existieren.

**Verbände**

- vorhandene Formationen und tatsächlich unterstützte Aktionen;
- keine erfundenen Drops.

### 7.3 Kommunikation

Unteransichten:

```text
[Fragen] [Kommandanten] [Voice & Teilnehmer]
```

**Fragen**

- Crew kann Frage stellen;
- Operator sieht offene zuerst und beantwortet sie;
- beantwortete Fragen bleiben nachvollziehbar;
- Badge zählt nur offene Fragen.

**Kommandanten**

- Leader/Kommandanten suchen, ernennen und entfernen;
- Rollenbezeichnung verständlich;
- Guild-/Partnerkontext sichtbar.

**Voice & Teilnehmer**

- Subraum-Status;
- Voice aktivieren/deaktivieren;
- Empfängerzahl und Empfängerverwaltung;
- Join-Link/Store-Link nur wenn konfiguriert;
- nicht den Eindruck vermitteln, Fleetplanner übertrage selbst Audio.

### 7.4 Verwaltung

Unteransichten oder klar getrennte Sektionen:

- Wiederkehrende Serie erstellen/stoppen.
- Als Vorlage veröffentlichen.
- Operation abschließen.
- Operation absagen.
- Operation löschen.

Routineaktionen, Statuswechsel mit hoher Tragweite und irreversible Aktionen räumlich trennen.

```text
Serie
[Serie erstellen] [Serie stoppen]

Vorlage
[Als Vorlage veröffentlichen]

Gefahrenbereich
[Operation absagen] [Operation löschen]
```

Löschen verlangt Bestätigung mit Operationsname. Absagen und Löschen dürfen nicht wie normale
Primärbuttons aussehen.

---

## 8. Vollständige Funktions-Erhaltungsmatrix

Vor dem Umbau aus dem aktuellen Code eine maschinennahe Matrix erzeugen und während der Umsetzung
pflegen. Mindestens folgende Funktionen müssen abgedeckt bleiben:

| Funktion | Heutiger Träger | Neuer Ort | Rolle | Pflichtprüfung |
| --- | --- | --- | --- | --- |
| Op ansehen | `OpDetailPage` | Ansehen | alle nach Sichtbarkeit | Gast/Crew/Operator |
| Op erstellen | `WizardPage` | globale Aktion | Guild-Operator | Gate + Create |
| Vorlage anwenden | `TemplatesPage` | Wizard/Vorlagen | Guild-Operator | CSRF + Ziel-Guild |
| Status ändern | `OperatorConsole` | Freigabe/Objektkopf | `canManage` | alle Statuswerte |
| Eckdaten editieren | `EckdatenForm` | Planung | `canManage` | Autosave/Fehler |
| Ressourcenlinks | `ResourceLinksPanel` | Briefing & Medien | `canManage` | CRUD |
| Cover | `CoverPanel` | Briefing & Medien | `canManage` | Generate/Edit/Delete |
| Dokumente | `DocumentsPanel` | Briefing & Medien | je Aktion | Upload/Delete/Read |
| Bedarfe | `NeedsEditor` | Bedarfe | `canManage` | Ships/Fighter/CQB |
| Einheiten | `OperatorPanel`/Detail | Board | Crew/Manager | Offer/Accept/Reject/Withdraw |
| Sitze | `OperatorPanel`/Detail | Board | Crew/Manager | Claim/Assign/Move/Remove |
| Drag Person→Sitz | `OperatorPanel` | Board | Manager | Maus + Alternative |
| CQB | `OperatorPanel` | CQB | Crew/Manager | vorhandene Aktionen |
| Verbände | `OperatorPanel` | Verbände | Manager | vorhandene Aktionen |
| Fragen stellen | `OpDetailPage` | Ansehen/Fragen | angemeldet | Create |
| Fragen beantworten | `OperatorPanel` | Kommunikation | Manager | Answer |
| Kommandanten | `CommandersPanel` | Kommunikation | Manager | Add/Remove |
| Subraum | `VoicePanel`/Detail | Kommunikation/Ansehen | kontextabhängig | Toggle/Link |
| Streams | `OpDetailPage` | Ansehen | Nutzer/Manager | Add/Delete nach Gate |
| Serie | `OperatorConsole` | Verwaltung | Manager | Create/Stop |
| Vorlage publizieren | `OperatorConsole` | Verwaltung | Manager | Publish |
| Partnerverteilung | Wizard/Partnerships | Freigabe | Operator | Auswahl/Approval |
| Discord-Ankündigung | Wizard | Freigabe/Post-Create | Operator | Channel/Send |

Opus muss diese Tabelle vor Codeänderung gegen `api/client.ts`, `OpDetailPage`, `OperatorConsole`,
`OperatorPanel`, Backend-Routen und Tests vervollständigen. Kein Eintrag darf am Ende ohne neuen Ort
oder bewusste, vom User bestätigte Produktentscheidung bleiben.

---

## 9. Wizard-Zielworkflow

### 9.1 Schritte

```text
1 Eckdaten
2 Briefing & Treffpunkt
3 Bedarf
4 Freigabe & Verteilung
5 Prüfen
6 Erstellt
```

Nur echte Pflichtfelder blockieren. Optionale Angaben als „empfohlen“ markieren.

### 9.2 Verhalten

- Fortschritt zeigt Namen, aktuellen Schritt und Fehlerstatus.
- Direkter Sprung nur zu bereits validierten bzw. zurückliegenden Schritten.
- „Weiter“ validiert lokal und fokussiert ersten Fehler.
- Review-Zeilen führen zurück zum zuständigen Schritt.
- lokaler Entwurf bleibt bis erfolgreicher Erstellung erhalten.
- Guild-Wechsel verwirft keine eingegebenen Inhalte, bereinigt aber guildabhängige Partner-/Channelwahl.
- `beforeunload` nur bei echten ungespeicherten Daten.
- Vorlagenpicker als echtes modales Dialogfenster.

### 9.3 Nach Erstellung

Kein abruptes Teleportieren. Erfolgszustand:

```text
Operation wurde als Entwurf angelegt.

[Flotte planen] [Cover & Dokumente] [Discord ankündigen] [Operation ansehen]
```

Alle heutigen Post-Create-Funktionen erhalten: Cover, Dokumente, Ressourcen, Serie, Ankündigung und
Navigation zur Operation.

---

## 10. Visuelles System

### 10.1 Typografie

- UI-/Body-Schrift für Navigation, Formulare, Beschreibungen und Buttons.
- Monospace nur für Status, Zeit, IDs, technische Metadaten und kurze Eyebrows.
- Keine längeren Fließtexte in Monospace.
- Mindestgröße mobile Fließtexte ungefähr 15–16 px; Metadaten nicht unter gut lesbare 12 px.
- Versalien nur für kurze Kategorien, nicht für vollständige Anweisungen.

### 10.2 Farbe und Kontrast

- RDOC-Dunkelgrund, Cyan und Kupfer beibehalten.
- Textkontrast WCAG AA anstreben.
- Status nie nur farblich vermitteln: Text + optional Icon.
- Cyan = Auswahl/Information, Grün = Erfolg/offen, Gold = Aufmerksamkeit, Rot = Gefahr.
- Primäraktion pro Kontext eindeutig, nicht mehrere gleich starke Akzentbuttons.

### 10.3 Oberflächen

Nur folgende semantische Typen verwenden:

- Objektkachel
- Auswahlkachel
- Informationskarte
- Arbeitskarte
- Formularsektion
- Gefahrenbereich
- leerer/ladender/fehlerhafter Zustand

Nicht jede Textsektion benötigt Hintergrund, Border und Radius. Weißraum und Divider zur Hierarchie
nutzen. Arbeitskarten dürfen dichter sein als Marketingkarten.

### 10.4 Aktionshierarchie

- Primary: genau eine nächste Hauptaktion.
- Secondary: reversible Alternativen.
- Tertiary/Ghost: Navigation und seltene Optionen.
- Danger: ausschließlich destruktiv, räumlich getrennt.
- Icon-only nur mit `aria-label` und Tooltip; wichtige Aktionen bevorzugt mit Text.

---

## 11. Responsive Verhalten

### Desktop ab ca. 1200 px

- feste Rail;
- Inhaltsbreite nutzt Arbeitsfläche;
- Event-Verwaltung optional mit linker Bereichsnavigation und rechter Arbeitsfläche;
- Board/Warteliste darf zweispaltig sein;
- Tabellen bleiben Tabellen, wenn ausreichend Platz.

### Tablet ca. 700–1199 px

- Drawer statt Rail nach vorhandenem Breakpoint;
- Bereichsnavigation horizontal scrollbar oder als kompakte Segmente;
- Arbeitsbereiche einspaltig;
- Statuskopf kompakt sticky.

### Mobile unter ca. 700 px

- keine Desktop-Tabelle erzwingen; Karten-/Disclosure-Darstellung;
- Mindestzielgröße interaktiver Flächen ca. 44 × 44 px;
- Hauptbereiche als Select/Accordion oder horizontaler, sichtbar scrollbarer Switch;
- Unteransichten nicht als zweite gequetschte Tabreihe;
- Primäraktion optional als sticky Bottom Action, ohne Inhalte zu verdecken;
- lange Startseiteninhalte nach 3–5 Kategorien progressiv offenlegen;
- Modals als Bottom Sheet oder Fullscreen-Dialog;
- Drag nicht voraussetzen; Auswahlmodus ist Standard.

---

## 12. Accessibility

- Semantisch korrekte Überschriftenhierarchie, genau ein `h1` pro Seite.
- Breadcrumbs als `nav aria-label="Breadcrumb"`.
- Tabs nur verwenden, wenn echte Tabsemantik vorliegt; pro Tablist passende Panels.
- Roving Tabindex, Pfeiltasten, Home/End und dokumentiertes Aktivierungsmodell.
- Drawer/Dialog: Fokusfalle, Escape, Rückfokus, `aria-modal`, zugänglicher Titel.
- Autosave über höfliche Live-Region melden; Fehler zusätzlich am Feld.
- Dragstatus über Live-Region; Klick-/Tastaturalternative gleichwertig.
- Badges mit Bedeutung: „3 offene Fragen“, nicht nackte „3“.
- Fokus darf nach Mutation oder Reload nicht unerwartet an Seitenanfang springen.
- `prefers-reduced-motion` respektieren.
- Hover darf keine Information enthalten, die Touch/Tastatur nicht erhalten.

---

## 13. Zustände und Feedback

Für jede Mutation:

1. Idle.
2. Pending lokal am Auslöser.
3. Erfolg verständlich und knapp.
4. Fehler lokal plus global, wenn die Aufgabe sonst verloren geht.
5. Rollback bei optimistischer Darstellung.

Autosave:

- „Speichert …“
- „Gespeichert“
- „Nicht gespeichert – erneut versuchen“

Leere Zustände nennen Ursache und nächste Aktion. Ladezustände sollen das erwartete Layout stabil
halten. Keine Vollseiten-Sperre für eine lokale Mutation.

---

## 14. Empfohlene Komponentenarchitektur

Opus soll bestehende Komponenten bevorzugt weiterentwickeln und keine zweite Designbibliothek bauen.
Empfohlene Grenzen:

- `OperationShell`: Breadcrumb, Objektkopf, View/Manage-Modus.
- `OperationContextHeader`: Titel, Guild, Termin, Status, KPI, Aktionen.
- `ManageNavigation`: Hauptbereich + responsive Unteransicht.
- `OpenWorkDashboard`: offene Einheiten, Personen, Fragen, Sitze.
- `SectionHeader`: Titel, Beschreibung, optionale Aktion.
- `ActionBar`: Primary/Secondary/Danger-Hierarchie.
- `SaveState`: zentraler sichtbarer/zugänglicher Autosave-Zustand.
- vorhandene Kartentypen in `ui.tsx` nur behalten, wenn sie tatsächlich genutzt werden.

Navigation und Berechtigungsmetadaten bleiben möglichst datengetrieben. Keine Duplizierung von
Desktop-/Mobile-Menüs oder Rollenlogik in Seitenkomponenten.

---

## 15. Umsetzung in sicheren Phasen

### Phase 0 – Inventar und Sicherungsnetz

1. Dirty Worktree und parallele Änderungen erfassen.
2. Route-to-navigation-Matrix aktualisieren.
3. Funktions-Erhaltungsmatrix vervollständigen.
4. Tests für alle bestehenden Operator-Tabs und Mutationen ergänzen.
5. Screenshots Desktop/Mobile für Ausgangszustand erzeugen.

### Phase 1 – Gates und Kontextfehler

1. Operator-Gate für Create und Templates.
2. ungültige Guild-URL stabilisieren.
3. Base-path-falsche Links beseitigen.
4. Server-/Rollenanzeige vereinheitlichen.

### Phase 2 – OperationShell

1. permanenter Objektkopf;
2. Ansehen/Verwalten-Modus;
3. Breadcrumb und Rückweg;
4. alte URLs weiter auflösen;
5. keine Funktionspanels entfernen.

### Phase 3 – Verwaltungs-IA

1. Planung;
2. Besatzung & Flotte;
3. Kommunikation;
4. Verwaltung;
5. Bedarfe als eigenen Ort;
6. Status-/Gefahrenlogik trennen.

### Phase 4 – Workflow und visuelle Hierarchie

1. Open-Work-Dashboard;
2. Karten reduzieren;
3. Typografie/Kontrast;
4. Aktionshierarchie;
5. Wizard-Post-Create;
6. statusabhängige Hinweise, ohne Funktionen auszublenden.

### Phase 5 – Responsive und Accessibility

1. Mobile Verwaltungsnavigation;
2. Board/Warteliste;
3. Tabellen;
4. Dialoge/Drawer;
5. Tastatur/Screenreader;
6. Reduced Motion.

### Phase 6 – Verifikation

1. Contracts bauen.
2. SPA-Produktionsbuild.
3. SPA-Unit-Tests.
4. Backend-Unit-/DB-Tests, falls berührt.
5. Smoke.
6. komplette lokale E2E-Suite.
7. manuelle Rollenmatrix Desktop/Mobile.

---

## 16. Verbindliche Akzeptanzkriterien

### Navigation

- Gast sieht keine Create-, Konto-, Servermanagement- oder Adminziele.
- Crew sieht keine Create-, Templates- oder Servermanagementziele ohne Operator-Guild.
- Operator sieht Create und nur die für ihn verwaltbaren Serverziele.
- Superadmin sieht Administration; Guild-Funktionen richten sich weiterhin nach Memberships.
- Desktop und Mobile haben identische fachliche Einträge.
- `/ops/:id` markiert „Operationen“ aktiv.
- jeder Serverlink enthält einen validen Guild-Kontext.
- ungültiges `?guild=` führt stabil auf einen erlaubten Kontext oder erklärten 403-Zustand.

### Operationsdetail

- Crew sieht keinen Verwaltungsmodus.
- Manager kann ohne langes Scrollen zwischen Ansehen und Verwalten wechseln.
- Reload und Browser-Zurück erhalten Modus und Unteransicht.
- alte `op=`, `tab=`, `/edit`, `/manage`, `/cover`-Links funktionieren.
- Titel, Guild, Status und Termin bleiben im Verwaltungskontext sichtbar.

### Funktionen

- Jeder Eintrag aus Abschnitt 8 hat mindestens einen positiven Test.
- Kein vorher vorhandener API-Clientaufruf wird ohne bestätigte Ablösung ungenutzt.
- Fragen stellen und beantworten funktionieren.
- Ressourcen, Cover und Dokumente funktionieren.
- Einheiten-, Sitz-, Flex-, Interest-, CQB- und Formation-Funktionen bleiben erreichbar.
- Status, Serie, Vorlage und Löschen bleiben erreichbar und korrekt gegated.
- Discord-Ankündigung und Partnerverteilung bleiben im Wizard oder Verwaltungsflow erreichbar.

### Bedienung

- alle Kernabläufe mit Maus, Touch und Tastatur;
- Drag besitzt Klickalternative;
- sichtbarer Fokus;
- Dialoge schließen mit Escape und geben Fokus zurück;
- keine nackten Badge-Zahlen;
- keine rein farbliche Statusinformation;
- Mobile hat keine horizontal unbedienbaren Tabellen oder abgeschnittenen Tabs.

### Qualität

- TypeScript-/Produktionsbuild grün.
- SPA-Tests grün ohne neue unhandled-request-Warnungen.
- E2E grün.
- keine Änderung an Backend-Semantik ohne explizite Begründung und Contract-/API-Tests.
- keine Änderung am Brandkit, die Lesbarkeit oder Identität verschlechtert.

---

## 17. Manuelle Abnahmeszenarien

1. **Gast, Mobile:** Start → Operationen → öffentliche Op → Briefing lesen → Login-CTA.
2. **Crew, Mobile:** Op öffnen → flexibel anmelden → Frage stellen → eigenes Schiff anbieten →
   eigenen Sitz claimen → Angebot zurückziehen.
3. **Operator, Desktop:** Create → Pflichtvalidierung → Bedarf → Partnerwahl → Entwurf erstellen →
   Cover → Discord ankündigen → Verwalten.
4. **Operator, Desktop:** offene Einheit annehmen → flexiblen Nutzer per Klick zuweisen → per Drag
   verschieben → Fehlerfall simulieren → Rollback sehen.
5. **Operator, Tablet:** Fragen beantworten → Kommandanten ernennen → Subraum aktivieren.
6. **Operator, Serie:** Vorlage veröffentlichen → Serie erstellen → Serie stoppen.
7. **Multi-Guild:** Server A wählen → Einstellungen → Partnerschaften → Diagnose → Server B per Deep
   Link → ungültige Guild-ID.
8. **Superadmin:** Admin-Konsole und Systemlogs erreichbar, Event-Verwaltung begrifflich getrennt.
9. **Tastatur:** Drawer, View-Switch, Manage-Navigation, Dialog, Sitzzuweisung und Gefahrbestätigung.
10. **Browserhistory:** Übersicht-Filter, Eventmodus und Unterbereiche vor/zurück reproduzierbar.

---

## 18. Arbeitsanweisung an Claude Code Opus

1. Lies zuerst `CLAUDE.md`, das Mergelog, diese Spezifikation, die archivierte vorherige UI/UX-Audit,
   `FR-SPA-PARITY-RESTORE.md`, `nav.ts`, `serverContext.tsx`, `App.tsx`, `OpDetailPage.tsx`,
   `OperatorConsole.tsx`, `OperatorPanel.tsx`, `WizardPage.tsx`, `api/client.ts` und die relevanten
   Tests vollständig.
2. Prüfe den aktuellen Dirty Worktree. Überschreibe keine fremden Änderungen.
3. Erstelle vor Codeänderung die vervollständigte Funktions- und Routenmatrix.
4. Implementiere phasenweise, aber lasse den Branch nach jeder Phase build- und testfähig.
5. Entferne keine Funktion, nur weil sie im neuen Zielbild keinen offensichtlichen Platz hat. Stoppe
   und dokumentiere den Konflikt.
6. Verwende echte Session-/Membership-Daten für Gates; keine globalen Rollenannahmen.
7. Bewahre URLs und API-Verträge. Wenn eine kanonische URL eingeführt wird, teste sämtliche Aliase.
8. Nutze vorhandene Komponenten und Tokens, reduziere technische Schuld und vermeide Parallel-UI.
9. Teste Gast, Crew, Operator und Superadmin separat sowie mindestens einen Multi-Guild-Fall.
10. Liefere am Ende:
    - geänderte Informationsarchitektur;
    - vollständige Funktions-Migrationsmatrix;
    - Screenshots Desktop/Mobile der Kernflows;
    - Build-/Testresultate;
    - bekannte Restpunkte;
    - explizite Bestätigung, ob Funktionsparität erreicht wurde.

---

## 19. Definition of Done

Das Redesign ist erst abgeschlossen, wenn nicht nur alle Tests grün sind, sondern ein Nutzer die
folgenden Fragen jederzeit ohne Raten beantworten kann:

- Wo bin ich?
- Welche Operation und welchen Discord-Server bearbeite ich?
- In welcher Rolle handle ich?
- Was ist der aktuelle Status?
- Was ist die wichtigste offene Aufgabe?
- Was passiert, wenn ich die hervorgehobene Aktion ausführe?
- Wie komme ich zurück zur Teilnehmeransicht?
- Wo finde ich jede bisherige Funktion?

Wenn eine dieser Fragen in einem Kernflow unbeantwortet bleibt, ist die UI trotz technischer
Funktionsparität noch nicht fertig.
