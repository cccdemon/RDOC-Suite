# RDOC-Suite Testplan

## Systemübersicht

Zwei getrennte Subsysteme in einem Stack:

| System | URL | Zweck |
|---|---|---|
| Fleetplanner | `voice.raumdock.org` | SC Fleet-Op-Planung + Mission Voice |
| Bridge Admin | `suite.raumdock.org/admin` | Channel-Commander PTT-Verwaltung |
| Companion App | lokal | PTT-Client + Fleet-Voice-Client |

---

## Phase 0: Rollen verstehen

### Fleetplanner-Rollen (User.role)

| Rolle | Kann |
|---|---|
| `superadmin` | Alles; global |
| `fleetoperator` | Ops erstellen/managen, Units accept/reject |
| `crew` | Default; kann Ops beitreten, Units registrieren, eigene Unit-Seats konfigurieren, Seats claimen |

Zuweisung: Fleetplanner-Admin setzt `user.role` direkt im Admin-UI oder via Discord-Rolle-Mapping in Guild-Settings (`admiralRoleId` -> `fleetoperator`).

### Bridge/Companion-Rollen (Channel Commander PTT)

| Tier | Wer | Autorisierung |
|---|---|---|
| **Admin** | Discord-User auf AdminUser-Whitelist | `BRIDGE_SUPERADMIN_*` env-Seed oder Invite-Link |
| **Admiral** | API `key:secret` vom Admin erhalten | Companion ADMIRAL-Tab; kann Sessions erstellen + Commander einladen |
| **Commander** | One-shot Invite-Token vom Admiral | Companion SESSION-Tab |

Discord-Rolle für Commander: Snowflake in `GuildConfig.commanderRoleIds` (Bridge Admin → Konfig-Seite).

---

## Phase 1: Voraussetzungen prüfen

- [ ] `docker compose ps` auf Server → alle Container `Up`
- [ ] `suite.raumdock.org/admin` → Login mit Discord möglich
- [ ] `voice.raumdock.org` → Login mit Discord/GitHub/Google möglich
- [ ] Bridge Admin → **Konfig** → "System aktiviert" = ✓
- [ ] Bridge Admin → **Konfig** → Commander Role ID gesetzt (Discord-Rollen-Snowflake)
- [ ] Fleetplanner: eigene User-Rolle = `fleetoperator` oder `superadmin`

---

## Phase 2: Operation/Event erstellen

**Voraussetzung:** User hat `fleetoperator`- oder `superadmin`-Rolle im Fleetplanner.

### Schritt 1 — Neue Operation anlegen

1. `voice.raumdock.org` öffnen → Login
2. Startseite: **+ New Operation** klicken (Button oben rechts)
3. Formular ausfüllen:
   - **Titel** — z. B. "Alpha Squadron Training"
   - **Op-Typ** — `combat`, `pve`, `mining`, `salvage`, `training`, `mixed`, etc.
   - **Scheduled At** — Datum + Uhrzeit
   - **System** — `stanton`, `nyx`, oder `pyro`
   - **Meeting Location** (optional)
   - **Beschreibung** (optional)
4. Absenden → Op-Detailseite, Status = `draft`

- [ ] Op erscheint auf Startseite im Kalender-Board

### Schritt 2 — Op strukturieren

Auf der Op-Detailseite (als `fleetoperator`):

1. **Leaders** → `Assign Leader` → User + Rolle wählen (`raid_leader`, `fleet_commander`, `event_leader`, `wing_commander`)
2. **Composition** → `+ Add Group` → Gruppenname (z. B. "Strike Wing")
3. In Gruppe: `+ Requirement` → Label + Kategorie + Anzahl + Notiz

- [ ] Leader-Tag erscheint in Leaders-Sektion
- [ ] Composition-Gruppe mit Requirements sichtbar

### Schritt 3 — Op öffnen

Status-Button **open** klicken:

- [ ] Mission Voice Rooms Sektion zeigt "LIVE"
- [ ] Discord-Rollen assignt: `commanderVoiceRoleId` -> Command Net User; `globalVoiceRoleId` -> Global Radio Net User

### Schritt 4 — Unit registrieren (Crew-Perspektive)

1. Als User mit `crew`-Rolle einloggen
2. Op aufrufen → `+ Register a Unit`
3. Ship suchen oder aus eigenem Profil wählen (oder FPS-Squad)
4. Optional: Composition Slot wählen
5. **Register Unit** klicken

- [ ] Unit erscheint mit Status `pending`

### Schritt 5 — Unit akzeptieren (als fleetoperator/leader)

1. Unit-Card → **Accept**

- [ ] Unit Status wechselt zu `accepted`
- [ ] Seats sind claimbar

### Schritt 6 — Discord-Rolle für Unit-Captain setzen

Auf accepted Unit: **Commander**- oder **Admiral**-Button klicken (Bridge-Bot muss laufen).

- [ ] Discord-Rolle wurde dem Captain zugewiesen (im Discord prüfen)

---

## Phase 3: Companion App — Channel Commander PTT

**Voraussetzung:** Discord-Konto hat Commander-Rolle auf dem Server (laut `GuildConfig.commanderRoleIds`).

### Erste Einrichtung

1. Companion App starten
2. **Settings** → `Bridge URL` = `https://suite.raumdock.org` prüfen
3. **Hotkey** wählen (Default: `Mouse4`) — `Change Hotkey` → Taste drücken
4. **Sign in with Discord** → Server-ID eingeben → Browser öffnet Discord OAuth
5. Autorisieren → Deep-Link `dccc://auth?token=…` wird gefangen

- [ ] Status: Signed in: yes · Connection: connected

**Mögliche Fehler:**

| Fehler | Fix |
|---|---|
| `403 missing_commander_role` | Bridge Admin → Konfig → Commander Role ID prüfen; Rolle dem User geben |
| `guild_not_enabled` | Bridge Admin → Konfig → "System aktiviert" ticken |
| `403 not_a_member` | User ist kein Mitglied des Discord-Servers |

### PTT testen

1. Hotkey **gedrückt halten** → Fenster wird rot → "COMMANDER BRIDGE LIVE"
2. Mikrofon-Permission bestätigen (einmalig)
3. Hotkey loslassen → Bridge schließt sofort

- [ ] Audio-Status zeigt `connected`
- [ ] Bridge Admin → Monitoring → Session-Eintrag erscheint

---

## Phase 4: Companion App — Fleet Voice (Fleetplanner)

**Voraussetzung:** Unit in einer accepted Position für eine offene Op.

### Einrichtung

1. Companion Settings → `Fleetplanner URL` = `https://voice.raumdock.org`
2. **FLEET LOGIN** Button → Webview öffnet OAuth (Discord/GitHub/Google)
3. Autorisieren → Deep-Link `dccc://fleet-auth?token=…` wird gefangen

- [ ] Token gespeichert; FLEET-Button zeigt Status

### Verbindung

App pollt `/api/companion/voice` alle 20 Sekunden. Wenn offene Op + accepted Unit existiert:

- [ ] FLEET-Status = `connected`
- [ ] `fleetRoomName` + `fleetOpTitle` in UI sichtbar

### Fleet-PTT testen

1. Fleet-PTT-Taste halten → `fleetPttActive = true`
2. Crew im selben Unit-LiveKit-Room hört Audio

- [ ] Kein Audio-Feedback von sich selbst (Kopfhörer nutzen)

---

## Phase 5: Rollen-Zuweisung — Zusammenfassung

| Person | Welche Rolle | Wo setzen |
|---|---|---|
| Erster Admin (Bootstrap) | Bridge `Admin` | `BRIDGE_SUPERADMIN_DISCORD_ID` + `_GUILD_ID` in `.env` |
| Weitere Admins | Bridge `Admin` | Bridge Admin UI → Invite-Link |
| PTT-Nutzer | Discord Commander-Rolle | Discord selbst; Snowflake in Bridge Admin → Konfig |
| Admiral (Session-Ersteller) | Bridge `Admiral` (key:secret) | Bridge Admin UI → Admirals → Credential ausstellen |
| Fleet-Op-Ersteller | Fleetplanner `fleetoperator` | Fleetplanner Admin oder Discord `admiralRoleId`-Mapping in Guild-Settings |
| Unit-Captain | Mission Unit-Captain | Entsteht durch Unit-Registrierung und Accept, kein Fleetplanner-Rang |
| Crew | Fleetplanner `crew` | Default; kann Units registrieren und Seats claimen |
| Global Radio Net | Discord `globalVoiceRoleId` | Automatisch fuer Event/Raid/Wing Leader und explizit aktivierte Commanders |
| Command Net | Discord `commanderVoiceRoleId` | Automatisch fuer accepted Unit-Captains, Event/Raid/Wing Leader und manuelle Commanders |

---

## Schnell-Checkliste Gesamttest

```
[ ] Server-Stack läuft (docker compose ps)
[ ] Bridge Admin: System aktiviert, Commander-Role-ID gesetzt
[ ] Fleetplanner: eigene Rolle = fleetoperator (über Admin oder Discord-Mapping)
[ ] Op erstellen → Status draft → open
[ ] Als zweiter User: Unit registrieren
[ ] Als fleetoperator: Unit accepten
[ ] Companion: Fleet Login → Fleet Voice verbindet automatisch
[ ] PTT-Test: Channel Commander Hotkey funktioniert (Fenster rot)
[ ] PTT-Test: Fleet Hotkey funktioniert (fleetPttActive)
[ ] Bridge Admin → Monitoring: Sessions erscheinen
```

