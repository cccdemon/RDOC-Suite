// Sidebar navigation model (design README §71 — grouped rail).
// `gate` hides an item unless it matches the viewer's role perspective.
// `auth` hides an item entirely unless the viewer is logged in.
export type Perspective = "crew" | "fleetoperator" | "superadmin";

export type NavItem = {
  to: string;
  labelKey: string;
  icon: string;
  gate?: Perspective;
  auth?: boolean;
};

export type NavGroup = {
  labelKey: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    labelKey: "nav.group.ops",
    items: [
      { to: "/", labelKey: "nav.ops", icon: "board" },
      { to: "/ops/new", labelKey: "nav.opsNew", icon: "plus", auth: true },
      { to: "/polls", labelKey: "nav.polls", icon: "check" },
      { to: "/ships", labelKey: "nav.ships", icon: "ship" },
    ],
  },
  {
    labelKey: "nav.group.server",
    items: [
      { to: "/guilds", labelKey: "nav.servers", icon: "server", auth: true },
      { to: "/guilds/fleet", labelKey: "nav.orgFleet", icon: "ship", auth: true },
      { to: "/guilds/settings", labelKey: "nav.settings", icon: "wrench", auth: true },
      { to: "/guilds/diagnostics", labelKey: "nav.diagnostics", icon: "refresh", auth: true },
      { to: "/guilds/partnerships", labelKey: "nav.partnerships", icon: "link", auth: true },
    ],
  },
  {
    labelKey: "nav.group.konto",
    items: [
      { to: "/konto", labelKey: "nav.konto", icon: "users", auth: true },
    ],
  },
  {
    labelKey: "nav.group.admin",
    items: [
      { to: "/admin", labelKey: "nav.admin", icon: "shield", gate: "superadmin" },
      { to: "/admin/system", labelKey: "nav.system", icon: "doc", gate: "superadmin" },
    ],
  },
  {
    labelKey: "nav.group.info",
    items: [
      { to: "/handbuch", labelKey: "nav.handbuch", icon: "doc" },
      { to: "/api-docs", labelKey: "nav.apiDocs", icon: "doc" },
    ],
  },
];

// An item is visible when (a) login-gated items only show to logged-in users, and
// (b) role-gated items only show to the matching perspective. `perspective === null`
// means "not logged in".
export function isVisible(item: NavItem, perspective: Perspective | null): boolean {
  if (item.auth && perspective === null) return false;
  if (item.gate && item.gate !== perspective) return false;
  return true;
}

// Flat list (mobile <select>), filtered for the viewer.
export function visibleItems(perspective: Perspective | null): NavItem[] {
  const out: NavItem[] = [];
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (isVisible(it, perspective)) out.push(it);
    }
  }
  return out;
}
