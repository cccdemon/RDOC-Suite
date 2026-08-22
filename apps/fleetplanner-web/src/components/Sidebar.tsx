import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { logout } from "../api/client";
import type { SessionResponse } from "../api/types";
import {
  DEVELOPER_LINKS,
  PRIMARY_ACTION,
  bestMatch,
  isVisible,
  navHref,
  visibleGroups,
  type NavItem,
  type Perspective,
} from "../nav";
import { useServerContext } from "../serverContext";
import { THEMES, type Theme } from "../theme";
import { Ic } from "./Icons";
import { Avatar } from "./Avatar";
import { useT } from "../i18n";

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


// ── One nav model, two shells ────────────────────────────────────────────────
// Desktop rail and mobile drawer render the SAME groups through the SAME gates
// (IA goal 3). The only difference is the wrapper and the testid prefix.

function NavLinkItem({
  item,
  active,
  href,
  prefix,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  href: string;
  prefix: string;
  onNavigate?: () => void;
}) {
  const t = useT();
  return (
    <Link
      to={href}
      onClick={onNavigate}
      className={`nav-item${active ? " is-active" : ""}`}
      aria-current={active ? "page" : undefined}
      data-testid={`${prefix}${item.to}`}
    >
      <span className="nav-icon"><Ic name={item.icon} size={15} sw={1.6} /></span>
      <span className="nav-label">{t(item.labelKey)}</span>
    </Link>
  );
}

// The active server, right above the screens that belong to it — so "Org-Flotte"
// and "Server-Einstellungen" are never ambiguous about *which* server (goal 4).
function ServerPicker({ prefix }: { prefix: string }) {
  const t = useT();
  const { memberships, activeGuildId, setActiveGuildId } = useServerContext();
  if (memberships.length === 0) return null;
  return (
    <select
      className="select nav-server-picker"
      data-testid={`${prefix}server-picker`}
      value={activeGuildId ?? ""}
      onChange={(e) => setActiveGuildId(e.target.value)}
      aria-label={t("nav.serverContextAria")}
    >
      {memberships.map((m) => (
        <option key={m.guildId} value={m.guildId}>{m.guildName}</option>
      ))}
    </select>
  );
}

function NavTree({
  session,
  prefix,
  onNavigate,
}: {
  session: SessionResponse | null;
  prefix: string;
  onNavigate?: () => void;
}) {
  const t = useT();
  const { pathname } = useLocation();
  const { access, activeGuildId } = useServerContext();
  const perspective = perspectiveOf(session);
  const best = bestMatch(pathname);
  const groups = visibleGroups(perspective, access);

  return (
    <>
      {isVisible(PRIMARY_ACTION, perspective, access) && (
        <div className="nav-action">
          <Link
            to={PRIMARY_ACTION.to}
            onClick={onNavigate}
            className="nav-item nav-item-action"
            data-testid={`${prefix}${PRIMARY_ACTION.to}`}
          >
            <span className="nav-icon"><Ic name={PRIMARY_ACTION.icon} size={15} sw={1.9} /></span>
            <span className="nav-label">{t(PRIMARY_ACTION.labelKey)}</span>
          </Link>
        </div>
      )}
      {groups.map((g) => (
        <div className="nav-group" key={g.id} data-testid={`${prefix}group-${g.id}`}>
          <div className="nav-group-label">{t(g.labelKey)}</div>
          {g.id === "server" && <ServerPicker prefix={prefix} />}
          {g.items.map((it) => (
            <NavLinkItem
              key={it.to}
              item={it}
              href={navHref(it, activeGuildId)}
              active={it.to === best}
              prefix={prefix}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      ))}
    </>
  );
}

// Developer surface — API docs left the primary navigation (IA goal 6).
function DeveloperLinks({ prefix, onNavigate }: { prefix: string; onNavigate?: () => void }) {
  const t = useT();
  return (
    <div className="nav-dev" data-testid={`${prefix}developer`}>
      {DEVELOPER_LINKS.map((it) => (
        <Link
          key={it.to}
          to={it.to}
          onClick={onNavigate}
          data-testid={`${prefix}${it.to}`}
          className="nav-dev-link"
        >
          {t(it.labelKey)}
        </Link>
      ))}
    </div>
  );
}

export function Sidebar({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const t = useT();
  return (
    <aside className="sidebar">
      <Brand />
      <nav className="sidebar-nav" data-testid="sidebar-nav">
        <NavTree session={session} prefix="nav-" />
      </nav>
      <div className="sidebar-foot">
        <ThemePicker theme={theme} setThemeId={setThemeId} />
        <div className="nav-foot-links">
          <DeveloperLinks prefix="nav-" />
          <Link to="/rechtliches" data-testid="footer-legal" className="nav-dev-link">
            {t("sidebar.legal")}
          </Link>
        </div>
        <UserChip session={session} />
      </div>
    </aside>
  );
}

// Shown < 880px instead of the sidebar. The old flat <select> could not express
// groups, gates or the server context, so it is gone: this is the same tree in a
// drawer (IA goal 3).
export function MobileNav({ session, theme, setThemeId }: { session: SessionResponse | null; theme: Theme; setThemeId: (id: string) => void }) {
  const t = useT();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);

  // Navigating always closes the drawer — including via browser back.
  useEffect(() => { setOpen(false); }, [pathname]);

  return (
    <>
      <div className="mobile-head">
        <button
          type="button"
          className="nav-icon mobile-nav-toggle"
          data-testid="mobile-nav-toggle"
          aria-expanded={open}
          aria-controls="mobile-nav-drawer"
          aria-label={t("sidebar.menuAria")}
          onClick={() => setOpen((v) => !v)}
        >
          <Ic name={open ? "back" : "board"} size={16} sw={1.7} />
        </button>
        <Brand />
        <span style={{ flex: 1 }} />
        <ThemePicker theme={theme} setThemeId={setThemeId} />
        <UserChip session={session} />
      </div>
      {open && (
        <nav id="mobile-nav-drawer" className="mobile-drawer" data-testid="mobile-nav-drawer">
          <NavTree session={session} prefix="mnav-" onNavigate={() => setOpen(false)} />
          <div className="nav-foot-links">
            <DeveloperLinks prefix="mnav-" onNavigate={() => setOpen(false)} />
            <Link to="/rechtliches" data-testid="mnav-legal" className="nav-dev-link" onClick={() => setOpen(false)}>
              {t("sidebar.legal")}
            </Link>
          </div>
        </nav>
      )}
    </>
  );
}
