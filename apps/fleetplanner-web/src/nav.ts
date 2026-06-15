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
      { to: "/", label: "Operationen", icon: "board" },
      { to: "/ops/new", label: "Neue Operation", icon: "plus", auth: true },
      { to: "/polls", label: "Umfragen", icon: "check" },
      { to: "/ships", label: "Schiffe", icon: "ship" },
      // IA merge F: templates live in the op-editor ("Aus Vorlage starten" in the
      // wizard + "Als Vorlage sichern" in the Admin tab) — no top-level marketplace.
    ],
  },
  {
    label: "Server / Discord",
    items: [
      { to: "/guilds", label: "Server", icon: "server", auth: true },
      { to: "/guilds/fleet", label: "Org-Flotte", icon: "ship", auth: true },
      { to: "/guilds/settings", label: "Einstellungen", icon: "wrench", auth: true },
      { to: "/guilds/diagnostics", label: "Diagnose", icon: "refresh", auth: true },
      { to: "/guilds/partnerships", label: "Partnerschaften", icon: "link", auth: true },
    ],
  },
  {
    // IA merge C: Profil & Hangar + Logins + Feedback are tabs of one Konto screen.
    label: "Konto",
    items: [
      { to: "/konto", label: "Konto", icon: "users", auth: true },
    ],
  },
  {
    label: "Admin / System",
    items: [
      { to: "/admin", label: "Admin-Konsole", icon: "shield", gate: "superadmin" },
      { to: "/admin/system", label: "System & Logs", icon: "doc", gate: "superadmin" },
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
