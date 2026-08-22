# UI/UX- und Funktionsaudit für Claude Opus

Stand: 21. August 2026  
Scope: Fleetplanner-Web-SPA  
Nicht Bestandteil: Brandkit, Farbwahl, Logo, Illustration und rein ästhetische Geschmacksfragen

## 1. Auftrag und Zielbild

Dieser Bericht bewertet, ob die im Frontend abgebildeten Funktionen verständlich auffindbar, logisch gruppiert, konsistent bedienbar und über Desktop, Mobile, Maus, Touch und Tastatur erreichbar sind.

Das Ziel ist keine optische Neugestaltung. Claude Opus soll die bestehende Oberfläche strukturell überarbeiten und dabei sämtliche bestehenden Pfade, Berechtigungen, Deep Links und Funktionen erhalten.

Leitprinzipien:

1. Ein Objekt hat überall dieselbe Darstellungs- und Bedienlogik.
2. Navigation beschreibt Orte; Buttons beschreiben Aktionen.
3. Tabs bilden gleichrangige Ansichten desselben Objekts ab.
4. Kacheln bilden gleichartige Objekte mit derselben Informationsreihenfolge ab.
5. Gruppierungen folgen Nutzeraufgaben, nicht technischen Modulen.
6. Drag-and-drop ist eine Beschleunigung, niemals der einzige Bedienweg.
7. Rollen- und Serverkontext müssen vor jeder Aktion eindeutig erkennbar sein.
8. Jeder Zustand muss per URL, Reload und Browsernavigation reproduzierbar sein, wenn er eine eigenständige Ansicht darstellt.

## 2. Rollen und globale Perspektiven

Die Anwendung unterscheidet mindestens vier Perspektiven:

| Perspektive | Erwartete Hauptaufgaben |
| --- | --- |
| Gast | Öffentliche Operationen ansehen, Handbuch lesen, anmelden |
| Crew | Operation finden, anmelden, Schiff oder CQB-Einheit anbieten, Sitz wählen, Konto pflegen |
| Flottenoperator | Operation erstellen und verwalten, Personen und Einheiten zuordnen, Server konfigurieren |
| Superadmin | Instanz, Server, Logs und systemweite Einstellungen verwalten |

### Befund

Die Sichtbarkeit von Hauptmenüpunkten ist rollenabhängig. Innerhalb einzelner Seiten werden Berechtigungen aber teilweise erst nach dem Öffnen durch einen Anmelde- oder Fehlerzustand erklärt. Der aktive Discord-Server wird nicht als globaler Kontext geführt.

### Anforderung

- Navigation nur für tatsächlich erreichbare Bereiche anzeigen.
- Fehlende Berechtigung nicht nur als Fehler, sondern mit nächstem sinnvollen Weg erklären.
- Aktiven Server im Serverbereich persistent und sichtbar führen.
- Bei serverbezogenen Mutationen immer Servername und gegebenenfalls Rolle im Seitenkopf anzeigen.
- Rollenwechsel oder „Ansicht als Crew/Gast“ darf nicht wie eine echte Rechteänderung wirken.

## 3. Vollständiges Pfad- und Funktionsinventar

### 3.1 Einstieg und Operationen

| Pfad | Ziel/Funktion | Nutzer | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- | --- |
| `/` | Gast: Startseite; angemeldet: Weiterleitung zur Operationsübersicht | alle | Einstieg | Zielwechsel nach Login transparent halten; keine Navigation mit unklarem Ziel |
| `/start` | Produkt- und Einstiegsseite | alle | Hilfe/Info, nicht primärer Arbeitsbereich | Für angemeldete Nutzer sekundär behandeln |
| `/operationen` | Liste, Kalender und Agenda; Filter; vergangene Ops; Erstellen-CTA | alle | Operationen | Ansichts-, Filter- und Zeitkontext reproduzierbar machen |
| `/calendar` | Legacy-Redirect auf Kalenderansicht | alle | Operationen | Redirect und Query erhalten |
| `/ops/new` | Sechsstufiger Erstellungsflow, Vorlagenpicker, Cover/Dokumente/Sharing | Operator | Aktion „Operation erstellen“ | Aktion statt eigenständigem Hauptmenüpunkt; validierte lineare Progression |
| `/ops/:id` | Operationsdetail, Anmeldung, Flotte, Dokumente, Fragen, Streams, Operatorbereich | je Sichtbarkeit | Operationen > Operation | Breadcrumb und aktiver Hauptbereich erforderlich |
| `/ops/:id/edit` | Redirect auf Operator-Tab Eckdaten | Operator | Operation > Verwaltung | Deep Link erhalten |
| `/ops/:id/manage` | Redirect anhand `tab` auf Operatorbereich | Operator | Operation > Verwaltung | Legacy-Parameter vollständig abbilden |
| `/ops/:id/cover` | Redirect auf aktuellen Operatorbereich | Operator | Operation > Medien/Cover | Ziel sollte semantisch „Cover“ statt pauschal „Admin“ sein |
| `/templates` | Operationsvorlagen auswählen/anwenden | Operator | Operationen > Vorlagen | Im Erstellungsflow oder als Unterseite auffindbar machen |

### 3.2 Umfragen und Schiffe

| Pfad | Ziel/Funktion | Nutzer | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- | --- |
| `/polls` | Umfragen anzeigen und neue Umfrage starten | alle/angemeldet je Aktion | Kommunikation oder Operationen | Kachelstruktur an Operationslisten angleichen, ohne Objekttypen zu vermischen |
| `/polls/new` | Umfrage erstellen | angemeldet | Umfragen > Erstellen | Eindeutiger Abbruch- und Rückweg |
| `/polls/:id` | Abstimmen, Ergebnisse, Verwaltung/Löschen | nach Berechtigung | Umfragen > Umfrage | Breadcrumb; destruktive Aktionen getrennt gruppieren |
| `/ships` | Schiffsdatenbank durchsuchen und Details öffnen | alle | Datenbank/Flotte | Bezeichnung „Schiffsdatenbank“, falls es nicht „Meine Schiffe“ ist |

### 3.3 Server und Organisation

| Pfad | Ziel/Funktion | Nutzer | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- | --- |
| `/guilds` | Eigene Discord-Server, Rollen, Bot hinzufügen | angemeldet | Discord-Server > Übersicht | Ausgangspunkt und Serverauswahl |
| `/guilds/fleet` | Organisationsflotte, Mitglieder, Gastschiffe | angemeldet | Aktiver Server > Org-Flotte | Aktiven Server zwingend anzeigen und in URL führen |
| `/guilds/settings` | Server-, Discord-, Kalender- und Bot-Einstellungen | Operator | Aktiver Server > Einstellungen | Direkter Menüaufruf darf keinen zufälligen Server wählen |
| `/guilds/diagnostics` | Bot- und Discord-Diagnose | Operator | Aktiver Server > Diagnose | Diagnose als sekundäre Verwaltungsfunktion |
| `/guilds/partnerships` | Partnerschaften und Tokens verwalten | Operator | Aktiver Server > Partnerschaften | Serverkontext über Hin- und Rückweg erhalten |

### 3.4 Konto

| Pfad | Ziel/Funktion | Nutzer | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- | --- |
| `/konto/profil` | Profil, Hangar, Fleetyards-/Flottenimport | angemeldet | Konto > Profil & Hangar | Klares Trennen von Profil und Datenimport durch Sektionen |
| `/konto/logins` | Verknüpfte Logins | angemeldet | Konto > Verbundene Konten | Konsistente Tabsemantik |
| `/konto/prefs` | Sprache und Präferenzen | angemeldet | Konto > Einstellungen | Präziser Tabname statt generischem „Einstellungen“ |
| `/konto/feedback` | Feedback | angemeldet | besser Hilfe > Feedback | Nicht zugleich Hauptmenüpunkt und Konto-Tab |
| `/profile`, `/account`, `/feedback` | Legacy-Redirects | angemeldet | jeweiliges neues Ziel | Beibehalten und testen |

### 3.5 Hilfe, Rechtliches und Entwicklung

| Pfad | Ziel/Funktion | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- |
| `/handbuch/:section` | Was ist das, Technik, Architektur, Anleitung, Roadmap, Changelog, Binary | Hilfe | Lange Sektionen mobil als Inhaltsmenü statt zweiter permanenter Sidebar |
| `/sc-tools` | Star-Citizen-Werkzeuge | Werkzeuge oder Hilfe | Fachliche Bedeutung im Label erklären |
| `/rechtliches/:section` | Lizenz, Impressum, Datenschutz | Footer/Rechtliches | Tabmuster mit Konto vereinheitlichen |
| `/api-docs` | API-Dokumentation | Entwickler | Aus primärer Nutzernavigation entfernen |
| Legacy-Dokumentpfade | Redirects | Hilfe/Rechtliches | Deep Links erhalten |

### 3.6 Administration

| Pfad | Ziel/Funktion | Nutzer | Soll-Gruppierung | UX-Anforderung |
| --- | --- | --- | --- | --- |
| `/admin` | Server- und Instanzverwaltung | Superadmin | Administration | Admin-Kacheln nach Aufgabe und Risiko gruppieren |
| `/admin/system` | Dienste, Jobs, Ereignisse, Logs | Superadmin | Administration > System | Diagnose, Status und destruktive Aktionen differenzieren |

## 4. Empfohlene Hauptnavigation

```text
Operationen
├── Übersicht
├── Umfragen
└── Vorlagen                    nur Operator

Flotte
├── Meine Schiffe / Hangar      angemeldet
├── Org-Flotte                  mit aktivem Server
└── Schiffsdatenbank

Discord-Server                  angemeldet
└── [Aktiver Server ▾]
    ├── Übersicht
    ├── Einstellungen           Operator
    ├── Partnerschaften         Operator
    └── Diagnose                Operator

Hilfe
├── Handbuch
├── SC-Tools
└── Feedback

Konto                           angemeldet
├── Profil & Hangar
├── Verbundene Konten
└── Sprache & Präferenzen

Administration                 nur Superadmin
├── Admin-Konsole
└── System & Logs
```

„Operation erstellen“ ist eine hervorgehobene Aktion auf der Operationsübersicht und optional als globaler Erstellen-Button verfügbar. Sie ist kein Navigationsort.

Mobile muss exakt dieselbe Informationsarchitektur als Drawer oder Sheet abbilden. Ein flaches `<select>` ist nicht ausreichend, weil Gruppen, Kontext und Deep-Route-Zuordnung verloren gehen.

## 5. Operationsübersicht: Ansichten, Filter und Kacheln

Die Seite besitzt drei Darstellungen: Liste, Kalender und Agenda. Auf Mobile wird Kalender implizit zu Agenda. Typfilter, Streamfilter und „Vergangene“ wirken nicht in allen Ansichten identisch sichtbar.

### Anforderungen

- Liste, Kalender und Agenda als echten View-Switch mit `role="tablist"`, `role="tab"`, `aria-selected` und Tastatursteuerung ausführen.
- Aktive Ansicht in `?view=` speichern; Browser-Zurück sollte vorherige Ansicht wiederherstellen. Für häufiges Umschalten ist `push`, nicht immer `replace`, zu prüfen.
- Filter ebenfalls in der URL speichern: Typ, Streamzustand, vergangene Operationen, Monat und ausgewählter Tag.
- Auf Mobile „Kalender“ entweder sichtbar deaktivieren und begründen oder gar nicht anbieten. Eine stille Umwandlung in Agenda vermeiden.
- Streamfilter nicht als Drei-Zustands-Schalter mit wechselndem Text verstecken. Besser: Auswahl „Alle / Nur Streams / Ohne Streams“.
- Leerer Zustand nennt aktive Filter und bietet „Filter zurücksetzen“.
- Entwürfe als gespeicherte Ansicht beziehungsweise Filter „Entwürfe“ statt als Sprungbutton behandeln.

### Einheitliche Operationskachel

Informationsreihenfolge in jeder Kachel:

1. Status und Teilnahmezustand
2. Titel
3. Datum und Uhrzeit
4. Server/Organisation
5. Ort/System
6. Kapazität beziehungsweise Belegung
7. relevante sekundäre Aktion

Liste, Agenda, Monatsdetail und Startseite dürfen unterschiedliche Dichte besitzen, müssen aber dieselben Begriffe, Statuswerte und Informationsprioritäten verwenden. Eine ganze Kachel darf das Primärziel öffnen. Sekundäre Aktionen wie Discord dürfen nicht unerwartet ebenfalls die Detailseite auslösen.

## 6. Operationsdetail und Operator-Konsole

Die öffentliche beziehungsweise Crew-Ansicht und die Operator-Verwaltung befinden sich auf derselben langen Seite. Der Operatorbereich erscheint weit unten und enthält neun gleichrangige Tabs.

### Probleme

- `/ops/:id` aktiviert den Hauptmenüpunkt „Operationen“ nicht zuverlässig.
- Kein dauerhafter Breadcrumb oder klarer Rücksprung zur vorherigen Übersicht.
- Operatorfunktionen sind wegen ihrer Position schwer auffindbar.
- Neun Tabs überschreiten eine sinnvolle primäre Ebene.
- Tabwechsel aktualisieren die URL nicht; Reload, Teilen und Browser-Zurück verlieren den Zustand.
- Tab-Buttons besitzen keine vollständige Tab-Semantik.
- „Admin“ enthält fachlich verschiedene Aufgaben wie Vorlage, Serie, Status und potenziell gefährliche Aktionen.

### Empfohlene Gruppierung

```text
Operation ansehen | Verwalten

Verwalten
├── Planung
│   ├── Eckdaten
│   ├── Briefing & Ressourcen
│   ├── Cover
│   └── Fragen
├── Besatzung & Flotte
│   ├── Board
│   ├── Bedarfe
│   ├── CQB
│   └── Verbände
├── Kommunikation
│   ├── Voice
│   └── Commanders
└── Verwaltung
    ├── Status
    ├── Vorlage
    ├── Serie
    └── Gefahrenbereich
```

Nicht zwingend alle Unterpunkte müssen weitere Tabs sein. Innerhalb eines Hauptbereichs können klar betitelte Sektionen verwendet werden. Maximal fünf primäre Tabs anstreben.

### URL-Modell

- Empfohlen: `/ops/:id?mode=manage&section=fleet&sub=board`
- Bestehende Parameter `op=fleet`, `op=eckdaten` usw. weiterhin akzeptieren und kanonisch umleiten.
- Tabwechsel schreibt die URL.
- Vor/Zurück wechselt Tabs beziehungsweise Bereiche erwartungsgemäß.
- Ungültiger Tab fällt auf ein dokumentiertes Standardziel zurück.

## 7. Drag-and-drop: vollständige Interaktionsspezifikation

### 7.1 Aktuell tatsächlich implementierter Drag

Ziehbar sind ausschließlich flexible Personen aus dem Panel „Flexibel“. Gültige Ziele sind aktive, freie Sitze auf dem Operator-Board. Eine anstehende Einheit ist bewusst nicht auf einen einzelnen Sitz ziehbar; sie wird über „Annehmen“ verarbeitet. Verbände, Carrier, CQB-Teamzuordnung und Bedarfe werden im aktuellen React-Frontend überwiegend über Buttons oder Dropdowns bedient.

Diese fachliche Grenze muss sichtbar und testbar bleiben. Dokumentation oder UI darf keine Drag-Funktion versprechen, die nicht implementiert ist.

### 7.2 Zustände eines Drags

Jeder Drag muss folgende Zustände eindeutig abbilden:

| Zustand | Erwartetes Verhalten |
| --- | --- |
| Ruhend | Ziehbares Element besitzt sichtbaren Griff oder verständlichen Hinweis |
| Aufgenommen | Quelle bleibt identifizierbar; alle gültigen Ziele werden hervorgehoben |
| Über gültigem Ziel | Ziel nennt Person und Zielplatz, z. B. „Alex auf Pilot setzen“ |
| Über ungültigem Ziel | Kein Drop-Cursor; Grund bei längerer Interaktion oder nach Versuch erklären |
| Speichern | Ziel zeigt lokalen Pending-Zustand; weitere widersprüchliche Aktion sperren |
| Erfolg | Person erscheint am Sitz; Quelle verschwindet aus „Flexibel“; Live-Region bestätigt |
| Fehler | Optimistisches Update zurückrollen; Fehler direkt am Ziel und global melden |
| Abbruch | Escape, Drop außerhalb oder Klick auf „Abbrechen“ setzt alle Markierungen zurück |

### 7.3 Pflichtalternativen

- Bestehendes Klickmuster „Einteilen“ → Ziel auswählen beibehalten und als gleichwertigen Weg behandeln.
- Freier Sitz → „Einteilen“ → Person suchen/auswählen beibehalten.
- Touch: kein HTML5-Drag voraussetzen; Auswahlmodus als Standard anbieten.
- Tastatur: Person fokussieren, „Einteilen“ aktivieren, Ziel per Tastatur wählen, bestätigen oder Escape.
- Screenreader: Statusänderungen per `aria-live`; Dragstatus nicht nur visuell kommunizieren.

### 7.4 Gruppierungsregeln beim Ziehen

- Nur kompatible Zielgruppen hervorheben.
- Sitze nach Einheit und Rolle gruppiert lassen; ein Drop darf die räumliche Zuordnung nicht verschieben.
- Ist eine Person bereits eingeteilt, muss „Verschieben“ explizit von „zusätzlich zuweisen“ unterschieden werden.
- Fremde Partner-Mitglieder müssen mit Organisation gekennzeichnet bleiben.
- Deaktivierte und belegte Sitze sind keine Ziele.
- Captain-Sitze mit Sonderregeln dürfen nicht wie normale Sitze wirken.
- Bei gefilterten oder eingeklappten Zielgruppen muss die Oberfläche erklären, warum kein Ziel sichtbar ist.

### 7.5 Optionale zukünftige Drag-Funktionen

Drag für CQB, Verbände oder Carrier nur ergänzen, wenn das gleiche Interaktionsmodell vollständig umgesetzt wird. Dropdowns bleiben als präzise und barrierearme Alternative erhalten. Kein gemischtes Modell, bei dem einige Karten durch Drag verschoben und andere nur über versteckte Dropdowns zugeordnet werden können, ohne dies zu kennzeichnen.

## 8. Kachel- und Kartenkonsistenz

Der Sammelbegriff `fpw-card` wird für sehr unterschiedliche Dinge verwendet: klickbare Objektkachel, Formularcontainer, Statuspanel, Tabelle und Verwaltungssektion. Das erzeugt inkonsistente Erwartungen.

### Verbindliche Kartentypen

| Typ | Zweck | Interaktion |
| --- | --- | --- |
| Objektkachel | Operation, Umfrage, Vorlage, Server | Ganze Kachel öffnet genau ein Primärziel |
| Auswahlkachel | Missionstyp, Sichtbarkeit, Template | Auswahlzustand; `aria-pressed` oder Radiosemantik |
| Informationskarte | Statistik, Erklärung, Status | Nicht klickbar; kein Hover-/Pointer-Verhalten |
| Arbeitskarte | Einheit, Verband, CQB-Team | Enthält lokale Aktionen und Zuordnungen; nicht pauschal klickbar |
| Formularsektion | Zusammengehörige Eingaben | Überschrift, Beschreibung, Validierung, Aktionen am Ende |
| Gefahrenkarte | Löschen, Beenden, Trennen | Räumlich abgesetzt und nie mit Routineaktionen vermischt |

### Gemeinsame Regeln

- Gleicher Kartentyp hat überall dieselbe Informationsreihenfolge.
- Ganze klickbare Karten besitzen genau ein Hauptziel und einen sichtbaren Fokusring.
- Interaktive Kindelemente innerhalb klickbarer Karten lösen nicht zusätzlich die Kartenaktion aus.
- Statusbadges verwenden dieselben Begriffe über Liste, Detail, Admin und Kalender hinweg.
- Leere, ladende, erfolgreiche und fehlerhafte Zustände haben pro Kartentyp ein einheitliches Muster.
- Kartenhöhen müssen nicht künstlich identisch sein; Aktionsbereiche vergleichbarer Karten sollen jedoch fluchten.
- Tabellen dürfen nicht nur wegen des gemeinsamen Rahmens als „Karten“ semantisch behandelt werden.

## 9. Tabkonsistenz

Derzeit existieren mindestens vier unterschiedliche tabähnliche Muster: Konto-Links, Rechtliches-Links, Handbuch-Seitennavigation und Operator-Buttons. Die Operationsansichten sind ebenfalls Tabs, aber als View-Schalter umgesetzt.

### Standard

- URL-Link-Tabs für eigenständig adressierbare Inhalte.
- Lokale Tabs nur für flüchtige Inhalte ohne eigenen Navigationswert.
- `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls` und passende Panels.
- Pfeiltasten wechseln Fokus; Enter/Space aktiviert entsprechend gewähltem Tabmodell.
- Aktiver Tab ist nicht nur farblich markiert.
- Tabs bleiben in stabiler Reihenfolge.
- Badge zählt offene Aufgaben, nicht bloß vorhandene Datensätze; Bedeutung per zugänglichem Label erklären.
- Auf schmalen Ansichten horizontal scrollbare Tabs mit sichtbarem Überlaufhinweis oder Select/Accordion mit gleicher Hierarchie.

### Begriffsregeln

- „Einstellungen“ immer qualifizieren: Server-Einstellungen, Kontoeinstellungen, Sprache & Präferenzen.
- Deutsch und Englisch innerhalb einer Navigation nicht ohne fachlichen Grund mischen: „Commanders“, „Voice“, „Board“, „Admin“ prüfen.
- „Flotte & Board“ nicht mit einem parallelen Tab „Verbände“ mischen, wenn Verbände Teil derselben Flottenaufgabe sind.

## 10. Erstellungsflow

Der Wizard besitzt sechs Schritte, erlaubt aber den direkten Sprung in beliebige Schritte und „Weiter“ validiert die aktuelle Stufe nicht erkennbar. Nach Erstellung verwandelt sich Schritt sechs in einen umfangreichen Nachbearbeitungsbereich.

### Anforderungen

- Schritte nach Nutzerziel benennen: Eckdaten, Briefing, Veröffentlichung, Bedarf, Prüfen, Erstellen & Teilen.
- Direkten Sprung nur zu bereits erreichbaren Schritten zulassen oder Fehler zusammenfassen.
- „Weiter“ validiert die aktuelle Stufe und fokussiert das erste fehlerhafte Feld.
- Pflichtfelder, optionale Felder und Auswirkungen vor Eingabe erklären.
- Zusammenfassung anklickbar machen: Jeder Eintrag führt zum betreffenden Schritt.
- Nach dem Erstellen klare Entscheidung anbieten: „Operation öffnen“ oder „Cover und Freigabe ergänzen“.
- Vorlagenpicker als Dialog mit Fokusfalle, Escape, Rückfokus und eigenem Lade-/Leerzustand.
- Entwurf bleibt bei unbeabsichtigtem Verlassen erhalten beziehungsweise der Nutzer wird vor Datenverlust gewarnt.

## 11. Serverkontext und Gruppierung

Der größte funktionale Navigationsrisiko liegt bei mehreren Servermitgliedschaften. Org-Flotte und Einstellungen bestimmen den Server aus Queryparametern oder aus der verfügbaren Liste. Der direkte Hauptmenüpfad trägt keinen Server.

### Zielmodell

- Serverauswahl im Serverbereich als gemeinsamer Context Provider.
- Kanonische URL entweder `/guilds/:guildId/...` oder konsequent `?guild=:guildId`.
- Auswahl wird beim Wechsel zwischen Übersicht, Flotte, Einstellungen, Partnerschaften und Diagnose erhalten.
- Letzter gültiger Server kann lokal gemerkt werden; URL hat Vorrang.
- Nicht mehr erreichbarer Server führt zur Auswahlseite mit verständlicher Meldung.
- Aktionen wie Bot hinzufügen, Partnerschaftstoken erstellen oder Kalenderziel ändern nennen den betroffenen Server.

## 12. Responsive Verhalten

- Desktop- und Mobile-Navigation verwenden dieselben Gruppen und Labels.
- Monatskalender darf mobil eine alternative Darstellung besitzen, aber der Wechsel muss explizit sein.
- Arbeitskarten mit mindestens 500 px Breite dürfen auf kleinen Viewports nicht horizontal überlaufen.
- Tabellen wie Schiffsdatenbank und Org-Flotte benötigen mobile Zeilenkarten oder kontrolliertes horizontales Scrollen mit fixierter erster Spalte.
- Sticky-Navigationen dürfen mobile Header und Fokusziele nicht überdecken.
- Drag-and-drop wird auf Touch automatisch durch Auswahlmodus ersetzt.
- Primäraktion bleibt erreichbar, ohne dass Footer oder Sidebar zwingend sichtbar sein müssen.

## 13. Priorisierte Maßnahmen

### P0 – Funktions- und Orientierungsrisiken

1. `/ops/:id` dem aktiven Hauptbereich Operationen zuordnen.
2. Operator-Tabzustand in der URL führen.
3. Persistenten und sichtbaren Serverkontext einführen.
4. Mobile Navigation von flacher Auswahl auf gruppierte Navigation umstellen.
5. Drag-and-drop mit Touch-, Tastatur- und Fehleralternative absichern.
6. Wizard-Schrittvalidierung und Schutz vor Datenverlust ergänzen.

### P1 – Konsistenz

1. Operator-Konsole auf maximal fünf Hauptgruppen reduzieren.
2. Karten in definierte Kartentypen trennen.
3. Tabsemantik über Konto, Rechtliches, Operationsansichten und Operatorbereich vereinheitlichen.
4. Filter und relevante Ansichtsparameter in der URL persistieren.
5. Feedback aus Konto lösen und doppelte Navigation entfernen.
6. Vorlagen auffindbar unter Operationen gruppieren.

### P2 – Benennung und Feinschliff

1. Mehrdeutige Labels qualifizieren.
2. API-Doku in Entwickler-/Footerbereich verschieben.
3. Breadcrumbs und kontextuelle Rückwege vereinheitlichen.
4. Leere Zustände um „Filter zurücksetzen“ beziehungsweise nächsten sinnvollen Schritt ergänzen.
5. Status- und Badge-Terminologie vereinheitlichen.

## 14. Akzeptanzkriterien und Tests

### Navigation

- Jede registrierte Route besitzt einen erwarteten Elternbereich.
- Aktiver Menüpunkt stimmt auf Detail- und Unterrouten.
- Rollen sehen nur erlaubte Haupt- und Unterpunkte.
- Desktop und Mobile zeigen dieselbe fachliche Struktur.
- Alle Legacy-Redirects behalten Query und Hash, sofern relevant.

### Tabs und Ansichten

- Direkter Deep Link öffnet den richtigen Tab.
- Reload behält Tab, View, Server und relevante Filter.
- Browser-Zurück stellt die vorherige Ansicht wieder her.
- Tabs sind vollständig per Tastatur und Screenreader bedienbar.

### Karten

- Klick auf Kartenfläche öffnet das Primärziel genau einmal.
- Sekundäraktionen funktionieren ohne Karten-Navigation.
- Gleiche Objekte zeigen Status und Metadaten in gleicher Reihenfolge.
- Mobile Darstellung überläuft nicht und verliert keine Aktion.

### Drag-and-drop

- Flexible Person kann per Maus auf freien aktiven Sitz gezogen werden.
- Belegte und deaktivierte Sitze nehmen keinen Drop an.
- Erfolg entfernt die Person aus „Flexibel“ und setzt sie am Ziel ein.
- API-Fehler rollt die Oberfläche zurück und meldet den Fehler.
- Escape bricht einen aktiven Auswahl-/Dragmodus ab.
- Derselbe Vorgang funktioniert ohne Drag über Quell- und Zielauswahl.
- Tastatur- und Touchweg haben denselben Funktionsumfang.
- Partnerherkunft bleibt bei der Personenauswahl sichtbar.

### Wizard

- Unvollständiger Pflichtschritt kann nicht unbemerkt übersprungen werden.
- Zusammenfassung führt zurück zum gewählten Schritt.
- Erstellung erzeugt genau einen Entwurf.
- Nach Erstellung sind Öffnen und Nachbearbeiten klar getrennte Wege.

## 15. Konkreter Implementierungsauftrag für Claude Opus

Überarbeite die Informationsarchitektur und Interaktionslogik des Fleetplanner-Web-Frontends anhand dieses Berichts. Bewahre alle bestehenden Funktionen, Berechtigungen, API-Verträge, Legacy-Redirects und Deep Links. Bewerte oder verändere das Brandkit nicht.

Arbeite in dieser Reihenfolge:

1. Erstelle zunächst eine Route-to-Navigation-Matrix im Code und ordne jede Route einem Elternbereich zu.
2. Implementiere einen persistenten Serverkontext und führe ihn durch alle Server-Unterseiten.
3. Vereinheitliche Desktop- und Mobile-Hauptnavigation mit identischen Gruppen.
4. Mache Operationsansichten, Konto, Rechtliches und Operatorbereiche URL-basiert und semantisch korrekte Tabs beziehungsweise View-Switches.
5. Reduziere die Operator-Konsole auf die Gruppen Planung, Besatzung & Flotte, Kommunikation und Verwaltung. Erhalte sämtliche heutigen Inhalte.
6. Definiere wiederverwendbare Komponenten für Objektkachel, Auswahlkachel, Informationskarte, Arbeitskarte, Formularsektion und Gefahrenbereich. Migriere vorhandene Karten ohne Funktionsverlust.
7. Härte das bestehende Crew-zu-Sitz-Drag-and-drop gemäß Zustandsmodell ab. Erhalte die Klickalternative und ergänze vollständige Tastatur-/Touchbedienung. Implementiere keine fachlich falschen Drops für anstehende Einheiten.
8. Ergänze Wizard-Validierung, Rücksprünge, Verlustschutz und eine klare Post-Create-Entscheidung.
9. Ergänze responsive Lösungen für Tabellen, breite Fleet-Karten, Tabs und Handbuchnavigation.
10. Schreibe automatisierte Tests für alle Akzeptanzkriterien. Ändere keine Backend-Semantik, sofern dies für den persistenten Serverkontext nicht zwingend erforderlich ist.

Vor jeder Änderung ist zu prüfen, ob die betroffene Funktion für Gast, Crew, Flottenoperator und Superadmin unterschiedlich wirkt. Keine vorhandene Funktion darf allein durch neue Gruppierung unauffindbar werden.
