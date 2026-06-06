# Org Fleet — guild ship roster (who owns what)

**FeatureRequest — Priority 3** (scale 1 highest … 5 lowest)
**Status:** Plan, **NOT yet implemented**. Captured 2026-06-07.
**Requested by:** SilentKnight — *"Org fleet tab: see which member has which ship, to ask to borrow
or look at it; maybe a Discord link to message/mention the owner. Most infra already exists."*

## Dependencies
- **Hängt an:** nichts hartes. Nutzt das, was es schon gibt: `UserShip` (owned ships), `GuildMembership`
  (member↔guild), ship catalog (`Ship`), `UserIdentity` (Discord id/handle for contact).
- **Blockiert:** nichts.
- **Verwandt:** [orgmodule-implementationplan.md](orgmodule-implementationplan.md) (full SC-Org entities)
  und [FR-P2-fleet-import-json.md](FR-P2-fleet-import-json.md) (füllt die Schiffsliste). Org Fleet ist
  die **leichte, guild-scoped** Variante — kein neues Org-Datenmodell nötig.
- **Quer:** mergelog-first; Discord IDs als String; Zod an der Boundary; per-guild Tenant-Scoping.

## Goal
A guild-internal **Org Fleet** view: list which member owns which ship, so members can find a hull
(“who has a Polaris?”) and reach out to borrow or inspect it. Read-only roster + a contact path.

## Data — already present
- Owned ships: `UserShip(userId, shipId, nickname)`.
- Membership: `GuildMembership(userId, guildId, role)`.
- Ship facts: `Ship(name, manufacturer, size, career, role, …)`.
- Discord contact: `UserIdentity(provider="discord", providerId, username)`.

No new tables required for the MVP. (Optional later: a per-user visibility flag — see decisions.)

## UI
- New **Org Fleet** tab (guild context) — server-rendered, members-only (same guild).
- **Two pivots** off one dataset:
  - **By ship:** searchable list of ships present in the org → expand to the owners.
  - **By member:** member → their owned ships (mirror of the profile Owned Ships, but org-wide).
- Reuse the sortable/searchable table style from the profile Owned Ships.
- Each owner row → a **Discord contact link**.

## Discord contact (the only “new” bit)
Tiered, cheapest first:
1. **Deep link / handle (MVP):** show the owner’s Discord handle + a link to their Discord profile
   (`discord://users/<discordId>` / `https://discord.com/users/<discordId>`). Zero bot work.
2. **Bot DM relay (phase 2, optional):** an "ask about this ship" button → the Fleetplanner bot DMs
   the owner ("<requester> asks about your <ship> for borrowing/viewing"). Reuses `sendDiscordDm`.
   Needs a light anti-spam guard + an opt-out.

## Scope / privacy
- **Guild-scoped:** a member only sees the fleet of guilds they belong to. No cross-guild leak.
- Ships come straight from each member’s profile (incl. JSON-imported ones).

## Build order
1. Aggregation query (guild members × their UserShips) + the Org Fleet tab with both pivots + search/sort.
2. Discord contact link (MVP tier 1 — handle + profile deep link).
3. (Optional) bot-DM relay + per-user visibility opt-out.

## Decisions (2026-06-07)
1. **Visible to fellow guild members by default — no opt-in/opt-out.** A member's owned ships are
   shown to everyone in their guild(s). No privacy toggle.
2. **MVP contact = Discord profile link only** (handle + `discord://users/<id>`). Bot-DM relay
   deferred to a later phase.
3. **Show quantity per model.** `UserShip` is unique per (user, model), so a **`quantity` column**
   must be added to carry hull counts (e.g. "MDC ×7"). Implications:
   - `UserShip.quantity Int @default(1)` + migration.
   - **FR-P2 import** sets `quantity` = number of that model in the JSON (instead of collapsing to 1);
     re-import updates the count.
   - Profile Owned Ships + Org Fleet display the count; Org Fleet can also total per model across the
     guild ("Polaris ×3 — 2 members").
   - This supersedes FR-P2's "duplicates collapse to one entry" — they now collapse to one row **with
     a count**.

---
*Design doc only. Implement on explicit instruction, mergelog-first. Light feature — most data
already exists; the bot-DM relay is the only net-new integration.*
