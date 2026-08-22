import { useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation, useParams, useSearchParams } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { useTheme } from "./theme";
import { LocaleProvider } from "./i18n";
import { ServerContextProvider } from "./serverContext";
import { Sidebar, MobileNav } from "./components/Sidebar";
import { ToastHost } from "./components/Toast";
import { OperationenPage } from "./pages/CalendarPage";
import { StartPage } from "./pages/StartPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { WizardPage } from "./pages/WizardPage";
import { KontoPage } from "./pages/KontoPage";
import { ShipsPage } from "./pages/ShipsPage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { HandbuchPage } from "./pages/HandbuchPage";
import { ScToolsPage } from "./pages/ScToolsPage";
import { RechtlichesPage } from "./pages/RechtlichesPage";
import { GuildSettingsPage } from "./pages/GuildSettingsPage";
import { PartnershipsPage } from "./pages/PartnershipsPage";
import { ServerListPage } from "./pages/ServerListPage";
import { OrgFleetPage } from "./pages/OrgFleetPage";
import { PollsPage } from "./pages/PollsPage";
import { PollCreatePage } from "./pages/PollCreatePage";
import { PollDetailPage } from "./pages/PollDetailPage";
import { DiagnosticsPage } from "./pages/DiagnosticsPage";
import { AdminPage } from "./pages/AdminPage";
import { SystemPage } from "./pages/SystemPage";
import { LoginPage } from "./pages/LoginPage";
import { ApiDocsPage } from "./pages/ApiDocsPage";
import { ErrorState } from "./components/ErrorState";
import { ChangelogPopup } from "./components/ChangelogPopup";

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
  // §3.1: the cover link should land on the cover, not on a generic admin area.
  return <KeepQuery to={`/ops/${id}`} extra={{ op: "cover" }} />;
}
function EditRedirect() {
  const { id } = useParams<{ id: string }>();
  return <KeepQuery to={`/ops/${id}`} extra={{ op: "eckdaten" }} />;
}

// `/` sends a signed-in member to the operation list. The query string and hash
// have to travel with them: `/?view=liste` (and every other deep link onto the
// list) would otherwise silently lose its parameters.
function RootRedirect() {
  const { search, hash } = useLocation();
  return <Navigate to={`/operationen${search}${hash}`} replace />;
}

// Every legacy path keeps whatever the caller sent with it (§14: "Alle
// Legacy-Redirects behalten Query und Hash"). `extra` is merged in first so an
// explicit incoming parameter still wins.
function KeepQuery({ to, extra }: { to: string; extra?: Record<string, string> }) {
  const { search, hash } = useLocation();
  const q = new URLSearchParams(search);
  for (const [k, v] of Object.entries(extra ?? {})) if (!q.has(k)) q.set(k, v);
  const qs = q.toString();
  return <Navigate to={`${to}${qs ? `?${qs}` : ""}${hash}`} replace />;
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
    <LocaleProvider preferred={session?.user?.locale}>
    <ServerContextProvider session={session}>
    <div className="app-root" style={{ filter: theme.filter === "none" ? undefined : theme.filter }}>
      {theme.id === "crt" && <div className="crt-scanlines" />}
      <ChangelogPopup session={session} />
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
            {/* `/` is the front door for visitors and the work list for members.
                A signed-out visitor gets the start page; a member goes straight
                to the operations. The operation list keeps its own URL so the
                nav can point at it from either state, and so a guest can still
                reach the public operations.

                `session === null` means the session request has not answered
                yet, so nothing renders until it does. Without that, a member
                would see the start page flash on every reload. */}
            <Route
              path="/"
              element={
                session === null && !sessionFailed ? null : session?.user ? (
                  <RootRedirect />
                ) : (
                  <StartPage session={session} />
                )
              }
            />
            {/* Always reachable, including when signed in. */}
            <Route path="/start" element={<StartPage session={session} />} />
            <Route path="/operationen" element={<OperationenPage session={session} />} />
            <Route path="/calendar" element={<KeepQuery to="/operationen" extra={{ view: "kalender" }} />} />
            <Route path="/ops/new" element={<WizardPage session={session} />} />
            <Route path="/ships" element={<ShipsPage session={session} />} />
            <Route path="/polls" element={<PollsPage session={session} />} />
            <Route path="/polls/new" element={<PollCreatePage session={session} />} />
            <Route path="/polls/:id" element={<PollDetailPage session={session} />} />
            <Route path="/templates" element={<TemplatesPage session={session} />} />
            <Route path="/guilds" element={<ServerListPage session={session} />} />
            <Route path="/guilds/fleet" element={<OrgFleetPage session={session} />} />
            {/* IA merge C: profile/hangar + logins + feedback → /konto tabs */}
            <Route path="/konto" element={<KontoPage session={session} />} />
            <Route path="/konto/:tab" element={<KontoPage session={session} />} />
            <Route path="/profile" element={<KeepQuery to="/konto/profil" />} />
            <Route path="/account" element={<KeepQuery to="/konto/logins" />} />
            <Route path="/feedback" element={<KeepQuery to="/konto/feedback" />} />
            <Route path="/guilds/diagnostics" element={<DiagnosticsPage session={session} />} />
            <Route path="/guilds/settings" element={<GuildSettingsPage session={session} />} />
            <Route path="/guilds/partnerships" element={<PartnershipsPage session={session} />} />
            <Route path="/admin" element={<AdminPage session={session} />} />
            <Route path="/admin/system" element={<SystemPage session={session} />} />
            <Route path="/ops/:id/edit" element={<EditRedirect />} />
            <Route path="/ops/:id/manage" element={<ManageRedirect />} />
            <Route path="/ops/:id/cover" element={<CoverRedirect />} />
            <Route path="/ops/:id" element={<OpDetailPage session={session} />} />
            <Route path="/login" element={<LoginPage />} />
            {/* IA merge B: docs hub + footer-level legal */}
            <Route path="/handbuch" element={<HandbuchPage />} />
            <Route path="/handbuch/sc-tools" element={<KeepQuery to="/sc-tools" />} />
            <Route path="/handbuch/:section" element={<HandbuchPage />} />
            <Route path="/sc-tools" element={<ScToolsPage />} />
            <Route path="/rechtliches" element={<RechtlichesPage />} />
            <Route path="/rechtliches/:section" element={<RechtlichesPage />} />
            {/* legacy doc routes → handbuch / rechtliches sections (deep-link safe) */}
            <Route path="/was-ist" element={<KeepQuery to="/handbuch/was-ist-das" />} />
            <Route path="/what-is" element={<KeepQuery to="/handbuch/was-ist-das" />} />
            <Route path="/how-to" element={<KeepQuery to="/handbuch/anleitung" />} />
            <Route path="/roadmap" element={<KeepQuery to="/handbuch/roadmap" />} />
            <Route path="/changelog" element={<KeepQuery to="/handbuch/changelog" />} />
            <Route path="/why-unsigned" element={<KeepQuery to="/handbuch/unsigniert" />} />
            <Route path="/license" element={<KeepQuery to="/rechtliches/lizenz" />} />
            <Route path="/impressum" element={<KeepQuery to="/rechtliches/impressum" />} />
            <Route path="/privacy" element={<KeepQuery to="/rechtliches/datenschutz" />} />
            <Route path="/api-docs" element={<ApiDocsPage />} />
            <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
          </Routes>
        </div>
      </div>
      <ToastHost />
    </div>
    </ServerContextProvider>
    </LocaleProvider>
  );
}
