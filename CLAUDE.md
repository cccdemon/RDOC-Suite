# CLAUDE.md

## Projektname

Discord Channel Commander Voice Bridge

## Operative Hinweise für Claude Code

Dieser Abschnitt fasst zusammen, was beim Arbeiten am Repo sofort gebraucht wird. Die harten Constraints (Security, Coding, Architektur) stehen weiter unten.

> **Für Production: [STAND.md](STAND.md) ist Single-Source-of-Truth.** Dort steht der aktuelle Deploy-Stand (Hostname, Traefik-Routing, LXC-Setup, iptables-DNAT, `.env` auf dem Server, offene Punkte). Wenn du an Docker/Deploy/Traefik/Prod-`.env` arbeitest, lies STAND.md zuerst. Dieser Abschnitt hier beschreibt nur den Code und das lokale Dev-Setup.

### Häufige Commands — Lokales Dev

```bash
# Installation und Setup
pnpm install
pnpm db:generate            # Prisma Client generieren
pnpm db:migrate             # Migrationen auf dev.db anwenden
pnpm db:studio              # Prisma Web-UI für die SQLite-DB

# Build / Lint / Format / Test (alle Workspaces)
pnpm build
pnpm lint
pnpm format
pnpm test                   # vitest in jedem Workspace, der test-Skript hat

# Einzelnes Workspace bauen / entwickeln (Watch-Mode)
pnpm --filter @dccc/bot dev
pnpm --filter @dccc/bridge dev
pnpm --filter @dccc/companion dev          # nur Vite-Frontend
pnpm --filter @dccc/companion tauri:dev    # Vite + Rust Shell (Hotkeys, Deep-Link)

# Bot / Bridge starten (nach `build`)
node apps/bot/dist/index.js
node apps/bridge/dist/index.js

# Einzelne Tests laufen lassen (Bridge ist aktuell das einzige Workspace mit Tests)
pnpm --filter @dccc/bridge test -- oauth      # nur oauth.test.ts
pnpm --filter @dccc/bridge test -- -t "name"  # einzelner it("name", ...) Block

# Lokales LiveKit (für Voice-Tests zwingend; Dev-Compose mit eingebauten Creds)
docker compose up -d livekit
```

Es gibt keinen `ts-node`-Runner. Bot und Bridge müssen vor dem Start kompiliert werden (Output in `dist/`). **Für Production wird ausschließlich in Docker gebaut** — siehe nächster Block.

### Häufige Commands — Production (auf dem Commander-LXC)

```bash
cd /opt/discord-channel-commander
git pull
docker compose -f docker-compose.prod.yml build         # baut alle geänderten Services (bridge + bot)
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f bridge   # oder `logs -f bot`
```

Build läuft komplett im Container — der LXC-Host braucht außer Docker nichts. Bridge und Bot laufen beide dockerisiert (`dccc-bridge`, `dccc-bot`); LiveKit ebenso (`dccc-livekit`, fertiges Image). Prisma-Migrations werden beim Bridge-Container-Start vom [apps/bridge/docker-entrypoint.sh](apps/bridge/docker-entrypoint.sh) idempotent ausgeführt (`prisma migrate deploy`). Companion-Builds laufen weiter nur **lokal auf Windows** (Tauri braucht Rust + MSVC).

### Workspace-Namen

| Verzeichnis | pnpm-Name |
| --- | --- |
| [apps/bot/](apps/bot/) | `@dccc/bot` |
| [apps/bridge/](apps/bridge/) | `@dccc/bridge` |
| [apps/companion/](apps/companion/) | `@dccc/companion` |
| [packages/shared/](packages/shared/) | `@dccc/shared` |
| [packages/db/](packages/db/) | `@dccc/db` |

### Architektur-Pickup in 8 Punkten

1. **Bridge = Fastify** mit `@fastify/cookie` + `@fastify/websocket`. Bootstrap in [apps/bridge/src/app.ts](apps/bridge/src/app.ts); Health-Check unter `/health`, OAuth unter `/auth/*`, WebSocket unter `/ws`. Logs werden mit Pino redacted (siehe `REDACT_PATHS`).
2. **Session-Token = HS256-JWT** via `jose`, 15 min TTL, Issuer `dccc-bridge`, Audience `dccc-companion`, In-Memory-Revocation per `jti` ([apps/bridge/src/auth/sessionToken.ts](apps/bridge/src/auth/sessionToken.ts)). Companion sendet das Token als `?token=…` Query-Param beim WS-Connect.
3. **WS-Protokoll** ist in [packages/shared/src/protocol.ts](packages/shared/src/protocol.ts) typisiert; Parser/Validator in [packages/shared/src/validation.ts](packages/shared/src/validation.ts). Non-Standard Close-Codes: `4401` unauth, `4400` protocol, `4403` forbidden. Heartbeat alle 20 s, **Permission-Recheck alle 60 s** ([apps/bridge/src/signaling/ws.ts:12-13](apps/bridge/src/signaling/ws.ts#L12-L13)) — verliert ein Commander seine Rolle, fliegt er beim nächsten Tick aus dem Raum.
4. **Voice geht über LiveKit (SFU), Lifecycle ist sticky pro WS-Session**. Direkt nach erfolgreichem WS-Auth (nicht erst bei `ptt:start`) minted die Bridge ein LiveKit-Token, joined den Commander in den Room und schickt `bridge:joined` mit `livekitUrl` + `livekitToken`. Companion verbindet sich zu LiveKit, publiziert den Mic-Track **gemuted**. `ptt:start`/`ptt:stop` toggeln dann nur noch (a) das `speaking`-Flag in `commander:list`-Broadcasts und (b) den lokalen Mic-Mute-State über `LivekitAudio.setMuted()` — der ICE/DTLS-Handshake passiert genau einmal pro Session, nicht pro Tap. Echter Leave erst bei WS-Close oder Permission-Recheck-Fail. Räume sind in-memory ([apps/bridge/src/services/rooms.ts](apps/bridge/src/services/rooms.ts)); Bridge-Neustart heißt: alle Commander re-connecten von vorne.
5. **Hotkey ist zweischichtig**: Tastatur über `@tauri-apps/plugin-global-shortcut`, Maus-Tasten (`Mouse4`, `Mouse5`, …) über einen eigenen `rdev`-Thread in Rust ([apps/companion/src-tauri/src/lib.rs:13](apps/companion/src-tauri/src/lib.rs#L13), aktuell nur Windows). Beide Quellen emittieren das gleiche `"hotkey"` Event; die React-Schicht filtert nach Accelerator-Name.
6. **`PUBLIC_BASE_PATH` macht die Bridge reverse-proxy-aware** ([apps/bridge/src/config/env.ts:17-23](apps/bridge/src/config/env.ts#L17-L23)). Wenn Traefik `commander.raumdock.org/dccc/*` per `stripPrefix` an die Bridge weiterreicht, sieht die Bridge nur `/auth/...`, der Browser aber `/dccc/auth/...`. Damit Cookies und (potentiell) Redirects mit dem **un-stripped** Pfad arbeiten, setzt die Bridge ihren OAuth-`state`-Cookie auf `Path=${PUBLIC_BASE_PATH}/auth` ([apps/bridge/src/auth/oauth.ts](apps/bridge/src/auth/oauth.ts)). Lokal: `PUBLIC_BASE_PATH=""` (Default), dann Cookie-Path `/auth` wie ohne Proxy. Prod: `PUBLIC_BASE_PATH=/dccc`. Zod-Schema akzeptiert nur `""` oder Werte mit führendem `/`.
7. **Voice-Channel-Enforcement: DB für State, HTTP-Push für Realtime**. Bot abonniert `voiceStateUpdate` mit dem `GuildVoiceStates`-Intent ([apps/bot/src/events/voiceState.ts](apps/bot/src/events/voiceState.ts)) und upsertet jede Änderung in `UserVoiceState` (`{guildId, userId, channelId|null}`). **Direkt nach dem DB-Upsert** macht der Bot einen fire-and-forget HTTP-POST an die Bridge (`/internal/voice-state-changed`, Auth via `X-Internal-Auth`-Header mit `INTERNAL_BRIDGE_SECRET`), damit die Bridge sofort `audio:enable` / `audio:disable` an die offene Companion-WS pushen kann — kein 60s-Recheck-Lag mehr. Die 60s-Loop in [ws.ts](apps/bridge/src/signaling/ws.ts) gibt es weiter, aber sie prüft jetzt nur noch die Discord-**Rolle** (Bot pusht keine Rollen-Änderungen), nicht mehr die Voice-Channel-Zugehörigkeit. **WS bleibt sticky offen** auch wenn der User nicht in einem erlaubten Voice-Channel ist — `bridge:joined` wird ohne `livekitUrl` + `livekitToken` geschickt, Companion wartet auf den nächsten `audio:enable`-Push. Empty `allowedVoiceChannelIds` = always pass (backwards-kompatibel). Fallback-Verhalten ohne `INTERNAL_BRIDGE_SECRET`: Endpoint returnt 503, Bot loggt warn, System fällt zurück auf 60s-Recheck-only — Audio-Toggle dauert dann wieder bis zu 60 s.
8. **Phase B (rewritten 2026-05-24): zwei Tiers (Admin → Commander)**. Der ursprüngliche B1-Versuch mit drei Tiers (Admin/Admiral/Commander, ApiCredential, Session, per-Session-InviteToken) wurde wieder zurückgebaut, weil zu komplex für unsere Bedürfnisse. Jetzt: **Admin** = Discord-User auf der `AdminUser`-Whitelist pro Guild → kann sich in's Web-Admin-UI bei `/admin/*` einloggen (Discord-OAuth + Cookie-Session), dort alles managen: GuildConfig editieren, andere Admins via Invite-Link einladen, Live-Dashboard sehen. **Commander** = Discord-User mit Commander-Rolle → benutzt die Companion mit dem existierenden OAuth-JWT-Flow aus Phase A/A.1 (`WS /ws?token=<jwt>`). Bootstrap des ersten Admins via `/cc admin add @user` (Discord Manage Guild), alles andere übers Web-UI. Admin-Invite-Links sind single-use, sha256-hash-only persistiert, 7-Tage-Default-TTL, atomic-consume in Transaction. Code: [apps/bridge/src/admin/](apps/bridge/src/admin/) (auth-Cookie, OAuth, Views, Routes), [apps/bridge/src/services/adminInviteLinks.ts](apps/bridge/src/services/adminInviteLinks.ts) (mint/consume/revoke). Tests in [apps/bridge/src/__tests__/admin.test.ts](apps/bridge/src/__tests__/admin.test.ts).

### Quirks, die schon Zeit gekostet haben

- **`--node-ip` ist überall load-bearing.** Im Dev-Compose `--node-ip 127.0.0.1` ([docker-compose.yml](docker-compose.yml)), weil Docker Desktop unter Windows nicht zurück-hairpinnen kann. Im Prod-Compose `--node-ip ${LIVEKIT_NODE_IP}` ([docker-compose.prod.yml](docker-compose.prod.yml)) mit Wert aus `.env`, weil Proxmox/LXC-Double-NAT die STUN-basierte Auto-Detection bricht (STUN sieht nur die LXC-Bridge-Gateway-IP wie `10.10.10.1`, nicht die echte Public IP). Ohne den Flag advertised LiveKit eine intern-only-Adresse an WebRTC-Clients, ICE schlägt fehl, Audio bleibt bei „could not establish pc connection" hängen.
- **`tauri_plugin_single_instance` muss als allererstes registriert werden** ([apps/companion/src-tauri/src/lib.rs:60](apps/companion/src-tauri/src/lib.rs#L60)), sonst startet jeder `dccc://`-Deep-Link eine zweite Companion-Instanz statt die laufende zu öffnen.
- **Discord-IDs sind immer Strings**, nie Number — Snowflakes überschreiten `Number.MAX_SAFE_INTEGER`.
- **Companion-Production-Build** braucht zusätzlich Rust und (auf Windows) Visual Studio Build Tools; siehe `README.md` Quickstart.
- **SQLite-Pfad auf Prod ist `/app/data/prod.db`, NICHT `/app/prisma/prod.db`** ([STAND.md](STAND.md) §Build- und Deploy-Commands). Das Volume mountet auf `/app/data`; `/app/prisma` darf NICHT vom Volume überdeckt werden, sonst stehlen Volume-eigene Migrations + Schema die Image-eigenen (haben wir 2026-05-23 schmerzhaft gelernt, als der `better-architecture`-Branch eines parallel arbeitenden Devs seine Schema-Files in unsere Volume eingebacken hatte und unsere main-branch-Migration silent ignoriert wurde). Filename `prod.db`, nicht `dev.db`, weil Docker bei nicht-existenten Bind-Mount-Sources Directories statt Files anlegt → Prisma `P1013 invalid connection string`.
- **`pnpm install` im Bridge-Dockerfile braucht `--no-frozen-lockfile` und `ENV CI=true`** ([apps/bridge/Dockerfile](apps/bridge/Dockerfile)). Es gibt bewusst keinen lokalen Node-Workflow für dieses Repo — Manifest-Änderungen kommen ohne aktualisierten Lockfile rein; der erste Docker-Build refresht ihn. `CI=true` verhindert pnpms TTY-Prompt beim Purgen von Dev-Deps.
- **pnpm-Workspaces im Runtime-Image:** **jedes** Workspace-`node_modules/` muss mit-kopiert werden, nicht nur Root + Target. Sonst `ERR_MODULE_NOT_FOUND` für transitive Deps anderer Workspaces (z. B. `zod` aus `@dccc/shared`). Im [apps/bridge/Dockerfile](apps/bridge/Dockerfile) bereits gelöst — als Vorlage für neue Workspace-Container nutzen.
- **`Caddyfile` im Repo ist eine Leiche.** Production läuft auf Traefik (siehe [STAND.md](STAND.md) §Traefik-Setup). Kann gelöscht werden, sobald sicher ist dass keiner das noch deployed.
- **Auf dem LXC kann ein alter `dccc-bridge.service` (systemd) parallel zum Docker-Container laufen** und den Port 8787 wegnehmen. Vor jedem Prod-Deploy prüfen: `systemctl is-enabled dccc-bridge`. Falls aktiv → `systemctl disable --now dccc-bridge`. Dasselbe gilt für `dccc-bot.service` seit der Bot ebenfalls dockerisiert ist. (Aktueller Stand auf `headwig`: `systemctl list-units 'dccc-*'` ist leer — siehe STAND.md.)
- **`GuildVoiceStates` ist nicht-privileged**. Anders als `GuildMembers` oder `MessageContent` muss man im Discord Developer Portal nichts toggeln. Wenn der Bot trotzdem keine `voiceStateUpdate`-Events bekommt, ist meistens der Intent nicht im `new Client({intents: […]})`-Array.
- **Voice-State-Race beim Bot-Restart**: User, die *vor* dem Bot in Voice waren, fehlen kurz in der `UserVoiceState`-Tabelle, bis der `ClientReady`-Sync durch ist (Sekunden). Connectet ein Companion in dem Fenster, kriegt er `not_in_voice` — Channel kurz verlassen + wieder joinen umgeht's. Ist akzeptiert.

### Wo welche Doku liegt

- [STAND.md](STAND.md) — **aktueller Deployment-Stand** (Hostname, Routing, .env, offene Punkte). Bei Production-Fragen zuerst hier lesen.
- [README.md](README.md) — verifizierter Quickstart, Architektur-Diagramm, Repository-Layout, Scripts-Tabelle
- [docs/admin-guide.md](docs/admin-guide.md) — Server-Admin-Walkthrough (Discord-App anlegen, Bot einladen, Rollen konfigurieren)
- [docs/commander-guide.md](docs/commander-guide.md) — Commander-Walkthrough (Login, Hotkey, Audio)
- [docs/privacy.md](docs/privacy.md) — Daten-Inventar
- [security-plan.md](security-plan.md) — Security-Threat-Model und geplante Härtungen
- [CHANGELOG.md](CHANGELOG.md) — Release-Notes (aktuell v0.1.0)
- Datenmodell: [prisma/schema.prisma](prisma/schema.prisma) ist die Quelle der Wahrheit (nicht hier dupliziert)
- WS-Protokoll: [packages/shared/src/protocol.ts](packages/shared/src/protocol.ts) (Typen) + [packages/shared/src/validation.ts](packages/shared/src/validation.ts) (Zod-Validatoren)

---

## Ziel

Dieses Projekt entwickelt eine Discord-Integration, mit der ausgewählte Nutzer, sogenannte **Channel Commander**, per Hotkey channelübergreifend miteinander sprechen können.

Der Zweck ist, dass Commander aus verschiedenen Voice-Channels kurzfristig Informationen austauschen können, ohne ihren eigentlichen Channel dauerhaft verlassen zu müssen. Danach geben sie relevante Informationen an ihre jeweiligen Channel weiter.

Typisches Szenario:

- Mehrere Teams befinden sich in getrennten Voice-Channels.
- Pro Team gibt es einen oder mehrere Channel Commander.
- Commander drücken einen Hotkey.
- Während der Hotkey gehalten oder aktiviert ist, hören alle aktiven Commander einander.
- Normale Nutzer im jeweiligen Team-Channel hören den Commander weiterhin.
- Die Kommunikation soll taktisch, kurz und latenzarm sein.

## Wichtige rechtliche und technische Rahmenbedingungen

Discord erlaubt keine Selfbots und keine Automatisierung normaler Nutzerkonten außerhalb der offiziellen Bot-/OAuth2-API. Dieses Projekt darf daher **nicht** als Selfbot, User-Token-Tool oder Client-Modifikation umgesetzt werden.

Verboten:

- Nutzung von User-Tokens
- Automatisierung normaler Discord-Nutzerkonten
- Modifikation des offiziellen Discord-Clients (inkl. BetterDiscord-/Vencord-Plugins)
- Injection in Discord Desktop/Web
- Umgehung von Discord-Berechtigungen
- Audio-Hooking aus dem Discord-Prozess
- heimliches Mithören oder Aufzeichnen
- Audio-Capture ohne klare Zustimmung der Nutzer

Erlaubter Zielansatz (was wir gebaut haben):

- offizieller Discord-Bot via discord.js
- Companion-App (Tauri) für Hotkey-Erkennung und lokale Audio-Steuerung
- eigene Voice-Bridge (Fastify + LiveKit SFU) — Discord wird für Audio gar nicht angefasst
- explizite Registrierung von Commandern über Discord-Rollen
- transparente Server-Konfiguration via Slash-Commands

## Sicherheitsregeln

Claude muss bei jeder Implementierung diese Regeln einhalten:

1. Niemals User-Tokens verwenden.
2. Niemals Discord-Client modifizieren.
3. Niemals heimlich Audio aufnehmen.
4. Niemals Audio speichern, außer der Nutzer fordert explizit eine rechtlich saubere Recording-Funktion an.
5. Commander müssen sichtbar erkennen können, ob sie live sprechen.
6. Nutzer müssen klar sehen können, ob sie mit der Bridge verbunden sind.
7. Admins müssen das System pro Server deaktivieren können.
8. Berechtigungen müssen serverseitig geprüft werden.
9. Clientseitige Checks gelten nur als UX, nie als Sicherheit.
10. Alle API-Inputs müssen validiert werden (Zod an der Boundary).

## Coding Guidelines

- TypeScript strict mode verwenden.
- Keine `any`, außer gut begründet.
- Alle externen Inputs mit Zod validieren.
- Fehler explizit modellieren.
- Services klein halten.
- Keine Businesslogik direkt in Command-Handlern.
- Keine Secrets loggen.
- Keine Discord IDs als Number behandeln; immer String.
- Alle async calls sauber behandeln.
- Rate Limits respektieren.
- Reconnects defensiv implementieren.

## Architekturprinzipien

### Bot ([apps/bot/](apps/bot/))

Zuständig für: Discord-Integration, Slash-Commands, Rollenprüfung beim Konfigurieren, Server-Konfiguration in der DB, Statusmeldungen.

**Nicht** zuständig für: globale Hotkeys, lokale Audioaufnahme, clientseitige Mikrofonsteuerung.

### Companion-App ([apps/companion/](apps/companion/))

Zuständig für: Hotkey-Erkennung (Tastatur + Maus), lokales Mikrofon, Nutzerstatus-UI, Verbindung zur Bridge, LiveKit-Audio-Client.

**Nicht** zuständig für: finale Berechtigungsentscheidung, Server-Konfiguration, Discord-Rollenverwaltung.

### Bridge ([apps/bridge/](apps/bridge/))

Zuständig für: aktive Commander-Räume, WebSocket-Signaling, LiveKit-Token-Minting, Session-State, **serverseitige Berechtigungsprüfung** (das ist die einzige Stelle, an der Permission-Checks wirklich zählen).

**Nicht** zuständig für: Discord Slash Commands, dauerhafte Discord-Konfiguration ohne Bot-Abgleich.

## Claude-Verhalten

Wenn Claude Code an diesem Projekt arbeitet:

- zuerst diese Datei und [STAND.md](STAND.md) lesen
- Discord-ToS-konforme Lösung bevorzugen
- keine Selfbot-Lösung schreiben
- keine User-Token-Nutzung vorschlagen
- bei unklarer technischer Umsetzbarkeit ehrlich sein
- kleine, testbare Schritte implementieren
- Architekturentscheidungen kurz dokumentieren (CHANGELOG, STAND.md, oder Commit-Message)
- sicherheitsrelevante Änderungen besonders vorsichtig behandeln
- keine Secrets in Code, Tests oder Logs schreiben

## Priorisierte Entscheidung

Für dieses Projekt gilt:

```txt
Compliance vor Komfort.
Stabilität vor Hack.
Transparenz vor Magie.
```

Wenn eine Funktion nur durch Selfbotting, Client-Modifikation oder heimliches Audio-Hooking möglich wäre, darf sie nicht implementiert werden.
