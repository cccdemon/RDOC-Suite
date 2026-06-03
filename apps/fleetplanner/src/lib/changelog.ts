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
