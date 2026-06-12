import { Link, Navigate, useParams } from "react-router-dom";
import type { SessionResponse } from "../api/types";
import { ProfilePage } from "./ProfilePage";
import { AccountPage } from "./AccountPage";
import { FeedbackPage } from "./FeedbackPage";
import { Ic } from "../components/Icons";
import { MONO } from "../components/ui";

// IA merge C: Profil & Hangar + verknüpfte Logins + Feedback become tabs of one
// /konto screen. The existing page components stay the tab bodies (each keeps its
// own data fetch + anon guard); /konto only adds the unifying tab nav. Same
// endpoints (/account, /hangar, /feedback, /ships/search).
const TABS = [
  { key: "profil", label: "Profil & Hangar", icon: "users" },
  { key: "logins", label: "Verknüpfte Logins", icon: "lock" },
  { key: "feedback", label: "Feedback", icon: "chat" },
] as const;

export function KontoPage({ session }: { session: SessionResponse | null }) {
  const { tab } = useParams<{ tab: string }>();
  const active = TABS.find((t) => t.key === tab);
  if (!active) return <Navigate to="/konto/profil" replace />;

  const tabBase: React.CSSProperties = { display: "inline-flex", alignItems: "center", gap: 6, padding: "0.55rem 0.9rem", fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", cursor: "pointer", whiteSpace: "nowrap", borderBottom: "2px solid transparent", color: "var(--dim)", textDecoration: "none" };
  const tabActive: React.CSSProperties = { ...tabBase, color: "var(--cyan)", borderBottomColor: "var(--cyan)" };

  return (
    <div data-testid="konto-page">
      <div style={{ display: "flex", gap: "0.3rem", overflowX: "auto", borderBottom: "1px solid rgba(0,212,255,0.14)", marginBottom: "1.4rem" }}>
        {TABS.map((t) => (
          <Link key={t.key} to={`/konto/${t.key}`} data-testid={`konto-tab-${t.key}`} style={t.key === active.key ? tabActive : tabBase}>
            <Ic name={t.icon} size={14} sw={1.7} />{t.label}
          </Link>
        ))}
      </div>
      {active.key === "profil" && <ProfilePage session={session} />}
      {active.key === "logins" && <AccountPage session={session} />}
      {active.key === "feedback" && <FeedbackPage session={session} />}
    </div>
  );
}
