// Sidebar navigation model (design README §71 — grouped rail).
// `gate` hides an item unless it matches the viewer's role perspective.
// `auth` hides an item entirely unless the viewer is logged in.
export type Perspective = "crew" | "fleetoperator" | "superadmin";

export type NavItem = {
  to: string;
  label: string;
  icon: string;
  gate?: Perspective;
  auth?: boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Operationen",
    items: [
      { to: "/", label: "Übersicht", icon: "board" },
      { to: "/calendar", label: "Kalender", icon: "cal" },
      { to: "/ops/new", label: "Neue Operation", icon: "plus", auth: true },
      { to: "/ships", label: "Schiffe", icon: "ship" },
      { to: "/templates", label: "Marktplatz", icon: "swap", auth: true },
    ],
  },
  {
    label: "Server / Discord",
    items: [
      { to: "/guilds", label: "Server", icon: "server", auth: true },
      { to: "/guilds/settings", label: "Einstellungen", icon: "wrench", auth: true },
      { to: "/guilds/diagnostics", label: "Diagnose", icon: "refresh", auth: true },
      { to: "/guilds/partnerships", label: "Partnerschaften", icon: "link", auth: true },
    ],
  },
  {
    label: "Nutzer / Konto",
    items: [
      { to: "/profile", label: "Profil & Flotte", icon: "users", auth: true },
      { to: "/account", label: "Verknüpfte Logins", icon: "lock", auth: true },
      { to: "/feedback", label: "Feedback", icon: "chat", auth: true },
    ],
  },
  {
    label: "Admin / System",
    items: [
      { to: "/admin", label: "Admin-Konsole", icon: "shield", gate: "superadmin" },
    ],
  },
  {
    // IA merge B: the 6 help docs are now sections of the Handbuch hub; the 3 legal
    // pages moved to a footer-level Rechtliches page (out of the primary nav).
    label: "Info",
    items: [
      { to: "/handbuch", label: "Handbuch", icon: "doc" },
      { to: "/api-docs", label: "API-Doku", icon: "doc" },
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
