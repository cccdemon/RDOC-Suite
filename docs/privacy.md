# Privacy — data inventory

What the **RDOC Fleetplanner** stores, where it lives and how long. This is the engineering
inventory behind the user-facing privacy page (`/rechtliches/datenschutz`, built in
`apps/fleetplanner/src/web/pages.ts`). Have legal counsel review before publishing a formal notice.

Stand 2026-08-12, checked against `apps/fleetplanner/prisma/schema.prisma`.

> **Was rewritten on 2026-08-12.** The previous version documented the Channel Commander voice
> bridge — `CommanderSession`, `GuildConfig`, a Companion session JWT, LiveKit tokens and bridge
> logs. None of that exists any more (voice stack removed 2026-06, Companion 2026-08). It described
> a system that was gone.

## Identity and access

| Data | Where | Why | Retention |
| --- | --- | --- | --- |
| Discord (or GitHub/Google) **account id + username** | `UserIdentity.providerId` / `.username` | Links the login to the account; the Discord id is also how DMs and RSVPs are matched | Until the identity is unlinked or the account is deleted |
| **Display name, avatar hash, language, layout preference** | `User` | Shows who is who and renders the UI in the chosen language | Until the account is deleted |
| **Instance role, active flag, joined / last-seen timestamps** | `User` | Permission checks; the last-seen date shows operators who is still around | Until the account is deleted |
| **Session** | `UserSession.tokenHash` (SHA-256), `csrfToken`, `expiresAt` | Keeps you signed in | 30 days, or until logout |
| **Server membership + role** | `GuildMembership` | Decides what you may do *in that server* | Until the membership is removed or the server is deleted |

The session cookie carries a random token; the database stores **only its SHA-256**. A database or
backup leak therefore cannot be replayed as a session. OAuth access tokens are used once during
sign-in and are **never** persisted or logged.

## Operations

| Data | Where | Why | Retention |
| --- | --- | --- | --- |
| Operation content (title, briefing, date, meeting point, visibility) | `Operation` | The plan itself | Until the operation is deleted |
| Fleet units, seats, crew requests, primary ship | `FleetUnit`, `SeatAssignment`, `CrewAssignmentRequest`, `OpPrimaryUnit` | Who flies what and sits where | Cascade-deleted with the operation |
| Ground-team sign-ups | `CqbSignup` | Ground roster | Cascade-deleted with the operation |
| Questions and answers | `OpQuestion` | Mission Q&A | Cascade-deleted with the operation |
| **Mission log** (actor name, action, timestamp) | `AuditLog` | Who changed the roster and when | Cascade-deleted with the operation |
| Commanders | `OperationLeader` | Command chain | Cascade-deleted with the operation |
| Attached **PDF documents** | `OperationDocument` row + file on the server volume | Briefing material | Deleted with the document or the operation |
| Stream links | `OperationStream` | Who broadcasts | Cascade-deleted with the operation |
| Shared hangar for an operation | `OperationHangarShare` | Lets the operator see which hulls are available | Cascade-deleted with the operation |
| Voice link recipients | `OperationVoiceRecipient` | Who may see the Subraum join link | Cascade-deleted with the operation |
| Cover image | `OpCover` + file in the cover service | Banner, link preview, Discord event image | Auto-purged 14 days after an operation is completed or cancelled |

## Discord side

| Data | Where | Why | Retention |
| --- | --- | --- | --- |
| **"Interested" RSVPs** — Discord id + display name | `EventInterest` | A pilot who clicks Interested on the Discord event appears on the operation. **Also stored for people without a Fleetplanner account** (`userId = null`, claimed on their first login) | Cascade-deleted with the operation; set to `withdrawn` when the pilot un-clicks |
| Server configuration — guild id, name, org name, role id, channel ids, timezone, reminder lead time, invite URL | `Guild` | So events, tickets and permission mapping work without a Discord round-trip per request | Until the server is removed |
| Partnerships and share policies | `GuildPartnership`, `PartnerSharePolicy`, `EventDistribution` | Cross-server sharing and its decisions | Until revoked / deleted with the operation |

Sent **to** Discord: scheduled events (title, description, time, op link, cover image), reminder and
assignment DMs, feedback tickets and announcements you trigger, and the partner-approval DM. Nothing
else leaves the instance.

## Community and catalogue

| Data | Where | Retention |
| --- | --- | --- |
| Hangar (which catalogue ships you own) | `UserShip` | Until you remove them or delete the account |
| Fleetyards username, org-hangar opt-in | `User` | Until you change it |
| Polls, options and **votes** (tied to your account) | `Poll`, `PollOption`, `PollVote` | Until the poll is deleted |
| Operation templates | `OperationTemplate` | Until deleted |
| Ship / location catalogue | `Ship`, `Location`, `FleetyardsShip` | Not personal data — synced from public sources |

## Operations of the instance

| Data | Where | Retention |
| --- | --- | --- |
| System events (level, category, message, detail) | `SystemEvent` | **10 days**, then pruned |
| Request logs (pino: method, path, status, request id, client IP) | Container stderr | Whatever the operator keeps |
| Metrics | Prometheus | Aggregate only, no personal data |

## What is **never** collected

- **Audio.** The Fleetplanner carries no voice traffic. It builds a link into a Subraum room and
  nothing more — no recording, no mixing, no presence in a Discord voice channel.
- **Passwords.** Login is OAuth only.
- **Discord message content, presence, or member lists** beyond the role ids needed for the
  permission mapping.
- **Persisted OAuth access tokens.** Used once during sign-in, then dropped.
- **Payment data.** There is none.

## Deleting data

- **An operation** takes everything attached to it (see the cascade table in
  [ARCHITEKTUR.md §6.4](ARCHITEKTUR.md#64-löschverhalten)).
- **A server** takes its operations, memberships, polls, templates and partnerships.
- **An account**: there is no self-service delete button today — deletion is an operator action on
  the instance. Sessions and identities cascade; authored content (operations, questions, audit
  entries) is written with the display name of the time and must be handled by the operator.

## Contact

The instance operator is named in the imprint (`/rechtliches/impressum`).
