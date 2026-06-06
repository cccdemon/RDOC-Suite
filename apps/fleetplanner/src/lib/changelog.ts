// User-facing changelog shown at /changelog. Newest entry first.
// Keep entries short and player-readable — this is not the git log.

export type ChangelogEntry = {
  /** Display date, ISO yyyy-mm-dd. */
  date: string;
  /** Short headline. */
  title: string;
  /** Bullet points, plain text. */
  changes: string[];
};

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-06-06",
    title: "Smarter fleet import & sortable ship list",
    changes: [
      "Fleet import now matches short ship names to the full catalog name (e.g. \"Ares Ion\" → Ares Star Fighter Ion), so far more of your ships import automatically.",
      "Any ship that still doesn't match is listed after the import so you can search the ship database and assign the right one — or skip it.",
      "Your Owned Ships list is now sortable: click a column header (Ship, Nickname, Manufacturer, Size, Career, Role, Crew) to sort.",
    ],
  },
  {
    date: "2026-06-06",
    title: "Mission cover generator",
    changes: [
      "New Mission Cover page on each operation (operators): generate a cinematic Star-Citizen briefing cover from the op's own data, or open the editor to fine-tune background, logos, fonts and effects.",
      "The cover is used for the mission — shown as the banner on the operation page, as the link-preview image when you share the op, and as the Discord scheduled-event image (updated automatically when you regenerate it).",
      "Optional checkbox in the Create-Event wizard to jump straight to the cover after creating an operation.",
      "Covers of completed or cancelled operations are cleaned up automatically after 14 days.",
    ],
  },
  {
    date: "2026-06-06",
    title: "Fleet import, ground vehicles & event polish",
    changes: [
      "Import your fleet from a CCU-Game JSON export on your profile to bulk-add owned ships.",
      "Ships with a big-enough cargo bay can carry a ground vehicle as a crewable sub-unit with its own seats, nested under the carrier ship; the operator accepts the ship and its vehicles together.",
      "Mission briefings now render Markdown (headings, bold, lists, links), with a Markdown cheatsheet in the event wizard.",
      "Rebuilt operator management workspace: a clear status flow (Draft → Open → Live → Done) with a 'next step' button and a 'what needs you' command rail.",
      "Rejecting a unit now frees its seats; you can configure your offered ship's seats or withdraw it while it is still pending.",
    ],
  },
  {
    date: "2026-06-03",
    title: "Primary voice channel & looser voice rules",
    changes: [
      "Members assigned to two or more units now get one main Discord voice channel they can choose themselves — or a mission leader assigns it (Fleet tab → Primary Voice Channel). Default is the FPS squad.",
      "Global Radio: you now only need to be on the same Discord server — no specific voice channel required.",
      "Command Net: you may sit in the event channel or any of the operation's unit voice channels, not just your own unit.",
    ],
  },
  {
    date: "2026-06-03",
    title: "Mission participant export",
    changes: [
      "Completed operations now show a Participants panel on the Overview tab listing everyone who took part — leaders, unit captains, seat-holders, and manually-added Command Net members.",
      "Download the participant roster as a CSV (incl. Discord name/ID, roles, and units) from the completed op.",
    ],
  },
  {
    date: "2026-06-03",
    title: "Fix: FPS squad members can command ships",
    changes: [
      "Fixed: a member assigned to an FPS squad could not also command a ship in the same operation (\"already assigned to a primary seat\"). FPS and a ship seat can now be held at the same time.",
    ],
  },
  {
    date: "2026-06-03",
    title: "How-to guide refreshed",
    changes: [
      "Updated the How-to page with the current role model: Superadmin, Fleetadmin, Captain, and Crew.",
      "New Mission voice section explaining the Command Net (mission leaders) and Global Radio Net (RelayBot broadcast into Discord), plus which mission roles get each net.",
      "Clarified that fleet roles do not grant mission voice automatically — voice is assigned per operation via the Commanders tab.",
    ],
  },
  {
    date: "2026-06-02",
    title: "Mobile layout & calendar timezone fix",
    changes: [
      "The whole app is now mobile-responsive: nav, tables, op dashboard and forms reflow and scroll cleanly on phones and tablets.",
      "Fixed: the operation calendar showed times in UTC. Every op now appears in its own server's timezone, matching the op detail page.",
    ],
  },
  {
    date: "2026-06-01",
    title: "Tenant isolation, op visibility, commanders & timezones",
    changes: [
      "Operations now have a visibility setting: Private (this Discord), Partners (linked Discords), or Public (any logged-in user). Independent of the op status.",
      "Public operations are visible to everyone and any logged-in user can register a unit and claim seats across servers.",
      "Server partnerships: link two Discord servers via a single-use token so both see each other's Partners operations. Manage under Servers → Settings → Partnerships.",
      "Server owners can remove their server from Fleetplanner (Servers → Settings → Danger zone). Data is kept and reactivates when the bot is re-added.",
      "SuperAdmins can ban/unban Discord servers from the Admin panel.",
      "New Commanders tab on the operation detail page: see mission voice links per accepted captain and add extra commanders by hand.",
      "New Voice Control section on the operation detail page: pull a unit's crew into their Discord voice channel, or move individual members.",
      "New read-only Composition Board in the operation overview: required vs filled vs open slots at a glance.",
      "Per-server timezone (default Europe/Berlin): operation dates are now shown and entered in your server's local time instead of UTC.",
      "Discord scheduled events now include a header image based on the operation type.",
      "Fixed: seat claiming is now properly scoped to people who can access the operation.",
      "Voice bot configuration is now hidden until a server is granted Voice Permission.",
      "Known status: Discord Channelcommander & Discord Voicebridge still untested.",
    ],
  },
  {
    date: "2026-05-31",
    title: "Mission voice sessions & bot diagnostics",
    changes: [
      "Mission voice sessions: when an operation opens, Command Net and Global Radio Net rooms are created and the matching Discord roles are granted; both are cleaned up when the op completes or is cancelled.",
      "SuperAdmins can grant a server Voice Permission; voice features stay hidden until then.",
      "Pick the Discord voice channel for an operation's scheduled event when creating or editing the op.",
      "New bot install diagnostics: check that the required Discord bots are installed with the right permissions, with exact invite links when something is missing.",
      "Fixed: web login now uses the dedicated Fleetplanner Discord app instead of the companion/voice app.",
    ],
  },
  {
    date: "2026-05-30",
    title: "Multi-server support & ship catalog",
    changes: [
      "Fleetplanner is now multi-tenant: one instance serves many Discord servers, each with its own operations, members and roles. Switch servers from the nav.",
      "Self-service setup: any logged-in user can add the Fleetplanner bot to a Discord server they manage and become its Admiral.",
      "Discord scheduled events are posted automatically when an op opens and removed when it is cancelled or completed.",
      "Ship catalog from the Star Citizen Wiki now auto-refreshes weekly, with a manual 'Sync now' trigger in the Admin panel.",
    ],
  },
];
