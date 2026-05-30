# RDOC-Suite Mergelog

Stand: 2026-05-30

## Fleetplanner / Fleetmanager

### Deployment

- Zielsystem: LXC 103 auf `root@85.215.253.135`
- Projektpfad: `/opt/RDOC-Suite`
- Service: `fleetplanner`
- Deploy-Befehl: `docker compose -f docker-compose.prod.yml up -d --build fleetplanner`
- Public URL: `https://suite.raumdock.org/fleetplanner`
- Letzter Fleetplanner-Rebuild und Neustart: erfolgreich

### Datenmodell / Migrationen

Neue Migrationen:

- `20260530002000_user_owned_ships`
  - User Profile kann eigene Schiffe speichern.
  - Operation Registration kann ein Schiff optional direkt im Profil speichern.

- `20260530013000_app_settings`
  - Key/Value Settings fuer GUI-konfigurierbare App-Werte.
  - Wird aktuell fuer den Discord Feedback Channel genutzt.

- `20260530014500_operation_meeting_system`
  - Operationen haben ein `meetingSystem` (`stanton`, `pyro`, `nyx`).

- `20260530020000_seat_active`
  - Seats haben `active`.
  - Nicht benoetigte Crewplaetze koennen deaktiviert werden.

- `20260530021000_meeting_location_crew_requests`
  - Operationen haben `meetingLocation`.
  - Neuer Pool `CrewAssignmentRequest` fuer "Crewmember, need assignment".

- `20260530022000_locations_catalog`
  - Neuer lokaler Location-Katalog aus `https://api.star-citizen.wiki/api/locations`.
  - Neuer Sync-State `LocationSyncState`.

### Features

- Profile Page `/profile`
  - User koennen eigene Schiffe speichern und entfernen.
  - Gespeicherte Schiffe koennen in Operationen genutzt werden.
  - Beim Registrieren einer Unit kann ein Schiff optional direkt als eigenes Schiff gespeichert werden.

- Ship Lookup
  - Ship Dropdowns/Suchen nutzen die lokale DB.
  - Kein Runtime-Fallback auf externe API in den User-Flows.
  - Bugfix fuer `Size: [object Object]`.
  - `Ships DB` wurde aus der GUI-Navigation entfernt; interne APIs bleiben fuer Registrierung/Profile aktiv.

- Operation Registration / Units
  - Mehrere Units/Ships pro User sind moeglich.
  - Captain Seat ist nicht claimbar.
  - Captain/Fleetoperator koennen Seats pro Unit umbenennen.
  - Nicht benoetigte Seats koennen aktiviert/deaktiviert werden.
  - Deaktivierte Seats sind nicht claimbar/assignbar und werden beim Deaktivieren freigegeben.
  - FPS Seat Placeholder enthalten Beispiele wie `Boomtuber`, `Railgunner`, `Medic`, `Soldier`, `Sniper`.

- Seat Assignment
  - Fleetmanager/Event Leader koennen Seats anderen aktiven Usern zuweisen.
  - Nach manueller Zuweisung wird der User aus dem "Need assignment"-Pool entfernt.
  - Der zugewiesene User bekommt eine Discord-DM mit Operation, Unit/Ship, Captain und Seat.

- Crew Assignment Pool
  - User koennen sich als `Crewmember, need assignment` fuer eine Operation anmelden.
  - Optionale Notiz ist moeglich.
  - Fleetmanager/Event Leader sehen den Pool in der Operation.
  - User oder Fleetmanager koennen Requests entfernen.

- Event Leaders
  - Event Leader sind assignbar, nicht claimbar.
  - Rollen: `event_leader`, `fleet_commander`, `raid_leader`, `wing_commander`.
  - Raidlead-Anzeige nutzt Discord Avatar, falls vorhanden.

- Operation Dashboard
  - Drei-Spalten-Layout:
    - Links: aktuelle Flotte
    - Mitte: Steuerung/Composition/Registration
    - Rechts: Aktionsdetails
  - Aktionsdetails zeigen Status, Treffpunkt, Zeit, Raidlead und Briefing.
  - Systemgrafik fuer Stanton/Pyro/Nyx.

- Meeting Location
  - Operationen haben jetzt ein konkretes `meetingLocation`.
  - Location-Vorschlaege kommen aus lokaler DB statt Hardcode.
  - Location-Katalog wird aus `https://api.star-citizen.wiki/api/locations` synchronisiert.
  - Manueller Sync wurde ausgefuehrt: `1955` Locations fetched, `0` failed.
  - Verifizierte Beispiele:
    - `Checkmate` / Pyro
    - `Levski` / Nyx
    - `HUR-L1 Green Glade Station` / Stanton
    - `HUR-L1 Green Glade Clinic` / Stanton

- Discord Integration
  - Separater Fleetplanner Bot:
    - `DISCORD_FLEETPLANNER_CLIENT_ID`
    - `DISCORD_FLEETPLANNER_BOT_TOKEN`
  - Fallback bleibt `DISCORD_BOT_TOKEN`.
  - Feedback Tickets werden ueber den Fleetplanner Bot gesendet.
  - Scheduled Events werden ueber den Fleetplanner Bot erstellt.
  - Accepted Captain bekommt automatisch `Commander` Role.
  - Accepted Captain bekommt Discord-DM mit Operation-Link und Voice-Client Links.
  - Neue optionale Env Keys:
    - `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL`
    - `FLEETPLANNER_VOICE_CLIENT_CONFIG_URL`

- Feedback
  - Neue Feedback Page.
  - Feedback geht per Discord in einen GUI-konfigurierbaren Channel.
  - Channel ID ist im Admin Panel konfigurierbar.

- View As Role
  - Fleetplanner kann Rollenansichten simulieren, damit man sieht, was Crew/Guest/etc. sehen.

- Footer
  - RDOC RSI Link gesetzt.
  - Tested by Links gesetzt:
    - smorxel Twitch
    - Infinite Horizon RSI
    - Voidforge Armaments RSI

### Monitoring / Grafana

- Grafana Dashboard fuer RDOC Suite erweitert.
- LiveKit-Metriken eingebunden, darunter Bandwidth/Transfer-Summen.
- Prometheus soll nicht public erreichbar sein; Zugriff ueber geschuetztes Grafana.

### Verifikation

- Lokale Builds:
  - `pnpm.cmd --filter @rdoc-suite/fleetplanner build` erfolgreich.
  - Prisma Client Generate erfolgreich.

- Server:
  - Docker Build fuer `rdoc-suite-fleetplanner:latest` erfolgreich.
  - Container `rdoc-suite-fleetplanner` gestartet.
  - Prisma Migrations erfolgreich angewendet.
  - Location Sync erfolgreich: `1955/1955`.

### Bekannte offene Punkte / Hinweise

- Discord DM kann fehlschlagen, wenn Discord keine DM erlaubt.
  - Beobachteter Fehler: `Cannot send messages to this user due to having no mutual guilds`.
  - Voraussetzung: Fleetplanner Bot und User muessen im gleichen Discord Guild sein; User muss DMs erlauben.

- Voice Client Links sind optional.
  - Wenn `FLEETPLANNER_VOICE_CLIENT_DOWNLOAD_URL` und `FLEETPLANNER_VOICE_CLIENT_CONFIG_URL` leer sind, sendet die Captain-DM nur einen Fallback-Hinweis.

- `Ships DB` ist aus der Navigation entfernt, die Route/API bleibt bewusst erhalten, weil Registrierung und Profil die lokale Ship DB weiter benoetigen.

## Commit Message

```text
feat(fleetplanner): add profiles, crew assignment, locations sync and discord workflows

- add user-owned ships and profile management
- use local ship database for fleet registration and fix ship size rendering
- allow multiple units per user and configurable unit seats
- support disabled seats and manual seat assignment by fleet leaders
- add crew "need assignment" pool for operations
- add event leader assignment and role preview mode
- add operation dashboard with fleet overview, action details and raidlead avatar
- add meeting system and DB-backed meeting location catalog
- sync locations from star-citizen.wiki into local database
- add Discord Fleetplanner Bot support for feedback, events, captain roles and DMs
- notify accepted captains with voice client links
- notify users when they are assigned to a seat
- add feedback ticket page with GUI-configurable Discord channel
- update footer links and remove Ships DB from navigation
- extend monitoring dashboards with RDOC and LiveKit metrics
```
