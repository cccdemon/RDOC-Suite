# Deployment-Stand

Stand: 2026-05-27 (Bridge auf Commit `4988a88` deployed, Companion build 125 released-pending)

## 🔁 Pickup für die nächste Session

**Was läuft live?**
- Bridge: `dccc-bridge:latest` auf LXC `headwig`, Commit `4988a88` — Raid-Planer + Output-Mute via Subscribe/Unsubscribe + AFK + alle Discord-REST-Mutation-Endpoints
- Companion: **build 125 lokal gebaut, GitHub-Release ausstehend**. Vorheriger Live-Release `v0.5.0-build114`. Neue Builds seitdem: build123 = PTT-Sound Auto-Repeat-Fix (Raw-Input-Debounce), build125 = neues App-Icon (RDOC Squad Link Helm-Logo, generiert per `tauri icon`).
- Bot: unverändert (kein Code-Change in dieser Session)

**Was steht morgen an?**

1. **4 Companion-Live-Verifications stehen aus** (mit zweitem Commander online):
   - Build 113 — Raw-Input-Keyboard funktioniert in DirectX-Fullscreen-Games + kein Discord-PTT-Konflikt mehr
   - Build 108 — Output-Mute (Subscribe/Unsubscribe-Variante): muted User hört durchgehend nichts, auch bei mehreren PTT-Cycles vom Kollegen
   - Build 114 — Discord-Ducking: peer-trigger lowert beim Empfänger Discord, beide `Discord.exe`-Slider im Mixer rutschen synchron (User hatte das "zweimal Discord im Mixer"-Verhalten gefragt — beide sollten geduckt werden)
   - **Build 123 — PTT-Sound feuert nur einmal pro Press, auch wenn Taste gehalten wird (Auto-Repeat-Debounce)**

2. **Bot-Permissions im Discord-Server** (User-Aktion, dann Raid-Planer-Test):
   - Discord → Servereinstellungen → Rollen → Bot-Rolle → aktivieren: **Kanäle verwalten**, **Mitglieder verschieben**, **Rollen verwalten**
   - Bot-Rolle in Hierarchie über RDOC-CC + RDPC-SQ-CC ziehen (sonst 403 bei Role-Assign)
   - Discord → Servereinstellungen → Rollen → IDs von RDOC-CC + RDPC-SQ-CC kopieren (Entwicklermodus an) → in Admin → KONFIG → "Commander-Rollen", **RDOC-CC zuerst** (steuert den grün/rot-Indikator)

3. **Raid-Planer testen**: https://commander.raumdock.org/dccc/admin/raid-planer
   - Drag-and-Drop Member zwischen Channel-Tiles
   - Klick (mit oder ohne Strg) auf Member = toggle Selection; Klick ins Leere = clear
   - Rechtsklick auf einen markierten User → Aktion fan-out auf alle Selected
   - Channel-Rename mit Custom-Modal (Discord rate-limited auf 2 Renames pro 10 Min pro Channel)
   - Bots (funkrelais-im-Namen) erscheinen unter Separator als "BOT", keine Aktionen

4. **Etappe 5 startbereit**: User wollte das Bridge-Bot-für-Speak-to-Discord-Feature noch besprechen, bevor's losgeht. Repo + LiveKit-Bot-Konfig vom befreundeten Dev fehlt noch. **Vor Beginn: User fragen ob er es heranreichen kann.**

**Wichtige Memories** (in `~/.claude/projects/c--Projekte-DCCC/memory/`):
- `project_dccc_output_mute_verify_pending.md` (build 108)
- `project_dccc_raw_input_verify_pending.md` (build 113)
- `project_dccc_ducking_verify_pending.md` (build 114)
- `project_dccc_folgendes_plan.md` (Roadmap-Stand)

---

## Älterer Stand: 2026-05-24 (verifiziert per SSH)

## Was läuft

Alle drei DCCC-Services laufen als Docker-Container auf LXC `headwig`. Bridge + LiveKit sind extern erreichbar unter `https://commander.raumdock.org` (Traefik path-routing). Bot redet nur outbound mit Discord.

```
Public :443/tcp ── LXC 101 nginx (SNI-Passthrough) ──► 10.10.10.97:443 (Traefik)
                                                          │
                                  /dccc/* ──────────────► 127.0.0.1:8787 (dccc-bridge, Docker)
                                  /lk/*   ──────────────► 127.0.0.1:7880 (dccc-livekit, Docker)

Public :7881/tcp ── LXC 101 iptables DNAT ──► 10.10.10.97:7881 (LiveKit ICE-TCP)
Public :7882/udp ── LXC 101 iptables DNAT ──► 10.10.10.97:7882 (LiveKit RTC-Media)
```

- **SSH:** `ssh -p 22107 -i ~/.ssh/llw_homepage_ed25519 root@landwurscht.raumdock.org` → landet direkt auf LXC `headwig`
- **LXC:** `headwig` / `10.10.10.97`, Proxmox-Container (Kernel `pve`)
- **Repo:** `/opt/discord-channel-commander` (Verzeichnis-Name bewusst beibehalten), branch `main`, **neues GitHub-Remote `git@github.com:head87x/rdcc.git`** (privat). Das alte geteilte Remote `head87x/discord-channel-commander` ist nur noch unter `archive-shared` als Referenz da; wir arbeiten ab 2026-05-23 ausschließlich am neuen Repo, um die Kollision mit dem `better-architecture`-Branch des anderen Devs zu vermeiden.
- **Hostname:** `commander.raumdock.org` (Cloudflare-DNS, kein Proxy/Orange-Cloud)
- **TLS:** Traefik via Cloudflare-DNS-01, Cert-Resolver `le` (zusätzlich `tlsChallenge: {}` als Fallback)
- **Web-Proxy:** Traefik (systemd, kein Docker — direkt auf der LXC)
- **Alle DCCC-Services:** Docker via [docker-compose.prod.yml](docker-compose.prod.yml)
- **Es gibt KEINE `dccc-*.service` systemd-Units mehr** (der alte Konflikt aus älterer Doku ist gelöst — `systemctl list-units 'dccc-*'` ist leer)

## Komponenten (verifizierter Stand)

| Komponente | Container | Image | Ports | Mounts | Restart |
| --- | --- | --- | --- | --- | --- |
| Bridge | `dccc-bridge` | `dccc-bridge:latest` (lokal gebaut) | `127.0.0.1:8787 → 8787/tcp` | `discord-channel-commander_bridge_data → /app/data` | `unless-stopped` |
| Bot | `dccc-bot` | `dccc-bot:latest` (lokal gebaut) | keine (nur outbound zu Discord) | `discord-channel-commander_bridge_data → /app/data` (shared mit Bridge) | `unless-stopped` |
| LiveKit | `dccc-livekit` | `livekit/livekit-server:latest` | `127.0.0.1:7880` (signaling), `:7881/tcp`, `:7882/udp` (WebRTC) | bind `livekit.yaml → /etc/livekit.yaml` | `unless-stopped` |
| Traefik | (systemd) | — | `:80`, `:443` | `/etc/traefik/*` | systemd-managed |

Volumes:
- `discord-channel-commander_bridge_data` — aktives Volume mit der SQLite-DB.
- `dccc_bridge_data` — **verwaist** (vom alten Compose-Project-Namen, kein Container mountet das mehr). Sicher löschbar, sobald man sich sicher ist, dass dort keine wertvollen Daten liegen.

## Smoke-Test

```bash
curl https://commander.raumdock.org/dccc/health
# {"ok":true,"service":"bridge"}

curl -I https://commander.raumdock.org/lk/
# HTTP/2 200  (LiveKit-Root "OK\n")
```

WebRTC-Media von extern (Status hängt aktuell an Port-Freigaben des Hosting-Providers für die Public-IP):

```bash
nc -u -zv <public-ip> 7882
nc -zv  <public-ip> 7881
```

## Traefik-Setup

Statische Config `/etc/traefik/traefik.yml`:

```yaml
entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"

certificatesResolvers:
  le:
    acme:
      email: admin@raumdock.org
      storage: /etc/traefik/acme.json
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "8.8.8.8:53"
```

Cloudflare-Token via systemd-Drop-in:

```
/etc/traefik/cloudflare.env       # chmod 600, enthält CF_DNS_API_TOKEN=...
/etc/systemd/system/traefik.service.d/cloudflare.conf
    [Service]
    EnvironmentFile=/etc/traefik/cloudflare.env
```

Dynamic Config (file provider), aktiver Stand:

```yaml
http:
  routers:
    dccc-bridge-https:
      rule: "Host(`commander.raumdock.org`) && PathPrefix(`/dccc`)"
      entryPoints: [websecure]
      middlewares: [dccc-strip]
      service: dccc-bridge
      tls:
        certResolver: le

    dccc-bridge-http:
      rule: "Host(`commander.raumdock.org`) && PathPrefix(`/dccc`)"
      entryPoints: [web]
      middlewares: [dccc-redirect-https]
      service: dccc-bridge

    dccc-livekit-https:
      rule: "Host(`commander.raumdock.org`) && PathPrefix(`/lk`)"
      entryPoints: [websecure]
      middlewares: [lk-strip]
      service: dccc-livekit
      tls:
        certResolver: le

    dccc-livekit-http:
      rule: "Host(`commander.raumdock.org`) && PathPrefix(`/lk`)"
      entryPoints: [web]
      middlewares: [dccc-redirect-https]
      service: dccc-livekit

  middlewares:
    dccc-strip:
      stripPrefix:
        prefixes:
          - "/dccc"
    lk-strip:
      stripPrefix:
        prefixes:
          - "/lk"
    dccc-redirect-https:
      redirectScheme:
        scheme: https
        permanent: true

  services:
    dccc-bridge:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:8787"
        passHostHeader: true

    dccc-livekit:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:7880"
        passHostHeader: true
```

WebSocket-Upgrades (`/dccc/ws` und `/lk/rtc`) werden von Traefik per Default durchgereicht — kein Extra-Setup nötig.

## nginx-SNI-Router (LXC 101)

In `/etc/nginx/stream.d/minecraft.raumdock.org.conf`:

```nginx
# in map $ssl_preread_server_name $upstream
commander.raumdock.org  cc_commander;

upstream cc_commander {
    server 10.10.10.97:443;
}
```

## iptables-DNAT (LXC 101)

WebRTC läuft nicht durch den SNI-Router — direktes Port-Forwarding:

```bash
iptables -t nat -A PREROUTING -p udp --dport 7882 -j DNAT --to-destination 10.10.10.97:7882
iptables -A FORWARD            -p udp -d 10.10.10.97 --dport 7882 -j ACCEPT

iptables -t nat -A PREROUTING -p tcp --dport 7881 -j DNAT --to-destination 10.10.10.97:7881
iptables -A FORWARD            -p tcp -d 10.10.10.97 --dport 7881 -j ACCEPT

iptables -t nat -A POSTROUTING -o eth1 -d 10.10.10.97 -j MASQUERADE

netfilter-persistent save
```

## Env-Vars (`.env` auf LXC)

```ini
DISCORD_BOT_TOKEN=...
DISCORD_CLIENT_ID=...
DISCORD_CLIENT_SECRET=...
DISCORD_PUBLIC_KEY=...

DATABASE_URL="file:./dev.db"

BRIDGE_HOST=0.0.0.0
BRIDGE_PORT=8787
OAUTH_REDIRECT_URI=https://commander.raumdock.org/dccc/auth/callback
PUBLIC_BASE_PATH=/dccc              # damit OAuth-State-Cookie unter /dccc/auth gesetzt wird
SESSION_SECRET=<32+-char-random>

LIVEKIT_URL=wss://commander.raumdock.org/lk
LIVEKIT_API_KEY=<echter-key>           # nicht "devkey"
LIVEKIT_API_SECRET=<echter-secret>

# Auto-Updater (Companion → Bridge → GitHub Releases)
GITHUB_REPO=head87x/rdcc                  # owner/repo das die Companion-EXE-Releases hostet
GITHUB_TOKEN=<PAT classic, scope=repo>    # für private Repos zwingend, public optional (Rate-Limit)
COMPANION_ASSET_PATTERN=.exe              # default; matched gegen Release-Asset-Namen
```

## Build- und Deploy-Commands

```bash
cd /opt/discord-channel-commander
git pull
docker compose -f docker-compose.prod.yml build bridge
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml logs -f bridge
```

Migrations laufen automatisch beim Container-Start über [apps/bridge/docker-entrypoint.sh](apps/bridge/docker-entrypoint.sh) (`prisma migrate deploy` — idempotent). `prisma` ist dafür als reguläre Dependency in [apps/bridge/package.json](apps/bridge/package.json) eingetragen, damit der CLI im Runtime-Image überlebt.

`DATABASE_URL` in `.env`:

```env
DATABASE_URL="file:///app/data/prod.db"
```

Drei Slashes nach RFC 8089. **Pfad bewusst `/app/data/`, nicht `/app/prisma/`** — das Volume mountet auf `/app/data`, dort liegt die persistente SQLite-File. `/app/prisma` bleibt das ungemountete Image-Verzeichnis, in dem Prisma seine Schema-File + Migrations findet (entrypoint führt `prisma migrate deploy` mit `--schema prisma/schema.prisma` aus, also aus dem Image, nicht aus dem Volume). Frühere Konfiguration hatte das Volume direkt auf `/app/prisma` gemountet — das überdeckte aber die Image-eigenen Migrations + Schema, was zu silent-schema-Drift führte, wenn ein anderer Branch jemals in dieselbe Volume reingebaut hat. Siehe Kommentar in [docker-compose.prod.yml](docker-compose.prod.yml).

**Dateiname bewusst `prod.db`, nicht `dev.db`** — auf dem LXC lag im `bridge_data`-Volume früher ein leeres Verzeichnis namens `dev.db` (vermutlich von einem versehentlichen Bind-Mount mit nicht-existentem Source-Pfad — Docker legt sowas als Directory an). Prisma wirft dann `P1013 invalid connection string`, was die wahre Ursache (Pfad zeigt auf Directory statt File) verschleiert.

## Offene Punkte

1. **WebRTC-Audio-Test von extern verifiziert 2026-05-23.** Ports `:7882/udp` und `:7881/tcp` SIND vom Hosting-Provider durchgeschaltet (DNAT auf LXC 101). LiveKit selbst musste mit `--node-ip ${LIVEKIT_NODE_IP}` gestartet werden (in [docker-compose.prod.yml](docker-compose.prod.yml), Wert aus `.env`), weil Proxmox/LXC-Double-NAT die STUN-basierte IP-Auto-Detection bricht — LiveKit detectete sonst `10.10.10.1` (LXC-Bridge-Gateway) statt der echten Public IP `85.215.253.135`. Bei neuen Deployments: `LIVEKIT_NODE_IP=<curl https://api.ipify.org>` in `.env` setzen.

2. **Caddyfile-Leiche** — [Caddyfile](Caddyfile) liegt noch im Repo, wird nicht mehr benutzt (Traefik hat übernommen). Kann gelöscht werden.

3. **SQLite → Postgres** — aktuell SQLite im Volume `discord-channel-commander_bridge_data`. Für produktive Last laut [CLAUDE.md](CLAUDE.md) auf Postgres wechseln.

4. **Verwaistes Volume `dccc_bridge_data`** existiert noch (alter Compose-Project-Name), wird von keinem Container mehr gemountet. Sicher löschbar via `docker volume rm dccc_bridge_data`, sobald sicher ist dass darin keine wertvollen Daten liegen.

5. ~~**LiveKit-API-Credentials liegen im Klartext** in [livekit.yaml](livekit.yaml)~~ — **erledigt 2026-05-24**: keys werden jetzt via LiveKit's natives `LIVEKIT_KEYS`-Env-Var aus `.env` injiziert ([docker-compose.prod.yml](docker-compose.prod.yml)), kein `keys:`-Block mehr im Repo, kein envsubst-Schritt, `git pull` kann nichts mehr überschreiben.

### Erledigt (zuletzt verifiziert 2026-05-23)

- ✅ **systemd-Konflikt gelöst** — keine `dccc-*.service` Unit mehr aktiv (`systemctl list-units 'dccc-*'` ist leer).
- ✅ **Bot ist im Compose-Stack** — läuft als Container `dccc-bot`, teilt sich das `bridge_data`-Volume mit der Bridge.
- ✅ **Companion-Build für Prod** — Production-EXE wird mit `VITE_BRIDGE_URL=https://commander.raumdock.org/dccc` aus [apps/companion/.env.production](apps/companion/.env.production) gebaut.
- ✅ **Discord OAuth Redirect-URI** im Developer-Portal eingetragen: `https://commander.raumdock.org/dccc/auth/callback`.
- ✅ **Voice-Channel-Enforcement aktiv und in Produktion verifiziert** (Phase A + A.1 des Folgendes-Plans). Bridge weist Commander ab, deren aktueller Discord-Voice-Channel nicht in `allowedVoiceChannelIds` ist. Bot trackt Voice-States via `GuildVoiceStates`-Intent in der neuen `UserVoiceState`-Tabelle. Migration `20260523195614_add_user_voice_state` läuft beim Bridge-Container-Start automatisch.
- ✅ **Instant Audio-Toggle (Phase A.1)** — Bot pusht Voice-State-Änderungen per HTTP-POST an `/internal/voice-state-changed` an die Bridge, die sofort `audio:enable` / `audio:disable` an die offene Companion-WS schickt. Audio cuttet innerhalb ~100 ms beim Verlassen des erlaubten Channels und kommt innerhalb ~100 ms beim Wieder-Beitreten zurück. Shared-Secret in `.env` als `INTERNAL_BRIDGE_SECRET` (mind. 16 chars), Bridge-URL als `BRIDGE_INTERNAL_URL=http://bridge:8787` (Docker-Compose-Service-DNS).
- ✅ **Phase B1 deployed (2026-05-23)** — neue Prisma-Models (`AdminUser`, `ApiCredential`, `Session`, `InviteToken`), 3-Tier-Auth (Admin/Admiral/Commander), REST-API `/api/v1/sessions/...`, WS-Auth-Paths `?invite=` und `?adm=`, Bot-Commands `/cc admin add|remove|list` + `/cc generate-credential`. **Wurde am 2026-05-24 wieder zurückgebaut** (siehe nächster Eintrag) weil zu komplex.
- ✅ **Companion-Auto-Updater live (2026-05-24)** — notify-only Popup, JWT-auth'd. Companion fragt 3 s nach Sign-in `GET /updater/companion/check?token=<jwt>` an der Bridge → Bridge fragt GitHub-Releases-API → wenn `remoteVersion > LOCAL_VERSION` (Format `<APP_VERSION>-build<N>`) erscheint Chaos-Crew-Modal mit Release-Notes. Klick auf „DOWNLOAD IM BROWSER ÖFFNEN" → `POST /updater/companion/mint-download-token` → Bridge mintet single-use-Token mit Label `[auto-update] <userId>` (1-Tag-TTL) → Companion öffnet die Landing-Page im System-Browser, User ersetzt EXE manuell. Bypassed den Single-Use-Admin-Download-Mechanismus NICHT (gleiche `mintDownloadToken`-Funktion). End-to-End-verifiziert: Build 94 lokal installiert → Build 95 auf GitHub veröffentlicht → Popup erschien innerhalb 3 s nach Sign-in. Release-Workflow ist manuell (siehe „Release-Workflow Companion" unten); CI-Automation explizit verworfen.
- ✅ **Phase B (rewrite 2026-05-24): Web-Admin-UI live, B1-Admiral-Schiene zurückgebaut**. Migration `20260523233020_drop_admiral_models_add_admin_invite_links` dropt die 3 unbenutzten B1-Tabellen + fügt `AdminInviteLink` hinzu. Web-Admin-UI bei `/admin/*` mit Discord-OAuth + Cookie-Session + AdminUser-Whitelist-Gate. Single-use-Invite-Links für neue Admins. Dashboard mit 5s-Live-Polling (verbundene Commander + Members-mit-Commander-Rolle + Voice-State-Status). Config-Editor ersetzt die `/cc setup`/`role`/`channel`-Slash-Commands (die werden in Follow-Up-Commit entfernt nachdem User das Web-UI verifiziert hat). Brand-UI: Chaos-Crew-Voice-Console-Design (Cyan/Gold, Share Tech Mono, Corner-Tick-Cards, Scanlines). Optionale Env-Var `ADMIN_SESSION_SECRET` (sonst Fallback auf `SESSION_SECRET`). 14 neue Bridge-Tests, suite 39 → 53 grün.
- ✅ **Etappe 1 (Bugfixes, 2026-05-26)** — drei Live-Bugs aus dem v0.5.0-build96-Betrieb final gefixt. (1) PTT-Callback ist jetzt stabiler `useCallback`, überlebt Settings-Save. (2) Tastatur-PTT wurde nach 6 Iterationen (builds 98→100→103→111→112→113) auf **Win32 Raw Input (WM_INPUT, RIDEV_INPUTSINK)** umgestellt — funktioniert ohne Admin, in DirectX-Fullscreen-Games, ohne Discord-PTT-Konflikt. Maus bleibt auf rdev WH_MOUSE_LL. (3) Self-Hearing-Diagnose + Self-Track-Schutz in LiveKit attach.
- ✅ **Etappe 2 (Output-Mute + AFK, 2026-05-26)** — zwei neue Per-User-Status-Flags im Squad-Roster. `CommanderInfo.outputMuted` + `afk` propagiert durch Bridge zu allen Peers. AFK ist manueller Toggle. Output-Mute wurde nach 5 Iterationen (builds 104→106→107→108) auf **`publication.setSubscribed(!muted)`** umgestellt — Subscribe/Unsubscribe statt Element-Mute, weil livekit-client `<audio>.muted` bei TrackMuted/Unmuted overschreibt. Bridge 53 → 55 Tests grün.
- ✅ **Etappe 3.1 (PTT-Sound-Indikator, 2026-05-26, build 110)** — vier synthetische Funkrauschen-Cues live via Web Audio: PTT-press/release + remote-talk-start/stop. Suppression-Sync mit Output-Mute.
- ✅ **Etappe 3.2 (Discord-Volume-Ducking, 2026-05-26, build 114)** — Per-App-Volume-Ducking auf Discord via WASAPI (`apps/companion/src-tauri/src/discord_ducking.rs`, dedicated COM worker thread). Reference-counted Trigger: eigener PTT + remote speakers. Matched per Image-Name `Discord.exe`/`DiscordPTB.exe`/`DiscordCanary.exe`. Settings: Default 25% target volume, einstellbar.
- ✅ **Etappe 4 (Admin Raid-Planer, 2026-05-27)** — neuer Tab unter `/admin/raid-planer`: read-only Channel-Mirror mit Drag-and-Drop für Member-Move, Rechtsklick-Context-Menu für Rollen-Add/Remove (whitelist via `commanderRoleIds`), DM-Download-Link, Channel-Rename via Custom-Modal. Multi-Select via Klick (Ctrl optional) → Batch-Actions parallel. Bots (`funkrelais`-im-Namen ODER `user.bot=true`) als Separator-Liste ohne Aktionen. Cache für Discord-channels/roles mit Stale-While-Error (60s fresh, 30 min stale). Neue Discord-REST-Helpers (`addGuildMemberRole`, `moveGuildMember`, `modifyChannel`, `fetchGuildChannels`, `fetchGuildRoles`, `sendDirectMessage`). 4 neue admin-API-Endpoints, alle scoped to session-guild. **Bot braucht serverseitig Manage Channels + Move Members + Manage Roles + Bot-Rolle hoch in Hierarchie** — nächste User-Aktion morgen.

## Release-Workflow Companion (manueller Auto-Updater-Trigger)

Aktuell kein CI. Wenn eine neue Companion-Version raus soll:

1. Lokal auf Windows: `pnpm --filter @dccc/companion tauri:build` — produziert `apps/companion/src-tauri/target/release/rdoc-squad-link.exe`
2. GitHub → `head87x/rdcc` → Releases → „Draft a new release"
3. Tag-Format zwingend `v<MAJOR>.<MINOR>.<PATCH>-build<N>` (z. B. `v0.5.0-build95`) — sonst tippt der Companion-`parseVersion` daneben. `<N>` ist `git rev-list --count HEAD` zum Build-Zeitpunkt (steht auch im Companion-Footer).
4. EXE als Asset hochladen — Name muss das Pattern aus `COMPANION_ASSET_PATTERN` enthalten (default `.exe`).
5. „Publish release" — Companion-Instanzen erkennen das Update beim nächsten Start automatisch und zeigen Popup.

Wenn der Wunsch kommt das zu automatisieren: GitHub-Actions-Workflow auf `windows-latest`-Runner, getriggert bei `git push --tags v*`. ~30 min Setup einmalig. **Nicht jetzt machen** — explizit zurückgestellt am 2026-05-24.

## v0.2 Audio-Lifecycle (2026-05-23)

Refactor weg vom "PTT = Room-Rebuild"-Modell: LiveKit-Session wird jetzt **beim WS-Connect einmal** aufgebaut und bleibt offen, solange der Companion eingeloggt ist. PTT toggelt nur noch `setMicrophoneEnabled(true|false)` lokal und broadcastet ein `speaking`-Flag im `commander:list`. Dadurch keine ICE/DTLS-Handshakes mehr pro Tastendruck.

Wichtige Auswirkungen auf Test/Doku/Logs:
- Es gibt einen neuen `speaking: boolean` in `CommanderInfo` ([packages/shared/src/types.ts](packages/shared/src/types.ts)). Wer eigene Konsumenten schreibt, muss das Feld erwarten.
- `bridge:joined` wird sofort nach Auth geschickt (nicht erst bei `ptt:start`), kommt zusammen mit dem LiveKit-Token.
- `ptt:start`/`ptt:stop` sind jetzt reine Status-Signale; sie minten keinen LiveKit-Token mehr.
- LiveKit-Server-Logs sollten ab jetzt **lange laufende Sessions** zeigen (nicht mehr 689 ms wie vorher); `mute`/`unmute`-Events ersetzen `join`/`leave` als High-Frequency-Signal.

Vollständige Details siehe [CLAUDE.md §Architektur-Pickup Punkt 4](CLAUDE.md).

## Path-Prefix-Awareness der Bridge

Die Bridge weiss durch die Env-Variable `PUBLIC_BASE_PATH` (default `""`), unter welchem öffentlichen Pfad sie hinter Traefik erreichbar ist. Das ist nötig, damit Cookies (insbesondere der OAuth-`state`-Cookie) mit dem **vor dem Strip** sichtbaren Pfad-Attribut gesetzt werden — der Browser sieht ja `https://commander.raumdock.org/dccc/auth/...` und schickt Cookies nur für matching Path-Prefixe zurück.

Logik in [apps/bridge/src/auth/oauth.ts](apps/bridge/src/auth/oauth.ts): `cookiePath = ${PUBLIC_BASE_PATH}/auth`. Mit `PUBLIC_BASE_PATH=/dccc` ergibt das den korrekten `Path=/dccc/auth`.

Für lokales Dev ohne Reverse-Proxy: `PUBLIC_BASE_PATH=""` lassen, dann ist der Cookie-Path wie zuvor `/auth`.

Schema-Validierung in [apps/bridge/src/config/env.ts](apps/bridge/src/config/env.ts) erlaubt nur `""` oder Werte mit führendem `/` und stripped trailing slashes.

## Build-Gotchas (für nächste Sessions)

Beim Bau des Bridge-Dockerfiles zweimal reingelaufen:

- `pnpm install --prod` in Docker braucht `ENV CI=true`, sonst `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`.
- pnpm-Workspaces brauchen im Multi-Stage-Runtime **jedes** Workspace-`node_modules/` mit-kopiert — nicht nur das Root und das des Targets. Sonst `ERR_MODULE_NOT_FOUND` für transitiv-genutzte Deps der anderen Workspaces (z. B. `zod` aus `@dccc/shared`).
- `pnpm install --no-frozen-lockfile` (statt `--frozen-lockfile`): es gibt bewusst keinen lokalen Node-Workflow für dieses Repo. Manifest-Änderungen kommen ohne aktualisierten Lockfile rein; der erste Docker-Build refresht ihn. Reproduzierbarkeit ist über git-Pinning der `package.json`-Versionen sichergestellt.

Beides ist im [apps/bridge/Dockerfile](apps/bridge/Dockerfile) bereits gelöst.
