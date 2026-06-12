import { Link, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../api/client";
import type { SessionResponse } from "../api/types";
import { NAV_GROUPS, isVisible, visibleItems, type NavItem, type Perspective } from "../nav";
import { THEMES, type Theme } from "../theme";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";

// The active nav item = the longest `to` that equals the path or is a path
// prefix. This keeps deep routes like /handbuch/roadmap highlighting "Handbuch"
// without also lighting up shorter siblings (e.g. /guilds vs /guilds/settings).
function bestMatch(pathname: string): string {
  let best = "";
  for (const g of NAV_GROUPS) {
    for (const it of g.items) {
      const hit = it.to === "/" ? pathname === "/" : pathname === it.to || pathname.startsWith(it.to + "/");
      if (hit && it.to.length > best.length) best = it.to;
    }
  }
  return best;
}

function perspectiveOf(session: SessionResponse | null): Perspective | null {
  const r = session?.user?.role;
  return r === "superadmin" || r === "fleetoperator" || r === "crew" ? r : null;
}

function ThemePicker({ theme, setThemeId }: { theme: Theme; setThemeId: (id: string) => void }) {
  return (
    <div className="theme-pick">
      <span className="theme-dot" style={{ color: theme.dot, background: theme.dot }} />
      <select
        className="select"
        data-testid="theme-select"
        value={theme.id}
        onChange={(e) => setThemeId(e.target.value)}
        aria-label="Hersteller-Theme"
        style={{ fontSize: "0.72rem", padding: "0.4rem 0.5rem" }}
      >
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>{t.label}</option>
        ))}
      </select>
    </div>
  );
}

function UserChip({ session }: { session: SessionResponse | null }) {
  const user = session?.user ?? null;
  if (!user) {
    return (
      <Link to="/login" className="foot-user" style={{ textDecoration: "none" }} data-testid="login-link">
        <Avatar name="Gast" size={26} />
        <span className="uname">Anmelden</span>
      </Link>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", minWidth: 0 }}>
      <Link to="/profile" className="foot-user" style={{ textDecoration: "none", flex: 1, minWidth: 0 }} data-testid="profile-link">
        <Avatar name={user.username} size={26} />
        <span className="uname" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.username}</span>
        <span className="urole">{user.role}</span>
      </Link>
      <button
        type="button"
        className="nav-icon"
        data-testid="logout-btn"
        title="Abmelden"
        aria-label="Abmelden"
        onClick={() => void logout()}
        style={{ border: "1px solid var(--border)", background: "transparent", borderRadius: 7, padding: "0.35rem", cursor: "pointer", flexShrink: 0, color: "var(--dim)" }}
      >
        <Ic name="back" size={15} sw={1.7} />
      </button>
    </div>
  );
}

function Brand() {
  return (
    <div className="sidebar-brand">
      <span className="icon-chip"><Ic name="shield" size={16} sw={1.7} /></span>
      <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.25 }}>
        <span className="brand-main">RDOC</span>
        <span className="brand-sub">FLEETPLANNER</span>
      </div>
    </div>
  );
}

export function Sidebar({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const { pathname } = useLocation();
  const perspective = perspectiveOf(session);
  const best = bestMatch(pathname);

  return (
    <aside className="sidebar">
      <Brand />
      <nav className="sidebar-nav">
        {NAV_GROUPS.map((g) => {
          const items = g.items.filter((it) => isVisible(it, perspective));
          if (items.length === 0) return null;
          return (
            <div className="nav-group" key={g.label}>
              <div className="nav-group-label">{g.label}</div>
              {items.map((it) => (
                <NavLinkItem key={it.to} item={it} active={it.to === best} />
              ))}
            </div>
          );
        })}
      </nav>
      <div className="sidebar-foot">
        <ThemePicker theme={theme} setThemeId={setThemeId} />
        <Link to="/rechtliches" data-testid="footer-legal" style={{ fontFamily: "var(--mono)", fontSize: "0.6rem", letterSpacing: "0.06em", color: "var(--dim2)", textDecoration: "none", padding: "0 0.25rem" }}>
          Rechtliches · Impressum · Datenschutz
        </Link>
        <UserChip session={session} />
      </div>
    </aside>
  );
}

function NavLinkItem({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link to={item.to} className={`nav-item${active ? " is-active" : ""}`} data-testid={`nav-${item.to}`}>
      <span className="nav-icon"><Ic name={item.icon} size={15} sw={1.6} /></span>
      <span className="nav-label">{item.label}</span>
    </Link>
  );
}

// Shown < 880px instead of the sidebar: brand + theme + avatar, plus a full-width
// screen <select> to jump between top-level views.
export function MobileNav({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const items = visibleItems(perspectiveOf(session));
  const best = bestMatch(pathname);
  const current = items.some((it) => it.to === best) ? best : "";

  return (
    <>
      <div className="mobile-head">
        <Brand />
        <span style={{ flex: 1 }} />
        <ThemePicker theme={theme} setThemeId={setThemeId} />
        <UserChip session={session} />
      </div>
      <select
        className="select mobile-screen-select"
        data-testid="mobile-screen-select"
        value={current}
        onChange={(e) => navigate(e.target.value)}
        aria-label="Screen wechseln"
      >
        {!current && <option value="">— Ansicht —</option>}
        {items.map((it) => (
          <option key={it.to} value={it.to}>{it.label}</option>
        ))}
      </select>
    </>
  );
}
