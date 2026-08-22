import { Navigate, useParams } from "react-router-dom";
import type { SessionResponse } from "../api/types";
import { ProfilePage } from "./ProfilePage";
import { AccountPage } from "./AccountPage";
import { FeedbackPage } from "./FeedbackPage";
import { PreferencesPanel } from "../components/PreferencesPanel";
import { LinkTabs } from "../components/ui";
import { Breadcrumbs } from "../components/Breadcrumbs";

// IA merge C: Profil & Hangar + verknüpfte Logins + Feedback become tabs of one
// /konto screen. The existing page components stay the tab bodies (each keeps its
// own data fetch + anon guard); /konto only adds the unifying tab nav. Plus a
// Preferences tab (FR-B8: language). Same endpoints (/account, /hangar, /feedback).
const TABS = [
  { key: "profil", label: "Profil & Hangar", icon: "users" },
  { key: "logins", label: "Verknüpfte Logins", icon: "lock" },
  { key: "prefs", label: "Einstellungen", icon: "wrench" },
  { key: "feedback", label: "Feedback", icon: "chat" },
] as const;

export function KontoPage({ session }: { session: SessionResponse | null }) {
  const { tab } = useParams<{ tab: string }>();
  const active = TABS.find((t) => t.key === tab);
  if (!active) return <Navigate to="/konto/profil" replace />;

  return (
    <div data-testid="konto-page">
      <Breadcrumbs items={[{ label: "Konto", to: "/konto" }, { label: active.label }]} />
      <LinkTabs
        ariaLabel="Kontobereiche"
        panelId="konto-panel"
        activeKey={active.key}
        testid={(k) => `konto-tab-${k}`}
        items={TABS.map((t) => ({ key: t.key, label: t.label, to: `/konto/${t.key}`, icon: t.icon }))}
      />
      <div role="tabpanel" id="konto-panel" aria-labelledby={`konto-panel-tab-${active.key}`} tabIndex={-1}>
        {active.key === "profil" && <ProfilePage session={session} />}
        {active.key === "logins" && <AccountPage session={session} />}
        {active.key === "prefs" && <PreferencesPanel session={session} />}
        {active.key === "feedback" && <FeedbackPage session={session} />}
      </div>
    </div>
  );
}
