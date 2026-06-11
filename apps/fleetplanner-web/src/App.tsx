import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { OverviewPage } from "./pages/OverviewPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { ErrorState } from "./components/ErrorState";
import { Avatar } from "./components/Avatar";

const MONO = "var(--mono)";

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSessionFailed(true));
  }, []);

  const user = session?.user ?? null;
  const navIdle = { display: "block", padding: "0.9rem 0.9rem", color: "#9fb1c2", textDecoration: "none", whiteSpace: "nowrap" } as const;

  return (
    <div style={{ minHeight: "100vh" }}>
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
        <a href="/fleetplanner/guilds" style={navIdle}>Server</a>
        <a href="/fleetplanner/feedback" style={navIdle}>Feedback</a>
        <a href="/fleetplanner/roadmap" style={navIdle}>Roadmap</a>
        <a href="/fleetplanner/how-to" style={navIdle}>Anleitung</a>
        <span style={{ flex: 1 }} />
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
            <>
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
            </>
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
          <Route path="/ops/:id" element={<OpDetailPage session={session} />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
        </Routes>
      </main>
    </div>
  );
}
