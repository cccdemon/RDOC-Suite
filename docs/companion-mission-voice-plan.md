# Companion Mission Voice Plan

Date: 2026-06-02

## Goal

The Companion app supports operation-scoped mission voice. Users receive a mission-scoped configuration link when the operation starts, join the correct Discord voice channel first, and then use Companion for LiveKit commander voice and relay-bot transmission according to their mission permissions.

The Companion app is built via GitHub Actions workflows. Fleetplanner should link users to a stable current download source or to a Fleetplanner download page that resolves to the latest approved build.

## Operation Lifecycle

- When an operation is set to `open`, Fleetplanner prepares the operation-scoped LiveKit voice rooms.
- When an operation is set to `in_progress`, Fleetplanner starts mission voice for real:
  - Relay bots join or create Discord voice channels according to their assigned mission groups.
  - Relay bots move connected Discord users into their assigned channels when possible.
  - Mission start DMs are sent to all eligible users.
- When an operation is set to `completed`, `cancelled`, or is deleted:
  - Companion leaves LiveKit rooms.
  - Companion disables PTT.
  - Companion shows a clear mission-ended state.
  - Companion clears the stored mission session.
  - Relay bots disconnect from Discord and clean up empty mission channels.

Relay bots must recover from process crashes by rejoining/recreating their operation channels and resuming their assigned mission group state.

## Mission Start DM Recipients

On first transition to `in_progress`, Fleetplanner sends the mission start DM to:

- Captains of all accepted units.
- Operation leaders from the Leaders tab.
- Users with the `fleet_commander` operation role.
- Mission Commanders from the Commanders tab.

Each user should receive at most one DM per operation start, even if they qualify through multiple paths.

## Mission Start DM Content

The DM should communicate:

```text
The Operation <Operation name> - Lead by <Leadername(s)> has started.

- Please use this Voice Client to participate in the Commanders Voice <voice client link>
- If you've already installed SquadLink, here is your configuration Link: <https companion mission link>

Raw configuration link, if needed: <rdoc://mission?...>

Good Hunt
```

The configuration is mission-scoped only:

```text
rdoc://mission?token=<mission-token>&url=<fleetplanner-url>
```

It must not create or send a full companion auth token.

## Clickable Mission Configuration

Discord custom-scheme links are not reliable enough as the only user-facing link. Fleetplanner must provide an HTTPS wrapper:

```text
https://fleetplanner.example/companion/mission?token=<mission-token>
```

The wrapper page resolves the Fleetplanner public URL, builds the `rdoc://mission?token=...&url=...` link, and provides:

- A button/link to open Companion through the custom scheme.
- A visible copy fallback for the raw `rdoc://mission?...` link.
- A download link if the configured Companion download URL is available.

The DM can include both the HTTPS wrapper and the raw `rdoc://` fallback.

## Companion Runtime Behavior

Companion stores only one active mission configuration. Users cannot actively participate in multiple operations at the same time. The only exception is a separate Bridge Mode for explicitly permitted users on Raumdock Discord guild `1431307397842079777`.

Companion polls Fleetplanner for:

- Operation status.
- LiveKit mission voice room information.
- Whether the user currently has commander-room access.
- Whether the user currently has relay/global voice permission.
- The expected Discord voice channel for this user.
- Whether the user's linked Discord account is in the expected event voice channel or relay-bot channel.

Permissions must be refreshed from the mission session while the app is running. The app must not rely only on local cached leader/commander state.

If the user's Discord account leaves the event Discord voice context or is no longer present in the expected voice/relay channel, Companion must immediately:

- Disconnect from LiveKit.
- Disable both PTT paths.
- Keep the mission configuration but show the required Discord channel guidance.
- Reconnect only after the backend reports that the user is back in the expected Discord voice channel.

If the user is not in the correct Discord voice channel, Companion shows:

```text
Please join your adviced Voice channel <channelname> on Discord first.
```

The channel name is based on the assigned squad/mission group name. Duplicate squad names must be prevented. Squad names must not be editable after mission start.

## Voice Model

The Companion app has two PTT paths:

- Local/Commander voice: operation-scoped LiveKit commander room.
- Global/Relay voice: second PTT sends to the relay bots, which then transmit into their assigned Discord channels.

The second PTT is available only to users with the appropriate mission permission:

- Operation leaders.
- FleetCommander operation role.
- Commanders explicitly assigned in the Commanders tab.

## Discord Preconditions

The user must be part of the event Discord. A captain who is not present in the event Discord cannot fulfill the voice participation requirements.

Discord voice presence checks should be performed through Fleetplanner/relay-bot backend data, not guessed locally in Companion. The check must be reliable enough to drive the Companion UI state.

## Implementation Milestones

1. Add the HTTPS Companion mission wrapper route.
2. Update mission start DM generation to include all recipient classes and the HTTPS wrapper link.
3. Extend the mission-voice polling endpoint with permission refresh and expected Discord voice-channel state.
4. Update Companion UI/state to display required Discord channel guidance, disconnect LiveKit, and disable voice/PTT whenever the backend reports an invalid Discord voice presence.
5. Prevent duplicate squad names and block squad-name edits after mission start.
6. Add relay-bot recovery/rejoin behavior and operation channel cleanup guarantees.
7. Add the new UI control for relay bots to join/create mission Discord channels according to their assignment.
