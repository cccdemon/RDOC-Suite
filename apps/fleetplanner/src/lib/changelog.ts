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
    date: "2026-07-20",
    title: "Flexible signups reach the fleet operator again",
    changes: [
      "Signing up with \"just place me somewhere\" now actually shows up in the fleet operator's Flexible list, so you get assigned instead of sitting unseen. Previously that button wrote to a different place than the operator's panel was reading.",
      "Fighters assigned to a squadron no longer show up as \"no squadron\" on the board when the operation uses both requirement squadrons and hand-built formations.",
      "Fleet operators can now move a fighter into a requirement squadron — the dropdown only offered hand-built formations before.",
      "The needs editor now also appears on the CQB tab, so ground troops can be requested from the same place where they are managed. It used to live on the Fleet tab only, which made \"request 2 CQB teams\" impossible to do from where you would expect it.",
    ],
  },
  {
    date: "2026-07-20",
    title: "You decide what your ship is here for",
    changes: [
      "When you offer a ship you can now say what role it plays in this operation — fighter, transport, support, mining, salvage, exploration or capital. The ship catalog only supplies the suggestion.",
      "This matters for hybrids: the catalog calls the Cutlass Black a \"Light Freight / Medium Fighter\", so it used to land in the fighter lane whether you brought it as one or not. Now you say, and the fleet operator can change it.",
      "Fleet operators have a role dropdown on every ship on the board. Changing it moves the ship to the right lane and is recorded in the mission log.",
      "Fixed ship classification generally: around 40 freighters and all mining ships were falling through into no category at all, so they never matched a transport or mining requirement. Bombers and interceptors now count as fighters.",
    ],
  },
  {
    date: "2026-07-20",
    title: "See where you were placed",
    changes: [
      "Every ship, vehicle and fighter on the board now shows which squadron or formation it belongs to — previously only the fleet operator could see that.",
      "\"Your status\" now spells out your placement: your formation, the ship carrying you, your slot number in a ground troop and whether you're its Captain.",
      "Vehicles and fighters loaded into a ship show \"RIDING IN: <ship>\", and the carrying ship lists what it has aboard.",
      "New Mission Log on the operation page: every roster change is recorded, so you can check when you were put into a formation or moved to another slot. Not shown to visitors who aren't signed in.",
    ],
  },
  {
    date: "2026-07-20",
    title: "Squadrons, ground troops and captains",
    changes: [
      "Fighter squadrons and CQB troops can now be grouped under a larger formation (Verband) — \"Squadron 1 + Squadron 2 form a wing\". The formation is shown on the roster tile, so everyone can see which formation they were put into, not just the fleet operator.",
      "The first place in a troop or squadron is always the Captain, and it's marked as such on the roster. The fleet operator can promote anyone else to Captain; the previous one simply trades places.",
      "Ground troops now show as a tile with real slots — \"2 troops of 4\" looks like two tiles with four places, with free ones marked FREE, instead of a plain name list.",
      "Fighters can be carried by a ship, the same way ground vehicles already could.",
      "When an operation is shared with partner Discords, the fleet operator can now also assign members of those partner orgs (shown with their org name). As before, only people who have logged in at least once can be assigned.",
    ],
  },
  {
    date: "2026-07-19",
    title: "Late arrivals and squadron auto-fill",
    changes: [
      "Coming late? You (or your fleet operator) can set an arrival time on your ship, your seat or your ground-troop slot. It shows up as an amber \"EST 21:00\" marker so the operator can plan around it.",
      "Fighters that get accepted without a squadron are now dropped into the first squadron with a free place automatically. There's also an Auto-Fill button that does the same for fighters that were already accepted.",
      "Fleet operators can place a pilot into a squadron directly, even if that pilot didn't bring a ship.",
    ],
  },
  {
    date: "2026-07-18",
    title: "See your signup status",
    changes: [
      "After signing up — especially when you offered a ship — the operation page now shows what you signed up with and whether it's been confirmed yet, instead of looking as if you never signed up at all.",
      "Ships you offered that are still awaiting a decision now stay visible on the board, greyed out and tagged \"awaiting confirmation\".",
      "Feedback is now its own entry in the main navigation instead of being buried in your profile.",
      "Ships from the ship list can be added straight to your hangar, and the add button sits next to the ship name.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Share a public operation",
    changes: [
      "Public operation pages now have a Share row: on mobile it opens your phone's native share sheet (Instagram, Snapchat, TikTok, WhatsApp and everything else) and attaches the mission cover image when available.",
      "On desktop you get direct buttons for X, Facebook, Threads, WhatsApp, Telegram and a copy-link button.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Mission cover as page backdrop",
    changes: [
      "The mission cover is now the operation page's header background, gently dimmed so the title and details stay easy to read.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Discord \"Interested\" auto-joins the op",
    changes: [
      "Click \"Interested\" on an operation's Discord event and you now show up automatically in the op's Need Assignment list — no separate signup needed.",
      "Un-click Interested on Discord and you're removed again (and any seat you held is freed).",
      "Pilots who haven't logged into the Fleetplanner yet show up by their Discord name and are counted separately as \"unknown to the system\"; logging in once with Discord links them up.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Share events with partner Discords",
    changes: [
      "Partner & public operations can now be cross-posted to your partner Discords as their own scheduled event (linking back to the operation page).",
      "On the Partnerships page you can turn on \"Auto-share\" per partner — their operations then appear in your Discord automatically.",
      "For partners without auto-share, every fleetoperator of the receiving Discord gets a \"Shared with us\" inbox on the Partnerships page (and a Discord DM with Teilen/Ablehnen buttons) to approve or decline each event.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Attach screenshots to feedback",
    changes: [
      "The Feedback form now lets you attach screenshots (up to 4 images, max 8 MB each) — they're sent straight to the team along with your message.",
    ],
  },
  {
    date: "2026-06-07",
    title: "\"Was ist das?\" beginner page",
    changes: [
      "New \"Was ist das?\" tab: a plain-language, non-technical intro to what the Fleetmanager is and how an operation works — for newcomers.",
    ],
  },
  {
    date: "2026-06-07",
    title: "Roadmap page",
    changes: [
      "New Roadmap tab shows what's planned, blocked and already shipped.",
    ],
  },
  {
    date: "2026-06-06",
    title: "Mission cover editor fixes",
    changes: [
      "Your edits now persist: reopening the cover editor loads your last saved cover (positions, texts, background and logo) instead of starting over.",
      "Switching the style preset now keeps all your inputs and only changes the look (colors, fonts, effects) — it no longer wipes your texts and placements.",
      "Fixed: clicking \"Abbrechen\" in the editor now returns to the cover page instead of showing an error.",
      "The bottom save bar no longer covers the editor.",
      "After saving, the editor shows a clear \"Zurück zum Fleetmanager\" button.",
    ],
  },
  {
    date: "2026-06-06",
    title: "Recurring events",
    changes: [
      "Operations can now repeat: pick \"Repeat\" in the create wizard (weekly, every 2 weeks, monthly on the same weekday, or yearly) — the pattern follows your start date.",
      "Each occurrence is created as its own operation with its own roster and voice; the Discord event shows the native recurring badge.",
      "Optionally end the series after a number of occurrences or a date, and stop a running series anytime from the operation's Admin tab.",
    ],
  },
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
