import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useParams } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { useTheme } from "./theme";
import { Sidebar, MobileNav } from "./components/Sidebar";
import { ToastHost } from "./components/Toast";
import { OverviewPage } from "./pages/OverviewPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { OpManagePage } from "./pages/OpManagePage";
import { CalendarPage } from "./pages/CalendarPage";
import { WizardPage } from "./pages/WizardPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ShipsPage } from "./pages/ShipsPage";
import { FeedbackPage } from "./pages/FeedbackPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { HandbuchPage } from "./pages/HandbuchPage";
import { RechtlichesPage } from "./pages/RechtlichesPage";
import { GuildSettingsPage } from "./pages/GuildSettingsPage";
import { PartnershipsPage } from "./pages/PartnershipsPage";
import { ServerListPage } from "./pages/ServerListPage";
import { AccountPage } from "./pages/AccountPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { ApiDocsPage } from "./pages/ApiDocsPage";
import { ErrorState } from "./components/ErrorState";

// Legacy cover URL → the cover tab in Op-Management (the SSR cover page is gone).
function CoverRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/ops/${id}/manage?tab=cover`} replace />;
}

// Standalone edit screen is fused into Op-Management as the Eckdaten tab.
function EditRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/ops/${id}/manage?tab=eckdaten`} replace />;
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
            <Route path="/guilds" element={<ServerListPage session={session} />} />
            <Route path="/account" element={<AccountPage session={session} />} />
            <Route path="/guilds/diagnostics" element={<DiagnosticsPage session={session} />} />
            <Route path="/guilds/settings" element={<GuildSettingsPage session={session} />} />
            <Route path="/guilds/partnerships" element={<PartnershipsPage session={session} />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/ops/:id/edit" element={<EditRedirect />} />
            <Route path="/ops/:id/manage" element={<OpManagePage session={session} />} />
            <Route path="/ops/:id/cover" element={<CoverRedirect />} />
            <Route path="/ops/:id" element={<OpDetailPage session={session} />} />
            <Route path="/login" element={<LoginPage />} />
            {/* IA merge B: docs hub + footer-level legal */}
            <Route path="/handbuch" element={<HandbuchPage />} />
            <Route path="/handbuch/:section" element={<HandbuchPage />} />
            <Route path="/rechtliches" element={<RechtlichesPage />} />
            <Route path="/rechtliches/:section" element={<RechtlichesPage />} />
            {/* legacy doc routes → handbuch / rechtliches sections (deep-link safe) */}
            <Route path="/was-ist" element={<Navigate to="/handbuch/was-ist-das" replace />} />
            <Route path="/what-is" element={<Navigate to="/handbuch/was-ist-das" replace />} />
            <Route path="/how-to" element={<Navigate to="/handbuch/anleitung" replace />} />
            <Route path="/roadmap" element={<Navigate to="/handbuch/roadmap" replace />} />
            <Route path="/changelog" element={<Navigate to="/handbuch/changelog" replace />} />
            <Route path="/sc-tools" element={<Navigate to="/handbuch/sc-tools" replace />} />
            <Route path="/why-unsigned" element={<Navigate to="/handbuch/unsigniert" replace />} />
            <Route path="/license" element={<Navigate to="/rechtliches/lizenz" replace />} />
            <Route path="/impressum" element={<Navigate to="/rechtliches/impressum" replace />} />
            <Route path="/privacy" element={<Navigate to="/rechtliches/datenschutz" replace />} />
            <Route path="/api-docs" element={<ApiDocsPage />} />
            <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </div>
  );
}
