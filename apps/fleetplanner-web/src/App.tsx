import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
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
import { ErrorState } from "./components/ErrorState";
import { Avatar } from "./components/Avatar";

const MONO = "var(--mono)";

// Green-phosphor CRT preview filter — same transform as the design bundle.
const CRT_FILTER = "grayscale(1) sepia(1) hue-rotate(62deg) saturate(2.8) brightness(1.06) contrast(1.05)";

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);
  const [crt, setCrt] = useState(false);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSessionFailed(true));
  }, []);

  const user = session?.user ?? null;
  const navIdle = { display: "block", padding: "0.9rem 0.9rem", color: "#9fb1c2", textDecoration: "none", whiteSpace: "nowrap" } as const;

  return (
    <div style={{ minHeight: "100vh", filter: crt ? CRT_FILTER : "none" }}>
      {crt && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 9998,
            background: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,25,10,0.26) 3px, rgba(0,0,0,0) 4px)",
            boxShadow: "inset 0 0 200px rgba(0,45,18,0.6)",
          }}
        />
      )}
      {/* scanline overlay (design) */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 9999,
          background:
            "repeating-linear-gradient(0deg,transparent,transparent 2px,rgba(0,0,0,0.07) 2px,rgba(0,0,0,0.07) 4px)",
        }}
      />

      <nav
        style={{
          position: "sticky",
          top: 0,
          zIndex: 100,
          display: "flex",
          alignItems: "center",
          gap: 0,
          background: "#090f18",
          borderBottom: "1px solid rgba(0,212,255,0.32)",
          padding: "0 1.6rem",
          fontFamily: MONO,
          fontSize: "0.8rem",
          letterSpacing: "0.04em",
          overflowX: "auto",
        }}
      >
        <Link
          to="/"
          style={{
            fontWeight: "bold",
            fontSize: "0.85rem",
            letterSpacing: "0.12em",
            padding: "0.9rem 1.4rem 0.9rem 0",
            borderRight: "1px solid rgba(0,212,255,0.12)",
            marginRight: "0.6rem",
            whiteSpace: "nowrap",
            textDecoration: "none",
          }}
        >
          <span style={{ color: "#00d4ff" }}>RDOC</span> <span style={{ color: "#5b6b7a" }}>//</span>{" "}
          <span style={{ color: "#9fb1c2" }}>FLEETPLANNER</span>
        </Link>
        <Link to="/" style={{ ...navIdle, color: "#00d4ff", background: "rgba(0,212,255,0.08)" }}>
          Operationen
        </Link>
        <Link to="/calendar" style={navIdle}>Kalender</Link>
        <Link to="/ships" style={navIdle}>Schiffe</Link>
        <Link to="/guilds" style={navIdle}>Server</Link>
        <Link to="/feedback" style={navIdle}>Feedback</Link>
        <Link to="/roadmap" style={navIdle}>Roadmap</Link>
        <a href="/fleetplanner/how-to" style={navIdle}>Anleitung</a>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          data-testid="crt-toggle"
          onClick={() => setCrt((v) => !v)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 7,
            padding: "0.32rem 0.7rem",
            fontFamily: MONO,
            fontSize: "0.66rem",
            letterSpacing: "0.1em",
            borderRadius: 6,
            cursor: "pointer",
            whiteSpace: "nowrap",
            border: crt ? "1px solid rgba(0,255,136,0.55)" : "1px solid rgba(0,212,255,0.28)",
            background: crt ? "rgba(0,255,136,0.12)" : "rgba(0,212,255,0.05)",
            color: crt ? "#00ff88" : "#9fb1c2",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", flexShrink: 0, background: crt ? "#00ff88" : "#5b6b7a", boxShadow: crt ? "0 0 8px #00ff88" : "none" }} />
          GRÜN-CRT
        </button>
        <span style={{ color: "#5b6b7a", fontSize: "0.72rem", letterSpacing: "0.12em", padding: "0 1rem", whiteSpace: "nowrap" }}>
          RAUMDOCK.ORG
        </span>
        <span
          data-testid="session-state"
          style={{ display: "flex", alignItems: "center", gap: "0.55rem", padding: "0 0.4rem 0 0.6rem", whiteSpace: "nowrap" }}
        >
          {sessionFailed ? (
            <span style={{ color: "var(--red)", fontSize: "0.72rem" }}>OFFLINE</span>
          ) : session === null ? (
            <span style={{ color: "#5b6b7a" }}>…</span>
          ) : user ? (
            <Link to="/profile" data-testid="profile-link" style={{ display: "inline-flex", alignItems: "center", gap: "0.55rem", textDecoration: "none" }}>
              <span
                style={{
                  border: "1px solid rgba(240,165,0,0.38)",
                  color: "#f0a500",
                  background: "rgba(240,165,0,0.08)",
                  fontSize: "0.6rem",
                  padding: "0.15rem 0.45rem",
                  letterSpacing: "0.06em",
                  textTransform: "uppercase",
                }}
              >
                {user.role}
              </span>
              <Avatar name={user.username} size={24} />
              <span style={{ color: "#ccdde8", fontSize: "0.82rem", fontFamily: "var(--body)" }}>{user.username}</span>
            </Link>
          ) : (
            <span style={{ color: "#9fb1c2" }}>GAST</span>
          )}
        </span>
      </nav>

      <div
        style={{
          background: "rgba(240,165,0,0.08)",
          borderBottom: "1px solid rgba(240,165,0,0.38)",
          color: "#f0a500",
          fontFamily: MONO,
          fontSize: "0.74rem",
          letterSpacing: "0.03em",
          textAlign: "center",
          padding: "0.5rem 1rem",
        }}
      >
        ⚠ Beta — Fleetplanner wird noch aktiv entwickelt. Idee oder Bug? Sag uns Bescheid im Feedback-Tab.
      </div>

      <main className="fpw-main">
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
          <Route path="/ops/:id" element={<OpDetailPage session={session} />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/impressum" element={<DocPage slug="impressum" />} />
          <Route path="/license" element={<DocPage slug="license" />} />
          <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
        </Routes>
      </main>
    </div>
  );
}
