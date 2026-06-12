import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useParams, useSearchParams } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { useTheme } from "./theme";
import { Sidebar, MobileNav } from "./components/Sidebar";
import { ToastHost } from "./components/Toast";
import { OperationenPage } from "./pages/CalendarPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { WizardPage } from "./pages/WizardPage";
import { KontoPage } from "./pages/KontoPage";
import { ShipsPage } from "./pages/ShipsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { HandbuchPage } from "./pages/HandbuchPage";
import { RechtlichesPage } from "./pages/RechtlichesPage";
import { GuildSettingsPage } from "./pages/GuildSettingsPage";
import { PartnershipsPage } from "./pages/PartnershipsPage";
import { ServerListPage } from "./pages/ServerListPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { AdminPage } from "./pages/AdminPage";
import { LoginPage } from "./pages/LoginPage";
import { ApiDocsPage } from "./pages/ApiDocsPage";
import { ErrorState } from "./components/ErrorState";

// IA merge D: the operator console is now part of /ops/:id (op=<tab>). The old
// manage/edit/cover URLs redirect there, preserving any tab + flash.
function ManageRedirect() {
  const { id } = useParams<{ id: string }>();
  const [sp] = useSearchParams();
  const q = new URLSearchParams();
  q.set("op", sp.get("tab") ?? "fleet");
  const flash = sp.get("flash");
  if (flash) q.set("flash", flash);
  return <Navigate to={`/ops/${id}?${q.toString()}`} replace />;
}
function CoverRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/ops/${id}?op=admin`} replace />;
}
function EditRedirect() {
  const { id } = useParams<{ id: string }>();
  return <Navigate to={`/ops/${id}?op=eckdaten`} replace />;
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
            {/* IA merge A: Operationen = Liste / Kalender / Agenda in one screen */}
            <Route path="/" element={<OperationenPage session={session} />} />
            <Route path="/operationen" element={<OperationenPage session={session} />} />
            <Route path="/calendar" element={<Navigate to="/?view=kalender" replace />} />
            <Route path="/ops/new" element={<WizardPage session={session} />} />
            <Route path="/ships" element={<ShipsPage />} />
            <Route path="/templates" element={<TemplatesPage session={session} />} />
            <Route path="/guilds" element={<ServerListPage session={session} />} />
            {/* IA merge C: profile/hangar + logins + feedback → /konto tabs */}
            <Route path="/konto" element={<KontoPage session={session} />} />
            <Route path="/konto/:tab" element={<KontoPage session={session} />} />
            <Route path="/profile" element={<Navigate to="/konto/profil" replace />} />
            <Route path="/account" element={<Navigate to="/konto/logins" replace />} />
            <Route path="/feedback" element={<Navigate to="/konto/feedback" replace />} />
            <Route path="/guilds/diagnostics" element={<DiagnosticsPage session={session} />} />
            <Route path="/guilds/settings" element={<GuildSettingsPage session={session} />} />
            <Route path="/guilds/partnerships" element={<PartnershipsPage session={session} />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/ops/:id/edit" element={<EditRedirect />} />
            <Route path="/ops/:id/manage" element={<ManageRedirect />} />
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
