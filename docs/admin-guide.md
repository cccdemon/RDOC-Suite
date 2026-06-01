# Admin Guide

This guide walks a Discord server administrator through setting up Channel Commander on their server.

## What you need

- **Owner or Manage Guild permission** on the Discord server.
- A computer where the bot + bridge will run (your own machine, a small VPS, a Pi — anything that can run Node.js 20+).
- ~30 minutes for the first-time setup.

## 1. Create the Discord application

1. Open [https://discord.com/developers/applications](https://discord.com/developers/applications) and log in.
2. Click **"New Application"** (top right). Name it e.g. `Channel Commander`. Accept the terms. Click **Create**.
3. You are now on the **General Information** page. Note down the **Application ID** — this is your `DISCORD_RDOCRTC_CLIENT_ID`.
4. Scroll down to **Client Secret**. Click **Reset Secret**, copy the value, save it — this is your `DISCORD_CLIENT_SECRET`. (You can only see it once.)

## 2. Configure the bot

1. In the left sidebar click **Bot**.
2. The bot is auto-created. Under **Token**, click **Reset Token** and copy it — this is your `DISCORD_RDOCRTC_BOT_TOKEN`. Save it somewhere safe (a password manager).
3. Under **Privileged Gateway Intents**: **none of these are required**. Leave them off.
4. Under **Bot Permissions**, the slash commands handle their own permission gating, so you do not need to pre-grant anything special here.

## 3. Configure OAuth2

1. In the left sidebar click **OAuth2**.
2. Under **Redirects**, click **Add Redirect** and enter:
   ```
   http://localhost:8787/auth/callback
   ```
   (Use your public URL instead of `localhost:8787` if you are hosting the bridge somewhere else.)
3. Save changes.

## 4. Invite the bot to your server

1. Still on the **OAuth2** page, scroll to **OAuth2 URL Generator**.
2. Check the scope **`bot`** and **`applications.commands`**.
3. The bot-permissions panel that appears below: check **`Manage Roles`** is enough for our use case; leave the rest off unless you need more.
4. Copy the **Generated URL** at the bottom and open it in a new browser tab.
5. Pick your server, click **Authorize**, complete the CAPTCHA.

The bot should now be listed in your server's member list (it will appear as offline until you actually start it).

## 5. Fill in .env

In your local clone of this repository, edit `.env` and fill in the four Discord values you collected:

```env
DISCORD_RDOCRTC_BOT_TOKEN="<from step 2>"
DISCORD_RDOCRTC_CLIENT_ID="<from step 1>"
DISCORD_CLIENT_SECRET="<from step 1>"
OAUTH_REDIRECT_URI="http://localhost:8787/auth/callback"
COMPANION_REDIRECT_URI="dccc://auth"
SESSION_SECRET="<generate a random 32+ character string>"
```

To generate a session secret on Windows PowerShell:
```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }) -as [byte[]])
```

## 6. Start the services

In three separate terminals (in the project root):

```bash
docker compose up -d livekit
pnpm --filter @rdoc-suite/bridge build && node apps/bridge/dist/index.js
pnpm --filter @rdoc-suite/bot   build && node apps/bot/dist/index.js
```

The bot should log `bot ready` once it connects to Discord.

## 7. Bootstrap the first admin + configure your server

The `/cc` slash command has been **removed**. Guild config and admin management now
live entirely in the **bridge admin web UI** (`https://suite.raumdock.org/admin`).

### Bootstrap the first admin (env seed)

Set both in `/opt/RDOC-Suite/.env`, then recreate the bridge:

```
BRIDGE_SUPERADMIN_DISCORD_ID=<your Discord user id>
BRIDGE_SUPERADMIN_GUILD_ID=<your Discord guild id>
```

```
docker compose -f docker-compose.prod.yml up -d --force-recreate bridge
```

On startup the bridge seeds a protected **admiral** AdminUser for that guild (idempotent —
safe on every boot). This replaces the old `/cc admin add` bootstrap. After the first admin
exists, additional admins are added via invite links in the web UI.

### Configure the guild (web UI)

1. Open `https://suite.raumdock.org/admin` → sign in with Discord (the seeded admiral).
2. Go to **Konfig** (`/admin/config`):
   - Tick **System aktiviert** (this is the `enabled` flag — without it, commander/companion
     sign-in returns `guild_not_enabled`).
   - Paste the **Commander role** snowflake(s), one per line.
   - (Allowed voice channels are managed here too — leave empty to allow all channels.)
   - Save.

**About allowed voice channels:** this list is **enforced** by the bridge. A commander must
be sitting in one of the listed voice channels to connect; the bridge re-checks every 60 s
and kicks anyone who moves out (close code `4403`, reason `outside_allowed_voice_channel`).
Empty list = all channels allowed.

## Phase B: managing Admins + issuing Admiral credentials

Channel Commander has three permission tiers:

| Tier | Who | What they can do | How they're authorized |
| --- | --- | --- | --- |
| **Admin** | Discord user on your AdminUser whitelist | Sign into the web admin UI, manage other admins, issue + revoke Admiral credentials | First admin via `BRIDGE_SUPERADMIN_*` env seed; further admins via invite links in the web UI |
| **Admiral** | Anyone given a `key:secret` API credential by an Admin | Create sessions, invite Commanders to those sessions, end sessions | API credential from the admin UI |
| **Commander** | Anyone given a one-shot invite token by an Admiral | Join one specific session and talk in its LiveKit room | Invite token pasted into the Companion |

### Bootstrap

1. Seed the first admin via the `BRIDGE_SUPERADMIN_DISCORD_ID` / `BRIDGE_SUPERADMIN_GUILD_ID`
   env vars (see section 7), then sign into `/admin`.
2. Add further admins and issue Admiral credentials from the web admin UI.
3. Hand the `key:secret` to whoever should be Admiral of a session (out of band). They paste
   it into the Companion's ADMIRAL tab.
4. The Admiral uses the Companion to create a session, then mints a per-Commander invite for
   everyone they want to pull in — each Commander gets one one-shot token, also out of band.

If a credential leaks: issue a new one and revoke the old one in the web admin UI.

## 8. Hand out the Companion app

Every commander downloads / builds the Companion app and runs it. See [commander-guide.md](commander-guide.md).

## Operating notes

- **Disable on the fly**: untick **System aktiviert** in `/admin/config` — stops all active PTT sessions on the next 60-second permission recheck.
- **Remove a role mid-session**: same — server detects within 60 s and kicks the user.
- **Check who is connected**: bridge logs every WS connect/disconnect at `info` level.
- **Audio is never recorded**: this is enforced both in the bridge's LiveKit token (`roomRecord: false`) and by running LiveKit without any recording egress configured.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Companion/Commander sign-in `guild_not_enabled` | Guild not enabled in the bridge | Tick **System aktiviert** in `/admin/config` |
| Cannot reach `/admin` (not on admin list) | No AdminUser seeded yet | Set `BRIDGE_SUPERADMIN_DISCORD_ID` + `BRIDGE_SUPERADMIN_GUILD_ID`, recreate bridge |
| Commander gets 403 on sign-in | `enabled=false` or role missing in `GuildConfig` | Check `/admin/config` (enabled + commander roles) |
| Bridge crashes on startup | `SESSION_SECRET` < 32 chars | Set a longer secret |
| LiveKit "connection failed" | Container not running | `docker compose up -d livekit`, check `docker logs dccc-livekit` |
| OAuth redirect mismatch | The redirect URL in DDP must match `OAUTH_REDIRECT_URI` exactly | Copy-paste, no trailing slash |
