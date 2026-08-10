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

/**
 * The current release marker = the newest entry's date. The "what's new" popup
 * shows entries newer than what a user last acknowledged, and ack stores this value.
 * (Caveat: two releases on the same date share a marker — acceptable; releases are dated.)
 */
export function latestChangelogVersion(): string {
  return CHANGELOG[0]?.date ?? "";
}

/**
 * Entries a user with `lastSeen` acknowledgement has NOT seen yet.
 *  - lastSeen === latest → [] (up to date)
 *  - lastSeen null       → the newest release only (never dump full history on a new user)
 *  - otherwise           → every entry dated after lastSeen
 */
export function unseenChangelog(lastSeen: string | null): ChangelogEntry[] {
  const latest = latestChangelogVersion();
  if (!latest) return [];
  if (!lastSeen) return CHANGELOG.filter((e) => e.date === latest);
  return CHANGELOG.filter((e) => e.date > lastSeen);
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    date: "2026-08-15",
    title: "SquadLink is now Subraum",
    changes: [
      "The voice app is called Subraum now (subraum.cc). Everywhere the Fleetplanner named it, it says Subraum.",
      "The join link and the voice panel work exactly as before — only the name changed.",
    ],
  },
  {
    date: "2026-08-14",
    title: "Show your org on the start page",
    changes: [
      "The start page can now list the orgs that fly with the Fleetplanner, with a link to their Discord.",
      "Your org appears only if you want it to: tick \"Auf der Startseite zeigen\" in the server settings. You need a Discord invite link there first, and you can untick it at any time.",
      "Nothing else is shown — the org name, the server icon and the invite link you set yourself.",
    ],
  },
  {
    date: "2026-08-13",
    title: "The start page now matches the tool",
    changes: [
      "The start page claimed radio relay bots carried a second voice net into your Discord channels. That has not been true for a while — the text is gone.",
      "Voice is one thing now: for a running operation the commanders get a join link into the operation's voice room, and the talking happens in Subraum (subraum.cc).",
      "Three things the tool has always done were missing from the page: templates, stream links and ground teams with mission Q&A.",
    ],
  },
  {
    date: "2026-08-12",
    title: "How the Fleetplanner is built",
    changes: [
      "The handbook has a new section: Software architecture. It shows the building blocks, the data model and what happens when you publish an operation.",
      "It answers the questions people ask most: where the data lives, what Discord sees, and why an operation still opens when Discord does not answer.",
    ],
  },
  {
    date: "2026-08-11",
    title: "Two fixes",
    changes: [
      "Links to the operation list keep their view again. A link like the list view no longer drops you into the default view when you are signed in.",
      "Accepting a partner invite from a server you were partnered with before now gives a clear message instead of an error page.",
    ],
  },
  {
    date: "2026-08-10",
    title: "A real start page",
    changes: [
      "The Fleetplanner now has a start page. It explains what the tool does, lists the functions and shows the three steps from a Discord server to a flown operation.",
      "Visitors who are not signed in land there. Members go straight to their operations as before.",
      "The operation list has its own address now. You reach it from the nav at any time, signed in or not.",
      "Shared links show a proper title, description and preview image.",
    ],
  },
  {
    date: "2026-08-09",
    title: "Recurring events are visible again",
    changes: [
      "An operation that belongs to a recurring series now says so: a SERIE badge on the card and a panel on the detail page showing the pattern and the next dates.",
      "Dates that already exist as an operation link straight to them; the later ones are marked as not created yet, so you can see the rhythm without waiting.",
      "The next date is created as a real, joinable operation 21 days ahead instead of 7 — a fortnightly series now always has its follow-up ready.",
    ],
  },
  {
    date: "2026-08-08",
    title: "New look",
    changes: [
      "Fleetplanner now wears the official RDOC colours and typefaces. The neon blue is gone — the interface is quieter, and the one warm copper accent per screen points at the action that matters.",
      "Headlines are set in the RDOC display face, and the RDOC mark now sits at the top of the sidebar.",
      "Text should be easier to read: new headline and body typefaces, loaded from our own server instead of Google's, so nothing about your visit leaves the site.",
      "A teal second accent carries structure — section heads, table headers, board lanes — so those no longer compete with the copper action colour.",
      "Light Mode is a real light theme now instead of an inverted screen: logos, avatars and mission covers stay the right way round, and every colour was picked for a light background.",
      "The last pages on the old palette (maintenance notice, legal texts, error pages) have followed.",
      "The manufacturer themes are still there in the footer if you want them.",
    ],
  },
  {
    date: "2026-08-07",
    title: "Import your fleet from Fleetyards",
    changes: [
      "You can now pull your ships straight from Fleetyards.net — enter your Fleetyards username on your profile and hit import. Your hangar there has to be set to public.",
      "The username is remembered, so re-syncing after you buy a ship is one click.",
      "Loaner ships come across too and are marked as LEIHSCHIFF, so you can tell them apart from what you actually own.",
      "The import only adds — ships you added by hand are never removed.",
    ],
  },
  {
    date: "2026-07-22",
    title: "Attach a YouTube video and PDFs to an event",
    changes: [
      "When you create an operation you can now attach a YouTube video and upload PDF documents (briefing, rules of engagement, maps). They appear on the operation page for everyone who can see the op.",
      "Operators can also add or remove documents later, straight from the operation page. Up to 5 PDFs, 8 MB each.",
      "Fixed: operators can now remove a person from a CQB team again — each soldier row has a remove button.",
    ],
  },
  {
    date: "2026-07-22",
    title: "Choose which partner Discords get your event",
    changes: [
      "When you create a partner or public operation, you now pick exactly which partner Discords the event is posted to. Nothing is selected by default, so an event is never posted to a partner server you didn't choose.",
      "Leave everything unticked and the operation stays on your own server — no partner cross-posting at all.",
      "The operation board now updates on its own: changes to needs, roles and the roster show up right away, and edits made by another operator appear within seconds — no more reloading the page.",
      "After each update you'll get a short \"what's new\" note like this one, once per release — so you never miss a change.",
      "CQB teams can now be up to 20 soldiers (was 8); the default is still 4.",
      "Fixed: a mission cover made in the cover editor now actually shows up on the operation (and on the Discord event) — saves were being silently rejected.",
      "Smaller fixes: the operation board dropdowns no longer spill over the card edge on smaller screens, and the late-arrival button now reads \"Verspätung eintragen\" so it's clearly an action.",
    ],
  },
  {
    date: "2026-07-20",
    title: "Squadrons, ground troops and captains",
    changes: [
      "Squadrons and ground troops can be grouped under a larger formation — \"Squadron 1 and Squadron 2 form a wing\".",
      "The first place in a troop or squadron is always the Captain, and it is marked on the roster. Your fleet operator can hand the role to someone else; the two simply swap places.",
      "Ground troops are shown as a tile with real places. Ask for 2 troops of 4 and you get two tiles with four slots, free ones marked FREE.",
      "Fighters can be carried by a ship, the same way ground vehicles already could.",
      "For operations shared with partner Discords, the fleet operator can assign members of those orgs too. As always, only people who have signed in at least once can be assigned.",
    ],
  },
  {
    date: "2026-07-20",
    title: "See where you were placed",
    changes: [
      "Every ship, vehicle and fighter on the board shows the squadron or formation it belongs to — until now only the fleet operator could see that.",
      "\"Your status\" spells out where you ended up: your formation, the ship carrying you, your place in a ground troop and whether you are its Captain.",
      "Anything loaded into a ship says which ship it rides in, and the carrying ship lists what it has aboard.",
      "New mission log on the operation page records every roster change, so you can see when you were placed or moved. Visitors who are not signed in do not see it.",
    ],
  },
  {
    date: "2026-07-20",
    title: "You decide what your ship is here for",
    changes: [
      "When you offer a ship you say what it is here to do — fighter, transport, support, mining, salvage, exploration or capital. The ship catalogue only makes the suggestion.",
      "This settles the hybrids. The catalogue calls the Cutlass Black a \"Light Freight / Medium Fighter\", so it used to land among the fighters whether you brought it as one or not.",
      "Fleet operators can change the role of any ship on the board. It moves to the matching group and the change is recorded in the mission log.",
      "Ship classification was overhauled: freighters and industrial ships used to fall into no category at all and never matched a transport or mining need. Bombers and interceptors now count as fighters.",
    ],
  },
  {
    date: "2026-07-20",
    title: "Fixes",
    changes: [
      "Signing up as \"place me anywhere\" now reaches your fleet operator's flexible list, so you actually get assigned.",
      "Fighters that were assigned to a squadron no longer appear as having none.",
      "CQB teams can be requested from the CQB tab, where they are managed — the setting was only on the fleet tab.",
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
