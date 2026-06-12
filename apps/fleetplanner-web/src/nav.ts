// Sidebar navigation model (design README §71 — grouped rail).
// `gate` hides an item unless it matches the viewer's role perspective.
export type Perspective = "crew" | "fleetoperator" | "superadmin";

export type NavItem = {
  to: string;
  label: string;
  icon: string;
  gate?: Perspective;
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
      { to: "/ops/new", label: "Neue Operation", icon: "plus" },
      { to: "/ships", label: "Schiffe", icon: "ship" },
      { to: "/templates", label: "Marktplatz", icon: "swap" },
    ],
  },
  {
    label: "Server / Discord",
    items: [
      { to: "/guilds", label: "Server", icon: "server" },
      { to: "/guilds/settings", label: "Einstellungen", icon: "wrench" },
      { to: "/guilds/diagnostics", label: "Diagnose", icon: "refresh" },
      { to: "/guilds/partnerships", label: "Partnerschaften", icon: "link" },
    ],
  },
  {
    label: "Nutzer / Konto",
    items: [
      { to: "/profile", label: "Profil & Flotte", icon: "users" },
      { to: "/account", label: "Verknüpfte Logins", icon: "lock" },
      { to: "/feedback", label: "Feedback", icon: "chat" },
    ],
  },
  {
    label: "Admin / System",
    items: [
      { to: "/admin", label: "Admin-Konsole", icon: "shield", gate: "superadmin" },
      { to: "/api-docs", label: "API-Doku", icon: "doc" },
    ],
  },
  {
    label: "Info / Rechtliches",
    items: [
      { to: "/was-ist", label: "Was ist das?", icon: "eye" },
      { to: "/how-to", label: "Anleitung", icon: "doc" },
      { to: "/roadmap", label: "Roadmap", icon: "board" },
      { to: "/changelog", label: "Changelog", icon: "doc" },
      { to: "/sc-tools", label: "SC-Tools", icon: "wrench" },
      { to: "/license", label: "Lizenz", icon: "doc" },
      { to: "/impressum", label: "Impressum", icon: "doc" },
      { to: "/privacy", label: "Datenschutz", icon: "lock" },
      { to: "/why-unsigned", label: "Unsignierte Binary", icon: "alert" },
    ],
  },
];

// Flat list (mobile <select>), gate-filtered for the viewer.
export function visibleItems(perspective: Perspective | null): NavItem[] {
  const out: NavItem[] = [];
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      if (!it.gate || it.gate === perspective) out.push(it);
    }
  }
  return out;
}
