// English — the KEY BASE. Every translation key MUST exist here; other locales
// fall back to this dictionary per-key. See ../index.ts. Proper names / SC terms
// (ship names, "Command Net", "Global Radio Net", "Impressum", "RDOC") stay
// untranslated everywhere — do not add keys for them.
export const en: Record<string, string> = {
  // Nav
  "nav.operations": "Operations",
  "nav.servers": "Servers",
  "nav.feedback": "Feedback",
  "nav.admin": "Admin",
  "nav.changelog": "Changelog",
  "nav.whatIsThis": "What is this?",
  "nav.howTo": "How to",
  "nav.unsignedBinary": "Unsigned Binary",
  "nav.roadmap": "Roadmap",
  "nav.scTools": "SC Tools",
  "nav.profileTitle": "Profile",
  "nav.logout": "Logout",
  "nav.login": "Login",

  // Beta banner
  "beta.body": "Beta — RDOC Fleetplanner is still under active development. Spotted a bug or have an idea? Let us know on the {link}.",
  "beta.linkText": "feedback tab",

  // Footer
  "footer.testedBy": "Tested by:",
  "footer.impressum": "Impressum",
  "footer.privacy": "Privacy",
  "footer.license": "License",

  // Profile — language switch
  "profile.language.title": "Language",
  "profile.language.help": "Your interface language across Fleetplanner, the Companion app and mission covers.",
  "profile.language.save": "Save language",
  "profile.language.saved": "Language updated.",

  // Requirement categories
  "cat.fps": "FPS Squad",
  "cat.capital": "Capital Ship",
  "cat.subcapital": "Large / Subcapital Ship",
  "cat.fighter": "Fighter",
  "cat.support": "Support Ship",
  "cat.ground": "Ground / Vehicle",
  "cat.transport": "Transport Ship",
  "cat.mining": "Mining Ship",
  "cat.salvage": "Salvage Ship",
  "cat.exploration": "Exploration Ship",
  "cat.any": "Any Unit",

  // Operation status (rendered uppercased)
  "status.draft": "draft",
  "status.starting": "starting",
  "status.open": "open",
  "status.locked": "locked",
  "status.in_progress": "in progress",
  "status.completed": "completed",
  "status.cancelled": "cancelled",
  "status.pending": "pending",
  "status.accepted": "accepted",
  "status.rejected": "rejected",

  // Operation types (rendered uppercased)
  "optype.combat": "combat",
  "optype.pve": "pve",
  "optype.mining": "mining",
  "optype.salvage": "salvage",
  "optype.training": "training",
  "optype.mixed": "mixed",
  "optype.exploration": "exploration",
  "optype.transport": "transport",
  "optype.social": "social",

  // Visibility
  "vis.private": "private",
  "vis.partners": "partners",
  "vis.public": "public",
  "vis.aria": "Visibility",
  "vis.private.long": "Private (this Discord only)",
  "vis.partners.long": "Partners (this Discord + linked ones)",
  "vis.public.long": "Public (any logged-in user)",
  "vis.set": "Set visibility",

  // Logged-out op preview
  "oppreview.loginToView": "Log in to view this operation.",

  // Home / calendar
  "home.tabTitle": "Operations",
  "home.title": "FLEET OPERATIONS",
  "home.subtitle": "Star Citizen – RDOC operation calendar",
  "home.joined": "Joined",
  "home.waitlisted": "Waitlisted",
  "home.noOps": "No operations scheduled.",
  "home.createOne": "Create one?",
  "home.newOp": "New Operation",
  "home.newOpOn": "New Operation on…",
  "home.selectServerForOp": "Select server for new operation",
  "home.hidePast": "Hide Past",
  "home.showPast": "Show Past",
  "home.searchOps": "Search operations…",
  "home.anyStatus": "Any status",
  "home.anyType": "Any type",
  "home.mySignups": "My signups",
  "home.unitsAccepted": "{accepted}/{total} units accepted",
  "home.unitsCount": "{accepted}/{total} units",
};
