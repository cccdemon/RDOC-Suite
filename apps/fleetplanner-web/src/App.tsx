import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { useTheme } from "./theme";
import { Sidebar, MobileNav } from "./components/Sidebar";
import { ToastHost } from "./components/Toast";
import { OverviewPage } from "./pages/OverviewPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { EditOpPage } from "./pages/EditOpPage";
import { OpManagePage } from "./pages/OpManagePage";
import { CalendarPage } from "./pages/CalendarPage";
import { WizardPage } from "./pages/WizardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ShipsPage } from "./pages/ShipsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { RoadmapPage } from "./pages/RoadmapPage";
import { GuildSettingsPage } from "./pages/GuildSettingsPage";
import { PartnershipsPage } from "./pages/PartnershipsPage";
import { ServerListPage } from "./pages/ServerListPage";
import { AccountPage } from "./pages/AccountPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { DocPage } from "./pages/DocPage";
import { ApiDocsPage } from "./pages/ApiDocsPage";
import { ErrorState } from "./components/ErrorState";

// Legacy cover URL → the cover tab in Op-Management (the SSR cover page is gone).
function CoverRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/ops/${id}/manage?tab=cover`} replace />;
}

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const { theme, setThemeId } = useTheme();

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSessionFailed(true));
  }, []);

  return (
    <div className="app-root" style={{ filter: theme.filter === "none" ? undefined : theme.filter }}>
      <div className="crt-scanlines" />
      <div className="app-shell">
        <Sidebar session={session} theme={theme} setThemeId={setThemeId} />
        <div className="app-content">
          <MobileNav session={session} theme={theme} setThemeId={setThemeId} />
          {sessionFailed && (
            <div className="tag tag-red" data-testid="session-offline" style={{ marginBottom: "1rem" }}>
              OFFLINE — Sitzung nicht erreichbar
            </div>
          )}
          <Routes>
            <Route path="/" element={<OverviewPage session={session} />} />
            <Route path="/calendar" element={<CalendarPage />} />
            <Route path="/ops/new" element={<WizardPage session={session} />} />
            <Route path="/profile" element={<ProfilePage session={session} />} />
            <Route path="/ships" element={<ShipsPage />} />
            <Route path="/templates" element={<TemplatesPage session={session} />} />
            <Route path="/feedback" element={<FeedbackPage session={session} />} />
            <Route path="/roadmap" element={<RoadmapPage />} />
            <Route path="/guilds" element={<ServerListPage session={session} />} />
            <Route path="/account" element={<AccountPage session={session} />} />
            <Route path="/guilds/diagnostics" element={<DiagnosticsPage session={session} />} />
            <Route path="/guilds/settings" element={<GuildSettingsPage session={session} />} />
            <Route path="/guilds/partnerships" element={<PartnershipsPage session={session} />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/ops/:id/edit" element={<EditOpPage session={session} />} />
            <Route path="/ops/:id/manage" element={<OpManagePage session={session} />} />
            <Route path="/ops/:id/cover" element={<CoverRedirect />} />
            <Route path="/ops/:id" element={<OpDetailPage session={session} />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/impressum" element={<DocPage slug="impressum" />} />
            <Route path="/license" element={<DocPage slug="license" />} />
            <Route path="/why-unsigned" element={<DocPage slug="why-unsigned" />} />
            <Route path="/how-to" element={<DocPage slug="how-to" />} />
            <Route path="/was-ist" element={<DocPage slug="whatis" lang="de" />} />
            <Route path="/what-is" element={<DocPage slug="whatis" lang="en" />} />
            <Route path="/privacy" element={<DocPage slug="datenschutz" />} />
            <Route path="/changelog" element={<DocPage slug="changelog" />} />
            <Route path="/sc-tools" element={<DocPage slug="sc-tools" />} />
            <Route path="/api-docs" element={<ApiDocsPage />} />
            <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
