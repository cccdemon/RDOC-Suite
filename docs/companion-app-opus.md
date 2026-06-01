# Companion App — Neuarchitektur (Mission-First, 2 PTT)

## 1. Zusammenfassung

Die Companion-App (`apps/companion/`, Tauri v2 + React + TypeScript) wird von einem
Multi-Mode-Konstrukt (Bridge-PTT + Relay-PTT + Fleet-Voice-Unit + Fleet-Voice-Global +
Mission-Commander + Mission-Global = bis zu 6 Audio-Pfade, 4 Hotkeys, 3 Auth-Flows) auf
eine **mission-first 2-PTT-Architektur** reduziert.

Kernidee:

- Es gibt nur noch **zwei Push-to-Talk-Tasten**: `localHotkey` (LOKAL) und `globalHotkey` (RELAY/GLOBAL).
- **PTT-1 (LOCAL)** ist *kontextabhaengig*: ohne Mission spricht es in den Guild-Bridge-Raum
  (Squad Link, LiveKit ueber die Bridge — unveraendert), mit aktiver Mission in den
  `commanderRoom` der Mission.
- **PTT-2 (RELAY/GLOBAL)** ist *immer* der Discord-Relay-Pfad (`RelayAudio`). Es gibt
  **keinen** globalen LiveKit-Fleet-Raum mehr.
- Der **Fleetplanner-OAuth-Flow** und die **20-Sekunden-Voice-Polling-Schleife** entfallen
  vollstaendig. Statt sich beim Fleetplanner anzumelden, erhaelt ein Commander einen
  **Mission-Link** (Deep Link) zugeschickt.
- Das Deep-Link-Schema wird von `dccc://fleet-voice?token=...&url=...` auf
  `rdoc://mission?token=...&url=...` umbenannt. Waehrend der Uebergangsphase werden **beide**
  Schemata akzeptiert.
- Backend: das `mission-voice`-Endpoint liefert kuenftig **kein** `globalRoom`-Feld mehr,
  nur noch `commanderRoom`. Das `/api/companion/voice`-Endpoint wird stillgelegt.

**Erwartetes Ergebnis:** weniger State, weniger Effects, ein einziger Auth-Weg (Bridge),
ein klar definierter Mission-Lebenszyklus, deutlich einfachere Settings (2 statt 4 Hotkeys).

---

## 2. Neue Architektur

### Zwei Voice-Pfade

| PTT | Hotkey | Ohne Mission | Mit Mission | Transport |
|-----|--------|--------------|-------------|-----------|
| **LOCAL** | `localHotkey` | Guild-Bridge-Raum (Squad Link) | Mission `commanderRoom` | LiveKit |
| **RELAY** | `globalHotkey` | Discord-Relay (wenn `canUseRelay`) | Discord-Relay (wenn `canUseRelay`) | RelayAudio -> Discord-Bots |

Der RELAY-Pfad ist von der Mission **entkoppelt** — `relayRef` verbindet sich immer, sobald
`suiteCapabilities.canUseRelay === true` (plus Token + Guild vorhanden). Mission an/aus
aendert daran nichts. RELAY ist nur sichtbar/aktiv, wenn die Relay-Capability existiert.

Der LOCAL-Pfad wechselt sein Ziel je nach Mission-Zustand. Technisch bleibt die
**Bridge-WS + LivekitAudio**-Session (`audioRef`) fuer den missionslosen Fall vollstaendig
erhalten; im Mission-Fall uebernimmt die Mission-Commander-LiveKit-Verbindung
(`missionCommanderRef`) die Rolle von PTT-1.

### State-Machine (LOCAL-Pfad)

```
                         rdoc://mission Link  (saveMissionConfig)
                                   |
        +--------------+          v            +------------------------+
        |  NO MISSION  | -------------------->  |   MISSION (polling)    |
        |              |                        |                        |
        | PTT-1 ->     |                        |  mission-voice poll:   |
        | Guild Bridge |                        |   op != null           |
        | (audioRef,   | <--------------------  |   -> connect           |
        |  LivekitAudio)|   op == null  ODER     |   commanderRoom        |
        +--------------+   onMissionDisconnect   |  PTT-1 -> commanderRoom|
                            (clearMissionConfig) |  (missionCommanderRef) |
                                                 +------------------------+

   PTT-2 (RELAY): unabhaengig, immer aktiv solange canUseRelay — kein Zustand oben.
```

Wichtig: Im Mission-Zustand bleibt die Guild-Bridge-WS fuer Roster/Status weiterhin
verbunden (Squad Roster, Ducking-Diff, Mute/AFK-Broadcast). Nur die *Sende-Zuordnung* von
PTT-1 verschiebt sich auf den `commanderRoom`. (Entscheidung im Review festzulegen: ob die
Bridge-LiveKit-Audiosession im Mission-Modus stummgeschaltet oder getrennt wird — siehe Paragraph 9,
Schritt F.)

---

## 3. State-Modell

Datei: `apps/companion/src/App.tsx`, Typ `AppState` (Z. 70-131) und `INITIAL` (Z. 133-179).

### Entfernen (Felder + zugehoerige `INITIAL`-Defaults)

Fleet-Voice (Fleetplanner-OAuth + Polling) komplett:

- `fleetStatus` (Z. 110)
- `fleetPttActive` (Z. 111)
- `fleetRoomName` (Z. 112)
- `fleetOpTitle` (Z. 113)
- `fleetplannerToken` (Z. 115) — OAuth-Token entfaellt
- `globalFleetStatus` (Z. 116)
- `globalFleetPttActive` (Z. 117)

Mission-Global (es gibt keinen globalen LiveKit-Mission-Raum mehr):

- `globalMissionStatus` (Z. 123)
- `globalMissionPttActive` (Z. 125)

> `fleetplannerUrl` (Z. 114) **bleibt** erhalten — er wird weiterhin als `missionUrl`-Default
> bzw. fuer die Diagnostics-Buttons genutzt. (Review: ggf. in `missionUrl`-Default ueberfuehren.)

### Umbenennen

- `commanderHotkey` -> `localHotkey` (Z. 126; Default `"Mouse5"` -> uebernimmt den bisherigen
  LOCAL/PTT-Default, siehe Paragraph 4 Migration).
- `globalHotkey` bleibt namentlich, bekommt aber neue Semantik: **RELAY**-PTT (vorher der
  Mission-Global-Hotkey). Siehe Paragraph 4.
- Der bisherige Bridge-PTT-State `hotkey` (Z. 77) und `relayHotkey` (Z. 78) verschmelzen in
  `localHotkey` / `globalHotkey` (siehe Paragraph 4 Hotkey-Konsolidierung).

### Behalten (Mission-Commander-Pfad)

- `missionActive` (Z. 119)
- `missionOpTitle` (Z. 120)
- `missionHasCommander` (Z. 121) — bleibt, da `commanderRoom` optional sein kann
- `commanderStatus` (Z. 122) — Status der `missionCommanderRef`-Verbindung
- `commanderPttActive` (Z. 124)
- `missionToken` (Z. 128), `missionUrl` (Z. 129), `missionEnded` (Z. 130)

### Resultierender Mission-Block in AppState (Soll)

```ts
// -- Mission Voice -----------------------------------------------------
missionActive: boolean;
missionOpTitle: string | null;
missionHasCommander: boolean;     // commanderRoom vom Backend geliefert?
commanderStatus: FleetStatus;     // missionCommanderRef-Verbindung
commanderPttActive: boolean;
missionToken: string | null;
missionUrl: string | null;
missionEnded: boolean;
// Hotkeys (konsolidiert)
localHotkey: string;   // PTT-1
globalHotkey: string;  // PTT-2 (Relay)
```

### Refs entfernen (Z. 200-208)

- `fleetRef` (Z. 200)
- `globalFleetRef` (Z. 201)
- `currentFleetRoomRef` (Z. 202)
- `currentGlobalRoomRef` (Z. 203)
- `missionGlobalRef` (Z. 206)
- `currentMissionGlobalRoomRef` (Z. 208)

Behalten: `missionCommanderRef` (Z. 205), `currentMissionCommanderRoomRef` (Z. 207),
`relayRef` (Z. 199), `audioRef` (Z. 198), `wsRef` (Z. 197).

---

## 4. Hotkey-Konsolidierung (4 -> 2)

Heutiger Zustand — vier Hotkeys:

| Alt-Feld (store.ts / AppState) | Default | Zweck |
|--------------------------------|---------|-------|
| `hotkey`         | `Mouse4` (config.ts `DEFAULT_HOTKEY`) | Bridge-PTT |
| `relayHotkey`    | `R` (`DEFAULT_RELAY_HOTKEY`)          | Discord-Relay-PTT |
| `commanderHotkey`| `Mouse5`                              | Mission-Commander-PTT |
| `globalHotkey`   | `F9`                                  | Mission-Global-PTT |

Soll — zwei Hotkeys:

| Neu-Feld | Default | Zweck (kontextabhaengig) |
|----------|---------|--------------------------|
| `localHotkey`  | `Mouse4` | PTT-1: ohne Mission -> Bridge; mit Mission -> commanderRoom |
| `globalHotkey` | `R`      | PTT-2: Discord-Relay (immer) |

### Migration der alten Store-Keys

Beim Laden (`loadSettings`) wird gelesen mit Fallback-Kette:

```
localHotkey  = store.localHotkey  ?? store.hotkey         ?? DEFAULT_HOTKEY ("Mouse4")
globalHotkey = store.globalHotkey ?? store.relayHotkey    ?? DEFAULT_RELAY_HOTKEY ("R")
```

Begruendung der Zuordnung:
- `hotkey` (Bridge-PTT) war der primaere Sprechkanal -> wird `localHotkey`.
- `relayHotkey` war bereits der Relay-Kanal -> wird `globalHotkey` (neue RELAY-Semantik).
- `commanderHotkey` (`Mouse5`) und der alte `globalHotkey` (`F9`, Mission-Global) entfallen
  als eigenstaendige Keys. Falls ein Bestandsnutzer `commanderHotkey` gesetzt hatte, ist die
  bewusste Design-Entscheidung: **nicht** automatisch uebernehmen (PTT-1 ist jetzt der
  Bridge-Key). Optional kann beim ersten Start ein Hinweis-Banner gezeigt werden — kein
  harter Migrationszwang.

`saveCommanderHotkey` / `saveRelayHotkey` / `saveHotkey` werden durch
`saveLocalHotkey` / `saveGlobalHotkey` ersetzt (siehe Paragraph 5, store.ts).

---

## 5. Frontend-Aenderungen

### 5.1 `apps/companion/src/lib/config.ts`

1. `DEFAULT_HOTKEY = "Mouse4"` bleibt — wird Default fuer `localHotkey`.
2. `DEFAULT_RELAY_HOTKEY = "R"` bleibt — wird Default fuer `globalHotkey`.
3. `DEFAULT_FLEETPLANNER_URL` bleibt als Mission-URL-Default nutzbar.

### 5.2 `apps/companion/src/lib/store.ts`

1. **Settings-Typ (Z. 12-69):**
   - Entfernen: `fleetplannerToken` (Z. 18), `hotkey` (Z. 20), `relayHotkey` (Z. 22),
     `commanderHotkey` (Z. 66). *(Hinweis: Keys bleiben physisch in der JSON-Datei liegen
     und werden nur noch als Fallback gelesen — siehe Paragraph 8.)*
   - Hinzufuegen: `localHotkey: string`.
   - `globalHotkey: string` (Z. 68) bleibt (neue Semantik).
2. **DEFAULTS (Z. 74-91):** `commanderHotkey: "Mouse5"` (Z. 89) entfernen;
   `localHotkey: DEFAULT_HOTKEY`, `globalHotkey: DEFAULT_RELAY_HOTKEY` setzen.
   `hotkey`/`relayHotkey` aus DEFAULTS entfernen.
3. **`loadSettings` (Z. 98-170):** zusaetzlich `localHotkey` + `globalHotkey` lesen, mit der
   Fallback-Kette aus Paragraph 4. `fleetplannerToken` nicht mehr zurueckgeben.
4. **Save-Funktionen:**
   - Entfernen: `saveHotkey` (Z. 185), `saveRelayHotkey` (Z. 190),
     `saveFleetplannerToken` (Z. 205), `clearFleetplannerToken` (Z. 210),
     `saveCommanderHotkey` (Z. 274).
   - Hinzufuegen: `saveLocalHotkey(acc)` -> `store.set("localHotkey", ...)`.
   - Behalten/anpassen: `saveGlobalHotkey` (Z. 279) bleibt.
   - `saveMissionConfig` (Z. 262) / `clearMissionConfig` (Z. 268) bleiben unveraendert.

### 5.3 `apps/companion/src/App.tsx`

**Imports (Z. 22-68):** entfernen `saveFleetplannerToken`, `clearFleetplannerToken`,
`saveCommanderHotkey`, `saveRelayHotkey`, `saveHotkey` (durch `saveLocalHotkey` ersetzen),
`FleetAudio`/`FleetStatus` bleiben (von `commanderStatus` genutzt), `startFleetOAuthInWebview`
(Z. 65) entfernen.

**Zu entfernende useEffect-/Handler-Bloecke:**

1. **Fleet-Voice-Polling-Effekt (Z. 803-876)** — komplett entfernen. Das ist die
   20s-`/api/companion/voice`-Schleife inkl. `unitRoom`/`globalVoice`-Handling.
2. **`onFleetOAuth` (Z. 878-888)** — entfernen.
3. **`onFleetSignOut` (Z. 890-904)** — entfernen.
4. **`onFleetPttEvent` (Z. 744-747)** — entfernen.
5. **`onGlobalFleetPttEvent` (Z. 906-909)** — entfernen.
6. **`onGlobalMissionPtt` (Z. 917-920)** — entfernen (kein Mission-Global mehr).
7. **Global-Mission-Hotkey-Effekt (Z. 1135-1172)** — entfernen.
8. **Mission-Global-Anteil im Polling-Effekt (Z. 991-1086):** den `globalRoom`-Block
   (Z. 1038-1050) und alle `missionGlobalRef`/`currentMissionGlobalRoomRef`-Zugriffe
   entfernen. Response-Typ `MissionVoiceResponse` (Z. 995-1003) auf nur `commanderRoom`
   reduzieren (`globalRoom` raus). `data.op`-Destrukturierung (Z. 1036) ohne `globalRoom`.
   Der `commanderRoom`-Block (Z. 1052-1069) bleibt, ebenso `setState` (Z. 1071-1077) ohne
   `globalMissionStatus`/`globalMissionPttActive`. Polling-Intervall 30s bleibt.

**Zu konsolidierende Bloecke:**

9. **Bridge-PTT-Hotkey:** `handlePttEvent` (Z. 256-277) bleibt der LOCAL-Handler. Im
   Mission-Modus muss er statt `audioRef`/`ws.send(ptt:start)` die
   `missionCommanderRef.setPttActive(pressed)` ansteuern. Empfehlung: in `handlePttEvent`
   per `stateRef.current.missionActive && stateRef.current.missionHasCommander` verzweigen:
   - Mission-aktiv -> `missionCommanderRef.current?.setPttActive(e.state === "pressed")`
   - sonst -> bestehender Bridge-Pfad (`audioLocal.setMuted` + `ws.send`).
   Ducking + Feedback-Sounds bleiben in beiden Zweigen erhalten.
10. **Window-Fallback-Listener fuer PTT-1:** der Effekt Z. 290-314 hoert auf `state.hotkey`.
    Auf `state.localHotkey` umstellen.
11. **Relay-PTT:** `onRelayPttEvent` (Z. 749-753) bleibt, wird zu PTT-2. Der
    Relay-Hotkey-Window-Listener (Z. 756-779) hoert auf `state.relayHotkey` -> auf
    `state.globalHotkey` umstellen. Bedingung `state.suiteCapabilities.canUseRelay` bleibt.
12. **Relay-Connect-Effekt (Z. 782-801):** bleibt unveraendert (kein Mission-Bezug).
13. **Commander-Hotkey-Effekt (Z. 1093-1132):** dieser Effekt registrierte den separaten
    `commanderHotkey` als Extra-Hotkey fuer die Mission. Da PTT-1 jetzt ueber `localHotkey`
    (= `handlePttEvent`) laeuft und Mission-aktiv darin verzweigt, wird dieser **gesonderte**
    Effekt **entfernt**. Die Mission-Commander-PTT nutzt denselben `localHotkey`. (Damit
    entfaellt `setExtraHotkey("mission-commander", ...)`.)

**Mount-Effekt (Z. 353-552):**
14. `loadSettings()`-Destrukturierung: `settings.hotkey`/`relayHotkey`/`commanderHotkey`/
    `fleetplannerToken` raus; `settings.localHotkey`/`settings.globalHotkey` rein.
15. `setupHotkey(settings.hotkey, handlePttEvent)` (Z. 508) -> `setupHotkey(settings.localHotkey, ...)`.
16. `setState`-Initialisierung (Z. 519-539): `hotkey`/`relayHotkey`/`commanderHotkey`/
    `fleetplannerToken` raus; `localHotkey`/`globalHotkey` rein.
17. Cleanup (Z. 542-551): `fleetRef`/`globalFleetRef`/`missionGlobalRef`-Disconnects raus.

**`onSettingsSave` (Z. 1190-1312):**
18. Variablen `nextHotkey`/`nextRelayHotkey`/`nextCommanderHotkey` (Z. 1194-1196) durch
    `nextLocalHotkey`/`nextGlobalHotkey` ersetzen.
19. Hotkey-Save-Bloecke (Z. 1207-1229) auf zwei reduzieren: `localHotkey` (mit
    `setupHotkey` + `saveLocalHotkey`) und `globalHotkey` (mit `saveGlobalHotkey`).
20. `setState` (Z. 1283-1297) + Dependency-Array (Z. 1300-1311) entsprechend anpassen.

**`onSignOut` (Z. 1174-1188):** `fleetRef`-Disconnect (Z. 1177) entfernen.

**JSX / Header (Z. 1396-1470):** den gesamten Fleetplanner-Block (FLEET VOICE / GLOBAL /
BOT TEST / FLEET ABMELDEN / FLEET LOGIN) entfernen. `onFleetplannerDiagnosticsClick`
(Z. 693-697) kann erhalten bleiben, falls BOT-TEST woanders gewuenscht — andernfalls ebenfalls
entfernen.

**JSX PTT-Anzeige (Z. 1759):** `{state.hotkey}` -> `{state.localHotkey}`.

**Relay-Button (Z. 1471-1486):** `title` und Mouse-Handler von `state.relayHotkey` auf
`state.globalHotkey` umstellen.

**SettingsModal-Aufruf (Z. 1777-1799):** `hotkey`/`relayHotkey`/`commanderHotkey` durch
`localHotkey`/`globalHotkey` ersetzen.

### 5.4 `apps/companion/src/components/MissionVoicePanel.tsx`

Vereinfachen auf einen einzigen Raum (Commander). Entfernen:

- Props `globalStatus`, `globalPttActive`, `onGlobalPtt`, `globalHotkey` (Z. 7-15).
- Die GLOBAL-`mission-room`-Sektion (Z. 66-84).
- `hasCommanderRoom`-Logik bleibt: wenn kein `commanderRoom`, zeigt das Panel nur den
  Op-Titel + Hinweis "Sprich ueber Global/Relay" (kein Commander-PTT).

Verbleibende Props: `opTitle`, `commanderStatus`, `commanderPttActive`, `hasCommanderRoom`,
`onCommanderPtt`, `onDisconnect`, `commanderHotkey` (-> als Anzeige umbenennen zu
`localHotkey`, da PTT-1 jetzt der Commander-Sender ist).

App.tsx-Aufruf (Z. 1599-1613) entsprechend kuerzen: `globalStatus`, `globalPttActive`,
`onGlobalPtt`, `globalHotkey` raus; `commanderHotkey={state.localHotkey}`.

### 5.5 `apps/companion/src/components/SettingsModal.tsx`

1. `SettingsDraft`-Typ (Z. 11-26): `hotkey`, `relayHotkey`, `commanderHotkey` entfernen;
   `localHotkey`, `globalHotkey` hinzufuegen.
2. Fleetplanner-URL-Feld (Z. 176-192): bleibt **nur**, wenn `missionUrl` weiter ueber Settings
   editierbar sein soll; sonst entfernen. (Review-Entscheidung — Default: behalten, Label auf
   "Mission/Fleetplanner-URL".)
3. PTT-Hotkey-Feld (Z. 194-205): `draft.hotkey` -> `draft.localHotkey`, Label "PTT-Hotkey (Lokal)".
4. Voice-to-All-Feld (Z. 207-219): `draft.relayHotkey` -> `draft.globalHotkey`, bleibt
   `canUseRelay`-gegated.
5. Mission-Hotkey-Felder (Z. 221-237): **beide entfernen** (Commander- + Global-Mission-PTT).
6. `onSubmit` (Z. 120-134): `relayHotkey`-Trim-Logik (Z. 129) auf `globalHotkey` umstellen,
   `hotkey` -> `localHotkey`.

### 5.6 Deep-Link-Parsing — `apps/companion/src/App.tsx` (Z. 956-988)

`applyRaw` (Z. 959-968) ersetzt aktuell hart `^dccc://`. Beide Schemata akzeptieren —
beide Schema-Praefixe normalisieren und auf `token`/`url` pruefen (die Host-Unterscheidung
`fleet-voice` vs `mission` ist optional, da die Query-Parameter identisch sind):

```ts
const applyRaw = (raw: string): void => {
  try {
    const trimmed = raw.trim();
    const normalized = trimmed.replace(/^(dccc|rdoc):\/\//i, "https://link.local/");
    const u = new URL(normalized);
    const token = u.searchParams.get("token");
    const url = u.searchParams.get("url");
    if (token && url) void onMissionLinkApply(token, url);
  } catch { /* ignore */ }
};
```

---

## 6. Backend-Aenderungen (Fleetplanner / RDOC-RTC)

Datei: `apps/fleetplanner/src/routes/api.ts`.

### 6.1 `/api/companion/mission-voice` — `globalRoom` entfernen (Z. 1336-1432)

- `globalRoom`-Variable (Z. 1402) + die Guard `if (!globalRoom) return reply.send({ op: null })`
  (Z. 1405) muessen umgebaut werden: kuenftig ist `commanderRoom` der maszgebliche Raum.
- `globalToken`-Ausstellung (Z. 1408-1409) entfernen.
- Response (Z. 1422-1431) reduzieren auf:

```ts
return reply.send({
  op: {
    opId: activeOp.id,
    opTitle: activeOp.title,
    livekitUrl: env.LIVEKIT_URL,
    commanderRoom:
      commanderToken && commanderRoom ? { room: commanderRoom, token: commanderToken } : null,
  },
});
```

- Achtung Lebenszyklus: bisher signalisierte "kein `globalRoom`" -> `op: null` (Mission
  beendet). Kuenftig sollte das Vorhandensein einer **aktiven Op mit Voice-Session**
  (commanderVoiceRoom gesetzt, siehe `voiceSession.ts` Z. 168-175) die Aktivitaet bestimmen.
  Entscheidung: Wenn weder `commanderRoom` fuer den User verfuegbar ist noch die Op laeuft ->
  `op: null`. Wenn Op laeuft, der User aber **kein** Commander ist, liefert das Endpoint
  `op` mit `commanderRoom: null` — die App zeigt dann Mission-aktiv ohne Commander-PTT
  (Sprechen laeuft ueber RELAY).
- `commanderRoom`/`commanderToken`/`isCommander`-Logik (Z. 1411-1420) bleibt.

### 6.2 `/api/companion/voice` — stilllegen (Z. 1256-1326)

- Endpoint entfernen oder auf `410 Gone` setzen. Da die App das Polling entfernt, wird es
  nicht mehr aufgerufen; Entfernen ist sauberer. Zugehoerige Helper, die danach unbenutzt
  sind (`issueUnitLivekitToken`, `issueGlobalVoiceToken`), auf weitere Verwender pruefen,
  bevor entfernt.

### 6.3 Link-Generierung auf `rdoc://mission` umstellen

- `apps/fleetplanner/src/routes/api.ts` Z. 1479:
  `link: dccc://fleet-voice?<params>` -> `link: rdoc://mission?<params>`.
- `apps/fleetplanner/src/routes/web.ts` Z. 424: identisch umstellen.
- Waehrend des Rollouts duerfen alte Links (`dccc://fleet-voice`) weiter funktionieren, weil
  die App beide Schemata parst (Paragraph 5.6) — Backend selbst stellt aber nur noch `rdoc://` aus.

### 6.4 Relay-Bots

- **Keine funktionale Aenderung am Relay-Bot-Pfad noetig.** PTT-2 nutzt das bestehende
  Bridge-`/relay/token`-Endpoint via `RelayAudio` (unveraendert). Es muss lediglich
  sichergestellt sein, dass die Relay-Capability (`canUseRelay` aus `/suite/capabilities`)
  unabhaengig von der Mission gesetzt wird — das ist bereits der Fall.
- Der fruehere globale LiveKit-Fleet-Raum (`issueGlobalVoiceToken`) entfaellt; falls
  Relay-Bots dort beigetreten sind, ist das obsolet. Pruefen, ob `voiceSession.ts`-Globalraum
  (`globalVoiceRoom`, Z. 168/213) noch von anderen Stellen gebraucht wird (z. B. Discord-
  Role-Grants Z. 204) bevor er backend-seitig abgebaut wird — **auszerhalb dieses Scopes**,
  zunaechst nur das Companion-Endpoint anpassen.

---

## 7. Deep-Link-Migration (dccc:// + rdoc:// parallel)

### App-seitig

1. **`tauri.conf.json` (Z. 31-37):** Schema-Liste erweitern:
   ```json
   "deep-link": { "desktop": { "schemes": ["rdoc", "dccc"] } }
   ```
   Beide Schemata bleiben registriert, bis alte Links garantiert ausgelaufen sind.
2. **`src-tauri/src/lib.rs`:** Runtime-Registrierung (Z. 742) erweitern um `rdoc`:
   ```rust
   let _ = app.deep_link().register("rdoc");
   let _ = app.deep_link().register("dccc"); // Uebergang
   ```
   Hinweis: `dccc://fleet-auth` (Z. 164) wird weiterhin fuer den **Bridge-OAuth-Webview**
   genutzt (on_navigation) — dieser Pfad bleibt unangetastet, der Fleetplanner-OAuth
   (`dccc://fleet-auth` aus `auth.ts`) wird mit dem Wegfall des Fleet-Logins jedoch
   irrelevant. Bridge-OAuth bleibt.
3. **`applyRaw`** parst beide Schemata (Paragraph 5.6).

### Backend-seitig

- Stellt nur noch `rdoc://mission` aus (Paragraph 6.3). Alte, bereits verschickte `dccc://fleet-voice`-
  Links werden von der App weiterhin verarbeitet.

### Ausstiegskriterium

Sobald keine alten Links mehr im Umlauf sind (z. B. nach einer Mission-Token-TTL-Periode,
siehe `companionSession.ts` Token-Lebensdauer), kann `dccc` aus `schemes` und der
Runtime-Registrierung entfernt werden.

---

## 8. Settings-Migration

`loadSettings` (store.ts) liest neue Keys mit Fallback auf alte (siehe Paragraph 4):

```
localHotkey:  localHotkey  ?? hotkey      ?? DEFAULTS.localHotkey   // "Mouse4"
globalHotkey: globalHotkey ?? relayHotkey ?? DEFAULTS.globalHotkey  // "R"
```

- Beim ersten `saveLocalHotkey` / `saveGlobalHotkey` werden die **neuen** Keys geschrieben.
- Alte Keys (`hotkey`, `relayHotkey`, `commanderHotkey`, `fleetplannerToken`) werden **nicht
  aktiv geloescht** (kein destruktiver Migrationsschritt) — sie bleiben als Karteileiche in
  `settings.json` und werden ignoriert. Optional kann ein einmaliger Cleanup
  (`store.delete(...)`) beim Boot ergaenzt werden; nicht erforderlich.
- `missionToken` / `missionUrl` (store.ts Z. 62-64) bleiben unveraendert.
- Der `fleetplannerToken`-Key wird nicht mehr geschrieben/gelesen; bestehender Wert bleibt
  liegen, hat aber keine Wirkung mehr (Fleet-OAuth entfernt).

---

## 9. Reihenfolge der Umsetzung

Empfohlene Sequenz. Backend zuerst, damit die App gegen das neue Response-Schema entwickelt
werden kann — die App ist aber durch die Parser-Toleranz (Paragraph 5.6) abwaertskompatibel beim
Deep Link. Beim `mission-voice`-Response besteht hingegen eine harte Abhaengigkeit (siehe unten).

**Backend (unabhaengig deploybar):**

- **Schritt 1 — `mission-voice` Response (Paragraph 6.1):** `globalRoom` droppen. Die alte App
  liest `data.op.globalRoom.room` (Z. 1040) und wuerde bei fehlendem `globalRoom` brechen ->
  **Schritt 1 muss gemeinsam mit Frontend-Schritt D released werden** (kritische Reihenfolge-
  Abhaengigkeit). Solange alte App-Versionen im Feld sind, darf `globalRoom` NICHT entfernt
  werden — alternativ uebergangsweise `globalRoom` zusaetzlich zu `commanderRoom` weiterliefern.
- **Schritt 2 — Link-Schema (Paragraph 6.3):** `rdoc://mission` ausstellen. Unkritisch, sobald
  Frontend-Schritt B live ist (App parst beide).
- **Schritt 3 — `/api/companion/voice` stilllegen (Paragraph 6.2):** erst nachdem keine alte App
  das Endpoint mehr pollt.

**Frontend (in dieser Reihenfolge):**

- **A. store.ts + config.ts (Paragraph 5.1/5.2):** Settings-Typ, Migration, neue Save-Funktionen.
  Voraussetzung fuer alles Weitere. Unabhaengig testbar.
- **B. Deep-Link (Paragraph 5.6 + Paragraph 7):** `tauri.conf.json` + `lib.rs` + `applyRaw`. Unabhaengig.
- **C. Hotkey-Konsolidierung (Paragraph 4 + Paragraph 5.3 Punkte 9-11, 14-20):** `localHotkey`/`globalHotkey`
  verdrahten, `handlePttEvent`-Verzweigung. SettingsModal (Paragraph 5.5).
- **D. Mission-Polling + Global entfernen (Paragraph 5.3 Punkte 1-8):** Fleet-Voice-Effekt + Mission-
  Global raus; Polling-Response auf `commanderRoom` reduzieren. **Muss mit Backend-Schritt 1
  gemeinsam released werden.**
- **E. MissionVoicePanel (Paragraph 5.4):** auf Single-Room reduzieren.
- **F. Aufraeumen + Entscheidung Bridge-Audio-im-Mission-Modus:** Festlegen, ob `audioRef`
  (Guild-Bridge-LiveKit) im Mission-Modus getrennt oder nur stummgeschaltet wird, waehrend
  PTT-1 den `commanderRoom` bedient. Empfehlung: Bridge-WS verbunden lassen (Roster), aber
  Bridge-LiveKit-Senden unterdruecken, solange Mission aktiv ist.

**Unabhaengig voneinander:** A, B koennen jederzeit. C haengt an A. D haengt an A + Backend-1.
E haengt an D. F zuletzt.

---

## 10. Was bleibt (unveraendert)

- **Bridge-Auth (Discord-OAuth ueber die Bridge):** `startOAuthInWebview` (auth.ts),
  `dccc://fleet-auth`-on_navigation in `lib.rs` (Z. 164), Token-Persistenz
  (`saveSession`/`clearSession`). Unveraendert.
- **Relay-Bots / Discord-Relay-Pfad:** `RelayAudio` (`relayAudio.ts`), `/relay/token`-
  Endpoint, `canUseRelay`-Capability. Funktional unveraendert — nur der Hotkey heiszt jetzt
  `globalHotkey`.
- **LiveKit-Session-Handling:** `LivekitAudio` (`livekit.ts`), `BridgeWs` (`ws.ts`),
  Squad-Roster, `bridge:joined`/`commander:list`/`audio:enable`-Nachrichten, Session-Invite-
  Flow (`SessionJoinModal`, `joinSession`, `connectSession`). Unveraendert.
- **Discord-Ducking:** `duckingActivate`/`duckingDeactivate` (App.tsx Z. 232-254),
  `duck_discord`/`restore_discord_volume`-Invokes, `duckingEnabled`/`duckingTargetVolumePct`.
  Unveraendert.
- **Audio-Feedback (Funk-Sounds):** `feedbackAudio` (`audioFeedback.ts`), `playPttPress`/
  `playPttRelease`/`playIncomingStart`/`playIncomingStop`, zugehoerige Settings. Unveraendert.
- **Mute/AFK-Broadcast, Remote-Volumes, Geraeteauswahl, Auto-Update, Guild-Picker:** alle
  unveraendert.
- **`FleetAudio`-Klasse (`fleetAudio.ts`):** bleibt bestehen — wird weiterhin von
  `missionCommanderRef` (commanderRoom) genutzt. Nur die Global-/Unit-Verwender entfallen.

---

## Critical Files for Implementation

- C:\Users\streamer\Documents\Projekte\RDOC-Suite\apps\companion\src\App.tsx
- C:\Users\streamer\Documents\Projekte\RDOC-Suite\apps\companion\src\lib\store.ts
- C:\Users\streamer\Documents\Projekte\RDOC-Suite\apps\companion\src\components\SettingsModal.tsx
- C:\Users\streamer\Documents\Projekte\RDOC-Suite\apps\fleetplanner\src\routes\api.ts
- C:\Users\streamer\Documents\Projekte\RDOC-Suite\apps\companion\src-tauri\tauri.conf.json
