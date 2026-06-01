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
    date: "2026-06-01",
    title: "Tenant isolation, op visibility & server partnerships",
    changes: [
      "Operations now have a visibility setting: Private (this Discord), Partners (linked Discords), or Public (any logged-in user). Independent of the op status.",
      "Public operations are visible to everyone and any logged-in user can register a unit and claim seats across servers.",
      "Server partnerships: link two Discord servers via a single-use token so both see each other's Partners operations. Manage under Servers → Settings → Partnerships.",
      "Server owners can remove their server from Fleetplanner (Servers → Settings → Danger zone). Data is kept and reactivates when the bot is re-added.",
      "SuperAdmins can ban/unban Discord servers from the Admin panel.",
      "Fixed: seat claiming is now properly scoped to people who can access the operation.",
      "Voice bot configuration is now hidden until a server is granted Voice Permission.",
      "Known status: Discord Channelcommander & Discord Voicebridge still untested.",
    ],
  },
];
