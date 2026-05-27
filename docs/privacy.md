# Privacy

This document describes exactly what data the Channel Commander system collects, where it lives, and how to delete it. It is meant as a starting point for a formal privacy notice — please have legal counsel review before deploying publicly.

## What is collected

| Data | Where it lives | Why | Retention |
| --- | --- | --- | --- |
| Discord **user IDs** of commanders | SQLite/Postgres `CommanderSession.userId` | So the bridge knows who started/stopped a PTT session | Until the admin deletes it |
| **Guild IDs** of participating servers | SQLite/Postgres `GuildConfig.guildId` | So config and audit entries are tied to a server | Until the admin deletes the row |
| **Role IDs and channel IDs** marked as commander-related | SQLite/Postgres `GuildConfig.commanderRoleIds` / `allowedVoiceChannelIds` | So permission checks can be done without Discord round-trips on every event | Until the admin removes them |
| Session **start/stop timestamps** | SQLite/Postgres `CommanderSession.startedAt` / `endedAt` | Audit log | Until the admin deletes the row |
| Companion **session JWT** | On the commander's PC, in `%APPDATA%\com.head87x.dccc.companion\settings.json` (or platform equivalent) | So the commander does not have to sign in on every app restart | Until the commander clicks **Sign out** or the token expires (15 min default) |
| **Bridge logs** (pino, console) | Stderr of the bridge process | Operational debugging | Whatever the operator chooses to keep |

## What is **never** collected

- **Audio.** The bridge does not see audio at all — it routes signaling only. The LiveKit server is configured with no recording egress, and the access tokens the bridge mints explicitly set `roomRecord: false`.
- **Discord OAuth access tokens** beyond a single in-memory use during the sign-in flow. They are not logged, not persisted, not handed to anyone.
- **Microphone permissions** beyond what the operating system manages on the commander's PC.
- **Chat messages**, voice channel membership history, presence, or any other Discord data beyond what is needed for the role check.

## Logs

Pino logs in the bridge include:
- `userId` (Discord snowflake)
- `guildId` (Discord snowflake)
- WS protocol event codes (`bridge:joined`, `ptt:start`, error codes)
- Connection-level events (`heartbeat timeout`, `ws client connected`, `permission recheck failed`)
- Timestamps

Logs **never** include:
- Bearer tokens, session tokens, or `SESSION_SECRET` (redacted by pino at the field level).
- The contents of any user message (we don't get any).
- Audio frames.

## How to delete data

### As a commander

- **Sign out** in the companion → deletes the stored session JWT on your machine.
- Optionally delete `%APPDATA%\com.head87x.dccc.companion\settings.json` to remove the hotkey choice too.

### As an admin

- Open Prisma Studio: `pnpm db:studio`
- Delete rows from `GuildConfig` (removes the entire server config) or `CommanderSession` (removes audit entries) as needed.
- Or, for a clean wipe, stop the bridge + bot and delete `prisma/dev.db`.

## Discord ToS compliance

This system follows Discord's [Developer Terms](https://discord.com/developers/docs/policies-and-agreements/developer-terms-of-service):

- No user tokens, no client modification, no selfbots, no scraping.
- Only the official Bot API and OAuth2 are used.
- Bot identity, audio routing, and server configuration are all visible to the server admin.
- Commanders explicitly authorize the app via OAuth2.

If you are operating this for a third party, you should also publish a privacy notice that includes:
- The legal basis for processing (legitimate interest / consent).
- The data controller's contact information.
- The data subject's rights under your jurisdiction (GDPR, CCPA, etc.).
- The retention policy you actually implement.
