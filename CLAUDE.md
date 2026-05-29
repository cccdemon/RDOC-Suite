# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Projektname

RDOC-Suite — Discord Channel Commander Voice Bridge (Monorepo aus RDCC + RDOC-RTC + RDOC-VoiceRelayBots)

## Merge-Log zuerst — immer

**Bevor du irgendetwas tust (Code, Config, Docs): füge einen "Queued / Planned Step"-Eintrag (mit `YYYY-MM-DD:`-Prefix) in [`docs/RDOC-SUITE-MERGELOG.md`](docs/RDOC-SUITE-MERGELOG.md) ein.** Keine Ausnahmen. Protokoll:

- **Queued / Planned Step** — Eintrag *vor* der Arbeit schreiben, was geändert wird und warum.
- **Completed Steps** — nach Commit hierher verschieben/kopieren, Commit-Hash anhängen.
- **Open Decisions** — ungeklärte Architekturfragen; entfernen wenn entschieden.

Offene Entscheidungen (Stand 2026-05-27):
1. **Package-Namespace**: `@dccc/*` → `@rdoc-suite/*` oder `@rdoc-sc/*`? Betrifft alle Workspaces + Dockerfiles.
2. **Voice-to-All**: Commander-Rolle, separate Discord-Rolle oder Admin-only?
3. **Session-Modell**: Invite-basierte Ops-Räume (Step 3 implementiert) vs. einheitliche Guild-Räume mit Invite-Links?
4. **`Caddyfile` im Repo**: veraltet, Production läuft auf Traefik — kann gelöscht werden.

## Operative Hinweise für Claude Code

> **Für Production: [STAND.md](STAND.md) ist Single-Source-of-Truth.** Dort steht der aktuelle Deploy-Stand (Hostname, Traefik-Routing, LXC-Setup, iptables-DNAT, `.env` auf dem Server, offene Punkte). Wenn du an Docker/Deploy/Traefik/Prod-`.env` arbeitest, lies STAND.md zuerst. Dieser Abschnitt beschreibt nur den Code und das lokale Dev-Setup.

### Häufige Commands — Lokales Dev

```bash
# Installation und Setup
pnpm install
pnpm db:generate            # Prisma Client generieren (nach jedem frischen Clone zwingend!)
pnpm db:migrate             # Migrationen auf dev.db anwenden
pnpm db:studio              # Prisma Web-UI für die SQLite-DB

# Build / Lint / Format / Test (alle Workspaces)
pnpm build
pnpm lint
pnpm format
pnpm test                   # vitest in jedem Workspace mit test-Skript

# Einzelnes Workspace bauen / entwickeln (Watch-Mode)
pnpm --filter @dccc/bot dev
pnpm --filter @dccc/bridge dev
pnpm --filter @dccc/companion dev          # nur Vite-Frontend
pnpm --filter @dccc/companion tauri:dev    # Vite + Rust Shell (Hotkeys, Deep-Link)
pnpm --filter @rdoc-suite/fleetplanner dev
pnpm --filter @rdoc-suite/relay-bots dev

# Bot / Bridge starten (nach `build`)
node apps/bot/dist/index.js
node apps/bridge/dist/index.js

# Einzelne Tests laufen lassen
pnpm --filter @dccc/bridge test -- oauth      # nur oauth.test.ts
pnpm --filter @dccc/bridge test -- -t "name"  # einzelner it("name", ...) Block

# Lokales LiveKit (für Voice-Tests zwingend; Dev-Compose mit eingebauten Creds)
docker compose up -d livekit
```

Es gibt keinen `ts-node`-Runner. Bot und Bridge müssen vor dem Start kompiliert werden (Output in `dist/`). **Für Production wird ausschließlich in Docker gebaut** — kein lokaler pnpm/npm/cargo auf dem Server.

### Häufige Commands — Production (auf dem Commander-LXC)

```bash
cd /opt/discord-channel-commander
git pull
docker compose -f docker-compose.prod.yml build         # baut alle geänderten Services
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f bridge   # oder bot / fleetplanner
```

Build läuft komplett im Container. Companion-Builds laufen nur **lokal auf Windows** (Tauri braucht Rust + MSVC).

### Workspace-Namen

| Verzeichnis | pnpm-Name | Docker-Image |
| --- | --- | --- |
| [apps/bot/](apps/bot/) | `@dccc/bot` | `rdoc-suite-bot` |
| [apps/bridge/](apps/bridge/) | `@dccc/bridge` | `rdoc-suite-bridge` |
| [apps/companion/](apps/companion/) | `@dccc/companion` | — (lokaler Windows-Build) |
| [apps/fleetplanner/](apps/fleetplanner/) | `@rdoc-suite/fleetplanner` | `rdoc-suite-fleetplanner` |
| [apps/relay-bots/](apps/relay-bots/) | `@rdoc-suite/relay-bots` | `rdoc-suite-relay-bots` (noch nicht in Prod-Compose) |
| [apps/monitoring/](apps/monitoring/) | — (Prometheus-Image) | `rdoc-suite-monitoring` |
| [packages/shared/](packages/shared/) | `@dccc/shared` | — |
| [packages/db/](packages/db/) | `@dccc/db` | — |

### Architektur-Pickup

1. **Bridge = Fastify** mit `@fastify/cookie` + `@fastify/websocket`. Bootstrap in [apps/bridge/src/app.ts](apps/bridge/src/app.ts); Health-Check `/health`, OAuth `/auth/*`, WebSocket `/ws`, Admin-UI `/admin/*`, Sessions `/sessions/*`, Relay-Token `/relay/*`, Relay-Bots-Config `/relay-bots/*`, Suite-Capabilities `/suite/capabilities`.

2. **Session-Token = HS256-JWT** via `jose`, 15 min TTL, Issuer `dccc-bridge`, Audience `dccc-companion`, In-Memory-Revocation per `jti` ([apps/bridge/src/auth/sessionToken.ts](apps/bridge/src/auth/sessionToken.ts)). Companion sendet `?token=…` beim WS-Connect.

3. **WS-Protokoll** in [packages/shared/src/protocol.ts](packages/shared/src/protocol.ts); Zod-Validatoren in [packages/shared/src/validation.ts](packages/shared/src/validation.ts). Non-Standard Close-Codes: `4401` unauth, `4400` protocol, `4403` forbidden. Heartbeat alle 20 s, Permission-Recheck alle 60 s (nur Rolle; Voice-State kommt per Push).

4. **Voice geht über LiveKit (SFU), Lifecycle sticky per WS-Session.** Direkt nach WS-Auth minted die Bridge ein LiveKit-Token, joined den Commander in den Room, schickt `bridge:joined` mit `livekitUrl` + `livekitToken`. `ptt:start`/`ptt:stop` toggeln nur Mic-Mute + `speaking`-Flag. Echter Leave erst bei WS-Close oder Permission-Fail. Räume in-memory ([apps/bridge/src/services/rooms.ts](apps/bridge/src/services/rooms.ts)).

5. **Hotkey zweischichtig**: Tastatur via `@tauri-apps/plugin-global-shortcut`, Maus-Tasten via eigenem `rdev`-Thread in Rust ([apps/companion/src-tauri/src/lib.rs:13](apps/companion/src-tauri/src/lib.rs#L13)). Beide emittieren `"hotkey"` Event; React-Schicht filtert nach Accelerator-Name.

6. **Voice-Channel-Enforcement: DB für State, HTTP-Push für Realtime.** Bot abonniert `voiceStateUpdate` ([apps/bot/src/events/voiceState.ts](apps/bot/src/events/voiceState.ts)), upsertet `UserVoiceState`, schickt fire-and-forget POST an Bridge `/internal/voice-state-changed` (Auth: `X-Internal-Auth` + `INTERNAL_BRIDGE_SECRET`) → sofortiges `audio:enable`/`audio:disable` an Companion. 60s-Loop prüft weiterhin nur noch die Discord-Rolle. Ohne `INTERNAL_BRIDGE_SECRET`: Fallback auf 60s-Recheck-only.

7. **Admin-UI Phase B (seit 2026-05-24): zwei Tiers.** Admin = Discord-User auf `AdminUser`-Whitelist, kann das Web-Admin-UI unter `/admin/*` nutzen. Commander = Discord-User mit Commander-Rolle, nutzt Companion via JWT-WS-Flow. Bootstrap via `/cc admin add @user`; alles weitere im Web-UI. Admin-Invite-Links: single-use, sha256-hash-only persistiert, 7-Tage-TTL, atomic-consume in Transaction. Code: [apps/bridge/src/admin/](apps/bridge/src/admin/), [apps/bridge/src/services/adminInviteLinks.ts](apps/bridge/src/services/adminInviteLinks.ts).

8. **Sessions (Step 3, 2026-05-27): invite-basierte Ops-Räume.** Admiral minted single-use Invite-Token; Commander löst per `POST /sessions/join` LiveKit-Credentials ein. Schema: `Session` + `SessionInvite` in [prisma/schema.prisma](prisma/schema.prisma). Service: [apps/bridge/src/services/sessions.ts](apps/bridge/src/services/sessions.ts). Admin-UI unter `/admin/sessions`. Tests: [apps/bridge/src/__tests__/sessions.test.ts](apps/bridge/src/__tests__/sessions.test.ts).

9. **Relay-Bots Config (Step 5) in der Bridge.** Bridge speichert `RelayBotsConfig` in SQLite, stellt `/relay/token` (Bearer JWT, Publisher/Subscriber-Grant-Split) und `/relay-bots/*`-Admin-Routes bereit. Relay-Bots-Service fetcht Config via `GET /relay-bots/service-config` (Bearer `RELAY_BOTS_SECRET`).

10. **`apps/relay-bots` (Step 6) = importierter VoiceRelayBots-Worker** (`@rdoc-suite/relay-bots`). Liest Config von der Bridge, subscribed LiveKit-Track, relayed Audio in Discord Voice Channels via `@discordjs/voice`. `@discordjs/opus` ist ein nativer Addon — `pnpm approve-builds` nötig beim Deploy.

11. **`apps/fleetplanner` = Fastify + Prisma + SSR** (`@rdoc-suite/fleetplanner`). Eigenes SQLite (`fleetplanner.db`); Production-Route unter `suite.raumdock.org/fleetplanner`. Eigene `db:generate`/`db:migrate` Skripte pro Workspace.

12. **`apps/monitoring` = Prometheus-Image.** Keine eigene TypeScript-Quelle; `apps/monitoring/Dockerfile` wraps das offizielle Prometheus-Image mit `apps/monitoring/prometheus.yml`. Route: `suite.raumdock.org/monitoring`.

13. **`PUBLIC_BASE_PATH`** ([apps/bridge/src/config/env.ts:17-23](apps/bridge/src/config/env.ts#L17-L23)): leer (`""`) auf Production (Root-Host). Nur setzen, wenn ein Strip-Proxy mit Path-Prefix verwendet wird. Zod akzeptiert nur `""` oder Werte mit führendem `/`.

14. **`/suite/capabilities`-Route** gibt Companion-JWT-gesichert zurück, ob der User `canManageSessions` (= Admin in `AdminUser` für die Guild), `canUseRelay`, `canUseFleetTools`. Companion rendert Admiral-Tools nur wenn granted.

### Quirks, die schon Zeit gekostet haben

- **`pnpm db:generate` muss nach jedem frischen Clone laufen, bevor gebaut werden kann.** `packages/db/generated/client` ist in `.gitignore`. Ohne es löst TypeScript `getPrisma()` als `any` auf → Kaskade von `TS7006`-Fehlern in jedem Prisma-Callback.
- **`--node-ip` ist überall load-bearing.** Dev-Compose: `--node-ip 127.0.0.1`; Prod-Compose: `--node-ip ${LIVEKIT_NODE_IP}`. STUN-basierte Auto-Detection liefert in Proxmox/LXC-Double-NAT nur die LXC-Bridge-Gateway-IP → ICE schlägt fehl.
- **`tauri_plugin_single_instance` muss als allererstes registriert werden** ([apps/companion/src-tauri/src/lib.rs:60](apps/companion/src-tauri/src/lib.rs#L60)), sonst öffnet jeder `dccc://`-Deep-Link eine zweite Instanz.
- **Discord-IDs immer als String**, nie Number — Snowflakes überschreiten `Number.MAX_SAFE_INTEGER`.
- **SQLite-Pfad auf Prod ist `/app/data/prod.db`, NICHT `/app/prisma/prod.db`.** Volume mountet auf `/app/data`; `/app/prisma` darf NICHT vom Volume überdeckt werden (hatten wir 2026-05-23 mit einem Parallel-Branch). Filename `prod.db`, nicht `dev.db`, weil Docker nicht-existente Bind-Mount-Sources als Directory anlegt → Prisma `P1013`.
- **`pnpm install` im Bridge-Dockerfile braucht `--no-frozen-lockfile` und `ENV CI=true`** — bewusst kein gefrorener Lockfile-Workflow.
- **pnpm-Workspaces im Runtime-Image: jedes** Workspace-`node_modules/` muss mit-kopiert werden. Vorlage: [apps/bridge/Dockerfile](apps/bridge/Dockerfile).
- **Alter systemd-Service `dccc-bridge.service` kann Port 8787 belegen.** Vor Prod-Deploy prüfen: `systemctl is-enabled dccc-bridge`. Falls aktiv → `systemctl disable --now dccc-bridge`.
- **`GuildVoiceStates` ist nicht-privileged** — kein Toggle im Discord Developer Portal nötig. Wenn trotzdem keine Events: Intent fehlt im `new Client({intents: […]})`.
- **Voice-State-Race beim Bot-Restart**: User die vor dem Bot in Voice waren, fehlen kurz in `UserVoiceState`. Connectet Companion in dem Fenster, kriegt es `not_in_voice` — Channel kurz verlassen + joinen umgeht's. Akzeptiert.
- **`@discordjs/opus` in relay-bots ist ein nativer Addon** und benötigt `pnpm approve-builds` beim Deploy. TypeScript-Build läuft ohne es.

### Wo welche Doku liegt

- [docs/RDOC-SUITE-MERGELOG.md](docs/RDOC-SUITE-MERGELOG.md) — **Merge-Handover-Log** (Queued/Completed/Decisions). Vor jeder Änderung lesen und schreiben.
- [STAND.md](STAND.md) — **aktueller Deployment-Stand** (Hostname, Routing, .env, offene Punkte). Bei Production-Fragen zuerst hier lesen.
- [README.md](README.md) — Quickstart, Architektur-Diagramm, Repository-Layout
- [docs/admin-guide.md](docs/admin-guide.md) — Slash-Commands, Bot-Invite, Credential-Flow
- [docs/commander-guide.md](docs/commander-guide.md) — Companion-Install, Hotkey, Audio
- [docs/privacy.md](docs/privacy.md) — Daten-Inventar
- [security-plan.md](security-plan.md) — Threat-Model und geplante Härtungen
- Datenmodell: [prisma/schema.prisma](prisma/schema.prisma)
- WS-Protokoll: [packages/shared/src/protocol.ts](packages/shared/src/protocol.ts) + [packages/shared/src/validation.ts](packages/shared/src/validation.ts)

---

## Ziel

Discord-Integration für **Channel Commander**: ausgewählte Nutzer können per Hotkey channelübergreifend miteinander sprechen, ohne ihren Team-Channel dauerhaft zu verlassen. Audio läuft über eine eigene LiveKit-SFU-Bridge — Discord wird für Audio nicht angefasst.

## Wichtige rechtliche und technische Rahmenbedingungen

Discord-ToS verbietet Selfbots und Automatisierung von Nutzerkonten außerhalb der offiziellen Bot-/OAuth2-API.

Verboten: User-Tokens, Automatisierung normaler Discord-Nutzerkonten, Discord-Client-Modifikation (inkl. BetterDiscord/Vencord), Audio-Hooking aus dem Discord-Prozess, heimliches Mithören/Aufzeichnen.

Erlaubt (was wir gebaut haben): offizieller Discord-Bot (discord.js), Companion-App (Tauri) für Hotkey + lokale Audio-Steuerung, eigene Voice-Bridge (Fastify + LiveKit SFU), explizite Commander-Registrierung via Discord-Rollen.

## Sicherheitsregeln

1. Niemals User-Tokens verwenden.
2. Niemals Discord-Client modifizieren.
3. Niemals heimlich Audio aufnehmen oder speichern.
4. Commander müssen sichtbar erkennen können, ob sie live sprechen.
5. Nutzer müssen sehen können, ob sie mit der Bridge verbunden sind.
6. Admins müssen das System pro Server deaktivieren können.
7. Berechtigungen werden serverseitig geprüft — clientseitige Checks sind nur UX.
8. Alle API-Inputs mit Zod validieren (an der Boundary).

## Coding Guidelines

- TypeScript strict mode; kein `any` ohne Begründung.
- Alle externen Inputs mit Zod validieren.
- Discord-IDs immer als String behandeln.
- Keine Secrets loggen.
- Keine Businesslogik direkt in Command-Handlern.

## Priorisierte Entscheidung

```
Compliance vor Komfort.
Stabilität vor Hack.
Transparenz vor Magie.
```
