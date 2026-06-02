# Companion Voice Architecture

Date: 2026-06-02

This document is the authoritative target architecture for Companion voice modes.
If older docs or implementation details conflict with this file, this file wins.

## Discord Role IDs

These role IDs must be configurable through the Fleetmanager/Fleetplanner web UI.
They are not Companion-local settings.

| Purpose | Discord guild | Role ID | Lifetime |
| --- | --- | --- | --- |
| Bridge Mode access | Raumdock Discord `1431307397842079777` | `1511124797445247096` | Persistent admin-configured membership |
| Mission Commander Voice | Mission guild | `1510192642997227602` | Granted when mission voice opens, revoked when mission ends |
| Mission Relay Voice | Mission guild | `1510192451808133210` | Granted when mission voice opens, revoked when mission ends |

In the data model these are represented by:

- Bridge access: global Bridge settings (`raumdockGuildId`, `bridgeRequiredRoleId`).
- Mission Commander Voice: guild setting `commanderVoiceRoleId`.
- Mission Relay Voice: guild setting `globalVoiceRoleId` / relay voice role setting.

The UI wording should call the third role "Global Radio Net" where possible. Older code and docs may still call it "Global Voice"; functionally it means Relay Voice / Global Radio Net permission.

## Mission Role Matrix

Fleet roles and mission roles are separate layers. A Fleetadmin or Superadmin can administer the system, but does not automatically become a commander in every mission and does not automatically receive mission voice permissions.

Voice terminology:

- Command Net: mission command voice for leaders and commanders.
- Global Radio Net: mission relay voice path for RelayBot broadcast into assigned Discord channels.

| Scope | Role | Operation lifecycle | Need assignment / unit confirmation | Commanders tab | Command Net | Global Radio Net | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Fleet | Superadmin | Platform/admin scope | Admin scope only | No | No | No | No mission voice by fleet role alone. |
| Fleet | Fleetadmin | Guild/fleet admin scope | Admin scope only | No | No | No | Can manage, but is not automatically in mission voice. |
| Fleet | Crew | No | No | No | No | No | Mission access comes from assignment, not this base role. |
| Mission Leader | Event Leader | Yes: open, close, delete, cancel, complete | Yes | Yes | Yes | Yes | Event Leader equals Raidleader plus operation administration. |
| Mission Leader | Fleetcommander | No lifecycle by itself | Yes | No by default | No by default | No by default | Manages needs and confirms fleet units. Add explicitly or assign Event/Raid/Wing role for voice. |
| Mission Leader | Raidleader | Raid leadership | Yes | Yes | Yes | Yes | Leads the raid and always has Channel Commander and RelayBot rights. |
| Mission Leader | Wingcommander | Deputy raid leadership | Yes | Yes | Yes | Yes | Same voice rights as Raidleader. |
| Mission Commander | Ship Captain | No | Own unit context | Yes | Yes | No by default | Commands an accepted ship/fleet unit. |
| Mission Commander | CQB Captain | No | Own unit context | Yes | Yes | No by default | Commands an accepted FPS/CQB team. |
| Mission Commander | Added Commander | No | No by default | Yes | Yes | Optional | Manual Command Net participant; Global Radio Net is a separate toggle. |

Design rule:

- The Commanders tab is a mission roster, not an admin roster.
- It must not list every Fleetadmin, Superadmin, or guild Fleetoperator automatically.
- Administrative permission to edit a mission does not imply Command Net or Global Radio Net permission.
- Global Radio Net is intentionally narrower than Command Net. It should be granted only to users who may broadcast through RelayBots.

## Companion Modes

The Companion app has three operating modes.

### 1. Bridge Mode

Bridge Mode is the default only when no mission is active.

Requirements:

- No active mission configuration owns the Companion local voice path.
- User is authenticated with the Bridge.
- User has role `1511124797445247096` on Raumdock Discord guild `1431307397842079777`.

Behavior:

- PTT-1 / LOCAL sends to the normal Bridge/SquadLink commander room.
- Bridge Mode is automatically suspended when Commander Mode becomes active.
- When a mission ends or is disconnected, Companion may return to Bridge Mode if the user still satisfies the Bridge role gate.

Bridge Mode is not a mission fallback for users without the Raumdock Bridge role.

### 2. Commander Mode / Command Net

Commander Mode is the Companion mode for the mission Command Net.

Eligible users:

- Mission Captain / accepted unit captain.
- Mission Commander added through the mission Commanders UI.
- Event Leader, Raidleader, and Wingcommander.

Requirements:

- The mission is active.
- Mission voice for the operation has been opened.
- The mission has a dedicated Commander LiveKit room.
- The user is eligible for Command Net.
- The user receives temporary Discord role `1510192642997227602`.
- The user has a mission Companion link/session.

Behavior:

- PTT-1 / LOCAL sends to the mission Commander LiveKit room.
- The user can speak with all other Command Net users in that mission.
- Commander Mode automatically takes over LOCAL and ends/suspends Bridge Mode.
- The role `1510192642997227602` is revoked when the mission ends.

### 3. Relay Mode / Global Radio Net

Relay Mode is the Companion mode for the mission Global Radio Net. It is mission-scoped broadcast voice via RelayBots. It is an additional path beside Command Net and uses the second PTT button.

Eligible users:

- Event Leader, Raidleader, and Wingcommander.
- Mission Commanders explicitly permitted to use Global Radio Net.

Requirements:

- The mission is active.
- Mission voice for the operation has been opened.
- The mission has a dedicated Relay LiveKit publish room.
- The user has Global Radio Net permission.
- The user receives temporary Discord role `1510192451808133210`.
- RelayBots are running and assigned to mission groups/ships/squads.

Behavior:

- PTT-2 / GLOBAL sends audio to the mission Relay LiveKit room.
- RelayBots subscribe to that room and transmit audio into their assigned Discord voice channels.
- Each RelayBot creates its own Discord voice channel for the crew assigned to it through the Fleetmanager web interface.
- RelayBots create mission-specific Discord channels based on the mission assignment, ship, or squad.
- RelayBots should move assigned users into the Discord channel for their ship/squad when possible.
- The role `1510192451808133210` is revoked when the mission ends.

Important audio rule:

- If the speaking Fleetmanager/Commander is currently in the same Discord channel as a RelayBot, that RelayBot must not retransmit that speaker back into that channel. Otherwise the speaker hears themselves twice.

## Mission Voice Room Model

Each mission owns dedicated LiveKit rooms that are created/prepared when the mission is opened.

Required mission rooms:

- Commander room: Command Net for mission leaders, Captains, and Commanders.
- Relay publish room: input room for Global Radio Net. Companion publishes here with PTT-2; RelayBots subscribe here.

These rooms are mission-scoped. They are not shared between missions and must be cleaned up when the mission ends.

## Mission Lifecycle

When the mission is opened:

- Fleetplanner creates/prepares the mission Commander LiveKit room.
- Fleetplanner creates/prepares the mission Relay LiveKit room.
- Fleetplanner/RelayBots create mission-specific Discord voice channels for assigned ships/squads.
- Eligible Command Net users receive temporary role `1510192642997227602`.
- Eligible Global Radio Net users receive temporary role `1510192451808133210`.
- Mission Companion links are generated for eligible users.

While the mission is active:

- Companion polls mission state and permissions.
- Companion automatically selects the active mode.
- Commander Mode owns LOCAL when available.
- Relay Mode owns GLOBAL when available.
- Bridge Mode remains inactive while Commander Mode is active.
- RelayBots keep their Discord channel assignment in sync with mission ship/squad assignment.

When the mission ends:

- Companion leaves mission LiveKit rooms.
- PTT for mission Commander and Relay paths is disabled.
- Temporary Discord roles `1510192642997227602` and `1510192451808133210` are revoked.
- RelayBots disconnect from mission Discord channels and clean up mission-created channels where appropriate.
- Companion can return to Bridge Mode only if the user satisfies the Raumdock Bridge role gate.

## Fleetmanager Web UI Requirements

The Fleetmanager/Fleetplanner web UI must provide administration for:

- Raumdock Bridge guild ID: `1431307397842079777`.
- Bridge Mode role ID: `1511124797445247096`.
- Mission Commander Voice role ID: `1510192642997227602`.
- Mission Relay Voice role ID: `1510192451808133210`.
- RelayBot assignment to mission ships/squads.
- Mission Discord voice channel creation/assignment behavior.

The Fleetmanager mission UI must make clear who has:

- Command Net access.
- Global Radio Net access.
- Which RelayBot/channel they are assigned to.

## Implementation Notes

- The Companion must not expose Bridge Mode during an active Commander Mode session.
- Relay Mode is not the same thing as Bridge Mode.
- Relay Mode is mission-scoped, role-gated by the mission Global Radio Net role, and transported through RelayBots.
- The old term "Global Voice" should be treated as legacy wording for Global Radio Net unless explicitly discussing old code.
