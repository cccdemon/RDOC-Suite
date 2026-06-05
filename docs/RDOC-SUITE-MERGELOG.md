# RDOC Suite Merge Log

This file is the handover log for consolidating RDCC, RDOC-RTC, and
RDOC-VoiceRelayBots into this repository.

## Queued Step - 2026-06-05: Stale mission-token deadlock blocks Bridge audio — clear on definitive-ended/401 (Companion 1.0.1 + fleetplanner backend)

Symptom (live, diagnosed via LiveKit prod logs): "2 participants in bridge mode, nobody can
hear each other." Server logs (`commander-bridge-1431307397842079777-w22`, 08:51): only ONE
companion ever in the LiveKit bridge room, joined alone (`numParticipants: 0`), left after ~1s
(`CLIENT_REQUEST_LEAVE`). The "2 participants" was the WS squad roster (`commander:list`),
independent of LiveKit. The DTLS-timeout WARNs are teardown noise, not the cause.

Root cause: a **stale persisted `missionToken`** + today's Bridge↔Mission exclusivity gate
(commit 9d7c68f, `missionEngaged = !!state.missionToken`, App.tsx:1131). Bridge LiveKit connect
is skipped/torn down whenever a token is present (App.tsx:489/511/1137). The mission poll only
clears a stale token when `pinnedOpId !== null` (in-memory ref, null after restart, App.tsx:967),
and a 401 (expired token) hits `if (!res.ok) return` (App.tsx:953) → never cleared. So a token
from an already-ended/expired op deadlocks Bridge audio forever while the WS roster still shows
the user. Backend `/api/companion/mission-voice` overloads `op: null` for BOTH "op ended" (clear)
and "op active, voice not opened yet" (keep) — client can't distinguish.

Fix:
- **Backend** (`apps/fleetplanner/src/routes/api.ts`): add an `ended` discriminator to the
  `op: null` responses. `ended: true` for definitive-over (no active op / guild voice off);
  `ended: false` for pending (voice session not opened yet / no LIVEKIT_URL — transient).
- **Companion** (`apps/companion/src/App.tsx` mission poll): clear mission config (→ fall back to
  Bridge) when token is dead: `res.status === 401`, OR `op:null && (data.ended === true ||
  pinnedOpId !== null)`. Keep waiting silently on pending (`op:null && ended !== true` &&
  not pinned) and on transient non-401 `!res.ok`. Only show the "MISSION BEENDET" banner if we
  had actually joined (`pinnedOpId !== null`). Add `ended?: boolean` to `MissionVoiceResponse`.
  Backward compatible with old backend: `ended === undefined` → treated as pending (unchanged
  behavior for not-pinned), and expired tokens still self-heal via the 401 path.
- Self-healing: stale token clears within one 5s poll → `missionEngaged` flips false →
  bridge↔mission effect reconnects Bridge audio from `lastBridgeCredsRef` (set in bridge:joined
  even when the initial connect was skipped). No manual settings.json edit needed after deploy.
- Version bump Companion 1.0.1 → 1.0.2 (1.0.1 already released as commit 36d4a44).

Files: `apps/fleetplanner/src/routes/api.ts`, `apps/companion/src/App.tsx`,
`apps/companion/package.json`, `apps/companion/src-tauri/tauri.conf.json`,
`apps/companion/src-tauri/Cargo.toml` (version).

## Completed Step - 2026-06-05: relay-bots Buffer-Overflow + Doppel-Audio — Reader-Teardown + realtime-Mixer — commit e62ad47

Buffer-Overflow ist Backpressure, NICHT RAM. `pushPcm` schrieb PCM seriell in EINEN PassThrough
(192000 B/s realtime, Cap ~1s); >realtime → overflow → drop + Watchdog-Restart. Zwei Ursachen:
1. `subscriber.ts` hatte keinen TrackUnsubscribed/ParticipantDisconnected-Handler; reconnect/Restart
   (`new Room()`) ließ alte Reader-Loops weiterlaufen → mehrere Reader/Speaker → >realtime → Kaskade.
2. `botManager.pushPcm` hängte ALLE gleichzeitigen Speaker seriell in denselben PassThrough → 2 Speaker
   = 2×realtime + concat statt mix → overflow + Verzerrung.

Fix (relay-bots, Docker-Rebuild auf LXC 103):
- `subscriber.ts`: Reader pro track.sid in Map; dedupe bei re-Subscribe; `TrackUnsubscribed` +
  `ParticipantDisconnected` + Disconnected/disconnect() brechen Reader ab (`reader.cancel()` + Flag).
- `bot.ts`: pushPcm akkumuliert pro Speaker (jitter-cap ~200ms, trim-oldest = bounded Latenz). Neuer
  20ms-Output-Clock (`setInterval`) zieht 1 Frame/Speaker, **mischt** sample-weise (int16 sum+clamp),
  schreibt 1 gemischten 20ms-Frame in den PassThrough = exakt realtime → kein Overflow mehr. Idle-
  Speaker nach SILENCE_TIMEOUT entfernt; Mixer stoppt wenn alle idle.
Kein Companion-Bump (relay-bots ist nicht versioniert; deploy via `docker compose up -d --build relay-bots`).

## Completed Step - 2026-06-05: Companion 1.0.0 — Mission-Voice-UI-Politur + Brand-Logo — commit 60529fe

Audio-Tests (Command Net beidseitig, Global publish-only, Mission↔Bridge) erfolgreich → 1.0.0 sobald
Design stimmt. User-Vorgaben:
- Zwei Voice-Mode-Anzeigen (`MissionVoicePanel.tsx`) waren unstyled (CSS-Klassen `.mission-room*`
  existierten nicht in kit.css → Plain-Text). Jetzt: pro Modus eine Reihe = bordered Label-Chip
  (PTT-Button-Style) mit Status-Dot + Name + Hotkey + Meta, PTT-Button direkt daneben.
- Relabel: „Command Net (<hotkey>)" + „Global Radio Net : Permission Granted (<hotkey>)".
- Brand-Bar: nur Logo (`public/squadlink.png`, aus src-tauri/icons kopiert) statt „RDOC // SQUAD LINK"-Text.
- CSS neu in kit.css: `.cc-brand-logo`, `.mission-rooms/.mission-room/.mission-room-info/-status/-name/
  -key/-meta/.mission-ptt`.
Version 0.6.1→1.0.0 (erstes Stable). Danach: alle Releases/Tags companion-v* < 1.0.0 entfernen.

## Completed Step - 2026-06-05: Global Radio Net Doppel-Audio — RelayAudio muss publish-only sein (Companion v0.6.1) — commit b0855b1

Symptom (live verifiziert mit Hedwig): ein Commander mit Global-Net-Permission, in anderem Discord-
Channel, wird DOPPELT gehört. Bot-Mute-Test: Hedwig mutete Funkrelais-2 (ihr Channel), User sprach
Global — Hedwig hörte ihn trotzdem → die Kopie kam NICHT über den Bot.

Root Cause: `RelayAudio` ([apps/companion/src/lib/relayAudio.ts](../apps/companion/src/lib/relayAudio.ts))
wrappt `LivekitAudio`, die Klasse subscribed+attached ALLE Remote-Audio-Tracks (TrackSubscribed →
attachRemoteAudio). Der mission Relay-Raum (`fg-…`) ist aber PUBLISH-ONLY — nur die RelayBots dürfen
konsumieren (companion-voice-architecture.md §3: Global Radio Net = Broadcast via RelayBots in Discord-
Channels). Da jeder Companion im Relay-Raum die anderen direkt via LiveKit hört, entsteht: Bot-Kopie
(Discord) + LiveKit-Direkt-Kopie = DOPPELT; Bot-Mute entfernt nur die Bot-Kopie. NICHT „App sendet in
beide Räume" — Command-Net-Track ist bei reinem Global-PTT MUTED (per listParticipants gemessen).

Fix: `LivekitAudio` bekommt `publishOnly`-Modus (`autoSubscribe:false` beim connect + TrackSubscribed
skippt attach). `RelayAudio` nutzt `new LivekitAudio(true)`. Command-Net (FleetAudio) bleibt subscribe.
Version-Bump 0.6.0→0.6.1.

Follow-up (separat, relay-bots serverseitig): subscriber.ts hat keinen TrackUnsubscribed/Participant-
Disconnected-Handler + alle PCM in einen PassThrough; Watchdog-Restarts (buffer overflow) lassen alte
Reader-Loops weiterlaufen → kann INNERHALB eines Discord-Channels doppeln + Overflow-Kaskade. Eigener
Step (relay-bots Docker-Rebuild, nicht Companion).

## Completed Step - 2026-06-05: Bridge↔Mission room-Exklusivität im Code erzwingen (Companion v0.6.0) — commit 9d7c68f

Doc-Enforcement (#2) der Mode-Transitions: Bridge room (audioRef) darf bei aktivem Mission-Link nie
connecten. Vorher gegated auf `missionActive && missionHasCommander` → Lücke: solange commander room
noch nicht verbunden war, connectete Bridge doch (transiente Koexistenz → v0.5.21-Einweg-Bug).
Fix in [apps/companion/src/App.tsx](../apps/companion/src/App.tsx): Master-Gate auf `missionToken`
(=Mission-Link engaged, gesetzt bei Link, gecleart bei Mission-Ende).
- WS-Handler `bridge:joined` + `audio:enable`: `audio.connect()` nur noch wenn `!missionToken` (Creds
  werden weiter in lastBridgeCredsRef gemerkt für Return-to-Bridge).
- Bridge↔Mission-Effekt: `missionEngaged = !!missionToken` (Ref `missionOwnsLocalRef`→`missionEngagedRef`);
  engaged → Bridge disconnect; nicht-engaged + Creds + token/guildId → Bridge reconnect. Deps
  `[missionToken, token, guildId]`.
Resultat: Link → Bridge sofort raus, Mission-Räume rein; Bridge bleibt aus solange Mission; Mission-Ende
→ Bridge zurück (sofern Bridge-Gate Creds liefert). Strukturelle Garantie statt nur v0.5.21-Mitigation.
Version 0.5.21→0.6.0. Danach: alle GitHub-Releases/Tags companion-v* < 0.6.0 entfernen.

## Completed Step - 2026-06-05: Architektur-Doc — Mode-Transitions (Bridge↔Mission exklusiv) explizit — commit bd743dd

User-Klarstellung: Bridge room und Missionsräume sind room-level EXKLUSIV. Sobald der Mission-
Config-Link kommt, MUSS die Companion den Bridge room SOFORT verlassen und die Missionsräume betreten
(Commander immer; Relay wenn Global-Radio-Net-Berechtigung). Bridge Mode ist NUR aktiv solange der
User NICHT in einer Mission ist. Mission-Ende → zurück zu Bridge Mode NUR wenn die User-Rolle das
Bridge-Gate erfüllt. Doc-Ergänzung in `docs/companion-voice-architecture.md` (neuer Abschnitt
"Mode Transitions"). Bezug: der v0.5.21-Bug (ea6546f) entstand genau durch transiente Koexistenz
Bridge+Commander; die Doc verbietet diese Koexistenz jetzt explizit. Code-Enforcement (Bridge room
bei Mission garantiert ungeconnected statt transient flackernd) = separater Folge-Step.

## Completed Step - 2026-06-05: Command Net stabiles Einweg-Audio — LivekitAudio.disconnect() löscht fremde <audio> global (Companion v0.5.21) — commit ea6546f

Live mit Hedwig per `listParticipants` + Companion-Log (v0.5.19) gemessen: beide Publisher OK
(Track toggelt LIVE/MUTED korrekt mit PTT), Hedwig hört dich — du hörst Hedwig NICHT. Listener-Bug
auf deiner Seite, stabil (nicht der Flap aus v0.5.20).

Root Cause: in Mission laufen ZWEI `LivekitAudio`-Instanzen parallel — der mission commander room
(FleetAudio, identity=fleetplanner-cuid) UND der bridge/guild room (audioRef, identity=Discord-ID).
Beide attachen ihre Remote-`<audio>` an `document.body` mit `data-dccc-track`. Wenn der bridge room
in Mission abgebaut wird (`reason=1`), ruft `LivekitAudio.disconnect()`
([apps/companion/src/lib/livekit.ts](../apps/companion/src/lib/livekit.ts) ~L407):
`document.querySelectorAll("audio[data-dccc-track]").forEach(el => el.remove())` — das entfernt
ALLE solchen Elemente GLOBAL, also auch das des commander rooms. Folge: commander-Remote-Audio
(Hedwig) verschwindet, dein Mic-Publish bleibt → „Hedwig hört mich, ich höre Hedwig nicht", stabil
bis der commander room neu attached. Selbe Klasse: `data-dccc-sink`/`data-dccc-primer` global removed.

Fix: disconnect-Cleanup auf die eigene Instanz scopen — nur die Elemente aus `this.attachedRemotes`
entfernen (srcObject=null + remove), statt global per querySelectorAll. Koexistierende Rooms bleiben
unberührt. Version-Bump 0.5.20→0.5.21.

## Completed Step - 2026-06-05: Command Net flapping one-way audio — Discord-voice-gate Hysterese (Companion v0.5.20) — commit 6828d39

Symptom (live mit Hedwig diagnostiziert): im Commander Net (Mission, LiveKit `fc-<uuid>`-Raum)
hört mal der eine den anderen nicht, „wer als letztes joined wird gehört", Sprachindikator an/aus.
KEINE identity-Collision (zwei distinkte fleetplanner-userId-cuids im fc-Raum), KEIN fixes Einweg.
Per `listParticipants`-Messung: während Hedwig redete war ihr Track `LIVE`, der eigene Track die
ganze Zeit `MUTED` → PTT-1 entmutet nicht.

Root Cause: Companion mission-poll läuft alle **5s** ([apps/companion/src/App.tsx](../apps/companion/src/App.tsx)).
EIN einzelner Poll mit `discordVoice.ok=false` reißt sofort den commander room ab (`missionCommanderRef.disconnect()`,
L999-1003) + setzt `missionDiscordVoiceOk=false` → PTT-1 zwingt MUTE (L285-289). Das Gate
`missionDiscordVoiceState` ([apps/fleetplanner/src/routes/api.ts](../apps/fleetplanner/src/routes/api.ts) L376)
hängt an Bridge→Bot Discord-voice-state, der flaky/stale ist (Bot loggte 0 voiceState-Events) →
Gate flappt true↔false → commander room churnt (CLIENT_REQUEST_LEAVE alle paar s, beobachtet) →
Audio bricht beide Richtungen, versetzt pro User = „last joined wins". Channel-übergreifend (jeder
in seinem relaybot-Unit-Channel) ist GEWOLLT und vom Gate erlaubt — Problem ist nur das Flappen.

Fix (Companion, ursachenunabhängig robust): Grace-Fenster `COMMANDER_GATE_GRACE_MS=20s`. Nach dem
letzten echten `ok` toleriert der Poll transiente `ok=false` bis zur Grace, statt sofort abzureißen.
`commanderOk = discordVoiceOk || (now - lastCommanderOkAt < grace)` ersetzt `discordVoiceOk` an allen
COMMANDER-Gates (Teardown L999, Connect L1009, missionHasCommander L1072, missionDiscordVoiceOk L1075,
commanderPttActive L1079). Grace startet erst NACH erstem echten ok (init 0) → wer das Gate nie
besteht kriegt keine falsche Grace; echtes Verlassen (>20s) reißt weiterhin ab. Relay/Global-Pfad
unangetastet. Version-Bump 0.5.19→0.5.20.

Follow-up (separat, nicht in diesem Step): warum Bot 0 voiceState-Events loggt (GuildVoiceStates-Intent
/ stale UserVoiceState) — die eigentliche Flap-Quelle serverseitig härten.

## Completed Step - 2026-06-05: Fix "Relay bots sync failed (401)" — relay-admin Secret-Mismatch — commit a7ace6c

Deployed (relay-bots recreated, `[Admin] listening`). Verifiziert aus fleetplanner-Container:
authed (RELAY_BOTS_ADMIN_SECRET)=200, noauth=401. Sync muss neu angestoßen werden (Mission-Voice
neu öffnen) damit Config gepusht wird.

## Queued / Planned Step - 2026-06-05: Fix "Relay bots sync failed (401)" — relay-admin Secret-Mismatch

Regression aus dem relay-admin-Hardening (2026-06-04): relay-bots `ADMIN_PASSWORD` lag auf NEUER Var
`RELAY_ADMIN_PASSWORD`, aber Fleetplanner + Bridge senden seit jeher `RELAY_BOTS_ADMIN_SECRET` als
Basic-Auth (`admin:<secret>`) an relay-bots `/api/config` (+ metrics/restart). Mismatch → 401 „Relay
bots sync failed". Discord-Channels werden trotzdem erzeugt (eigener Discord-Pfad, kein relay-auth).
Fix: relay-bots `ADMIN_PASSWORD` = `${RELAY_BOTS_ADMIN_SECRET}` (kanonischer geteilter Secret); neue
Var entfernt. .env.prod.template dokumentiert jetzt das EINE geteilte Secret für alle 3 Parteien.
Deploy: relay-bots recreaten (nur Env).


## Completed Step - 2026-06-04: Cleanup — toten Commander-Gating-Code raus — commit a5f0739

Deployed (bridge-only, healthy, Build sauber).

## Queued / Planned Step - 2026-06-04: Cleanup — toten Commander-Gating-Code raus (post Bridge-Mode-Entkopplung)

Nach der Bridge-Mode-Entkopplung war `recheckCommanderRole` (permissions.ts) ohne Aufrufer → entfernt.
PermissionCheckResult-Reasons `no_commander_roles_configured`/`not_a_member`/`missing_commander_role`
ungenutzt → aus der Union raus. oauth.test „403 if user lacks the commander role" testete entferntes
Verhalten → gelöscht (Kommentar erklärt warum). NICHT angefasst: `GuildConfig.commanderRoleIds` +
fleetAdmin Strip-Roles/Dashboard — das sind eigene, noch genutzte Features (kein toter Code).


## Completed Step - 2026-06-04: Bridge LiveKit room weekly rotation + role-loss auto-kick — commit 4f0b113

Deployed (bridge-only, healthy). Verifiziert: `bridgeLivekitRoom(1431307397842079777)` =
`commander-bridge-1431307397842079777-w22`. Live-Migration via 60s-Recheck, role-loss-kick via
recheckBridgeAccess. Kein Companion-Bump.

## Queued / Planned Step - 2026-06-04: Bridge LiveKit room weekly rotation + role-loss auto-kick

1. **Weekly rotation:** Guild-Bridge-LiveKit-Raum rotiert alle 7 Tage. `livekit.ts`:
   `bridgeRoomRotationPeriod()` (7d-Index, Epoch 2026-01-01) + `bridgeLivekitRoom(guildId)` =
   `commander-bridge-<guild>-w<period>`; `issueLivekitToken` nutzt den rotierenden Namen. Roster-roomId
   (`bridgeRoomName`) bleibt STABIL → keine Squad-List-Churn. Live-Migration: `ws.ts` recheck (60s)
   trackt `livekitPeriod`; bei Period-Flip + Audio live → `pushAudioEnable` re-mintet + pusht frischen
   `audio:enable`-Token, Companion `audio.connect()` reißt alten Room ab + joint neuen (KEINE
   Companion-Änderung nötig). Leerer alter LiveKit-Room wird von LiveKit auto-reaped.
2. **Role-loss auto-kick:** bereits durch frühere Entkopplung — 60s-Recheck nutzt `recheckBridgeAccess`
   → wer die Bridge-Rolle (1511) verliert, fällt `checkBridgeGate` → CLOSE_FORBIDDEN, raus aus dem Raum.
Bridge-only Deploy, kein Companion-Bump.


## Queued / Planned Step - 2026-06-04: Bridge Mode entkoppelt von Commander-Rolle (per companion-voice-architecture.md)

Autoritatives Doc `docs/companion-voice-architecture.md`: Bridge Mode (kein-Mission-Modus) ist NUR
durch die Raumdock-Bridge-Rolle gegated (`bridgeRequiredRoleId`=1511124797445247096 @
`raumdockGuildId`=1431307397842079777), NICHT durch die Commander-Rolle. Commander-Rolle gehört zu
Command Net (Mission, temp-Rolle 1510192642997227602); Global Radio Net = temp-Rolle 1510192451808133210.
Code war falsch gekoppelt (OAuth-Login + WS verlangten Commander-Rolle für Bridge Mode). Fix:
- `permissions.ts`: neue `recheckBridgeAccess` (guild enabled + checkBridgeGate, KEIN Commander).
- `ws.ts handleOAuthCommander`: Connect-Gate + 60s-Recheck nutzen `recheckBridgeAccess` statt
  `recheckCommanderRole`.
- `oauth.ts`: Commander-Pflichtblock entfernt (guild enabled + Member-present + checkBridgeGate bleiben).
- DB: GlobalSettings raumdockGuildId + bridgeRequiredRoleId gesetzt.
Mission-Voice-Rollen (commanderVoiceRoleId/globalVoiceRoleId) + Fleetplanner-UI dafür = Folge-Arbeit.


## Completed Step - 2026-06-04: Companion picks up role grants live — commit dcb86e9, companion-v0.5.18

Deployed: bridge neu (healthy), Companion-Build grün → Release `RDOC.Squad.Link_0.5.18_x64-setup.exe`.
WS-Connect prüft jetzt checkBridgeGate + recheckCommanderRole live; Companion retryt 4403 alle 60s.
Rollen-Grant greift ohne Re-Login (~60s). Alte Clients bis Update: abmelden + neu anmelden.

## Queued / Planned Step - 2026-06-04: Companion picks up role grants live (4403 retry + WS-connect bridge gate)

Bug: Companion sagt dauerhaft „Bridge Mode nicht erlaubt" nachdem Admin die Rolle (CanUseBridgeMode)
gegeben hat. Ursachen: (1) Companion `ws.ts` behandelt `4403 forbidden` als terminal → kein Reconnect,
Rollen-Grant wird nie neu geprüft. (2) `bridgeRequiredRoleId`-Gate läuft NUR im OAuth-Login
(`oauth.ts`), nicht beim WS-Connect → altes Token re-evaluiert nie. Fix:
- Bridge: `checkBridgeGate({userId})` aus oauth.ts in `services/permissions.ts` extrahiert; in
  `ws.ts handleOAuthCommander` beim Connect aufgerufen (+ `recheckCommanderRole` beim Connect statt
  erst im 60s-Loop) → WS-Connect ist live-autoritativ, Reconnect reicht.
- Companion `ws.ts`: nach `4403 forbidden` langsamer Auto-Retry (60s, gedeckelt-loop) statt Dead-End
  → Rollen-Grant sickert ohne Neustart/Re-Login durch.
Companion Version-Bump 0.5.17 → 0.5.18 + Tag companion-v0.5.18.


## Completed Step - 2026-06-04: Fleetplanner Top-Nav "Unsigned Binary"-Seite

Neue Top-Nav-Seite `/why-unsigned` ("Unsigned Binary") erklärt warum die Companion-EXE (noch) nicht
Authenticode-signiert ist (SmartScreen) + alle evaluierten Optionen (Azure Trusted Signing, EV, OV,
Store/MSIX, no-sign user-bypass, EU-Individual-Geoblock) + aktueller Stand (Azure Trusted Signing
Org-Validation "Raumdock" läuft). `whyUnsignedPage` in pages.ts, Route in web.ts, Nav-Link in
render.ts (zwischen How-to und Changelog).


## Completed Step - 2026-06-04: Monitoring-Ausbau Batch 2 — commit c270a8b

Deployed + verifiziert: 6 Targets `up` (bridge/fleetplanner/livekit/node/postgres/relay-bots),
`fleetplanner_operations` 6 Serien, `bridge_ws_connections` da, `pg_up=1`. Public geblockt:
`/fleetplanner/metrics` → 404, `/metrics` → 404, `/fleetplanner` (App) → 200. Grafana Dashboard v5
(35 Panels, App-Services-Row). prom-client mit named imports (ESM-Interop). Bridge+fleetplanner
Docker-Build ohne TS-Fehler.

## Queued / Planned Step - 2026-06-04: Monitoring-Ausbau Batch 2 (fleetplanner /metrics + postgres_exporter + bridge HTTP/WS)

1. **Fleetplanner `/metrics`** (prom-client): default-Prozess-Metrics (prefix `fleetplanner_`),
   HTTP-Request-Histogram (method/route/status via onResponse-Hook), Op-Lifecycle-Gauge
   (`fleetplanner_operations` by status, async collect via Prisma groupBy). Route registriert ohne
   Base-Prefix (Caddy strippt). Scrape-Job `fleetplanner:3200`.
2. **postgres_exporter** Service (prometheuscommunity/postgres-exporter) → fleetplanner-db. Kein
   Host-Port, nur Docker-Netz. Scrape-Job `postgres-exporter:9187`. Alert PostgresDown.
3. **Bridge HTTP/WS-Metrics:** prometheusMetrics.ts auf prom-client umgestellt — default (prefix
   `bridge_`), HTTP-Histogram (onResponse), `bridge_ws_connections` Gauge (inc/dec in
   attachLifecycle/close). Bestehende `dccc_rooms_active/commanders_active/commanders_speaking`
   bleiben (als Gauges mit collect() aus rooms.globalMetrics()).
4. **SICHERHEIT:** `/fleetplanner/metrics` würde via Caddy `handle_path /fleetplanner*` öffentlich →
   Caddy-Block `handle /fleetplanner/metrics* { respond 404 }`. Prometheus scrapt intern übers
   Docker-Netz. postgres-exporter publisht keinen Port.
Deploy: caddy-rdoc + bridge + fleetplanner neu bauen, postgres-exporter + monitoring neu.


## Completed Step - 2026-06-04: Monitoring-Ausbau Batch 1 — commits b6540f2 + df18e97

Deployed + verifiziert: targets bridge/livekit/node/relay-bots alle `up`, 7 Alert-Rules geladen,
Alertmanager healthy (v0.28.1, `webhook_url_file` braucht ≥0.28), Prometheus→1 aktiver Alertmanager,
public `https://suite.raumdock.org/metrics` → 404 (geblockt), `/health` → 200, node-exporter ohne
Host-Port. **OFFEN:** Discord-Webhook ist noch Placeholder (`deploy/alertmanager/secret/discord-webhook-url`
= Beispiel-URL) → User muss echte Webhook-URL eintragen, dann liefern Alerts (kein Restart nötig,
0.28 liest die Datei beim Senden). `RelayNoAudioWhileActive` war initial „pending" — beobachten, ggf.
Schwelle/Gate justieren falls noisy.

**Nachtrag 2026-06-04:** Discord-Webhook live (Kanal 1512140718360236255, via Discord-UI erstellt —
RDOC-RTC Bot hatte kein MANAGE_WEBHOOKS, 50013). Datei `deploy/alertmanager/secret/discord-webhook-url`
gesetzt (gitignored). End-to-End verifiziert: direkter POST 204 + Synthetik-Alert durch Alertmanager,
keine notify-Errors. `RelayNoAudioWhileActive` feuert real → Schwelle/Gate evtl. nachziehen.

Grafana-Lücken-Review → Batch 1 von 2:
1. **Alerting:** Prometheus rule_files (`apps/monitoring/alerts.yml`) + Alertmanager-Service mit
   Discord-Webhook-Receiver. Rules an die Prod-Outages dieser Woche: `up==0` (ServiceDown),
   `increase(relay_watchdog_restarts_total[10m])>0` (Restart-Loop), Relay stumm während aktiv,
   `relay_bot_buffer_overflows` (robotische Stimme), Disk low. Webhook-URL als Datei-Secret
   (`deploy/alertmanager/secret/discord-webhook-url`, gitignored) — kein env-Substitution-Gefrickel.
2. **node_exporter:** Host-CPU/RAM/Disk (Disk-Fill-Vorfall 81%→52%). Kein Host-Port-Publish, nur
   Docker-Netz-Scrape. Disk-Alert <15% warn / <5% crit.
3. **relay per-bot Panels** ins Dashboard: voice_connected, buffer_bytes, overflow-rate,
   reconnect-rate (legend {{bot}}) + Watchdog-Restart-Panel. Metrics existierten, waren nur nicht visualisiert.
4. **SICHERHEIT — /metrics nicht ins Internet:** Caddy `suite.raumdock.org` Catch-all
   `reverse_proxy →:8787` exponierte bridge `/metrics` öffentlich. Fix: `handle /metrics* { respond 404 }`
   vor Catch-all. Prometheus scrapt `bridge:8787` übers Docker-Netz → unberührt. Neue Exporter
   (node-exporter/alertmanager) publishen KEINE öffentlichen Ports.
Deploy: caddy-rdoc + monitoring neu bauen, alertmanager + node-exporter neu, grafana Dashboard-Reload.
Batch 2 (separat): fleetplanner /metrics + postgres_exporter + bridge HTTP/WS-Metrics.


## Completed Step - 2026-06-04: Security-Review-Fixes (updater auth + relay-admin hardening) — commit 6304d23

Findings 1-4 fixed in commit `6304d23` (bridge updater + relay-bots adminServer).
Findings 5-6 fixed im Folge-Batch:
- **5 (Med) — Admin-CSRF:** `requireAdminSession` (`bridge/admin/middleware.ts`) prüft jetzt für
  unsafe Methoden (POST/PUT/PATCH/DELETE) Origin (Fallback Referer) gegen `OAUTH_REDIRECT_URI`-Origin
  → 403 `csrf_origin_mismatch` bei Mismatch/fehlend. Alle mutierenden Admin-Routes laufen durch diesen
  Choke-Point. GETs unberührt (Tests grün).
- **6 (Low) — Security-Header:** `onSend`-Hook in `registerAdminRoutes` setzt für alle `/admin/*`
  Responses CSP (`frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, default-src self;
  script/style behalten `'unsafe-inline'` wg. Inline-Scripts → Nonce-Härtung als Follow-up),
  X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy same-origin.

Security-Review fand 6 Findings (kein SQLi — Prisma model API). Fix in Reihenfolge:
1. **High — `bridge/routes/updater.ts:126` mint-download-token unauth:** Route authentifiziert,
   ignoriert aber `auth.ok === false` und mintet trotzdem mit `userId="auto-update"`. Fix: `401`
   zurückgeben wenn `!auth.ok` (vor dem Mint).
2. **Med — `bridge/routes/updater.ts:94` `/check` ohne Auth:** Leakt Release-Metadaten (Version/Notes/
   Asset) ohne JWT trotz Datei-Kommentar. Fix: gleiche Bearer-Auth wie mint anwenden.
3. **Med — `relay-bots/web/adminServer.ts:22` Admin offen ohne `ADMIN_PASSWORD`:** loggt nur Warnung,
   exponiert Config-Read/Write/Restart/Reload. Fix: fail-closed in Production (kein Start ohne Passwort
   außer explizit erlaubt / loopback-bind).
4. **Med — `relay-bots/web/adminServer.ts:464` Admin-XSS:** `b.name` (+ dyn. Felder) via `innerHTML`
   ohne Escaping in Metrics-Renderer. Fix: client-seitige `escapeHtml`-Helper, alle dyn. Felder escapen.
5. **Med — `bridge/.../routes.ts:643` Admin-CSRF:** nur SameSite=Lax, keine Token/Origin-Checks. (Folge,
   noch nicht in diesem Batch.)
6. **Low — Admin-HTML ohne CSP/frame-ancestors.** (Folge.)
Deploy: bridge + relay-bots Container neu bauen.

## Queued / Planned Step - 2026-06-04: Prod-Debug — Relay-Restart-Loop + Channel-Perms + Roster-Dup

Symptome Prod (10.10.10.99): Relay-Bots relayen nicht / robotische Stimme, Channel-Rechte zu
restriktiv, Duplicate-User in App. Logs (LiveKit) zeigen `voice-relay-bot-service` join → ~90s →
`CLIENT_REQUEST_LEAVE` → rejoin im Loop.
1. **Watchdog-Restart-Loop (Hauptursache Relay/robotisch):** `relay-bots/src/index.ts` Watchdog
   wertete ALLE Bots ohne Voice-Connection als „disconnected" → Neustart alle 90s. Bots joinen aber
   lazy (nur wenn Menschen im Kanal); idle = `!voiceConnected` = gesund. Fix: neues
   `BotMetrics.expectedConnected` (Menschen im Zielkanal, gesetzt in `bot.ts syncVoicePresence`);
   Watchdog restartet nur wenn erwartet-verbundene Bots alle down sind. Teardown-Loop killte Relay +
   zerhackte Live-Audio (robotisch).
2. **Channel-Rechte zu restriktiv:** `fleetplanner voiceBots.ts` setzte `@everyone deny VIEW+CONNECT`
   → nur zugewiesene Unit-Member sahen Kanal; widerspricht neuer Command-Net-Regel (Commander darf
   in JEDEN Kanal). Fix: `@everyone deny` entfernt → Kanäle erben Kategorie-Perms; Bot + Member-Allows
   bleiben. Gilt nur für NEU gelaunchte Kanäle (bestehende neu launchen).
3. **Duplicate-User:** `companion livekit.ts emitRoster` dedupt jetzt per userId (Reconnect-Race mit
   neuem identity-suffix zeigte User doppelt).
Deploy: relay-bots + fleetplanner Container neu bauen; companion neue Version.

**Nachtrag 2026-06-04 (Folge-Funde live):**
4. **Ghost-Participants / „101 im Kanal" + Command Net stumm:** `fleetplanner livekit.ts
   issueMissionVoiceToken` nutzte Identity `${userId}-${randomSuffix}` → jeder Reconnect = neuer
   Participant, SFU evictet alte nie → Räume voll Zombies. Companion keyed Remote-Audio per userId →
   stiller Ghost-Track überschrieb echten → niemand hörbar. Fix: stabile Identity (userId/relay-discordId),
   neue Connection ersetzt alte. LiveKit-Container neu gestartet zum Ghost-Flush. Commit eb4baa0.
5. **Bots löschen Channels nicht nach Op-Ende:** `voiceBots.ts cleanupOperationVoiceChannels` skippte
   Löschung wenn Channel „occupied" ODER Bridge-Occupancy unbekannt → post-op (Leute lingern / Bridge-
   Hiccup) wurde NIE gelöscht. Fix: Op ist vorbei → immer löschen (Discord trennt Nachzügler); Occupancy-
   Guard + ungenutzte bridge-Imports raus.
6. **Random-suffix Identity auch in Bridge + Unit/Global-Token** (LiveKit-Log:
   `could not restart participant` im `commander-bridge-<guild>`-Room). Gleiches Ghost-Problem in
   Squad-Link-Bridge-Room, Session-Rooms, Relay-Publisher, Fleet-Unit-/Global-Rooms. Fix: stabile
   Identity überall — `bridge/livekit.ts` (issueLivekitToken/issueSessionLivekitToken/issueRelayToken),
   `fleetplanner/livekit.ts` (issueUnitLivekitToken/issueGlobalVoiceToken). randomBytes-Imports raus.
   Bridge-Roster nutzt eigene RoomRegistry (kein Identity-Parsing) → kein Break.
Sonst: bot `shard reconnecting`→sofort `shard resumed replayed:1` = normales Discord-Gateway-Verhalten,
kein Fehler. Keine Buffer-Overflows, keine Caddy-5xx.

## Queued / Planned Step - 2026-06-03: Primäre Voice-Unit wählbar (Multi-Position-User)

Multi-Position-User (2+ akzeptierte Units) bekommen nur 1 Discord-Voice-Channel. Bisher: immer
erste Unit (createdAt). Neu: User wählt selbst ODER Missionsleiter weist zu, welche Unit der
Main-Channel ist. Default bei 2+ Units = FPS/Squad-Unit (statt nur erste).
- Schema: neues Model `OpPrimaryUnit` (operationId+userId unique → unitId, setByUserId) +
  Migration `20260603030000_op_primary_unit`. Back-Relations an User/Operation/FleetUnit.
- `services/primaryUnits.ts`: `userUnitsByUser`, `defaultPrimaryUnit` (FPS bevorzugt),
  `resolvePrimaryUnits`, `setPrimaryUnit`/`clearPrimaryUnit`, `getMultiPositionAssignments`.
- `services/voiceBots.ts moveOperationCrewToVoiceChannels`: nutzt resolvePrimaryUnits statt
  „erste Unit"; Fallback erste-mit-Channel.
- `routes/api.ts`: `POST /api/ops/:id/primary-unit` (self ODER Leader; leeres unitId = clear).
- UI `routes/web.ts`+`web/pages.ts`: Fleet-Tab Panel „Primary Voice Channel" — Dropdown pro
  Multi-Position-User (Leader sieht alle, User nur sich); Auto-Option = Default.
Deploy via Docker (Migration läuft per `migrate deploy` beim Container-Start).

## Queued / Planned Step - 2026-06-03: Channel-Restriction lockern (Global vs Command Net)

Regel-Trennung der Discord-Voice-Gate im Mission-Mode:
- **Global Radio (Relay)**: nur „selbe Discord" nötig (verknüpfter Discord-Account → Guild-Member,
  da op guild-scoped). KEIN Kanal-Zwang — Relaybot spricht für den User.
- **Command Net (Commander)**: muss im Event-Channel ODER in IRGENDEINEM Relaybot-Unit-Channel der
  Op sein (vorher: nur eigene Unit-Channels).
Backend `routes/api.ts`: `missionDiscordVoiceState` Gate = Event-Channel + alle `FleetVoiceChannel`
der Op (neue Helper `opRelayBotChannels`, alte `userMissionVoiceChannels` entfernt). Relay-Token
gated auf neuem `relayOk` (= canRelay && verknüpfter Discord), nicht mehr auf `discordVoice.ok`.
Response liefert `relayOk`. Companion `App.tsx`/`MissionVoicePanel.tsx`: `missionRelayOk` State;
Relay-Connect/PTT/Visibility nutzen `relayOk` statt commander-`discordVoiceOk`; Warn-Banner nur
noch für Commander. Companion-Build lokal/CI.

## Queued / Planned Step - 2026-06-03: Commander Mode Optik = Bridge Mode (Participant-Roster)

Bridge Mode zeigt SQUAD ROSTER (Teilnehmerliste), Command Net nur Teilnehmer-Count. Angleichen:
Command-Net zeigt jetzt COMMANDER ROSTER mit denselben `cc-prow`-Rows (Avatar, Name, Speaking,
Volume-Slider). Datenquelle = LiveKit-Presence der commanderRoom + Speaking via
`ActiveSpeakersChanged`; Namen vom Backend.
- `routes/api.ts` mission-voice: liefert `commanders:[{userId,username}]` (aus listMissionCommanders)
  damit LiveKit-Participants (name=userId) Namen kriegen.
- `lib/livekit.ts`: `RosterEntry`-Typ + `rosterChanged`-Listener; trackt remoteParticipants +
  `speakingUserIds` (ActiveSpeakersChanged), emit bei join/leave/sub/unsub/speaker-change.
- `lib/fleetAudio.ts`: `setRosterListener` Passthrough.
- `App.tsx`: `commanderRoster`/`commanderNames` State, Listener auf FleetAudio, an MissionVoicePanel.
- `components/MissionVoicePanel.tsx`: COMMANDER ROSTER Card (Self ohne Slider + Remote-Rows mit
  Volume), nur wenn commanderStatus connected.

## Queued / Planned Step - 2026-06-03: Fix Command Net — andere Commander nicht hörbar

Bug: im Command-Net-Mode (Mission `commanderRoom`, PTT-1) hört User andere Commander nicht.
Ursache: `missionCommanderRef` (FleetAudio) wird in `App.tsx` erstellt + connected, kriegt aber NIE
`applyDeviceConfig`/`setOutputMuted`/`setRemoteVolumes` — nur `audioRef` (Bridge) bekommt die beim
Mount. Folge: Command-Net-Audio spielt auf OS-Default-Output statt User-gewähltem Headset → User
hört nichts (Bridge ging, weil audioRef korrekt geroutet). Token/Grant der commanderRoom waren ok
(unique identity, canSubscribe true).
Fix: `lib/fleetAudio.ts` Passthroughs (`applyDeviceConfig`/`setOutputMuted`/`setRemoteVolumes`/
`setRemoteVolume`) zu inner LivekitAudio. `App.tsx`: vor commanderRoom-`connect` Device-Config +
outputMuted + remoteVolumes anwenden; bei Live-Änderungen (Settings-Save, Output-Mute-Toggle,
Remote-Volume-Slider) auch `missionCommanderRef` mitziehen. Companion-Build lokal/CI (Tag).

## Queued / Planned Step - 2026-06-03: Companion-Fenster breiter (Modebar-Buttons abgeschnitten)

Beim Start waren nicht alle Modebar-Buttons (SERVER WECHSELN/VOICE TO ALL/MUTE/AFK/ABMELDEN/
MISSION/⚙) sichtbar — `.cc-modebar`/`.cc-modebar-right` = flex ohne wrap, 640px zu schmal → rechts
geclippt. Fix: `tauri.conf.json` width 640→820, minWidth 560→720; `kit.css .cc-modebar-right`
`flex-wrap: wrap` + `justify-content: flex-end` als Sicherheitsnetz. Companion-Build lokal (Windows/Tauri).

## Queued / Planned Step - 2026-06-03: Mission Export — Teilnehmerliste nach Event-Ende

Feature: nach `completed`-Op die Teilnehmer-Roster anzeigen + als CSV exportieren ("Wer hat
teilgenommen"). Scope (User-Entscheidung): **zugewiesenes Roster** (keine echte Voice-Anwesenheit
— wird nirgends persistiert), Ausgabe **On-Page-Panel + CSV-Download**.
Roster-Quellen (unique pro User): Leaders (`OperationLeader.leaderRole`), Captains akzeptierter
Units, besetzte aktive Seats akzeptierter Units, manuelle `MissionVoiceParticipant` (Command Net).
- Neu: `services/participants.ts` → `getMissionParticipants(opId)` + `participantsToCsv()`.
- `routes/web.ts`: `GET /ops/:id/participants.csv` (effectiveOpRole-gated), + im Op-Detail-Loader
  Participants laden wenn `status==="completed"` und an detailPage durchreichen.
- `web/pages.ts`: `participants?`-Feld in OpDetailPageOptions, Overview-Panel "Participants"
  (nur wenn completed) mit CSV-Download-Button.
- Test: `__tests__/services/participants.test.ts`.

## Queued / Planned Step - 2026-06-03: Classic Op-Detail-Seite entfernt

`?ui=classic` Op-Detail-Ansicht komplett raus — V2 ist einzige UI. Entfernt: `opDetailPage`
(classic, ~1064 Zeilen), `opUiSwitch`-Nav-Toggle, alle `classicUrl`/"Classic UI"/"Classic Full
Controls"/"Advanced ship search"-Links, `?ui=classic` Loader-Branch + Querystring-Typ,
`.nav-ui-switch` CSS, jetzt tote Helfer `eventStatusLabel`/`discordAvatarUrl`.
`routes/web.ts` rendert immer `opDetailPageV2`.

## Queued / Planned Step - 2026-06-03: Fix FPS-Squad blockt Schiffs-Command

Bug: User in einer FPS-Squad kann kein Schiff commanden → `"Already assigned to a primary
seat in this operation"`. FPS + Schiff muss IMMER gleichzeitig gehen (vgl. M1-Entry unten).
Ursache: `assertUserCanTakeSeat` in `services/units.ts`. `categoryForUnit` gibt bei Squads mit
`requirement.category === "fps"` direkt `"fps"` zurück. `SECONDARY_ASSIGNMENT_CATEGORIES`
enthält aber nur `ground|mining|salvage|transport` — `fps` fehlt → wird als Primary behandelt →
kollidiert mit dem Schiffs-Primary-Seat.
Fix: `fps` zu `SECONDARY_ASSIGNMENT_CATEGORIES` hinzufügen (FPS = Boden-Domäne wie `ground`).
+ Test in `__tests__/services/units.test.ts`.

## Queued / Planned Step - 2026-06-03: How-To-Seite aktualisieren

Fleetplanner `pages.ts howToPage` auf aktuellen Stand bringen (`/how-to` ist bereits public, kein
Login). Login-Seite bleibt unverändert (User-Entscheidung).
- "What is this?": Mission-Voice + Companion-Hinweis ergänzt.
- Rollen-Tabelle: war nur Admiral/Crew → jetzt Superadmin/Fleetadmin/Captain/Crew (echtes
  `User.role` + `GuildMembership.role`-Modell).
- Neue Sektion "Mission voice": Command Net vs Global Radio Net + Mission-Rollen→Net-Matrix.
  Quelle: README.md "Mission role and voice concept".

## Queued / Planned Step - 2026-06-03: Multi-Position-User = 1 Voice-Channel (M1)

Problem: ein User kann Captain (Schiff) UND Seat (FPS-Squad) sein → 2 Unit-Channels. Discord erlaubt
nur 1 Voice-Channel. Aktueller Bug: `moveOperationCrewToVoiceChannels` schiebt ihn in mehrere
(letzter gewinnt, unkontrolliert), `expectedMissionVoiceChannel` erwartet nur die erste Unit →
`wrong_channel` → kein Token. Lösung M1 (erste-Zuordnung-Priorität):
- voiceBots.ts: jeden User nur EINMAL bewegen, in primäre Unit (erste per createdAt); dedupe.
- api.ts Companion-Gate: `allowedChannelIds` = ALLE Unit-Channels des Users + eventChannel
  (User darf sich frei zwischen seinen Missionskanälen bewegen, Token bleibt gültig).
- pages.ts: Multi-Position-User farblich markieren (in mehr als einer Unit/Seat).
M2/M3 (Leader Drag&Drop / Prioritäts-Tab) = späteres Projekt nach dem Event.

## Queued / Planned Step - 2026-06-03: Seat-Assign über Partner-Guilds

Folgeschritt zum Invite-Link: bei `partners`/`public`-Ops sollen im Seat-Assign-Dropdown
auch Members der aktiven Partner-Guilds auftauchen (manuell zuweisbar), nicht nur Host-Guild.
- web.ts `assignableUsers`: GuildMembership where guildId in [host, ...getActivePartnerGuildIds]
  wenn opVisibility partners/public; dedupe per user.id (user kann in beiden Guilds sein).
- Private Ops bleiben host-only (Tenant-Isolation).
- Voraussetzung Voice: Gast muss trotzdem im Host-Discord sein (Invite-Banner) — Move-Gate unverändert.

## Queued / Planned Step - 2026-06-03: Guild Discord-Invite-Link für Gäste

Cross-Org-Ops: Gäste aus Partner-Guilds (z.B. PinCodeX nur in Infinite Horizon) fehlen im
Seat-Dropdown, weil `assignableUsers` nur Host-Guild-`GuildMembership` listet (Tenant-Isolation,
web.ts) UND der Discord-Voice-Move den Host-Discord braucht. Lösung lt. User: Gäste treten dem
Event-/Host-Discord bei (Move klappt dann). Dafür: backend-konfigurierbarer permanenter
Discord-Invite-Link pro Guild.
- Schema: `Guild.discordInviteUrl String?` + Migration
- `guilds.ts` /guilds/settings GET+POST: Feld lesen/speichern (validiert: https discord invite)
- `guildSettingsPage`: Eingabefeld
- Op-Detail: Banner für Betrachter ohne Host-`GuildMembership` ("Tritt dem Event-Discord bei: <link>")
Companion eigener Name im Mission-Mode (self.username via mission-voice endpoint) = separater offener Punkt.

## Architecture Decision - 2026-06-02: Companion Voice Modes verbindlich

Authoritative doc: `docs/companion-voice-architecture.md`.

- Mission voice terms: `Command Net` is the mission commander voice path;
  `Global Radio Net` is the RelayBot broadcast path.
- Fleet-level roles (`Superadmin`, `Fleetadmin`, `Crew`) do not grant mission voice
  by themselves. The Commanders tab is a mission roster, not an admin roster.
- Mission voice access comes from accepted unit captain status, Event/Raid/Wing leader
  roles, or explicit Command Net participant assignment.
- `fleet_commander` is a mission management role for needs and unit confirmation unless
  the user is also assigned to a voice-bearing role or added explicitly.
- Bridge Mode: nur ohne aktive Mission, gated durch Raumdock Guild `1431307397842079777`
  und Rolle `1511124797445247096`.
- Commander Mode: mission-scoped Command Net fuer Captains/Commanders/voice leaders,
  temporaere Rolle `1510192642997227602`, Rolle wird bei Missionsende entzogen.
- Relay Mode / Global Radio Net: zweiter PTT, mission-scoped RelayBot broadcast, temporaere Rolle
  `1510192451808133210`, Rolle wird bei Missionsende entzogen.
- Commander Mode beendet/suspendiert Bridge Mode automatisch.
- Jede Mission hat dedizierte LiveKit-Raeume: Commander-Room und Relay-Publish-Room.
- RelayBots erstellen missionseigene Discordkanaele je zugewiesenem Schiff/Squad und bewegen
  zugewiesene User soweit moeglich in diese Kanaele.
- RelayBots muessen im Kanal des sprechenden Fleetmanagers/Commanders still sein, um
  Doppel-Audio/Echo zu vermeiden.

## Completed Step - 2026-06-02: Fleetplanner Calendar-Seite Zeitzone (war UTC)

`homePage` (Operation Calendar, [apps/fleetplanner/src/web/pages.ts]) baute `dayFormatter`/
`dayKeyFormatter`/`timeFormatter` OHNE `timeZone` → Server-System-TZ (UTC) statt Guild-TZ.
Op-Detailseiten nutzten bereits `gtz`. Calendar mischt Ops mehrerer Guilds → jede Op jetzt in
IHRER Guild-TZ (konsistent mit Detail).
- `operations.ts`: `timezone: true` in alle 4 guild-selects (listOperations/Public/Partner/AllUser)
- `pages.ts` OpListItem.guild: `timezone?: string | null`; per-TZ Intl-Formatter-Cache (`fmtsFor`),
  Tag-Gruppierung + Zeit (`fmtTime` → "20:00 CEST") pro Op-TZ; import `isValidTimezone`
Verifiziert: 18:00 UTC → 20:00 CEST (Sommer); 23:30 UTC → 00:30 CET nächster Tag-Bucket (Winter-DST).
Nicht lokal gebaut (Docker baut server-seitig).

## Completed Step - 2026-06-02: Fleetplanner Mobile-Responsive

`apps/fleetplanner/src/web/render.ts` CSS + HTML:
- Nav: `overflow-x: auto` (Basis-Regel, alle Breiten) + nav-username span hide-on-mobile
- Neuer `@media (max-width: 900px)`: op-dashboard, opv2-grid, opv2-hero auf 1fr; table horizontal-scroll; detail-row flex-wrap + strong overflow-wrap
- Mobile (680px): Touch-Targets ≥44px, seat-assign min-width fix, page-title kleiner, form-actions flex-wrap

Getestet mit headless Chromium (playwright) Harness aus der echten CSS, Viewports 375/430/820px:
horizontal-overflow-Check + Screenshots. 3 echte Bugs gefunden+gefixt:
1. `.detail-row strong` (lange Usernames) sprengte Viewport bei 375px (docW 410>375)
2. `.nav` Overflow bei 681–1120px (overflow-x war nur ≤680) → Basis-Regel
3. Tables sprengten Card/Page bei 681–900px → table-scroll von ≤680 auf ≤900 hochgezogen
Ergebnis: kein horizontal-overflow auf allen 3 Viewports.

## Queued / Planned Step - 2026-06-02: captainRoleId entfernen

`captainRoleId` ist funktionslos — `captain`-GuildRole gated keinen Route-Guard, Discord-Badge auf
Unit-Accept ist durch `commanderVoiceRoleId` ersetzt. Schema-Migration + guilds.ts + discord.ts
(`assignCaptainDiscordRole`, `removeCaptainDiscordRoles`, `configuredCaptainRoleIds`) + pages.ts.

## Queued / Planned Step - 2026-06-02: apps/error-page Microservice

Caveman-Fehlerseite als eigenständiger Node.js-Service (zero-deps, Port 9091).
Caddy handle_response @5xx + handle_errors leitet alle 5xx aus Fleetplanner und Bridge
an den Service weiter. docker-compose.prod.yml + Caddyfile angepasst.
app.ts setErrorHandler vereinfacht: nur noch JSON für /api/*, browser bekommt 5xx → Caddy.

## Queued / Planned Step - 2026-06-02: Caveman 500-Fehlerseite für Fleetplanner

Fastify setErrorHandler in app.ts — HTML-Fehlerseite für Browser-Requests bei unbehandelten
Fehlern (P2022, etc.). Caveman-Style. JSON bleibt für API-Requests (Accept: application/json).

## Queued / Planned Step - 2026-06-02: Mission Voice Roles — eigenes Panel in Guild Settings

`commanderVoiceRoleId` + `globalVoiceRoleId` aus dem Discord-Integration-Panel heraus in eigenes
Panel "Mission Voice — Companion & Relay" verschieben. Panel nur sichtbar wenn `voiceEnabled = true`.

## Queued / Planned Step - 2026-06-02: Guild eventChannelId entfernen

`Guild.eventChannelId` (Guild-Default für Discord-Event-Voice-Channel) entfernen. Per-Op
`eventVoiceChannelId`-Auswahl ist bereits implementiert und ersetzt den Guild-Default vollständig.
Schema-Migration + guilds.ts + pages.ts + discord.ts (guild-Fallback-Query raus).

## Queued / Planned Step - 2026-06-02: Dead-Code-Cleanup Fleet-Auth + Unit-Accept-DM-Fix

Handover-Dokument: `docs/handover-codex-fleet-auth-cleanup.md`

Companion: `fleetplannerAuth.ts` + `FleetVoiceModal.tsx` + Rust `start_fleet_oauth_webview` Command löschen.
Fleetplanner: `/auth/discord/companion/start|callback` + `/companion/configure` Routes entfernen.
`createCompanionSession` + `companionConfigUrl` aus Unit-Accept-Flow entfernen.
DM ohne toten Config-Link senden. Full-scope CompanionSession-Funktionen löschen wenn ungenutzt.

## Queued / Planned Step - 2026-06-02: Companion zeigt im Mission-Mode falschen (Bridge-)Roster

Bug: in MISSION MODE rendert die app parallel die bridge-connected-pane → SQUAD ROSTER zeigt
`activeCommanders` (bridge-guild-roster), nicht die mission-commander-room-teilnehmer. User sah
Leute (Headwig) "im Kanal" die nur am bridge hängen.

Fix (companion-only):
- Bridge-connected-pane (roster + bridge-PTT) wird ausgeblendet wenn `missionOwnsLocal`
  (missionActive && missionHasCommander) — die mission besitzt dann LOCAL.
- Echte mission-channel-präsenz: `FleetAudio` reicht `participantsChanged` (room.numParticipants)
  durch → `setParticipantsListener`/`getParticipantCount`. App-state `commanderParticipants`.
  MissionVoicePanel zeigt "N im Kanal" am COMMANDER-room (verbunden). Reset bei disconnect/ende.

## Queued / Planned Step - 2026-06-02: Companion Mission-Close kickt statt zu switchen

Bug: mission-token ist nicht op-gebunden; `/api/companion/mission-voice` liefert dynamisch
"nächste aktive op" → beim Schließen einer Mission sprang die App auf die nächste statt
rauszuwerfen. Fix (companion-only): `missionOpIdRef` pinnt die opId beim ersten poll; liefert
poll op:null ODER andere opId → Mission beenden (disconnect + `clearMissionConfig` stoppt
polling + missionEnded), KEIN switch. Bridge-resume via bestehendem bridge↔mission-effekt.
Re-join braucht frischen Link. `missionOpIdRef` auch in onMissionDisconnect zurückgesetzt.

## Queued / Planned Step - 2026-06-02: Companion Funk-Routing-Anzeige

App.tsx: neue "FUNK"-strip-zeile unter dem status-strip zeigt verbundenen raum + sprech-ziel.
LOKAL (PTT-1) = commander-room bei mission sonst session/guild-bridge; GLOBAL (PTT-2) =
Discord-relay. Farbe: green=sendend, cyan=verbunden, dim=–. Hotkey je kanal angezeigt. Derived
vars (missionOwnsLocal/localRoomLabel/localConnected/localSpeaking/global*). Nur UI, reuse
cc-badge/cc-status-strip. Build separat.

## Queued / Planned Step - 2026-06-01: Bridge-Zugang per Raumdock-Rolle (DB-konfigurierbar)

Bridge-mode (Squad Link) nur nutzbar mit bestimmter Discord-rolle auf dem **Raumdock-server**
(global, NICHT per-tenant). Rolle + Raumdock-guild + relay-rolle **DB-backed** (nicht .env),
konfigurierbar im bridge-admin nur durch den **protected/bootstrap-admiral** (initialer superadmin).

- **Schema** (root `prisma/schema.prisma`): neues singleton `GlobalSettings`
  (id @default("global"), raumdockGuildId?, bridgeRequiredRoleId?, relayRequiredRoleId?,
  updatedAt, updatedById). Migration unter root `prisma/migrations/`.
- **Service** `apps/bridge/src/services/globalSettings.ts`: get/save singleton (`prisma as any`).
- **oauth.ts** callback: nach userId → wenn bridgeRequiredRoleId+raumdockGuildId gesetzt →
  fetchGuildMember(RDOCRTC-bot, raumdockGuildId, userId) → rolle prüfen → sonst 403
  `missing_bridge_role`. Globaler gate vor tenant-commander-check.
- **relay.ts**: relay-rolle aus GlobalSettings statt `env.RELAY_REQUIRED_ROLE_ID`, geprüft
  gegen raumdockGuildId (global). env-var wird nicht mehr gelesen.
- **Admin-UI** (admin/routes.ts + views): "Global / Bridge Settings"-seite, gate
  `session.protected === true`. Form: raumdockGuildId, bridgeRequiredRoleId, relayRequiredRoleId.
- Rolle aktuell: 1511124797445247096 (wird per UI gesetzt, nicht hardcoded).
- Caveat: gate greift bei OAuth (wie commander-role); session-JWT-TTL → entzug erst bei ablauf.

## Queued / Planned Step - 2026-06-01: Bugfixes + Composition Schritt 1+2

- **Bug 1 (Companion):** mission-deeplink wechselte LiveKit-channel nicht — bridge-`audioRef`
  (guild) + `missionCommanderRef` liefen parallel (layering statt switch). Fix (§9-F des Plans):
  bei `missionActive && missionHasCommander` bridge-audio trennen; bei mission-ende mit
  gemerkten creds (`lastBridgeCredsRef`, gesetzt in bridge:joined/audio:enable) wieder verbinden;
  transition-guard (`missionOwnsLocalRef`) gegen reconnect-churn. bridge:joined/audio:enable
  connecten nicht während mission LOCAL besitzt.
- **Bug 2 (Fleetplanner):** Commanders-Tab listete alle guild-fleetoperators → wirkte als ob
  seat-crew drin ist. Fix: roster = nur accepted-unit-captains + manuell hinzugefügte participants.
  Fleetoperators behalten commander-zugriff per rolle (backend isCommander), werden aber nicht
  mehr auto-gelistet.
- **Composition Schritt 1:** `services/composition.ts` — pure `matchesCategory(category, unit)` +
  `suggestSlot(unit, slots)` (category↔Ship.size/career/role; nur hint, keine sperre).
- **Composition Schritt 2:** "Composition Board" (read-only) im Overview-Tab — soll/ist/offen je
  requirement + chips (filled/mismatch/open) + summe; nutzt `matchesCategory` für mismatch-flag.
  CSS `.comp-*` in render.ts. Kein Datenmodell-/Migration-Change. (Schritt 3+ aus Plan offen.)

## Queued / Planned Step - 2026-06-01: Composition-Rebuild — Plan-Dokument

User: Composition-Teil "stellenweise unlogisch / nicht intuitiv". Pain (priorisiert):
Darstellung/Übersicht, Zuordnung Units→Requirement, Gruppen/Requirements-Struktur. Tiefe:
**erst Plan-Dokument** (kein Code). → `docs/composition-rebuild-plan.md` mit Ist-Analyse
(CompositionGroup/CompositionRequirement/FleetUnit.requirementId, pages.ts groupsSection:639,
registerForm:819), Soll-Modell, UI-Vorschlag, Migration, Rollout. Code-Umbau erst nach Freigabe.

## Queued / Planned Step - 2026-06-01: Fleetplanner Op-Detail — Commanders-Tab + Overview-Metriken

Befund: `missionVoiceSection` (web/pages.ts:959, inkl. Copy-Button) war **toter Code** — nie in
einem Panel eingebunden. V2-`voicePanel` zeigte nur Room-Namen, keine Links. Darum sah der
User nie Links.

Neues Feature (entschieden mit User): voller Commander-Zugriff für manuell hinzugefügte Leute,
Persistenz via DB, neuer Tab "Commanders".

- **Schema** (`prisma/schema.prisma`): neues Model `MissionVoiceParticipant`
  (operationId, userId, addedById, createdAt; `@@unique([operationId,userId])`). Back-Relations
  auf `Operation.missionVoiceParticipants` + `User.missionVoiceParticipations`.
- **Migration**: `prisma/migrations/20260601120000_mission_voice_participant/migration.sql`
  (CREATE TABLE + FKs + indexes). Entrypoint `docker-entrypoint.sh` macht `migrate deploy`.
- **Backend** `routes/api.ts` mission-voice (`isCommander`, ~Z.1343): erweitern um
  MissionVoiceParticipant → hinzugefügte Leute kriegen `commanderRoom`. Neue Routes:
  `POST /api/ops/:id/voice-participants/add` (body userId) + `POST /api/ops/:id/voice-participants/:userId/remove`
  (beide fleetoperator + CSRF). Prisma-Zugriff via `(prisma as any)` (Client lokal noch ohne Model).
- **web.ts** Op-Detail-GET: Participants laden, `commanderLinks` bauen (captains ∪ fleetoperators
  ∪ participants → `createMissionVoiceSession` → `rdoc://mission`-Link), an Page übergeben.
- **pages.ts** `opDetailPageV2`: Tab "commanders" zu `tabNames` + `shellLink` + `activePanel`.
  `commandersPanel`: assigned Captains (mit Link+Copy), hinzugefügte Commanders (Link+Copy+Remove),
  Add-Form (assignableUsers-select). Gated canManage + voiceEnabled + globalVoiceRoom.
  Copy-Button-Pattern wie zuvor (clipboard aus Sibling-Input).
- **Mission-Overview** (overviewPanel-Metriken): Anzahl Schiffe + besetzte/unbesetzte Plätze;
  Anzahl FPS-Teams + besetzte/unbesetzte Plätze.

Composition-Umbau (User-Wunsch, "unlogisch/nicht intuitiv") = separater Schritt, erst nach
Rückfrage was konkret stört.

## Queued / Planned Step - 2026-06-01: Companion Neuarchitektur (Mission-First, 2 PTT)

Plan: `docs/companion-app-opus.md`. Reduce companion (`apps/companion/`) from 6 audio paths /
4 hotkeys / 3 auth flows to **2 PTTs**: `localHotkey` (LOCAL: guild bridge w/o mission,
mission `commanderRoom` with mission) + `globalHotkey` (RELAY: Discord relay bots, always when
`canUseRelay`). Fleetplanner OAuth + voice polling loop removed. Deep link `dccc://fleet-voice`
→ `rdoc://mission` (both schemes parsed during transition).

- `lib/config.ts`: defaults unchanged (`DEFAULT_HOTKEY`=Mouse4 → localHotkey, `DEFAULT_RELAY_HOTKEY`=R → globalHotkey).
- `lib/store.ts`: Settings type drops `hotkey`/`relayHotkey`/`commanderHotkey`/`fleetplannerToken`,
  adds `localHotkey`. `loadSettings` fallback chain `localHotkey ?? hotkey`, `globalHotkey ?? relayHotkey`.
  New `saveLocalHotkey`; remove `saveHotkey`/`saveRelayHotkey`/`saveCommanderHotkey`/`saveFleetplannerToken`/`clearFleetplannerToken`.
- `App.tsx`: remove fleet-voice polling effect, onFleetOAuth/onFleetSignOut/onFleetPttEvent/
  onGlobalFleetPttEvent/onGlobalMissionPtt + global-mission-hotkey effect + commander-hotkey effect.
  `handlePttEvent` branches: mission-active → `missionCommanderRef.setPttActive`, else bridge path.
  Mission polling response reduced to `commanderRoom` only. Header Fleetplanner block removed.
- `components/MissionVoicePanel.tsx`: single-room (commander) only.
- `components/SettingsModal.tsx` + `MissionLinkModal.tsx`: hotkey fields 4→2, link placeholder rdoc://.
- `src-tauri/tauri.conf.json` + `src-tauri/src/lib.rs`: register both `rdoc` + `dccc` schemes.
- Backend `apps/fleetplanner/src/routes/api.ts`: `mission-voice` drops `globalRoom` (commanderRoom
  is authoritative); `/api/companion/voice` retired; link gen → `rdoc://mission`. `web.ts:424` same.
- **Hard ordering dep:** backend `globalRoom` drop must release together with frontend mission-poll
  change (old app reads `data.op.globalRoom.room`).

## Queued / Planned Step - 2026-06-01: Fleetplanner Discord event header image from opType

`createScheduledEvent` and `updateScheduledEvent` in `services/discord.ts` never sent an
`image` field — assets existed in `public/mission-images/` but were unused for Discord events.

- `discord.ts`: add `opTypeImageDataUri()` helper (reads PNG from `public/mission-images/`,
  returns base64 data URI); add `opType?` to both function signatures; spread `image` into
  both body variants (VOICE + EXTERNAL).
- `routes/web.ts`: pass `opType: updatedOp.opType` in the `updateScheduledEvent` call.

## Queued / Planned Step - 2026-06-01: Fleetplanner security review → docs/security-review.md

Static security audit of `apps/fleetplanner/src/`. No code changes — documentation only.
Findings: 0 critical, 3 medium (no rate limiting, bot token in diagnostics object, missing
guild membership check on fleetoperator voice-token), 4 low/info. SQL injection and XSS
vectors: none. Dependencies: no known CVEs.

## Queued / Planned Step - 2026-06-01: Per-guild timezone (default Europe/Berlin)

Fleetplanner previously parsed and displayed all operation dates in UTC. Operators
schedule ops in their local timezone; UTC dates were confusing.

- Schema: `Guild.timezone String @default("Europe/Berlin")` + migration
  `20260601000000_guild_timezone`.
- `apps/fleetplanner/src/lib/timezone.ts`: new IANA tz helpers —
  `TIMEZONE_OPTIONS` (18 common zones), `isValidTimezone`, `fmtDateTz` (display),
  `fmtDateLocalTz` (datetime-local input value), `parseDateLocalTz` (parse input
  as wall-clock in guild tz). Uses only `Intl.DateTimeFormat` — no extra deps.
- `web/pages.ts`: `fmtDate(d, tz?)` + `fmtDateLocal(d, tz?)` delegate to tz helpers
  (default Europe/Berlin). Op detail page + form use `opts.guildTimezone`. Guild
  settings form: timezone `<select>` with 18 options.
- `routes/guilds.ts`: read + save `timezone` in GET/POST `/guilds/settings`.
- `routes/web.ts`: fetch guild timezone for op-detail GET, new-op GET/POST,
  edit-op GET/POST; replace `parseUtcDateTimeLocal` with `parseDateLocalTz`.

## Queued / Planned Step - 2026-06-01: Raid Planer → op-native "Voice Control" (Option B)

Decision: the bridge Raid Planer (live Discord voice member control) is NOT ported as a
standalone `/admin/bridge` panel. Instead its core function (pull crew into voice channels)
is folded into the **operation detail page**, scoped to the op's units + their Discord voice
channels — because moving crew belongs to running an operation, not a generic admin tool.

- New `apps/fleetplanner/src/services/opVoice.ts`: `buildOpVoiceControl(op)` (per-unit crew +
  each member's live voice location from a bridge voice-states snapshot), `moveUnitCrewToChannel`,
  `moveOpMemberToUnit`. Crew = unit captain + seat-assigned users; mapped to Discord IDs via
  `UserIdentity(provider=discord)`. Moves go through the bridge move API (RDOC-RTC bot has
  MOVE_MEMBERS). Members not in any voice channel are skipped (Discord can't move them).
- `web/pages.ts` `opDetailPage`: new "Voice Control" section (per unit: crew list w/ location
  tags + "Pull all crew here" + per-member "Move here"). Gated: fleetoperator + voiceEnabled +
  bridgeConfigured + op open/in_progress + units have Discord voice channels.
- `routes/web.ts`: GET /ops/:id builds voiceControl when gated; POST /ops/:id/voice/move-unit/:unitId
  and /ops/:id/voice/move-member/:unitId/:userId (requireOpRole fleetoperator + CSRF).

The bridge `/admin/raid-planer` (arbitrary live drag-drop + strategy channels + channel reorder)
stays on the bridge admin UI for non-op voice shuffling; op-bound crew moves now live in fleetplanner.

## Queued / Planned Step - 2026-06-01: Fleetplanner absorbs bridge admin (Option B, Phase 4) — companion downloads, relay metrics, refresh

Ports the remaining medium/low items. Only **Raid Planer** (real-time drag-drop) now stays
on the bridge admin UI; everything else is covered in fleetplanner `/admin/bridge`.

Bridge `routes/fleetInternal.ts`:
- Companion download tokens (global): `GET/POST /internal/fleet/companion-downloads`,
  `DELETE .../companion-downloads/:id`, `GET /internal/fleet/companion-release` (diagnostic).
  Mint returns the absolute bridge `/download/companion/<token>` URL.
- `POST /internal/fleet/guilds/:g/members/:userId/dm-download-link` — mint + DM via bot.

Fleetplanner:
- `services/bridge.ts`: list/mint/revoke companion downloads, getCompanionRelease, dm link.
- `routes/bridgeAdmin.ts`: `/admin/bridge/:g/downloads` (+ /dm, /:id/revoke); relay-bots GET now
  also fetches metrics (best-effort).
- `web/pages.ts`: new `bridgeDownloadsPage` (release info + mint + DM + token list); relay-bots
  page renders a metrics snapshot block; "Downloads" link in guild header; "↻ Refresh" links on
  dashboard + discord-voice (server-rendered snapshots, no SSE).

Remaining: Raid Planer port (deferred), then sunset bridge `/admin/*` HTML.

## Queued / Planned Step - 2026-06-01: Fleetplanner absorbs bridge admin (Option B, Phase 3) — complete the Admins panel

Phase 1 only did add/remove admin. Phase 3 finishes the Admins panel: role change
(promote/demote, guarded) + admin invite links (mint/list/revoke). Companion-download
tokens, relay-bots live metrics, dashboard SSE refresh, and Raid Planer still NOT ported.

Bridge:
- `services/fleetAdmin.ts`: `setAdminRoleSystem(guildId, userId, role)` — mirrors setAdminRole
  guards (no protected target, never demote last admiral) without the caller-admiral check.
- `routes/fleetInternal.ts`: `POST .../admins/:userId/role`, `GET/POST .../invites`,
  `DELETE .../invites/:id`. Mint returns the absolute bridge `/admin/invite/<token>` URL
  (built from OAUTH_REDIRECT_URI origin) so fleetplanner needn't know the bridge public host.

Fleetplanner:
- `services/bridge.ts`: setBridgeAdminRole, listBridgeInvites, mintBridgeInvite, revokeBridgeInvite.
- `routes/bridgeAdmin.ts`: role/invite routes; guild-detail GET now fetches invites + shows
  fresh-invite banner via `?fresh_url=`.
- `web/pages.ts`: admin rows gain a role <select>; new "Admin invite links" panel (list + mint
  form + revoke). Invite link is consumed on the bridge (Discord OAuth), single-use.

## Queued / Planned Step - 2026-06-01: Fleetplanner absorbs bridge admin (Option B, Phase 2) — Dashboard, Sessions, Relay Bots, Discord Voice

Phase 1 only ported config+admins+monitoring+audit; the bridge `/admin/*` UI still has
more panels. Phase 2 ports four more into fleetplanner `/admin/bridge/:guildId` via the
same `/internal/fleet/*` M2M API pattern. Raid Planer (real-time drag-drop + SSE + 1735-line
admin.js) NOT ported — deferred (would duplicate a complex real-time UI; bridge admin keeps it).

Bridge:
- New `apps/bridge/src/services/fleetAdmin.ts`: `fleetDashboard(guildId)` (commander roster +
  health, focused subset of admin loadDashboardData WITHOUT channelMirror) +
  `stripCommanderRoles(guildId, userId)` (reuses fetchGuildMember + removeGuildMemberRole).
- `apps/bridge/src/routes/fleetInternal.ts`: add endpoints —
  - `GET  /internal/fleet/guilds/:g/dashboard`
  - `DELETE /internal/fleet/guilds/:g/commander-roles/:userId`
  - Sessions: `GET/POST .../sessions`, `GET .../sessions/:id`, `POST .../sessions/:id/end`,
    `POST .../sessions/:id/invites` (returns plaintext once), `POST .../sessions/:id/invites/:inviteId/revoke`
  - Relay bots (singleton, not guild-scoped): `GET/POST /internal/fleet/relay-bots/config`,
    `GET /internal/fleet/relay-bots/metrics`, `POST /internal/fleet/relay-bots/restart`
  - Discord voice: `GET .../discord/voice-states`, `GET .../discord/roles`,
    `PATCH .../discord/members/:userId/channel`, `PUT/DELETE .../discord/members/:userId/roles/:roleId`

Fleetplanner:
- `apps/fleetplanner/src/services/bridge.ts`: client methods + inline types for all of the above.
- `apps/fleetplanner/src/routes/bridgeAdmin.ts`: superadmin-gated routes + SSR pages. Discord
  Voice is server-rendered (form POST → redirect), NOT the live-polling JS the bridge uses.
- `apps/fleetplanner/src/web/pages.ts`: dashboard / sessions list+detail / relay-bots / discord-voice
  render fns + links on the guild detail page.

## Queued / Planned Step - 2026-06-01: Fleetplanner absorbs bridge admin config (Option B, Phase 1)

Two web UIs / two logins (bridge `/admin/*` on SQLite vs. fleetplanner `/fleetplanner`
on PostgreSQL) confuse operators. Decision: fleetplanner superadmin manages bridge guild
config without opening the bridge admin UI. Bridge exposes a machine-to-machine API; bridge
admin UI kept running (phased sunset later). Plan: `docs/handover.to.opus-model.md`.

Bridge side (Phase 1):
- `apps/bridge/src/config/env.ts`: add `BRIDGE_FLEET_SECRET` (min 32, optional). When set,
  enables `/internal/fleet/*`. Separate from `INTERNAL_BRIDGE_SECRET` (bot-only, min 16).
- New `apps/bridge/src/routes/fleetInternal.ts`: Bearer-auth (`BRIDGE_FLEET_SECRET`) M2M API.
  503 when secret unset, 401 on wrong secret. Endpoints: GET/POST guild config, GET/POST/DELETE
  guild admins, GET monitoring, GET audit. Zod-validated, snowflake regex `/^[0-9]{17,20}$/`.
  Admin DELETE bypasses the "byUserId must be admiral" check via direct `deleteMany`
  (guards `protected: false` so the seeded admiral can't be removed by fleetplanner).
- `apps/bridge/src/app.ts`: register `registerFleetInternalRoutes`.

Fleetplanner side (Phase 2):
- `apps/fleetplanner/src/config/env.ts`: add `BRIDGE_INTERNAL_URL` (default `http://bridge:8787`)
  + `BRIDGE_FLEET_SECRET` (min 32, optional; hides Bridge section when unset).
- New `apps/fleetplanner/src/services/bridge.ts`: fetch+bearer client (pattern from
  `services/relayBots.ts`). Types redeclared inline (no bridge package dep).
- New `apps/fleetplanner/src/routes/bridgeAdmin.ts`: superadmin-gated `/admin/bridge*` routes.
  Registered in `app.ts`.
- `apps/fleetplanner/src/web/pages.ts`: bridge overview/config/monitoring/audit render fns;
  "Bridge" nav link shown only when `bridgeConfigured()`.

Phase 3: `.env.example` / `.env.prod.template` (user must edit if permission-blocked),
CLAUDE.md admin section + Quirks (same secret in BOTH .env entries). Raid Planer + bridge
sessions NOT touched (deferred). Verification sequence in handover §8.

## Queued / Planned Step - 2026-06-01: Remove `/cc` bot command — bridge guild-enable via web UI + env admin seed

Bridge guild config (`guildConfig.enabled`, commander roles) was only settable via the
Discord `/cc` slash command. Companion login `guild_not_enabled` for Raumdock because no
`/cc enable` was run. Move management to the bridge admin web UI (which already does
enable + commander roles) and remove `/cc` entirely.

- Bridge env: add `BRIDGE_SUPERADMIN_DISCORD_ID` + `BRIDGE_SUPERADMIN_GUILD_ID`
  ([apps/bridge/src/config/env.ts](apps/bridge/src/config/env.ts)).
- `seedSuperadmin()` in [apps/bridge/src/services/admins.ts](apps/bridge/src/services/admins.ts):
  idempotent `addAdmin({role:"admiral",protected:true})` on boot — replaces `/cc admin add`
  bootstrap. Called from bridge startup.
- Delete `/cc`: remove [apps/bot/src/commands/cc.ts](apps/bot/src/commands/cc.ts) +
  [apps/bot/src/services/guildConfig.ts](apps/bot/src/services/guildConfig.ts) (only cc imported it);
  `registerSlashCommands` PUTs empty body (deregisters global cmd); drop InteractionCreate handler
  in [apps/bot/src/index.ts](apps/bot/src/index.ts).
- Docs: CLAUDE.md admin section, docs/admin-guide.md, .env.example, .env.prod.template.
- Operator flow: set the two env vars → log into `suite.raumdock.org/admin` → enable guild +
  set commander roles in web UI. Plan: `.claude/plans/snappy-drifting-phoenix.md`.

## Queued / Planned Step - 2026-05-31: Remaining Codex items (#2 token scope, #4 capabilities, #6/#7 deep link) + env doc

- **#2 voice-link token scope:** `POST /api/ops/:opId/voice-links` + `/api/companion/generate-voice-link/:userId`
  currently mint full `CompanionSession` tokens for other users (authenticate as that
  user against all companion endpoints). Replace with a dedicated, narrowly-scoped
  mission-voice token (only `/api/companion/mission-voice`), short-lived.
- **#4 `/suite/capabilities`:** VERIFIED INTENTIONAL — `canUseRelay: false` is marked
  "decision pending" and `canUseFleetTools: false` is "web-first, not a companion
  feature" in the route. Not a bug; left unchanged.
- **#6/#7 `dccc://fleet-voice`:** add real handler so clicking the link configures the
  Companion (token+url) instead of paste-only. Mirror existing `dccc://` webview
  interception / single-instance arg path; emit `fleet-voice-configured`.
- **env doc:** add `DISCORD_FLEETPLANNER_CLIENT_SECRET` to fleetplanner `.env.example`.

## Queued / Planned Step - 2026-05-31: Fleetplanner web-login must use Fleetplanner OAuth client (not Companion/RDOC-RTC)

Bug: `apps/fleetplanner/src/auth/providers.ts` `discordOAuthClientId()` falls back to
`DISCORD_COMPANION_BOT_ID` / `DISCORD_RDOCRTC_CLIENT_ID`, so the normal Fleetplanner
web-login emits authorize links with the Companion/RDOC-RTC client_id
(1507722962919227452). Wrong — that client is Companion-only.

Fix:
- `config/env.ts`: add `DISCORD_FLEETPLANNER_CLIENT_SECRET` (optional).
- `auth/providers.ts`: split client selection. Web login:
  `discordOAuthClientId()` = `DISCORD_FLEETPLANNER_CLIENT_ID ?? DISCORD_CLIENT_ID` (NO
  companion/rdocrtc fallback). New `discordOAuthClientSecret()` =
  `DISCORD_FLEETPLANNER_CLIENT_SECRET ?? DISCORD_CLIENT_SECRET`. `discordEnabled()` =
  both present. `discordExchange()` uses `discordOAuthClientSecret()` not raw
  `DISCORD_CLIENT_SECRET`.
- `auth/discord.ts`: same split if still used; no companion/rdocrtc fallback.
- Companion OAuth (`/auth/discord/companion/*`) keeps `DISCORD_COMPANION_BOT_ID`/`_KEY`.
- Tests: web `/auth/discord/start` → client_id = FLEETPLANNER_CLIENT_ID;
  `/auth/discord/companion/start` → client_id = COMPANION_BOT_ID; only-companion-set ⇒
  `discordEnabled()` false for web.

## Queued / Planned Step - 2026-05-31: Mission Voice flow fixes (Codex review)

Found via Codex review of the new Fleetcommander/Mission-Voice path. Fixing 3:

1. **Response-shape mismatch (critical).** `GET /api/companion/mission-voice` success
   branch in `apps/fleetplanner/src/routes/api.ts` returns flat `{ opId, opTitle, ... }`
   while every "no session" branch returns `{ op: null }` and the companion
   (`apps/companion/src/App.tsx`) reads `data.op`. So an ACTIVE mission was seen as
   "no mission". Fix: wrap success payload in `op: { ... }`.

2. **Mission mouse-hotkeys dead (#3).** Commander/Global mission PTT effects in App.tsx
   only attach window keyboard listeners and `return` early on `isMouseHotkey`. Default
   `commanderHotkey` is `Mouse5` → never fires unless the UI button is clicked. Fix:
   subscribe to the Rust `"hotkey"` events for mission commander/global, matching the
   stored accelerator (same mechanism bridge PTT uses via setupHotkey/rdev).

3. **Silent Discord role grant/revoke (#5).** `apps/fleetplanner/src/services/voiceSession.ts`
   swallows role grant/revoke errors, so fleetplanner can show "mission voice active"
   even though Discord roles were never set. Fix: surface/log failures instead of
   swallowing.

Not fixing now (logged for later): voice-link token scope too broad (#2), bridge
`/suite/capabilities` reports fleet/relay false (#4), `dccc://fleet-voice` is paste-only,
no OS deep-link handler (#6/#7).

## Queued / Planned Step - 2026-05-31: Companion Fleetcommander Mode + Mission Voice Integration

Fleetplanner:
- GET /api/companion/mission-voice (Bearer companionSession): returns globalRoom+commanderRoom tokens for active op
- POST /api/companion/generate-voice-link/:userId: SuperAdmin/fleetoperator creates per-user companion session; returns dccc://fleet-voice link
- Op detail page: "Fleet Voice Links" section (open/in_progress + rooms exist) — shows dccc:// link per accepted captain + per fleetoperator
- Rust lib.rs: add dccc://fleet-voice?token=...&url=... handler → emits fleet-voice-configured event

Companion:
- lib/missionVoice.ts: 2 FleetAudio instances (commanderRef, globalRef), polls /api/companion/mission-voice every 30s
- AppState: add missionActive, missionOpTitle, missionHasCommander, commanderStatus, globalStatus, commanderPttActive, globalPttActive, commanderHotkey, globalHotkey
- AppState: remove fleetStatus, globalFleetStatus, fleetPttActive, globalFleetPttActive, fleetRoomName (keep FLEET unit room button in bridge mode)
- components/MissionVoicePanel.tsx: COMMANDER + GLOBAL PTT buttons, op title, DISCONNECT
- Mode banner: top strip shows "MISSION MODE" (cyan) or "BRIDGE MODE" (dark) at all times
- Store + Settings: commanderHotkey (default Mouse5), globalHotkey (default F9)
- Auto-connect on boot via stored missionToken + fleetplannerUrl

## Queued / Planned Step - 2026-05-31: Fleetplanner Mission Voice Sessions + Voice Permission flag

Schema:
- `Guild.voiceEnabled Boolean @default(false)` — feature flag; only SuperAdmin can set
- `Guild.commanderVoiceRoleId String?` — Discord role granted to Command Net users when mission voice is live
- `Operation.globalVoiceRoom String?` — LiveKit room name (random, stored on first open/in_progress)
- `Operation.commanderVoiceRoom String?` — LiveKit room name (random, stored on first open/in_progress)
Migration: 20260531005000_voice_session

Env: `RAUMDOCK_GUILD_ID` — guild always permitted to use voice regardless of voiceEnabled flag.

New service `apps/fleetplanner/src/services/voiceSession.ts`:
- `hasVoicePermission(guildId)` → Guild.voiceEnabled OR guildId === RAUMDOCK_GUILD_ID
- `openMissionVoiceSession(operationId)` — stores random room names in DB, grants Global Radio Net and Command Net roles based on the mission voice matrix
- `closeMissionVoiceSession(operationId)` — deletes LiveKit rooms, revokes both roles, clears room names
- `cleanupStaleVoiceSessions(log)` — called from scheduler: revoke+close ops older than 24h that still have rooms

Wire api.ts:
- status → "open" or "in_progress": call openMissionVoiceSession (non-fatal) if hasVoicePermission
- status → "completed" or "cancelled": call closeMissionVoiceSession (non-fatal)

Guild settings:
- SuperAdmin: voiceEnabled toggle + commanderVoiceRoleId + globalVoiceRoleId fields
- Route: POST /guilds/settings/voice-permission (superadmin only)

UI gating via hasVoicePermission:
- Op detail: hide voice channel launch + relay bot sections if !hasVoicePermission
- Guild settings: hide voice bot section from non-superadmin if !hasVoicePermission

Scheduler: add cleanupStaleVoiceSessions to 60s tick in index.ts

## Queued / Planned Step - 2026-05-31: Fleetplanner VOICEBOT_ENCRYPTION_KEY (BYOK)

- `apps/fleetplanner/src/config/env.ts`: Add `VOICEBOT_ENCRYPTION_KEY` (optional, min 32).
- `apps/fleetplanner/src/services/secrets.ts`: `masterSecret()` uses `VOICEBOT_ENCRYPTION_KEY` if set; falls back to `SESSION_SECRET` with console.warn.
- `apps/fleetplanner/.env.example`: Document `VOICEBOT_ENCRYPTION_KEY` with generation instructions.
- CLAUDE.md: Document bot architecture, VOICEBOT_ENCRYPTION_KEY quirk, and "Unsupported state" error diagnosis.
- Server `.env`: `VOICEBOT_ENCRYPTION_KEY` added. After deploy, re-enter all 6 Funkrelais tokens in guild settings.

## Queued / Planned Step - 2026-05-31: Companion config.ts localhost removal + Fleetplanner Discord event voice channel

- `apps/companion/src/lib/config.ts`: Remove isDev localhost fallbacks. `DEFAULT_BRIDGE_URL` and `DEFAULT_FLEETPLANNER_URL` always point to prod.
- `apps/fleetplanner/prisma/schema.prisma`: Add `eventVoiceChannelId String?` to `Operation`.
- Migration: `20260531004000_event_voice_channel`.
- `services/discord.ts`: `createScheduledEvent` uses `op.eventVoiceChannelId ?? guild.eventChannelId` as voice channel location; after creation PATCHes the event to prepend `https://discord.com/events/{guildId}/{eventId}` as first line of description. Added `fetchGuildVoiceChannels` (type=2 filter, sorted).
- `services/operations.ts`: `CreateOperationInput` + `updateOperation` support `eventVoiceChannelId`.
- `routes/web.ts`: New-op GET fetches voice channels for selected/single guild; edit GET fetches for op's guild. Both POST handlers parse and forward `eventVoiceChannelId`.
- `web/pages.ts`: `opFormPage` shows voice channel `<select>` dropdown (optional) when channels are available.

## Queued / Planned Step - 2026-05-31: Fleetplanner Discord install diagnostics

- Add a Fleetplanner GUI test suite for the selected Discord guild that checks
  RDOC-RTC, RDOC-Fleetplanner, and configured VoiceBots for installation and
  required permissions.
- Show exact invite links and setup instructions when a bot is missing or has
  insufficient permissions.
- Link the Companion app to the Fleetplanner diagnostics page instead of
  duplicating bot setup logic in the desktop app.

Rule: before implementation changes, add a short entry under "Queued /
Planned Step" describing what will be changed. After the change, move or
copy the result into "Completed Steps" with commit id if committed.

## Current Baseline

- Repository: `RDOC-Suite`
- Created from: `RDOC-SC-Suite/RDCC`
- Initial commit: `5045813 Initial RDOC Suite shell from RDCC`
- Strategy: RDCC remains the suite shell, styling source, admin UX source,
  Discord guild authority, and deployment base.

## Source Projects

- `RDOC-SC-Suite/RDCC`: base shell, admin styling, Discord bot, guild config,
  raid planner, companion download flow, commander PTT.
- `RDOC/RDOC-RTC`: session lifecycle, Admiral/API-key auth, relay token route,
  relay-bots bridge config, monitoring, audit log, "Voice to All", richer
  companion session UX.
- `RDOC/RDOC-VoiceRelayBots`: worker service that relays LiveKit audio into
  Discord voice channels and exposes metrics/reload/voice-state APIs.

## Target Shape

```text
RDOC-Suite/
  apps/
    bridge/       # one backend for admin, auth, sessions, signaling, relay APIs
    bot/          # Discord slash commands + voice-state cache
    companion/    # RDCC-styled Tauri app with RTC features added
    relay-bots/   # imported VoiceRelayBots worker
  packages/
    shared/
    db/
  prisma/
  docs/
```

## Similar Functionality Map

| Function | RDCC | RDOC-RTC | Target |
| --- | --- | --- | --- |
| LiveKit PTT bridge | guild room per Discord guild | session room per invite | support both guild and session room modes |
| WebSocket signaling | `ptt:start/stop`, voice gating, status flags | `ptt:start/stop`, heartbeat RTT | merged protocol with guild/session context |
| Admin auth | guild-scoped Discord OAuth admins | global Discord OAuth admins + API keys | guild-scoped admins plus API credentials |
| Admin UI | RDCC styling, dashboard, raid planner, config, admins | sessions, relay bots, monitoring, audit | RDCC styling with added pages |
| Discord voice state | bot cache in DB | proxied from relay service | keep RDCC bot cache, use relay proxy as extra status source |
| Relay to Discord channels | planned bridge mode | implemented worker | import worker as `apps/relay-bots` |
| Companion | Discord OAuth, server picker, PTT roster | invite/session, Admiral mode, Voice to All | RDCC UI base with RTC features added |

## Recommended Order

1. Import RDOC-RTC schema concepts into RDCC Prisma without changing runtime code.
2. Add backend auth/API credential services needed by Admiral/API clients.
3. Add session lifecycle backend routes and tests.
4. Add RDCC-styled admin pages for Sessions and API Keys.
5. Import relay token and relay-bots config backend routes.
6. Move VoiceRelayBots into `apps/relay-bots` and convert it to pnpm workspace.
7. Add RDCC-styled Relay Bots and Discord Voice admin pages.
8. Merge monitoring and audit log.
9. Extend shared WebSocket protocol.
10. Merge companion RTC/Admiral/Voice-to-All functions into RDCC companion.
11. Update Docker Compose and deployment docs.
12. Run full build/test/smoke verification and commit stable milestones.

## Queued / Planned Step

- 2026-05-27: Create this merge log and project plan before any merge work, so
  future agents can resume from a repo-local source of truth.
- 2026-05-27: Check all source repositories (`RDOC-SC-Suite/RDCC`,
  `RDOC/RDOC-RTC`, `RDOC/RDOC-VoiceRelayBots`) for upstream changes with
  `git pull`, then bring relevant source changes into `RDOC-Suite` while
  preserving the suite repo as the independent target repository.
- 2026-05-27: Apply deployment naming decision: all web interfaces should use
  `suite.raumdock.org`; LiveKit URL should use `voice.raumdock.org`.
- 2026-05-27: Remove `/dccc` from public suite URLs. Web interfaces should be
  served from `https://suite.raumdock.org/` with empty `PUBLIC_BASE_PATH`.
- 2026-05-27: Configure new Git remote origin:
  `git@github.com:cccdemon/RDOC-Suite.git`.
- 2026-05-27: Rename Docker containers/images to the clear pattern
  `rdoc-suite-<part>` for parts like `livekit`, `bridge`, and `bot`.
- 2026-05-27: Move toward microservice architecture by adding dedicated
  Docker images/services for `monitoring` and `fleetplanner` instead of
  folding those concerns into the bridge image.
- 2026-05-27: Start one-binary Companion merge. Keep RDCC SquadLink UI as
  default, then add dormant RDOC-RTC/Suite capability plumbing for future
  role-unlocked Admiral tools and Voice-to-All without changing the normal
  Commander flow.

## Completed Steps

- 2026-05-27: Created fresh Git repository `RDOC-Suite` from RDCC shell.
  Commit: `5045813`.
- 2026-05-27: Added this merge log and initial integration plan.
  Commit: `7846263`.
- 2026-05-27: Attempted to pull source repositories before importing further
  changes.
  - `RDOC-SC-Suite/RDCC`: local branch `main`, HEAD
    `607f1fe99b7480ece952402c16ce4db4553fc418`. `git pull --ff-only`
    failed because remote is `git@github.com:head87x/rdcc.git` and GitHub SSH
    auth is unavailable in this environment (`Permission denied (publickey)`).
    HTTPS also requested credentials, so no upstream changes could be fetched.
  - `RDOC/RDOC-RTC`: local branch `better-architecture`, HEAD
    `056e7d7232a594426868726c13ee484e03fdf5a5`. `git pull --ff-only`
    failed because remote is `git@github.com:cccdemon/RDOC-RTC.git` and
    GitHub SSH auth is unavailable. HTTPS also requested credentials, so no
    upstream changes could be fetched.
  - `RDOC/RDOC-VoiceRelayBots`: local branch `main`, HEAD
    `1d32ceeb3ead7cc365e8116cc432e13ca82386a1`. HTTPS pull from
    `https://github.com/cccdemon/RDOC-VoiceRelayBots.git main` succeeded and
    reported `Already up to date`.
  - Result for `RDOC-Suite`: no source-code changes imported from upstream
    because the only reachable source repo had no new commits.
- 2026-05-27: Applied deployment naming decision.
  - Web interface / bridge public URL: `https://suite.raumdock.org`
  - Discord OAuth callback: `https://suite.raumdock.org/auth/callback`
  - LiveKit signaling URL: `wss://voice.raumdock.org`
  - Updated `.env.example`, `.env.prod.template`, `Caddyfile`,
    `docker-compose.prod.yml`, `STAND.md`, and relevant code comments.
  - Left historical `CHANGELOG.md` entries unchanged.
- 2026-05-27: Removed `/dccc` path prefix from active production config and
  docs. `PUBLIC_BASE_PATH` is now empty for production root-host routing.
- 2026-05-27: Configured Git remote `origin` as
  `git@github.com:cccdemon/RDOC-Suite.git`.
- 2026-05-27: Renamed active Docker container/image references to
  `rdoc-suite-<part>`.
  - `rdoc-suite-livekit`
  - `rdoc-suite-bridge`
  - `rdoc-suite-bot`
  - Updated compose files, production env comment, and deployment notes.
- 2026-05-27: Added first microservice split for Fleetplanner and Monitoring.
  - Imported RDOC-RTC `apps/fleetplanner` as `@rdoc-suite/fleetplanner`.
  - Added dedicated fleetplanner production image/service:
    `rdoc-suite-fleetplanner`.
  - Added dedicated Prometheus-based monitoring image/service:
    `rdoc-suite-monitoring`.
  - Routed fleetplanner via `https://suite.raumdock.org/fleetplanner`.
  - Routed monitoring via `https://suite.raumdock.org/monitoring`.
  - Added separate data volumes for fleetplanner and monitoring.
  - Ran `pnpm.cmd --filter @rdoc-suite/fleetplanner exec prisma generate
    --schema prisma/schema.prisma` and `pnpm.cmd --filter
    @rdoc-suite/fleetplanner build`; both passed.
  - Ran production compose config validation with a temporary `.env`; passed.
  - Docker image build for monitoring was not run successfully because Docker
    Desktop Linux engine was not available in this environment.
- 2026-05-27: Started one-binary Companion merge.
  - Kept `apps/companion` RDCC/SquadLink UI as the base.
  - Added `apps/companion/src/lib/suite.ts` capability lookup with
    Commander-only fallback.
  - Added dormant persisted `relayHotkey` setting for future Voice-to-All.
  - Added hidden future top-bar controls for Admiral and Voice-to-All; they
    only render if the bridge grants capabilities.
  - Added bridge route `/suite/capabilities`, authenticated by companion
    session JWT and returning conservative false capabilities for now.
  - Verified `pnpm.cmd --filter @dccc/companion build`: passed.
  - `@dccc/bridge` full build remains blocked by existing admin/db TypeScript
    issues unrelated to this route; re-check after schema/db package cleanup.
- 2026-05-27: Fixed `@dccc/bridge` TypeScript build (18 type errors resolved).
  Root cause: `packages/db/generated/client` did not exist (Prisma client
  was never generated in this repo clone). Without it, `getPrisma()` resolved
  to `any`, cascading implicit-any errors into every `.map()` callback that
  touched Phase B models. Fix: `pnpm db:generate`. No code changes required.
  `pnpm --filter @dccc/bridge build` exits 0.
- 2026-05-27: Wired `canManageSessions` in `/suite/capabilities` route.
  Route now reads `guildId` from `?guildId=` query param (companion already
  sends it), falls back to the optional JWT `guildId` claim, then calls
  `isAdmin({ guildId, userId })` against the `AdminUser` table. Returns
  `canManageSessions: true` for any user with an `AdminUser` row for that
  guild (both `admiral` and `vice_admiral` roles). `canUseRelay` and
  `canUseFleetTools` remain `false` pending their respective decisions.
  Build verified: `pnpm --filter @dccc/bridge build` exits 0.
  - Root cause: `packages/db/generated/client` did not exist (Prisma client
    was never generated in this repo clone). Without it, `getPrisma()` resolved
    to `any`, cascading implicit-any errors into every `.map()` callback that
    touched Phase B models (`AdminUser`, `AdminInviteLink`, `UserVoiceState`,
    `CompanionDownloadToken`) and producing one `{}` vs. `string` narrowing
    error at line 1370 of `admin/routes.ts`.
  - Fix: ran `pnpm db:generate` → Prisma client generated to
    `packages/db/generated/client`. No code changes required.
  - Verified: `pnpm --filter @dccc/bridge build` exits 0, no errors.
  - Note: `generated/client` is in `.gitignore`; every fresh clone needs
    `pnpm db:generate` before building. Added to the Queued-steps protocol.

## Open Decisions

- Package namespace: currently inherited as `@dccc/*`; recommended final
  namespace is `@rdoc-suite/*` or `@rdoc-sc/*`.
- Room model: support both persistent guild bridge rooms and invite-based
  session rooms, but keep one shared `RoomRegistry` implementation.
- Fleetplanner: defer until voice/session/relay consolidation is stable.
- Voice-to-All permission: not yet decided (Commander role vs. separate Discord role vs. admin-only).
- Session model: not yet decided (invite-based ops rooms vs. unified guild rooms with extra invite links).

## Decided

- **Admiral tools in Companion** (2026-05-27): `canManageSessions` is based on
  the existing RDCC `AdminUser` whitelist, guild-scoped. No separate API keys
  required for Companion Admiral tools. If a Discord user is in `AdminUser` for
  that guild, their session JWT will carry `canManageSessions: true` from the
  `/suite/capabilities` route.

## Queued / Planned Steps

- 2026-05-31: Add GitHub Actions workflow for automated companion Windows build + deploy to server.
  Primary: GH Actions Windows runner → tauri:build → SCP EXE to /opt/RDOC-Suite/downloads/ → bridge serves via updater.
  Fallback: local build script for manual upload.

- 2026-05-31: Rename all @dccc/* workspace packages to @rdoc-suite/* — package.json names, all imports, Dockerfiles, docker-compose, CLAUDE.md, pnpm-workspace.yaml.

- 2026-05-31: Mark Fleetplanner backlog item #4.2 (auto-create voice channels + assign bots) as done in FLEETPLANNER-BACKLOG.md; user confirmed it is already implemented.
- 2026-05-31: Implement Fleetplanner companion auth + global voice.
  Fleetplanner: CompanionSession DB model, Guild.globalVoiceRoleId, companion OAuth routes
  (/auth/discord/companion/start + /callback → dccc://fleet-auth?token=...),
  GET /api/companion/voice bearer-token endpoint (auto-resolves unit room + global voice gated by Discord role).
  Companion Rust: start_fleet_oauth_webview command (catches dccc://fleet-auth?token=...).
  Companion TS: fleetplannerAuth.ts, store/config fleetplannerUrl+token,
  SettingsModal fleetplannerUrl field, App.tsx: fleet OAuth flow, 20s polling,
  auto-connect FleetAudio (unit) + globalFleetRef (global voice), FLEET LOGIN/PTT/GLOBAL buttons.
- 2026-05-31: Implement Fleetplanner LiveKit voice + Companion integration.
  Fleetplanner: add livekit-server-sdk, new services/livekit.ts (issueUnitLivekitToken, per-unit rooms fleet-{opId}-unit-{unitId}),
  new GET /api/ops/:id/voice-token endpoint (auth required, auto-resolves unit from captain or crew seat).
  Companion: new lib/fleetAudio.ts (FleetAudio class wrapping LivekitAudio, direct url+token connect),
  new components/FleetVoiceModal.tsx (paste JSON token from fleetplanner op page),
  App.tsx wired: fleetStatus/fleetPttActive/fleetRoomName/fleetOpTitle state, fleetRef, FLEET button in modebar,
  mouse PTT from modebar button, disconnect on sign-out.
- 2026-05-31: Implement Fleetplanner backlog #3 — Discord reminder DMs before operation start.
  Schema: add `reminderSentAt DateTime?` to `Operation`, add `reminderOffsetMin Int @default(15)` to `Guild`.
  New migration: `20260531002000_reminder_scheduler`.
  New service: `apps/fleetplanner/src/services/reminderScheduler.ts` — 60s tick, queries ops due for reminder,
  sends DM via existing Fleetplanner Bot (`sendDiscordDm`), marks `reminderSentAt` to prevent re-send.
  Wire into `src/index.ts` alongside existing schedulers.

- 2026-05-30: Step 12 — Full build/test/smoke verification and stable commit.
  Scope: build all workspace packages, run full bridge test suite, verify compose config,
  commit all merge work, tag stable milestone.
  Results:
  - `@dccc/shared` build: exit 0
  - `@dccc/bridge` build: exit 0
  - `@dccc/companion` build (tsc + vite): exit 0
  - `@rdoc-suite/relay-bots` build: exit 0
  - `@rdoc-suite/fleetplanner` build: exit 0
  - `pnpm --filter @dccc/bridge test`: 80/80 passed (6 test files)
  - `prisma migrate status`: 11 migrations, all applied
  - `docker compose -f docker-compose.prod.yml config`: valid (exit 0)
  - Commit: `f9984e9` — 64 files, 8068 insertions, 618 deletions
  All 12 merge steps complete.

- 2026-05-30: Step 11 — Update Docker Compose and deployment docs.
  Deliverables:
  - `docker-compose.prod.yml`: add `relay-bots` service (build context `apps/relay-bots`,
    image `rdoc-suite-relay-bots:latest`, port 8788 localhost-only, config.json mounted
    from `./relay-bots.config.json` on host). monitoring `depends_on` adds relay-bots.
  - `.env.example`: add `LIVEKIT_PROMETHEUS_URL` optional var (bridge → monitoring scrape).
  - `STAND.md` (new): deployment status snapshot — what's live, what needs operator action,
    open config decisions, relay-bots config.json setup instructions.
  - Note `Caddyfile` as orphan/alternative config: prod uses Traefik (see compose comments).

- 2026-05-30: Step 10 — Companion RTC/Admiral/Voice-to-All + import RDCC mobile-PWA additions.
  Part A — RDCC import (bridge):
  - Schema: `EphemeralChannel` model added (GC'd strategy voice channels). Migration `add_ephemeral_channel`.
  - Service: `apps/bridge/src/services/bridgeEvents.ts` copied — debounced guild-state event bus.
  - Service: `apps/bridge/src/services/strategyChannels.ts` copied — on-demand voice channel create + 15-min GC.
  - Discord API: `createGuildVoiceChannel` + `bulkModifyChannelPositions` added to `auth/discord.ts`.
  - Static files copied from RDCC: `admin.mobile.css`, `manifest.webmanifest`, `sw.js`, `pwa-icons/` (5 icons).
  - `views.ts`: `layout()` gets `viewport-fit=cover`, mobile CSS link, manifest link, PWA meta tags, SW registration.
    `renderRaidPlaner` gets Strategy-Channel button (was `renderCommandPanel` in RDCC; RDOC-Suite name kept).
  - `routes.ts`: `/admin` → `/admin/` trailing-slash redirect; `GET /admin/api/live-stream` SSE (replaces
    5 s polling, backed by `bridgeEvents`); `POST /admin/api/channels/reorder`; `POST /admin/api/strategy-channel`.
    `startStrategyChannelGc()` called on app boot.
  - `admin.js`: replaced with RDCC version (optimistic moves, tap-to-move, EventSource live-stream,
    mobile guild-switcher bottom-sheet, strategy-channel dialog, channel reorder); relay-bots form/metrics
    functions (Steps 7-8) re-inserted.
  Part B — Companion Step 10:
  - New `apps/companion/src/lib/sessionApi.ts` — `joinSession(bridgeUrl, bearerToken, inviteToken)` → POST /sessions/join.
  - New `apps/companion/src/components/SessionJoinModal.tsx` — invite token entry UI (commander joins session by paste/type).
  - New `apps/companion/src/lib/relayAudio.ts` — `RelayAudio`: fetches `/relay/token` (bearer), connects second LiveKit
    room, exposes `setPttActive(bool)` to mute/unmute relay audio.
  - `App.tsx`:
    - ADMIRAL button enabled → `openUrl(${bridgeUrl}/admin/sessions)` via tauri plugin-opener.
    - VOICE TO ALL button enabled → relay PTT via `RelayAudio`; status chip on connected panel.
    - `relayHotkey` registered via setupHotkey-like listener for relay PTT (hold to talk in relay room).
    - "JOIN SESSION" button in signed-in panel → `SessionJoinModal` → on confirm: `joinSession()` +
      `ws.connectSession()` + LiveKit connect with session token.
    - Session-aware status: when in session room, shows session label instead of guild name.
    - "LEAVE SESSION" action (back to guild room).
    - AppState gains `sessionMode`, `sessionId`, `sessionLabel`, `relayConnected`, `relayPttActive`.

- 2026-05-29: Step 9 — Extend shared WebSocket protocol.
  Deliverables:
  - Protocol (`packages/shared/src/protocol.ts`):
    - Add `pong` to `ServerMessage`: `{ type: "pong"; timestamp: number; serverTime: number }`
    - Add `roomMode: "guild" | "session"` + `sessionId?: string` to `bridge:joined`
  - Validation (`packages/shared/src/validation.ts`):
    - Add `pong` schema to `serverMessageSchema`
    - Add `roomMode`, `sessionId` fields to `bridgeJoinedSchema`
  - Bridge WS (`apps/bridge/src/signaling/ws.ts`):
    - `attachLifecycle`: handle `heartbeat` by sending `pong { timestamp, serverTime }` reply
    - Add `handleSessionCommander(socket, token, sessionId)`:
      - Verify JWT → userId
      - Verify `SessionInvite.findFirst({ sessionId, usedBy: userId })` exists
      - Verify `Session.status === "active"`
      - Issue `issueSessionLivekitToken(userId, sessionId)`
      - Join `RoomRegistry` under `session-{sessionId}`
      - Send `bridge:joined` with `roomMode: "session"`, `sessionId`, LiveKit creds
      - Recheck: session still active (no Discord role check)
    - `registerWsRoute`: dispatch to `handleSessionCommander` when `sessionId` query param present
  - Companion WS (`apps/companion/src/lib/ws.ts`):
    - Track `lastHeartbeatTimestamp` per send
    - Handle `pong` message: compute RTT, expose `rtt: number | null` property
    - Notify listeners on RTT update (reuse existing `message` listener path)
    - Add `connectSession(token, sessionId)` method alongside `connect(token, guildId)`
  - Tests: extend `ws.test.ts` with session WS path + pong response

- 2026-05-29: Step 8 — Merge monitoring and audit log.
  Deliverables:
  - Prisma: `AdminAuditLog` model added to `prisma/schema.prisma`.
    New migration `add_admin_audit_log`.
  - Service: `apps/bridge/src/services/audit.ts` —
    `appendAudit` (best-effort, never throws), `listRecentAudit(guildId, limit, offset)`,
    `countAudit(guildId)`. Guild-scoped (adds `guildId?` field vs. RDOC-RTC global model).
  - Service: `apps/bridge/src/services/monitoring.ts` —
    `monitoringSnapshot()` with uptime, active rooms/commanders/speaking, system
    memory/CPU, LiveKit bandwidth scrape (optional `LIVEKIT_PROMETHEUS_URL` env var).
  - rooms.ts: `globalMetrics()` added to `RoomRegistry` — returns per-room and
    aggregate stats for the monitoring page without exposing sockets.
  - Route: `apps/bridge/src/routes/prometheusMetrics.ts` — `GET /metrics`
    Prometheus text format; exports `dccc_rooms_active`, `dccc_commanders_active`,
    `dccc_commanders_speaking`. Registered in `app.ts`.
  - Env: `LIVEKIT_PROMETHEUS_URL` optional var added to `baseEnvSchema`.
  - Admin routes (additions to `registerAdminRoutes`):
      GET  /admin/monitoring              — HTML monitoring page
      GET  /admin/monitoring/snapshot     — JSON snapshot (for page AJAX)
      GET  /admin/audit                   — HTML audit page (admiral-only)
      GET  /admin/discord-voice           — HTML Discord voice page (completing step 7)
      GET  /admin/discord/voice-states    — JSON voice-state data for Discord Voice page
      GET  /admin/discord/roles           — JSON guild roles (filtered to commanderRoleIds)
      PATCH /admin/discord/members/:userId/channel  — move guild member
      PUT   /admin/discord/members/:userId/roles/:roleId — add role
      DELETE /admin/discord/members/:userId/roles/:roleId — remove role
  - `appendAudit` wired into: invite mint, invite revoke, admin remove,
    admin role change, session create, session end.
  - Views: `renderMonitoring`, `renderAudit`, `renderDiscordVoice` added to
    `apps/bridge/src/admin/views.ts`; `renderNav` active union extended with
    `"monitoring" | "audit" | "discord-voice"` and three new nav items.
  - prometheus.yml: relay-bots scrape job uncommented.

## Completed Steps (continued)

- 2026-05-27: Session lifecycle backend — Option A (invite-based ops rooms).
  Decision: Admiral mints single-use invite tokens; Commanders redeem them
  for LiveKit credentials. No WS for session rooms (yet — step 9).
  Deliverables:
  - Prisma: `Session` + `SessionInvite` models added to schema.
    Migration `20260527213109_add_session_models` created and applied.
  - Service: `apps/bridge/src/services/sessions.ts` —
    createSession, endSession, listActiveSessions, mintSessionInvite,
    consumeSessionInvite, listSessionInvites, revokeSessionInvite.
  - LiveKit: `issueSessionLivekitToken` + `deleteSessionRoom` added to
    `apps/bridge/src/services/livekit.ts`.
  - Routes: `apps/bridge/src/routes/sessions.ts` registered in app.ts.
    POST /sessions, GET /sessions, GET /sessions/:id, DELETE /sessions/:id,
    POST /sessions/:id/invites, GET /sessions/:id/invites,
    DELETE /sessions/:id/invites/:inviteId, POST /sessions/join.
    All gated by isAdmin except POST /sessions/join (bearer JWT only).
  - Tests: `apps/bridge/src/__tests__/sessions.test.ts` — 18 tests.
    All 73 bridge tests pass.
  - Side-fix: `apps/bridge/src/__tests__/setup.ts` sets DATABASE_URL to
    the absolute path of dev.db so tests run without a shell-level env var.
  Note: DATABASE_URL="file:./prisma/dev.db" resolves to prisma/prisma/dev.db
  (Prisma resolves relative to schema dir). Use "file:./dev.db" in future
  to keep db at prisma/dev.db.
- 2026-05-27: Admin pages for Sessions (step 4 of recommended order).
  RDCC-styled admin web UI for Admirals to manage invite-based ops sessions.
  Deliverables:
  - Views: `renderSessions` + `renderSessionDetail` added to
    `apps/bridge/src/admin/views.ts`. Follow exact RDCC pattern (template
    literals, `esc()`, `html` tag, `dateFmt()`, German strings, ALL-CAPS).
  - Nav: "SESSIONS" item added to `renderNav` between RAID PLANER and KONFIG.
    `active` union extended with `"sessions"`.
  - Routes (6) added to `apps/bridge/src/admin/routes.ts` inside
    `registerAdminRoutes`, gated by `requireAdminSession()`:
      GET  /admin/sessions             — sessions list + "New session" form
      POST /admin/sessions             — create session, redirect with toast
      GET  /admin/sessions/:id         — detail + invites + fresh-invite banner
      POST /admin/sessions/:id/end     — end session, redirect to list
      POST /admin/sessions/:id/invites — mint invite, redirect with ?fresh_*
      POST /admin/sessions/:id/invites/:inviteId/revoke — revoke, redirect
  - Added `application/x-www-form-urlencoded` content-type parser in
    `registerAdminRoutes` (native form POSTs, no new npm dependency).
  - Fresh-invite banner reuses `id="fresh-url"` + `id="copy-fresh"` so
    existing admin.js copy-button handler works without changes.
  - Imports: `createSession`, `endSession`, `getSession`, `listActiveSessions`,
    `mintSessionInvite`, `listSessionInvites`, `revokeSessionInvite` from
    sessions service; `renderSessions`, `renderSessionDetail` from views.
  - Build: `pnpm --filter @dccc/bridge build` exits 0.
  - Tests: all 73 tests pass (no new tests added for HTML pages).
- 2026-05-27: Step 5 — Relay token + relay-bots config backend routes.
  Deliverables:
  - Schema: `RelayBotsConfig` model added to `prisma/schema.prisma`.
    Migration `20260527215503_add_relay_bots_config` created and applied to
    both `prisma/dev.db` and `prisma/prisma/dev.db`.
  - Env: 7 optional relay env vars added to `baseEnvSchema` in
    `apps/bridge/src/config/env.ts` and documented in `.env.example`:
    RELAY_GUILD_ID, RELAY_REQUIRED_ROLE_ID, RELAY_DISCORD_BOT_TOKEN,
    RELAY_LIVEKIT_ROOM (default "voice-relay"), RELAY_BOTS_ADMIN_URL,
    RELAY_BOTS_SECRET, RELAY_BOTS_ADMIN_SECRET.
  - Service: `apps/bridge/src/services/relayBotsConfig.ts` —
    getRelayBotsConfig, setRelayBotsConfig, getRelayLivekitCredentials,
    getRelayRoomName, notifyRelayBotsReload.
  - LiveKit: `issueRelayToken` added to `apps/bridge/src/services/livekit.ts`.
    Uses DB credentials with env fallback; publisher/subscriber grant split.
  - Routes: `apps/bridge/src/routes/relay.ts` registered in app.ts.
    GET /relay/token — bearer JWT auth; optional Discord role check for
    publisher; guildId from ?guildId= param or config or RELAY_GUILD_ID env.
  - Routes: `apps/bridge/src/routes/relayBots.ts` registered in app.ts.
    GET  /admin/relay-bots/config       — read config (cookie auth; tokens redacted for vice admiral)
    POST /admin/relay-bots/config       — write config + notify bots service
    GET  /admin/relay-bots/metrics      — proxy from RELAY_BOTS_ADMIN_URL/api/metrics
    POST /admin/relay-bots/restart      — proxy to RELAY_BOTS_ADMIN_URL/api/restart
    GET  /relay-bots/service-config     — relay bots service fetches config (Bearer RELAY_BOTS_SECRET)
  - Build: `pnpm --filter @dccc/bridge build` exits 0.
  - Tests: all 73 tests pass.
- 2026-05-28: Step 6 — `RDOC/RDOC-VoiceRelayBots` imported as `apps/relay-bots`.
  Package name: `@rdoc-suite/relay-bots`. Already covered by `pnpm-workspace.yaml`
  (`apps/*`). Source files copied verbatim from RDOC-VoiceRelayBots HEAD
  `1d32ceeb`; no code changes to the service itself.
  Deliverables:
  - `apps/relay-bots/package.json` — name `@rdoc-suite/relay-bots`, same deps
  - `apps/relay-bots/tsconfig.json` — NodeNext module, strict, same settings
  - `apps/relay-bots/Dockerfile` — pnpm-based multi-stage build (replaced npm)
  - `apps/relay-bots/config.example.json` — bridge URL updated to
    `https://suite.raumdock.org` (was `/dccc` path prefix)
  - `apps/relay-bots/src/` — config.ts, metrics.ts, index.ts, discord/bot.ts,
    discord/botManager.ts, livekit/subscriber.ts, web/adminServer.ts
  - `apps/relay-bots/.gitignore`
  Note: `@discordjs/opus` native addon requires `pnpm approve-builds` for the
  build script to run. This is a deploy-time concern; TypeScript build passes
  without it (`pnpm --filter @rdoc-suite/relay-bots build` exits 0).
  All 73 bridge tests still pass.
- 2026-05-28: Step 7 — RDCC-styled Relay Bots admin page.
  Deliverables:
  - Views: `renderRelayBots` + `RelayBotsPageData` added to
    `apps/bridge/src/admin/views.ts`. Config form (LiveKit URL/room/key/secret,
    guild ID, dynamic bot list with name/channelId/token) + live metrics section
    (`#relay-metrics-global`, `#relay-metrics-bots`).
    Bot token inputs disabled for vice admirals; `data-can-see-tokens` attribute
    on the card communicates role to admin.js without a second template variable.
  - Nav: "RELAY BOTS" item added to `renderNav` between SESSIONS and KONFIG.
    `active` union already included `"relay-bots"` (added in step 6 prep).
  - Route: `GET /admin/relay-bots` added to `apps/bridge/src/admin/routes.ts`.
    Calls `getRelayBotsConfig()` + `getAdminNavGuilds()`; sets `canSeeTokens`
    from session role; renders `renderRelayBots`.
    Import: `renderRelayBots` from views, `getRelayBotsConfig` from service.
  - JS: `wireRelayBotsForm()` + `wireRelayBotsMetrics()` added to
    `apps/bridge/src/admin/static/admin.js` and called from `boot()`.
    - Form: seeds bot array from server-rendered rows; add/remove bots client-
      side with re-render; Save → JSON POST to `${NAV}/relay-bots/config` →
      redirect with `?saved=1`; Restart → POST `${NAV}/relay-bots/restart`.
    - Metrics: 3-second poll of `${NAV}/relay-bots/metrics`; renders global
      uptime/frames/audio/watchdog chips in `#relay-metrics-global`;
      per-bot name/state/buffer-bar rows in `#relay-metrics-bots`.
      Gracefully shows "OFFLINE" when service is unreachable.
  - TypeScript: `tsc --noEmit` exits 0. All 73 bridge tests pass.
- 2026-05-30: Step 9 — Extend shared WebSocket protocol.
  Deliverables:
  - Protocol (`packages/shared/src/protocol.ts`):
    - `bridge:joined` gains `roomMode: "guild" | "session"` + `sessionId?: string`
    - New `pong` server message: `{ type: "pong"; timestamp: number; serverTime: number }`
  - Validation (`packages/shared/src/validation.ts`):
    - `bridgeJoinedSchema` updated with `roomMode` + `sessionId`
    - `pongSchema` added to `serverMessageSchema`
  - Bridge WS (`apps/bridge/src/signaling/ws.ts`):
    - `attachLifecycle`: `heartbeat` case now sends application-level `pong` reply
    - `handleOAuthCommander`: sends `roomMode: "guild"` in `bridge:joined`
    - New `handleSessionCommander(socket, token, sessionId)`:
      - Verifies JWT → userId
      - Checks `SessionInvite.findFirst({ sessionId, usedBy: userId })` → 4403 if absent
      - Checks `Session.status === "active"` → 4403 if ended/missing
      - Issues `issueSessionLivekitToken({ userId, livekitRoom: session.livekitRoom })`
      - Joins `RoomRegistry` under `session-{sessionId}`
      - Sends `bridge:joined` with `roomMode: "session"`, `sessionId`, LiveKit creds
      - Recheck: session still active (no Discord role check)
    - `registerWsRoute`: dispatches to `handleSessionCommander` when `?sessionId=` present
  - Companion WS (`apps/companion/src/lib/ws.ts`):
    - `teardownSocket()` helper extracted (was inline in `connect()`)
    - New `connectSession(token, sessionId)` method for session-room WS
    - `openSocket()` handles `guildId` vs `sessionId` routing, closes on 4403
    - `lastHeartbeatTimestamp` tracked; `rtt: number | null` property updated on `pong`
  - Tests (`apps/bridge/src/__tests__/ws.test.ts`): 7 new tests
    - pong reply to heartbeat
    - `bridge:joined` includes `roomMode: "guild"` for guild path
    - Session path: rejects invalid token (4401)
    - Session path: rejects non-member (4403)
    - Session path: rejects ended session (4403)
    - Session path: sends `bridge:joined` with `roomMode: "session"` + creds
    - Session path: ptt:start broadcasts commander:list
  - Build: `@dccc/shared`, `@dccc/bridge`, `@dccc/companion` all exit 0.
    All 80 bridge tests pass.
- 2026-05-30: Step 10 — Companion RTC/Admiral/Voice-to-All + RDCC mobile-PWA import.
  Part A — RDCC import (bridge):
  - Schema: `EphemeralChannel` model. Migration `20260529221549_add_ephemeral_channel`.
  - Service: `bridgeEvents.ts` (debounced guild-state event bus).
  - Service: `strategyChannels.ts` (on-demand voice channel + 15-min GC).
    `startStrategyChannelGc()` called from `app.ts` at boot.
  - Discord API: `createGuildVoiceChannel`, `bulkModifyChannelPositions`, `deleteChannel`
    added to `auth/discord.ts`.
  - Static files copied: `admin.mobile.css`, `manifest.webmanifest`, `sw.js`, `pwa-icons/`.
  - `views.ts`: PWA meta tags + mobile CSS link + SW registration in `layout()`;
    strategy-channel button in `renderRaidPlaner` channel-mirror header.
  - `routes.ts`: `/admin` redirect; SSE live-stream `GET /admin/api/live-stream`;
    `POST /admin/api/channels/reorder`; `POST /admin/api/strategy-channel`.
  - `admin.js`: replaced with RDCC version (optimistic moves, tap-to-move, EventSource,
    mobile guild-switcher bottom-sheet, strategy-channel, channel reorder) + relay-bots
    form/metrics (Steps 7-8) re-inserted.
  Part B — Companion Step 10:
  - New `src/lib/sessionApi.ts` — `joinSession()` → POST /sessions/join (bearer auth).
  - New `src/components/SessionJoinModal.tsx` — invite token entry UI.
  - New `src/lib/relayAudio.ts` — `RelayAudio`: fetches /relay/token, wraps second
    LivekitAudio, exposes `setPttActive(bool)` + status listener.
  - `App.tsx`:
    - ADMIRAL button → `openUrl(bridgeUrl/admin/sessions)` via tauri plugin-opener.
    - SESSION button → SessionJoinModal → `ws.connectSession()` + LiveKit on join.
    - SESSION VERLASSEN button when in session → disconnect + reconnect guild WS.
    - VOICE TO ALL button + relayHotkey → relay PTT via RelayAudio.
    - Status strip shows session label when in session mode.
    - AppState: `sessionId`, `sessionLabel`, `relayStatus`, `relayPttActive`.
  - Build: `@dccc/bridge`, `@dccc/companion` exit 0. All 80 bridge tests pass.
- 2026-05-30: Step 11 — Update Docker Compose and deployment docs.
  Deliverables:
  - `docker-compose.prod.yml`: `relay-bots` service added (build context `apps/relay-bots`,
    image `rdoc-suite-relay-bots:latest`, port 127.0.0.1:8788:8788, config.json mounted from
    `./relay-bots.config.json` on host). `monitoring` depends_on now includes `relay-bots`.
  - `.env.example`: `LIVEKIT_PROMETHEUS_URL` optional var documented.
  - `STAND.md` created: deployment topology, all services + status, Traefik/Caddyfile note,
    relay-bots.config.json setup instructions, build/deploy commands, open decisions.
- 2026-05-29: Step 8 — Merge monitoring and audit log.
  Deliverables:
  - Prisma: `AdminAuditLog` model added to `prisma/schema.prisma`.
    Migration `20260529214305_add_admin_audit_log` created and applied.
    Fields: id, guildId?, actorUserId?, actorLabel?, action, target?,
    metadata (JSON string, default "{}"), createdAt. Index on (guildId, createdAt).
  - Service: `apps/bridge/src/services/audit.ts` —
    `appendAudit` (best-effort, never throws), `listRecentAudit(guildId, limit, offset)`,
    `countAudit(guildId)`. Guild-scoped vs. RDOC-RTC's global model.
  - Service: `apps/bridge/src/services/monitoring.ts` —
    `monitoringSnapshot()` with uptime, active rooms/commanders/speaking, system
    memory/CPU, LiveKit bandwidth scrape (optional `LIVEKIT_PROMETHEUS_URL` env var).
  - rooms.ts: `globalMetrics()` added to `RoomRegistry` — returns per-room and
    aggregate stats without exposing sockets.
  - Route: `apps/bridge/src/routes/prometheusMetrics.ts` — `GET /metrics`
    Prometheus text format; exports `dccc_rooms_active`, `dccc_commanders_active`,
    `dccc_commanders_speaking`. Registered in `app.ts` before admin routes.
  - Env: `LIVEKIT_PROMETHEUS_URL` optional var added to `baseEnvSchema` in
    `apps/bridge/src/config/env.ts`.
  - Admin routes added to `registerAdminRoutes`:
      GET  /admin/monitoring              — HTML monitoring page
      GET  /admin/monitoring/snapshot     — JSON snapshot (30s poll by page JS)
      GET  /admin/audit                   — HTML audit log (admiral-only; 403 for vice_admiral)
      GET  /admin/discord-voice           — HTML Discord voice page (completing step 7)
      GET  /admin/discord/voice-states    — JSON voice-state data (15s poll by page JS)
      GET  /admin/discord/roles           — JSON guild roles
      PATCH /admin/discord/members/:userId/channel  — move guild member + audit
      PUT   /admin/discord/members/:userId/roles/:roleId — add role + audit
      DELETE /admin/discord/members/:userId/roles/:roleId — remove role + audit
  - `appendAudit` wired into 5 existing handlers: invite revoke, admin remove,
    admin role change, session create, session end.
  - Views: `renderMonitoring`, `renderAudit`, `renderDiscordVoice` added to
    `apps/bridge/src/admin/views.ts`. Nav extended with "DISCORD VOICE",
    "MONITORING", "AUDIT" items; `renderNav` active union extended with
    `"monitoring" | "audit" | "discord-voice"`.
  - prometheus.yml: relay-bots scrape job uncommented (was gated on step 11,
    moved to active now that relay-bots is imported).
  - Build: `pnpm --filter @dccc/bridge build` exits 0. All 73 tests pass.
---

## Queued — Post-merge review fixes (2026-05-30)

External code review of committed merge (07d0ac4) found bugs. Fixing in one pass:

- **#1 (High)** Voice-channel enforcement fallback missing. `internal.ts` docstring
  claims the 60s recheck loop catches voice-channel drift, but the `attachLifecycle`
  recheck in `ws.ts` only calls `recheckCommanderRole` (role only). Add
  `checkAllowedVoiceChannel` to the loop so a user who leaves an allowed channel
  loses audio even if the bot's internal push is unavailable.
- **#2 (Med)** `ptt:start` accepted regardless of audio-enabled state. Bridge will
  reject ptt:start when the socket is not currently audio-enabled, so a client
  cannot broadcast TALKING after `audio:disable`.
- **#3 (Med)** Shared test drift: `validation.test.ts` bridge:joined fixture missing
  required `roomMode` → `@dccc/shared` test fails. Add `roomMode`.
- **#4 (Med)** `registerUnit` creates fleetUnit before validating ship / creating
  seats → orphan unit on failure. Validate ship + compute specs first, then create
  unit + seats + captain assignment in one `$transaction`.
- **#5 (Med)** `claimSeat` check-then-update race. Wrap in `$transaction` with a
  conditional `updateMany` (where userId null) + re-check single-seat-per-op.
- **#6 (Med)** Relay subscriber tokens unprotected. `GET /relay/token?role=subscriber`
  required only a valid companion JWT; doc claimed a shared secret. Require
  `RELAY_BOTS_SECRET` bearer for subscriber role; companion JWT path = publisher only.
- **#7 (Med)** Updater token in request body + wildcard CORS. Move to Authorization
  bearer; restrict CORS to known origins.
- **#8 (Low)** Companion download tokens stored plaintext. Store SHA-256 hash, compare
  on redeem.
- **#9 (Low)** ESLint config: add browser/service-worker globals for static JS, ignore
  generated/static assets. Fix real unused-var findings.
- **Cosmetic** Fix mojibake in README + oauth.ts strings; self-host fleetplanner fonts;
  fleetplanner dev cookie `secure` conditional on NODE_ENV.

## Completed — Post-merge review fixes (2026-05-30)

All 11 review findings fixed. `pnpm build` ✓, `pnpm lint` ✓ (188 → 0 errors),
`pnpm test` ✓ (shared 13, bridge 87 — was 80, +7 new). Companion + fleetplanner
tsc/vite build ✓.

- **#1** `apps/bridge/src/signaling/ws.ts` — guild-path recheck loop now also runs
  `checkAllowedVoiceChannel` and reconciles the audio grant (pushAudioDisable /
  pushAudioEnable) so voice-channel drift is caught even if the bot's
  `/internal/voice-state-changed` push is unavailable.
- **#2** Audio gating made server-authoritative. `rooms.ts` tracks per-socket
  `audioEnabled`; `pushAudioEnable`/`pushAudioDisable` and both join paths set it;
  `ptt:start` now rejects with `audio_not_enabled` when audio isn't granted.
  Regression test added.
- **#3** `packages/shared/src/__tests__/validation.test.ts` — bridge:joined fixture
  gained `roomMode: "guild"`. Shared tests pass.
- **#4** `apps/fleetplanner/src/services/units.ts` — `registerUnit` validates ship +
  computes seat specs before any write, then creates unit + seats + captain
  assignment inside one `$transaction` (no orphan units).
- **#5** `claimSeat` wrapped in a `$transaction` with a conditional
  `updateMany(where userId:null)` — race-safe seat claiming.
- **#6** `apps/bridge/src/routes/relay.ts` — `role=subscriber` now requires the
  `RELAY_BOTS_SECRET` bearer (constant-time compare); companion JWT path is
  publisher-only. No HTTP consumer used subscriber (relay-bots mints its own token),
  so nothing breaks. 6 relay tests added (`relay.test.ts`).
- **#7** `apps/bridge/src/routes/updater.ts` + `apps/companion/src/lib/updater.ts` —
  token moved to `Authorization: Bearer` header (query/body kept as fallback for
  older EXEs); CORS echoes the request Origin instead of `*` and allows the
  `authorization` header.
- **#8** `apps/bridge/src/services/companionDownloads.ts` — raw download tokens are
  no longer persisted (only sha256). A DB read can't recover live links. Admin
  re-copy after mint is gone (re-mint instead).
- **#9** `eslint.config.mjs` — browser + service-worker globals for
  `apps/bridge/src/admin/static/**/*.js`; `_`-prefix ignore + `caughtErrors:none` +
  `allowEmptyCatch` for that vendored JS. Fixed 5 real unused-var/`prefer-const`
  findings in `views.ts`, `auth.ts`, `web.ts`, `routes.ts`, `livekit.ts`.
- **Cosmetic** Fixed mojibake `fÃ¼r`→`für` in `SettingsModal.tsx`; dropped the
  Google-Fonts `@import` from fleetplanner `render.ts` (system-font fallbacks already
  present); fleetplanner session cookie `secure` now gated on
  `NODE_ENV==="production"` so local HTTP dev login works.
  (README mojibake reported by the reviewer was a false positive — files are clean UTF-8.)

---

## Queued — Fleetplanner finalize (2026-05-30)

User directive "finalize my fleetmanager". Scope:

1. **DB → Postgres** (from SQLite). New `postgres` service in docker-compose.prod.yml,
   `DATABASE_URL` switched, fresh PG baseline migration (old SQLite migration dropped),
   `.env.example` + STAND.md updated. Assumption: fresh DB (ships re-sync; old SQLite
   ops/users not migrated).
2. **Ship catalog cache + weekly refresh**: ships fetched from SC wiki are cached
   (already are); add a configurable auto-refresh (default weekly) + manual admin
   trigger. New `ShipSyncState` singleton (intervalDays, lastRunAt, running, enabled,
   shipCount). Scheduler in boot; full-catalog paginated sync.
3. **Feature audit**: confirm seat-claim, captain-adds-ship-with-crew-count,
   admiral-creates-op→discord-event all work end-to-end; fix gaps.
   Found gaps: backgroundSync never scheduled; Discord event id never stored
   (re-open duplicates events, can't delete on cancel) → add `Operation.discordEventId`.
4. **Admin GUI**: ship-sync panel (status, interval, "Sync now"); general GUI polish.

---

## Queued — Fleetplanner multi-tenant (Option A) (2026-05-30)

Multiple Discords share one Fleetplanner instance. Decisions:
- Trennlinie: `Operation.guildId`. New `Guild` + `GuildMembership` (role per guild).
- Roles per guild: installer=Admiral + manual mgmt + optional Discord-role mapping
  (Guild stores admiralRoleId, synced on login via bot REST; captainRoleId was removed).
- Bot invite: self-service — any logged-in user can add the bot to a Discord they
  manage (`/guilds/add` → Discord bot-invite → `/guilds/added` ?guild_id).
- Access: must be a real Discord member (Discord OAuth gains `guilds` scope; on login
  user's guilds ∩ installed Guilds → GuildMembership upsert; role via mapping).
- `User.role` becomes instance-level (superadmin only); per-guild role via membership.
- Active guild via cookie `fp_guild`, validated against membership; header switcher.
- Events: `createScheduledEvent(op)` uses `op.guildId` + `Guild.eventChannelId` + the
  single bot token (bot is in the target guild because it was invited).
- Fresh PG DB → fold Guild/GuildMembership/Operation.guildId into the baseline migration.

## Completed — Fleetplanner multi-tenant (Option A) (2026-05-30)

Multiple Discords share one instance. `pnpm --filter @rdoc-suite/fleetplanner build` ✓.
NOTE: Codex was editing fleetplanner in parallel; per user decision Codex stopped
fleetplanner and this agent owns the implementation. Codex had stubbed multi-tenant
with a hardcoded `currentGuildId()="default"` — replaced with the real resolution.

- Schema: `Guild` + `GuildMembership` (role/guild) + `Operation.guildId`; folded into
  the PG baseline migration (fresh DB).
- `services/guilds.ts`: installGuild, syncUserGuildMemberships (Discord guilds ∩
  installed → role via mapping), resolveActiveGuild, effectiveOpRole, listUserGuilds.
- Auth: Discord OAuth gained `guilds` scope; `providers.ts` returns discordGuildIds;
  `identity.ts` syncs memberships on login + on Discord-link.
- `routes/guilds.ts`: `/guilds` (list/switch), `/guilds/add` + `/guilds/added`
  (self-service bot invite), `/guilds/switch`, `/guilds/none`, `/guilds/settings`
  (+ per-guild member role mgmt). `fp_guild` active-guild cookie.
- Middleware: `requireGuild` / `requireGuildRole` / `optionalGuild` / `requireOpRole`.
- web.ts: home/ops-new/detail scoped to active guild; op edit/delete via requireOpRole;
  global `/admin` (ship/location catalog + user mgmt) now instance-superadmin-only;
  assignable-users list scoped to the op's guild.
- api.ts: all op-management routes (accept/reject/discord-role/status/seats/leaders/
  groups/requirements) + inline checks converted from global role to per-op guild role.
- discord.ts: `createScheduledEvent(op)` posts to `op.guildId` + per-guild event
  channel; `deleteScheduledEvent(guildId, eventId)`; added fetchGuildBasic /
  fetchGuildMemberRoles bot REST helpers.
- Pages: noGuildPage, guildsListPage, guildSettingsPage; nav gained "Servers"; login
  link → /login (multi-provider).
- env/.env.example/STAND updated (guilds scope, bot-invite redirect, GitHub/Google,
  DISCORD_FLEETPLANNER_CLIENT_ID).

Follow-ups (not blocking): header inline guild-switcher dropdown (currently a /guilds
page); migrating any existing single-tenant data (fresh DB assumed).
