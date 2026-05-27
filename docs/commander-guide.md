# Commander Guide

You have been designated a **Channel Commander** on a Discord server that uses Channel Commander Voice Bridge. This guide walks you through using the companion app.

## What you need

- Your admin must already have:
  - Started the bot + bridge for your server.
  - Given your Discord account a commander role.
  - Enabled the system with `/cc enable`.
- Ask your admin for the **server (guild) ID**. They can copy it by right-clicking the server icon in Discord with Developer Mode on → **"Copy Server ID"**.

## Install the companion

Until precompiled binaries are published, you build the companion locally:

```bash
git clone https://github.com/head87x/rdcc.git
cd rdcc
pnpm install
pnpm --filter @dccc/companion tauri:dev
```

A window titled "Discord Channel Commander" opens.

## First-time setup

### 1. Choose your hotkey

The default is **`Mouse4`** — the back-side button on a typical gaming mouse. Hold to talk, release to stop.

If your mouse doesn't have side buttons, click **"Change hotkey"** and enter something like:
- `Alt+F1`, `Ctrl+Shift+P` (keyboard combo)
- `F1`–`F12` (single function key)
- `Mouse5` (forward-side button)

**Don't** enter modifiers alone (`Alt`, `Ctrl`) — those don't work as hotkeys.

### 2. Sign in with Discord

1. Click **"Sign in with Discord"**.
2. A dialog asks for your server ID — paste the one your admin gave you.
3. Your system browser opens to Discord's authorize page. Click **Authorize**.
4. The companion catches the redirect (`dccc://auth?token=…`) and you should now see:
   - **Signed in:** yes
   - **Connection:** connected
   - **Server (guild):** your server ID

If you see **"403 missing_commander_role"** or **"403 not_a_member"**, double-check with your admin that your account actually has the commander role on that server.

### 3. Test the bridge

1. **Press and hold** your hotkey. The window should turn red with **"COMMANDER BRIDGE LIVE"** across the top.
2. The first time you do this, your OS asks for **microphone permission**. Allow it.
3. The **"Audio"** field should change to `connected`.
4. **Active commanders** counts all commanders currently holding their hotkey across all the server's voice channels — including you.

Release the hotkey and the bridge closes immediately. Your microphone is released.

## How it works in practice

- You stay in your own team's Discord voice channel the whole time. Your normal Discord audio is unaffected.
- Holding the hotkey opens a **separate audio side-channel** between you and any other commander who is also holding their hotkey, regardless of which Discord channel they sit in.
- When you release, only your own team can hear you again.

## What we know about you

The bridge stores **only**:
- Your Discord user ID and the server ID, so we can verify your role.
- Audit log entries for session start/stop (no audio).

We never store:
- Audio. Anywhere. The LiveKit server is configured with no recording capability and the bridge issues tokens that explicitly forbid it (`roomRecord: false`).
- Your Discord access token. We use it once during sign-in to fetch your user ID, then drop it.
- Anything about what you said, when you said it, or to whom — beyond "session X was open from 12:34 to 12:36".

You can sign out at any time with the **"Sign out"** button, which deletes the stored session token from your machine.

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| Hotkey does nothing | Check the DevTools console (debug logs); make sure the configured accelerator matches what the OS sends |
| "session expired" banner | Click **Sign in with Discord** again — session tokens live for 15 minutes |
| "Audio: error" with details | Check whether `docker compose up -d livekit` is running on the server |
| Window is unresponsive | Closing and reopening; the dev-mode app sometimes hangs on hot-reload |
| You hear yourself | Use headphones, not speakers — echo cancellation can only do so much |
| "audio paused — join an allowed voice channel" banner | You are signed in but not currently in one of the voice channels your admin marked as participating. Join one and audio resumes within a second — the WebSocket to the bridge stays open in the meantime. |
| "audio paused — current voice channel is not allowed" banner | Same idea, but you moved into a channel that's outside the allowed list. Switch back into one of the allowed channels and audio resumes automatically — no sign-out needed. |
| Disconnected with reason `missing_commander_role` | An admin removed your commander role on the Discord side. Ask your admin to add it back, then click **Sign in** again. |

## Privacy concerns

If you have questions about what is logged or stored, talk to your server admin — they can show you the bridge's pino logs, which contain only `userId`, `guildId`, timestamps, and protocol error codes.

See [privacy.md](privacy.md) for the full inventory.
