# Manuelle Abnahme vor dem Deploy

Die automatisierte Suite (Backend-Unit, SPA-Unit, DB, E2E, Smoke) steht in
[TESTING.md](TESTING.md) und deckt das meiste ab. Diese Liste ist das, was ein Mensch anfassen
muss: echte Discord-Nebenwirkungen, Bedienbarkeit auf dem Handy und die Dinge, die nur mit
echten Servern und echten Rollen auffallen.

Stand 2026-08-22. Reihenfolge ist Absicht — Phase 1 stellt die Voraussetzungen für alles Weitere.

**Ein System, eine URL:** `https://suite.raumdock.org/fleetplanner`. Es gibt keine Bridge, keine
Companion-App und keine `voice.raumdock.org` mehr — Voice läuft in Subraum (subraum.cc), einer
eigenen App, die der Fleetplanner nur per Deep-Link anspringt.

**Vorher lesen:** die manuelle Abnahme läuft gegen **Produktion**. Alles, was hier angelegt wird,
ist echt und für andere sichtbar. Test-Operationen mit `TEST-` beginnen lassen, `private` halten
und hinterher löschen.

---

## Phase 0 — Rollen, die es wirklich gibt

| Rolle | Wo sie lebt | Was sie darf |
|---|---|---|
| `superadmin` | `User.role` (global, instanzweit) | Admin-Konsole, Instanzverwaltung, Server sperren |
| `fleetoperator` | `GuildMembership.role` (**pro Server**) | Operationen anlegen und verwalten, Servereinstellungen, Partnerschaften |
| `crew` | `GuildMembership.role` (Default) | Operationen beitreten, Schiffe anbieten, Sitze belegen |
| Gast | keine Session | nur öffentliche Operationen und das Handbuch |

„Captain" ist **keine** Serverrolle, sondern der Kapitän einer Einheit innerhalb einer Operation.
Discord-seitig wird genau eine Rolle gemappt: `admiralRoleId` → `fleetoperator`, beim Login.

- [ ] Eigenes Konto ist `fleetoperator` im Testserver (oder `superadmin`)
- [ ] Ein zweites Konto steht als reines `crew`-Mitglied bereit
- [ ] Ein drittes Fenster ist **ausgeloggt** (Gast-Perspektive)

## Phase 1 — Voraussetzungen

- [ ] `docker compose -f docker-compose.prod.yml ps` → alle Container `Up`
- [ ] `https://suite.raumdock.org/fleetplanner` lädt, Login mit Discord funktioniert
- [ ] `E2E_TEST_LOGIN_SECRET` ist auf der Instanz **nicht** gesetzt
      (Gegenprobe: `POST /e2e/login` antwortet 404)
- [ ] Lese-Smoke grün: `E2E_BASE_URL=https://suite.raumdock.org ./scripts/prod-e2e-readonly.sh`
- [ ] Server → **Diagnose**: Bot-Token gültig, Kanäle lesbar, keine roten Zeilen

## Phase 2 — Operation anlegen (Assistent)

„Neue Operation" ist eine Aktion über der Navigation, kein Menüpunkt, und nur für Fleetoperatoren
sichtbar.

1. **Eckdaten** — Titel, Zeitpunkt, Typ, System/Ort
2. **Briefing** — Beschreibung, Ressourcenlinks, Dokumente
3. **Veröffentlichung** — Sichtbarkeit (`privat` / `partner` / `öffentlich`), Ankündigungskanal
4. **Bedarf** — Schiffsbedarfe, Jäger-Staffeln, CQB-Teams
5. **Prüfen** — Zusammenfassung
6. **Erstellen & Teilen** — Cover, Freigabe

- [ ] „Weiter" bei leerem Pflichtfeld springt in das fehlerhafte Feld statt still weiterzugehen
- [ ] Ein Eintrag in der Zusammenfassung führt zurück in den zugehörigen Schritt
- [ ] Verlassen mit ungespeichertem Entwurf warnt
- [ ] Nach dem Erstellen gibt es zwei klar getrennte Wege: Operation öffnen **oder** Cover ergänzen
- [ ] Genau **eine** Operation entstanden (kein Doppel bei Doppelklick)
- [ ] Vorlagen-Dialog: Escape schließt, Fokus kehrt auf den auslösenden Knopf zurück

## Phase 3 — Discord-Nebenwirkungen (der eigentliche Grund für Handarbeit)

- [ ] Operation veröffentlichen → im Discord erscheint ein **Scheduled Event** mit Titel, Zeit und
      Link auf die Operation
- [ ] Operation bearbeiten → dasselbe Event wird geändert, **kein zweites** Event
- [ ] Stream-Operation → das Event trägt die Stream-Kennzeichnung
- [ ] Ankündigung senden → Nachricht landet im gewählten Kanal
- [ ] Operation absagen/löschen → Discord-Event verschwindet
- [ ] Im Discord auf „Interessiert" klicken → der Pilot taucht binnen ~5 Minuten im Operator-Board
      als unzugewiesener Teilnehmer auf; Zurückziehen entfernt ihn wieder
- [ ] Sitz zuweisen → der zugewiesene Spieler bekommt eine DM (Operation, Einheit, Sitz, Kapitän)
- [ ] Einheit annehmen → der Kapitän bekommt eine DM mit Operation, Einheit, Startzeit und Link
      (Voice-Zeilen nur, wenn `FLEETPLANNER_VOICE_CLIENT_*` gesetzt ist)
- [ ] Erinnerung: `reminderOffsetMin` vor dem Start kommt die DM (einmal, nicht mehrfach)
- [ ] Feedback über „Hilfe → Feedback" mit Screenshot → Ticket samt Bild im Feedback-Kanal

## Phase 4 — Crew-Perspektive

Mit dem zweiten Konto (`crew`):

- [ ] Operation ist auffindbar (Liste, Kalender, Agenda) und die Kachel öffnet die Detailseite
- [ ] Schiff aus dem Katalog **und** aus dem eigenen Hangar anbieten
- [ ] Flexibel anmelden ohne Schiff
- [ ] Freien Sitz belegen und wieder freigeben
- [ ] Frage stellen; der Operator sieht und beantwortet sie
- [ ] Verspätung mit Uhrzeit eintragen
- [ ] Eigenes Schiff zurückziehen
- [ ] Wer in zwei Einheiten sitzt, sieht unter „Dein Status" die Auswahl der Haupteinheit

## Phase 5 — Operator-Konsole

Vier Gruppen mit Unter-Tabs; der Tab steht in der URL (`?op=<tab>`).

| Gruppe | Tabs |
|---|---|
| Flotte | Board, Bedarfe, CQB, Verbände |
| Planung | Eckdaten, Cover, Fragen |
| Kommunikation | Voice, Kommandanten |
| Verwaltung | Vorlage & Serie (inkl. Status und Gefahrenbereich) |

- [ ] Tab wechseln → URL ändert sich; Neuladen und Browser-Zurück landen im selben Tab
- [ ] Deep-Link `…/ops/:id?op=fleet` öffnet direkt das Board
- [ ] Einheit annehmen/ablehnen, Sitz zuweisen und wieder freigeben
- [ ] **Drag-and-drop:** flexible Person auf freien Sitz ziehen — belegte und deaktivierte Sitze
      nehmen nichts an, Escape bricht ab, ein Fehler rollt die Anzeige zurück
- [ ] **Ohne Maus:** derselbe Vorgang über „Einteilen" → Person wählen → bestätigen, komplett per
      Tastatur
- [ ] **Auf dem Handy:** Auswahlmodus statt Ziehen, alles erreichbar
- [ ] Bedarfe ändern, Verband anlegen, Fahrzeug/CQB-Team in ein Trägerschiff setzen
- [ ] CQB: „Auto-Bündeln" teilt den Pool in Squads der gewählten Größe; ein Squad auflösen gibt
      seine Soldaten in den Pool zurück (niemand fliegt aus der Operation)
- [ ] Briefing: Ressourcenlinks mit den Pfeiltasten-Knöpfen sortieren — Reihenfolge überlebt Reload
- [ ] Cover erzeugen, im Editor anpassen, speichern → Bild erscheint an der Operation **und** am
      Discord-Event
- [ ] Als Vorlage veröffentlichen; Vorlage in einer neuen Operation anwenden
- [ ] Serie anlegen, Serie stoppen
- [ ] Gefahrenbereich ist räumlich abgesetzt und fragt vor dem Löschen nach

## Phase 6 — Server und Partner

- [ ] Mit **mehreren** Servern: der aktive Server steht sichtbar im Seitenkopf und bleibt beim
      Wechsel zwischen Übersicht, Org-Flotte, Einstellungen, Partnerschaften und Diagnose erhalten
- [ ] Server wechseln → die serverbezogenen Seiten zeigen die Daten des neuen Servers
- [ ] Einstellungen: Rolle-Mapping, Eventkanal, Zeitzone, Einladungslink, Erinnerungsvorlauf
- [ ] Mitglied auf `fleetoperator` heben und wieder zurückstufen
- [ ] Partnerschaft einladen, annehmen, Auto-Share setzen
- [ ] Operation zum Partner teilen → Genehmigungs-DM mit Buttons; Annehmen erzeugt drüben ein Event
- [ ] Genehmigung im Web-Postfach funktioniert auch ohne Discord-Buttons
- [ ] Partnerschaft widerrufen → geteilte Events verschwinden

## Phase 7 — Konto, Hangar, Umfragen

- [ ] Hangar: Schiff manuell hinzufügen, CCU-JSON importieren, Fleetyards-Profil importieren
- [ ] Nicht erkannte Import-Namen manuell zuordnen
- [ ] Hangar für die Organisation freigeben → erscheint in der Org-Flotte
- [ ] Sprache umschalten (de/en) — Auswahl überlebt das Neuladen
- [ ] Verknüpfte Logins: Discord verknüpfen und die Liste stimmt
- [ ] Umfrage anlegen (Einzel- und Mehrfachauswahl), abstimmen, Stimme zurückziehen, Ergebnis sehen
- [ ] Umfrage löschen (nur wer darf)

## Phase 8 — Gast und Sichtbarkeit

Im ausgeloggten Fenster:

- [ ] Öffentliche Operation ist lesbar, **ohne** Spielernamen und ohne Missionslog
- [ ] Private Operation liefert keinen Hinweis auf ihre Existenz
- [ ] Handbuch und rechtliche Seiten sind erreichbar
- [ ] Ein Link auf eine nicht-öffentliche Operation zeigt einen Login-Hinweis, keine 404-Sackgasse
- [ ] Discord-Link-Vorschau einer öffentlichen Operation zeigt Titel, Zeit und Cover

## Phase 9 — Administration (superadmin)

- [ ] Admin-Konsole: Server- und Nutzerliste, Rolle ändern, Konto deaktivieren
- [ ] Schiffs- und Ortskatalog: „Jetzt synchronisieren" und Intervall ändern
- [ ] System & Logs: Health, Jobs, Ereignisse
- [ ] Wartungsmodus an → normale Nutzer sehen die Wartungsseite; wieder aus
- [ ] Server sperren/entsperren

## Phase 10 — Oberfläche und Geräte

- [ ] Mobile Navigation zeigt **dieselben Gruppen** wie die Desktop-Leiste
- [ ] Schiffsdatenbank und Org-Flotte laufen auf dem Handy nicht seitlich über
- [ ] Kalender/Agenda: Ansicht, Filter und Monat stehen in der URL und überleben Neuladen
- [ ] Leerer Filterzustand nennt die aktiven Filter und bietet „Filter zurücksetzen"
- [ ] Heller und dunkler Modus lesbar
- [ ] Tastatur allein reicht durch Navigation, Tabs und Formulare; Fokus ist immer sichtbar

## Schnelldurchlauf

```
[ ] Stack läuft, Prod-Smoke grün, E2E-Seam aus
[ ] Operation anlegen → Discord-Event da
[ ] Crew bietet Schiff an → Operator nimmt an → DM kommt
[ ] Sitz per Maus, per Tastatur und auf dem Handy vergeben
[ ] Cover erzeugen → an Operation und Discord-Event sichtbar
[ ] Partner-Teilen inkl. Genehmigung
[ ] Gast sieht nur, was er sehen darf
[ ] Testdaten wieder gelöscht
```
