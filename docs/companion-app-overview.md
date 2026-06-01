# RDOC Squad Link — App-Übersicht & Zusammenspiel mit dem Fleetplanner

> Stand: nach der Mission-First / 2-PTT-Neuarchitektur (Companion v0.5.3).
> Plan-Referenz: [companion-app-opus.md](companion-app-opus.md).

## Was ist die App?

Windows-Desktop-App (Tauri v2 + React + TypeScript), Paket `@rdoc-suite/companion`,
Identifier `com.rdoc.suite.companion`. Push-to-Talk-Voice-Client für Star-Citizen-Flotten.
Läuft neben dem Spiel; globale Hotkeys feuern auch, wenn ein Vollbild-Spiel den Input hält
(native rdev/raw-input). Verbindet sich mit LiveKit-Voice-Rooms und dem Discord-Relay.

## Zwei PTT-Tasten (Kern-Modell)

| PTT | Hotkey (default) | Ziel |
|-----|------------------|------|
| **LOKAL** | Mouse4 (`localHotkey`) | kontextabhängig (siehe unten) |
| **GLOBAL** | R (`globalHotkey`) | Discord-Relay-Bots → alle Discord-Channels |

**LOKAL ist kontextabhängig:**

- **Keine Mission aktiv** → Guild-Bridge-Room (Squad Link, Commander-zu-Commander-Funk)
- **Mission aktiv** → Mission-Commander-Room

**GLOBAL** ist immer der Relay-Pfad (sichtbar/aktiv, wenn der Server `canUseRelay` freigibt) —
unabhängig vom Missionszustand.

## Zwei Auth-/Datenquellen

### 1. Bridge (`suite.raumdock.org`) — Haupt-Login

- Discord-OAuth im Webview → Session-JWT (`saveSession`)
- WebSocket: Squad-Roster, PTT-Signalling, Mute/AFK-Broadcast, Ducking-Diff
- LiveKit-Token für Guild-Room + Relay über `/relay/token`
- Updater-Check (`/updater/companion/check`)

### 2. Fleetplanner — Mission-Voice, **kein eigenes Login mehr**

- Läuft ausschließlich über einen **Mission-Link** (Deep Link), nicht über separates OAuth.
- Der frühere Fleetplanner-Discord-OAuth-Flow wurde entfernt.

## Zusammenspiel mit dem Fleetplanner

```
Flottenleiter erstellt OP im Fleetplanner-Web
        │ startet Voice-Session für die OP
        ▼
Fleetplanner generiert pro User einen Mission-Link:
   rdoc://mission?token=<missionToken>&url=<fleetplannerUrl>
        │ (Verteilung: Discord-DM / Op-Detail-Seite)
        ▼
User klickt Link → Companion startet/fokussiert (Deep Link)
   → applyRaw parst token+url → saveMissionConfig
        ▼
Companion pollt GET /api/companion/mission-voice
   (alle 30 s, Header: Authorization: Bearer <missionToken>)
        ▼
Fleetplanner antwortet:
   op == null              → keine aktive Session → Banner "MISSION BEENDET"
   op + commanderRoom      → Captain/Fleetoperator → LiveKit-Commander-Room-Token
   op + commanderRoom:null → normale Crew → Mission aktiv, aber kein Commander-PTT
```

### Wer bekommt was

- **Captain / Fleetoperator** → `commanderRoom`-Token → **PTT-LOKAL** sendet in den
  Commander-Kanal (Führungsfunk).
- **Normale Crew** → kein Commander-Room → spricht nur über **PTT-GLOBAL** (Relay → Discord).

### Server-seitiges Gate (Fleetplanner)

Eine OP liefert nur dann eine Voice-Session, wenn:

- `voiceEnabled` für die Guild gesetzt ist,
- der OP-Status aktiv ist (`open` / `locked` / `in_progress`),
- eine Voice-Session live ist (intern markiert über `globalVoiceRoom`).

Der `commanderRoom` ist der maßgebliche LiveKit-Room; das frühere `globalRoom`-Feld wird
nicht mehr an den Companion geliefert (Global = Discord-Relay).

## Lebenszyklus

1. App-Start → lädt Settings, Bridge-WS verbindet, sobald Token + Guild vorhanden.
2. Mission-Link kommt rein → Mission-Polling startet → `MissionVoicePanel` erscheint,
   Banner wechselt auf **MISSION MODE**.
3. **PTT-LOKAL** schwenkt automatisch auf den Commander-Room (statt Bridge).
4. OP endet (Fleetplanner liefert `op: null`) → Auto-Disconnect, Banner **MISSION BEENDET**,
   zurück in den Bridge-Modus.
5. Button **TRENNEN** → `clearMissionConfig` → manueller Austritt aus der Mission.

## Was der Fleetplanner-Pfad NICHT mehr macht (nach Overhaul)

- ~~Separates Fleetplanner-Discord-OAuth-Login~~ (entfernt)
- ~~`/api/companion/voice` Unit-Room + Global-Voice-Polling (20-s-Loop)~~ (entfernt)
- ~~Globaler LiveKit-Fleet-Room~~ — Global ist jetzt der Discord-Relay

## Modus-unabhängige Audio-Features (bleiben)

- **Discord-Ducking** — Discord wird leiser, solange Funk aktiv ist (eigene PTT oder
  eingehender Peer).
- **Funk-Sounds** — PTT-Klicks + Incoming-Chirps.
- **Per-User-Volume** — Lautstärke-Slider je Commander im Roster.
- **Mic/Output-Device-Wahl, Output-Mute, AFK-Flag, Server-Wechsel ohne Re-Auth.**

## Deep-Link-Schemata

- Neu: `rdoc://mission?token=…&url=…`
- Legacy: `dccc://fleet-voice?token=…&url=…` (wird während der Übergangsphase weiter geparst)

Registriert in `tauri.conf.json` (`schemes: ["rdoc", "dccc"]`) und in `src-tauri/src/lib.rs`.

## Auto-Update

Notify-only (kein Silent-Install): App fragt beim Start die Bridge, vergleicht Versionen,
zeigt bei einer neueren Release ein Popup. Download/Installation der NSIS-EXE erfolgt manuell
über den Browser (Single-Use-Token, SmartScreen-Anleitung).

---

**Kurzfassung:** Bridge = ständiger Funk + Identität. Fleetplanner = missionsgetriebene
Voice-Rooms via Link. Der Companion vereint beide hinter zwei PTT-Tasten (LOKAL / GLOBAL).
