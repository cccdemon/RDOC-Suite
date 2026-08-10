# RDOC Fleetplanner — Was er kann und wofür er gedacht ist

*Vollständiger deutscher Überblick. Stand: 2026-08-12 (Funktionsumfang gegen den Quelltext geprüft).
Erreichbar unter `https://suite.raumdock.org/fleetplanner`.*

## Wofür ist der Fleetplanner gedacht?

Der Fleetplanner ist das **Operations- und Flottenplanungs-Werkzeug für Star-Citizen-Orgs**. Er
beantwortet die Fragen, die vor und während einer gemeinsamen Mission ("Operation"/"Op") immer
wieder auftauchen:

- **Was machen wir, wann, und wo treffen wir uns?**
- **Welche Schiffe und welche FPS-Teams brauchen wir?**
- **Wer fliegt was, und wer sitzt auf welchem Sitzplatz (Pilot, Gunner, Engineer, …)?**
- **Wie kommen die Kommandanten in denselben Sprachkanal?**

Er ist eng an **Discord** angebunden (Events, Benachrichtigungen, Rollen-Zuordnung) und
mandantenfähig: **ein Discord-Server = eine Guild = ein Mandant**. Mehrere Orgs nutzen dieselbe
Instanz, ohne sich gegenseitig in die Daten zu sehen.

## Für wen? (Rollen)

- **SuperAdmin** — Instanz-Betreiber (server­weit). Schaltet Guilds frei, Voice-Berechtigung, Bans.
- **Fleetoperator / Admiral** (pro Guild) — legt Operationen an, verwaltet Flotte, Sprache, Settings.
- **Captain** (pro Guild) — führt ein Schiff/Einheit.
- **Crew / Mitglied** — meldet sich zu Events an, stellt Schiffe, übernimmt Sitzplätze.

Wichtig: **Rollen sind pro Guild** (`fleetoperator | captain | crew`); nur *SuperAdmin* ist global.
Die Zuordnung kommt aus Discord-Rollen (Admiral-/Captain-Rolle in den Guild-Einstellungen).

---

## Was kann der Fleetplanner? (Funktionen)

### 1. Operationen anlegen — geführter Assistent
Ein **Schritt-für-Schritt-Wizard** führt durch: Eckdaten (Titel, Zeit in Server-Zeitzone, Typ) →
**Briefing** (mit Markdown) → Discord-Einstellungen → **Fleet Requirements** (was wird gebraucht,
mit Vorlagen) → Übersicht. Danach landet man im Management-Arbeitsbereich der Operation.

### 2. Wiederkehrende Events
Operationen können sich **wiederholen** (wöchentlich, alle 2 Wochen, monatlich am gleichen
Wochentag, jährlich). Jede Wiederholung wird als **eigene Operation mit eigenem Roster** erzeugt;
das Discord-Event trägt das native "wiederkehrend"-Abzeichen. Optional Ende nach N Terminen/Datum,
Serie jederzeit stoppbar.

### 3. Spieler-Anmeldung — "Ich will mitmachen"-Assistent
Die Event-Seite ist **spieler-zuerst**: Missions-Hero, Eckdaten, ein Assistent mit klaren Optionen:
- **Vom Operator einteilen lassen**,
- **Einen offenen Sitzplatz nehmen**,
- **Ein Schiff / CQB-Team anbieten**.

Spieler sehen die **akzeptierte Zusammensetzung**, nehmen/geben Sitzplätze direkt auf der Seite
frei, bearbeiten ihr angebotenes Schiff (Sitze umbenennen, an-/abschalten) und können es
zurückziehen — ohne separaten "Bearbeiten"-Modus.

### 4. Flotten-Zusammensetzung (Composition) & Sitzplätze
- **Fleet Requirements**: der Operator definiert Bedarf (z.B. "2× Subcapital", "1× FPS-Team").
- **Einheiten**: Schiffe (aus dem Schiffskatalog) oder FPS-Teams. Sitzplätze werden automatisch aus
  den Crew-Daten des Schiffs erzeugt (Pilot/Gunner/Engineer …).
- **Bodenfahrzeuge**: Schiffe mit großem Frachtraum tragen ein Fahrzeug als **bemannbare
  Untereinheit** (eigene Sitze), genistet unter dem Trägerschiff; akzeptiert wird "Schiff + Fahrzeug".
- **Annehmen/Ablehnen** durch den Operator; Ablehnen gibt Sitze wieder frei. Auto-Match schlägt
  passende Slots vor (Kategorie = Hinweis, keine harte Sperre).

### 5. Operator-Arbeitsbereich (Manage)
Aufgeräumte Oberfläche mit **Statusfluss** (Entwurf → Offen → Gesperrt → Startet → Live → Fertig),
einer "Nächster-Schritt"-Leiste und **Aufmerksamkeits-Tabs** (Gold umrandet, wo etwas zu tun ist):
Übersicht / Fleet / Crew / Voice / Voice-Zugriff / Admin. Aktionen aktualisieren nur den betroffenen
Bereich (kein ständiges Neuladen).

### 6. Schiffe & Profil
- **Schiffskatalog** aus der Star-Citizen-Wiki-API, lokal gecacht, wöchentlich aktualisiert.
- **Eigene Schiffe** im Profil pflegen; **Import per CCU-Game-JSON** (Massen-Import), nicht erkannte
  Namen manuell zuordnen; Liste sortierbar.

### 7. Mission-Cover-Generator
Pro Operation ein **kinoreifes Briefing-Cover** aus den Op-Daten — als Seiten-Banner, als
Link-Vorschaubild beim Teilen und als **Discord-Event-Bild**. Mit Editor zum Feintuning
(Hintergrund, Logos, Schriften, Effekte). Eigener Microservice; Cover alter Ops werden automatisch
aufgeräumt.

### 8. Sprach-Integration (Voice)
Der Fleetplanner überträgt **kein Audio** und bewegt niemanden in Discord-Sprachkanäle. Er baut für
eine **laufende** Operation einen signierten Deep-Link (`squadlink://connect`) in den CommandNet-Raum
der Operation; gesprochen wird in **Subraum** (subraum.cc), einer eigenständigen App. Der Operator wählt
aus, welche zugewiesenen Teilnehmer den Link sehen. Ohne konfiguriertes Raum-Secret ist die Funktion
in der Oberfläche schlicht nicht vorhanden.

> Die früheren **Funkrelais-Bots** ("Global Radio Net") und der LiveKit-Commander-Raum sind
> **entfernt** — im Code existiert davon nichts mehr.

### 9. Discord-Anbindung
- **Geplante Discord-Events** werden beim Öffnen einer Op erzeugt (inkl. Cover-Bild, wiederkehrend).
- **DMs/Erinnerungen** an Teilnehmer (z.B. Reminder vor Start, Sitzplatz-/Captain-Hinweise).
- **„Interessiert"** in Discord landet als Eintrag an der Operation (Abgleich alle fünf Minuten).
- **Ankündigungen** lassen sich einmalig in einen Textkanal posten.
- **Partner-Verteilung**: eine Operation geht auf Wunsch als Event in befreundete Server, dort
  entschieden per Button in der Direktnachricht oder über das Web-Postfach.
- **Feedback-Tickets** aus dem Feedback-Tab landen im Discord.

### 10. Mehrmandantenfähigkeit, Sichtbarkeit & Partnerschaften
- **Sichtbarkeit** pro Op: *Privat* (eigener Discord), *Partner* (verbündete Discords), *Öffentlich*.
- **Guild-Partnerschaften** per Einmal-Token verknüpfen → beide sehen die "Partner"-Operationen.
- Server-Owner können ihren Server entfernen (Daten bleiben); SuperAdmin kann Server bannen.

### 11. Nachbereitung
- **Teilnehmer-Export**: abgeschlossene Ops listen alle Beteiligten; CSV-Download (Discord-Name/ID,
  Rollen, Einheiten).
- **Audit-Log** pro Operation (wer hat was getan).
- **Changelog** (`/changelog`) und **Roadmap** (`/roadmap`) im Tool sichtbar.

---

## Typische Abläufe

**Als Operator/Admiral:**
1. Operation per Assistent anlegen (Zeit, Typ, Briefing, Fleet Requirements) — optional wiederkehrend.
2. Optional Mission-Cover erzeugen.
3. Op öffnen → Discord-Event entsteht, Mitglieder melden sich an.
4. Im Manage-Bereich Schiffe/Teams annehmen, Slots zuweisen, Voice vorbereiten.
5. Op auf "Live" setzen → Sprach-Setup aktiv, Crew in Kanäle ziehen.
6. Nach der Op: abschließen, Teilnehmer exportieren.

**Als Spieler/Crew:**
1. Event-Link öffnen (Discord) → Anmelde-Seite.
2. Sitzplatz nehmen **oder** eigenes Schiff/CQB-Team anbieten.
3. Eigenes Schiff konfigurieren / Sitze freigeben / ggf. zurückziehen.
4. Vor der Op: Erinnerung per DM; zur Op ins richtige Voice-Setup.

---

## Was (noch) nicht / in Planung
Siehe **Roadmap** (`/roadmap` im Tool, bzw. [ROADMAP.md](ROADMAP.md)). Geplant u.a.: Event-Verteilung
an Partner-Discords, Org-Flotte (wer hat welches Schiff), Sprachumschaltung (DE/EN/FR/ES),
Inaktivitäts-Alarm. Verworfen: Federation Voice. Blockiert: Item-/Loot-Datenbank (keine API).

## Abgrenzung
Der Fleetplanner ist **kein Voice-Werkzeug**. Er kennt den Namen eines Sprachraums und mintet einen
Link dorthin — mehr nicht. Audio, Push-to-Talk und Mischung liegen vollständig bei **Subraum**
(subraum.cc, eigenes Repo, eigene App). Discord wird ausschließlich über die offizielle Bot-/OAuth-API genutzt
(keine Selfbots, keine Client-Mods, keine heimlichen Aufnahmen, keine Gateway-Verbindung).
