import { Link, useLocation, useNavigate } from "react-router-dom";
import { logout } from "../api/client";
import type { SessionResponse } from "../api/types";
import { NAV_GROUPS, isVisible, visibleItems, type NavItem, type Perspective } from "../nav";
import { THEMES, type Theme } from "../theme";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";

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
  const t = useT();
  return (
    <div className="theme-pick">
      <span className="theme-dot" style={{ color: theme.dot, background: theme.dot }} />
      <select
        className="select"
        data-testid="theme-select"
        value={theme.id}
        onChange={(e) => setThemeId(e.target.value)}
        aria-label={t("sidebar.themeAria")}
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
  const t = useT();
  const user = session?.user ?? null;
  if (!user) {
    return (
      <Link to="/login" className="foot-user" style={{ textDecoration: "none" }} data-testid="login-link">
        <Avatar name={t("sidebar.guest")} size={26} />
        <span className="uname">{t("common.login")}</span>
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
        title={t("common.logout")}
        aria-label={t("common.logout")}
        onClick={() => void logout()}
        style={{ border: "1px solid var(--border)", background: "transparent", borderRadius: 7, padding: "0.35rem", cursor: "pointer", flexShrink: 0, color: "var(--dim)" }}
      >
        <Ic name="back" size={15} sw={1.7} />
      </button>
    </div>
  );
}

// The horizontal RDOC lockup, inlined from
// RDOC-Brandkit/brandkit/digital/web/logo-inline.html: the letters follow
// `currentColor` so the mark works in both themes, the ring keeps Copper.
//
// The lockup carries the signet in place of the O — that is the one place it
// appears (§2). No second signet may sit next to it, which is also why
// "FLEETPLANNER" below is set in type only: brandkit §14 leads project names
// typographically and forbids combining them with the mark.
function Lockup({ width = 148 }: { width?: number }) {
  return (
    <svg viewBox="0 -10 1020 220" width={width} fill="none" role="img" aria-label="RDOC">
      <g fill="currentColor" stroke="currentColor" strokeWidth="140" strokeLinejoin="round" transform="translate(0 200) scale(0.122 -0.122)">
        <path d="M185 0V1488H1386Q1662 1488 1768 1400Q1874 1312 1874 1074V953Q1874 805 1809 743Q1744 681 1595 663Q1855 621 1855 375V0H1667V329Q1667 480 1603 534Q1539 589 1362 589H386V0ZM386 753H1346Q1506 753 1589 798Q1673 843 1673 971V1103Q1673 1237 1593 1280Q1514 1324 1316 1324H386Z" />
        <path transform="translate(2100)" d="M185 0V1488H1388Q1757 1488 1887 1335Q2018 1182 2018 744Q2018 310 1879 155Q1741 0 1381 0ZM386 164H1409Q1649 164 1733 281Q1817 399 1817 662V812Q1817 1104 1736 1214Q1655 1324 1442 1324H386Z" />
        <path transform="translate(6266)" d="M1754 496H1942V386Q1942 166 1829 75Q1717 -16 1447 -16H691Q403 -16 280 110Q157 237 157 524V964Q157 1251 281 1377Q405 1504 691 1504H1448Q1910 1504 1910 1138V1008H1734V1074Q1734 1223 1662 1281Q1590 1340 1411 1340H707Q518 1340 438 1263Q358 1187 358 1019V471Q358 311 435 229Q512 148 707 148H1410Q1606 148 1680 203Q1754 258 1754 398Z" />
      </g>
      <g transform="translate(537.5 -10)">
        <g transform="translate(-66 -66) scale(0.34375)">
          <path
            fill="var(--accent)"
            d="M523.168,192.195 A320 320 0 0 1 784.845,344.8 L682.528,407.5 A200 200 0 0 0 518.98,312.122 Z M795.843,364.24 A320 320 0 0 1 799.614,652.279 L691.759,599.674 A200 200 0 0 0 689.402,419.65 Z M789.128,672 A320 320 0 0 1 657.277,797.122 L602.798,690.201 A200 200 0 0 0 685.205,612 Z M444.124,680 L579.876,680 L631.874,808.699 A320 320 0 0 1 586.703,823.158 L575.497,776.485 A272 272 0 0 0 589.252,772.799 L573.612,720 L450.388,720 L434.748,772.799 A272 272 0 0 0 448.503,776.485 L437.297,823.158 A320 320 0 0 1 392.126,808.699 Z M366.723,797.122 A320 320 0 0 1 234.872,672 L338.795,612 A200 200 0 0 0 421.202,690.201 Z M224.386,652.279 A320 320 0 0 1 228.157,364.24 L334.598,419.65 A200 200 0 0 0 332.241,599.674 Z M239.155,344.8 A320 320 0 0 1 500.832,192.195 L505.02,312.122 A200 200 0 0 0 341.472,407.5 Z"
          />
        </g>
      </g>
    </svg>
  );
}

function Brand() {
  return (
    <Link to="/" className="sidebar-brand" aria-label="RDOC Fleetplanner">
      <span className="brand-lockup"><Lockup /></span>
      <span className="brand-sub">FLEETPLANNER</span>
    </Link>
  );
}

export function Sidebar({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const t = useT();
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
            <div className="nav-group" key={g.labelKey}>
              <div className="nav-group-label">{t(g.labelKey)}</div>
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
          {t("sidebar.legal")}
        </Link>
        <UserChip session={session} />
      </div>
    </aside>
  );
}

function NavLinkItem({ item, active }: { item: NavItem; active: boolean }) {
  const t = useT();
  return (
    <Link to={item.to} className={`nav-item${active ? " is-active" : ""}`} data-testid={`nav-${item.to}`}>
      <span className="nav-icon"><Ic name={item.icon} size={15} sw={1.6} /></span>
      <span className="nav-label">{t(item.labelKey)}</span>
    </Link>
  );
}

// Shown < 880px instead of the sidebar: brand + theme + avatar, plus a full-width
// screen <select> to jump between top-level views.
export function MobileNav({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const t = useT();
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
        aria-label={t("sidebar.screenAria")}
      >
        {!current && <option value="">{t("sidebar.viewPlaceholder")}</option>}
        {items.map((it) => (
          <option key={it.to} value={it.to}>{t(it.labelKey)}</option>
        ))}
      </select>
    </>
  );
}
