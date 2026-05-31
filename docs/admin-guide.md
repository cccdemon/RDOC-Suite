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

## 7. Configure your server

In any text channel on your Discord server, run the slash commands as the admin:

```
/cc setup mode:external_voice
/cc role add @ChannelCommander       (← the role(s) that should be allowed to PTT)
/cc channel add #team-alpha-voice    (← each voice channel that participates)
/cc channel add #team-bravo-voice
/cc enable
/cc status                            (← double-check)
```

**About `/cc channel add`:** This list is now **enforced** by the bridge. A commander must be sitting in one of the listed voice channels to connect; the bridge re-checks every 60 s and kicks anyone who moves out (close code `4403`, reason `outside_allowed_voice_channel`). If you leave the list empty (no `/cc channel add` ever ran), all channels are allowed — this matches the historical pre-enforcement behaviour, so existing deployments are not broken.

## Phase B: managing Admins + issuing Admiral credentials

Channel Commander now has three permission tiers:

| Tier | Who | What they can do | How they're authorized |
| --- | --- | --- | --- |
| **Admin** | Discord user on your AdminUser whitelist | Will be able to sign into the web admin UI (Phase B2), manage other admins, issue + revoke Admiral credentials | `/cc admin add @user` (requires Manage Guild) |
| **Admiral** | Anyone given a `key:secret` API credential by an Admin | Create sessions, invite Commanders to those sessions, end sessions | API credential from `/cc generate-credential` or the admin UI |
| **Commander** | Anyone given a one-shot invite token by an Admiral | Join one specific session and talk in its LiveKit room | Invite token pasted into the Companion |

### Bootstrap

1. Add yourself as an Admin:
   ```
   /cc admin add @yourself
   ```
   List current admins anytime with `/cc admin list`.
2. Issue an Admiral credential. The `label` is just for your records — pick something like the person's name or laptop:
   ```
   /cc generate-credential label:Alice laptop
   ```
   The bot replies with a `key:secret` string in an ephemeral message (only you see it). **Copy it now** — it's shown once, never again.
3. Hand the `key:secret` to whoever should be Admiral of a session (DM, Signal, whatever — out of band). They paste it into the Companion's ADMIRAL tab (coming in Phase B3 redesign).
4. The Admiral uses the Companion to create a session, then mints a per-Commander invite for everyone they want to pull in — each Commander gets one one-shot token, also out of band, also pastes it into the Companion's COMMANDER tab.

If a credential leaks: `/cc generate-credential` again to issue a new one, then revoke the old one via the web admin UI when B2 is live (for now: ask me, I can flip the `revokedAt` in the DB).

If `/cc` does not show up: wait 1–2 minutes for Discord to propagate the global slash-command registration, then refresh the Discord client (`Ctrl+R` on desktop).

## 8. Hand out the Companion app

Every commander downloads / builds the Companion app and runs it. See [commander-guide.md](commander-guide.md).

## Operating notes

- **Disable on the fly**: `/cc disable` immediately stops all active PTT sessions on the next 60-second permission recheck.
- **Remove a role mid-session**: same — server detects within 60 s and kicks the user.
- **Check who is connected**: bridge logs every WS connect/disconnect at `info` level.
- **Audio is never recorded**: this is enforced both in the bridge's LiveKit token (`roomRecord: false`) and by running LiveKit without any recording egress configured.

## Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| `/cc` commands invisible | Global registration not propagated yet | Wait 2 min, restart Discord client |
| Commander gets 403 on sign-in | `enabled=false` or role missing in `GuildConfig` | Run `/cc status` to verify |
| Bridge crashes on startup | `SESSION_SECRET` < 32 chars | Set a longer secret |
| LiveKit "connection failed" | Container not running | `docker compose up -d livekit`, check `docker logs dccc-livekit` |
| OAuth redirect mismatch | The redirect URL in DDP must match `OAUTH_REDIRECT_URI` exactly | Copy-paste, no trailing slash |
