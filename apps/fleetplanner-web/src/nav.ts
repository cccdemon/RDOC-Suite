// Sidebar navigation model (design README §71 — grouped rail).
// `gate` hides an item unless it matches the viewer's role perspective.
// `auth` hides an item entirely unless the viewer is logged in.
//
// IA 2026-08-21:
//  - "Neue Operation" is an ACTION (PRIMARY_ACTION), not a top-level entry.
//  - `match` lists extra path prefixes an item owns, so /ops/:id highlights
//    "Operationen" instead of nothing.
//  - `server: true` marks an item that only makes sense for ONE Discord server;
//    those links carry the active server context (`?guild=`).
//  - API docs left the primary nav and live in DEVELOPER_LINKS (sidebar foot).
export type Perspective = "crew" | "fleetoperator" | "superadmin";

/** What the viewer's memberships allow, independent of the global `User.role`. */
export type NavAccess = {
  /** member of at least one guild */
  anyGuild: boolean;
  /** fleet operator in at least one guild */
  managesGuild: boolean;
};

export const NO_ACCESS: NavAccess = { anyGuild: false, managesGuild: false };

export type NavItem = {
  to: string;
  labelKey: string;
  icon: string;
  gate?: Perspective;
  auth?: boolean;
  /** extra path prefixes this item owns for active-state matching */
  match?: string[];
  /** the item addresses the active Discord server (gets `?guild=`) */
  server?: boolean;
  /** hide unless the viewer is a member of any guild */
  needsGuild?: boolean;
  /** hide unless the viewer is a fleet operator somewhere */
  needsManagedGuild?: boolean;
};

export type NavGroup = {
  /** stable id — used for testids and for the server-picker slot */
  id: string;
  labelKey: string;
  items: NavItem[];
};

/** "Neue Operation" — an action, rendered above the groups, not inside them. */
export const PRIMARY_ACTION: NavItem = {
  to: "/ops/new",
  labelKey: "nav.opsNew",
  icon: "plus",
  auth: true,
};

export const NAV_GROUPS: NavGroup[] = [
  {
    id: "ops",
    labelKey: "nav.group.ops",
    items: [
      { to: "/operationen", labelKey: "nav.ops", icon: "board", match: ["/ops", "/calendar"] },
      { to: "/templates", labelKey: "nav.templates", icon: "doc" },
      { to: "/polls", labelKey: "nav.polls", icon: "check" },
      { to: "/ships", labelKey: "nav.ships", icon: "ship" },
    ],
  },
  {
    id: "server",
    labelKey: "nav.group.server",
    items: [
      { to: "/guilds", labelKey: "nav.servers", icon: "server", auth: true },
      { to: "/guilds/fleet", labelKey: "nav.orgFleet", icon: "ship", auth: true, server: true, needsGuild: true },
      { to: "/guilds/settings", labelKey: "nav.settings", icon: "wrench", auth: true, server: true, needsManagedGuild: true },
      { to: "/guilds/partnerships", labelKey: "nav.partnerships", icon: "link", auth: true, server: true, needsManagedGuild: true },
      { to: "/guilds/diagnostics", labelKey: "nav.diagnostics", icon: "refresh", auth: true, server: true, needsManagedGuild: true },
    ],
  },
  {
    id: "konto",
    labelKey: "nav.group.konto",
    items: [{ to: "/konto", labelKey: "nav.konto", icon: "users", auth: true, match: ["/profile", "/account"] }],
  },
  {
    id: "admin",
    labelKey: "nav.group.admin",
    items: [
      { to: "/admin", labelKey: "nav.admin", icon: "shield", gate: "superadmin" },
      { to: "/admin/system", labelKey: "nav.system", icon: "doc", gate: "superadmin" },
    ],
  },
  {
    id: "help",
    labelKey: "nav.group.help",
    items: [
      { to: "/start", labelKey: "nav.start", icon: "globe" },
      { to: "/handbuch", labelKey: "nav.handbuch", icon: "doc" },
      { to: "/sc-tools", labelKey: "nav.scTools", icon: "wrench" },
      { to: "/konto/feedback", labelKey: "nav.feedback", icon: "chat", auth: true },
    ],
  },
];

/** Secondary, developer-facing links. Sidebar foot — not primary navigation. */
export const DEVELOPER_LINKS: NavItem[] = [{ to: "/api-docs", labelKey: "nav.apiDocs", icon: "doc" }];

// An item is visible when (a) login-gated items only show to logged-in users,
// (b) role-gated items only show to the matching perspective, and (c)
// membership-gated items only show when the viewer actually has such a server.
// `perspective === null` means "not logged in".
export function isVisible(item: NavItem, perspective: Perspective | null, access: NavAccess = NO_ACCESS): boolean {
  if (item.auth && perspective === null) return false;
  if (item.gate && item.gate !== perspective) return false;
  if (item.needsGuild && !access.anyGuild && !access.managesGuild) return false;
  if (item.needsManagedGuild && !access.managesGuild) return false;
  return true;
}

/** Groups with their items filtered for the viewer; empty groups dropped. */
export function visibleGroups(perspective: Perspective | null, access: NavAccess = NO_ACCESS): NavGroup[] {
  const out: NavGroup[] = [];
  for (const g of NAV_GROUPS) {
    const items = g.items.filter((it) => isVisible(it, perspective, access));
    if (items.length > 0) out.push({ ...g, items });
  }
  return out;
}

/** Flat list, filtered for the viewer (used by tests and by link resolution). */
export function visibleItems(perspective: Perspective | null, access: NavAccess = NO_ACCESS): NavItem[] {
  return visibleGroups(perspective, access).flatMap((g) => g.items);
}

// The active nav item = the longest owned path that equals the current path or
// is a prefix of it. `match` prefixes count as owned, which is what pulls every
// /ops/* route under "Operationen" (goal 2). Longest-match keeps /guilds and
// /guilds/settings apart.
export function bestMatch(pathname: string): string {
  let best = "";
  let bestLen = 0;
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      for (const owned of [it.to, ...(it.match ?? [])]) {
        const hit = owned === "/" ? pathname === "/" : pathname === owned || pathname.startsWith(owned + "/");
        if (hit && owned.length > bestLen) {
          best = it.to;
          bestLen = owned.length;
        }
      }
    }
  }
  return best;
}

/** Href for a nav item, carrying the active server when the item is server-scoped. */
export function navHref(item: NavItem, activeGuildId: string | null): string {
  if (!item.server || !activeGuildId) return item.to;
  return `${item.to}?guild=${encodeURIComponent(activeGuildId)}`;
}
