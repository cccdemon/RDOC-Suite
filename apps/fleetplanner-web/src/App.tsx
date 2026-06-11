import { useEffect, useState } from "react";
import { Link, Route, Routes } from "react-router-dom";
import { getSession } from "./api/client";
import type { SessionResponse } from "./api/types";
import { OverviewPage } from "./pages/OverviewPage";
import { OpDetailPage } from "./pages/OpDetailPage";
import { LoginPage } from "./pages/LoginPage";
import { ErrorState } from "./components/ErrorState";

export function App() {
  const [session, setSession] = useState<SessionResponse | null>(null);
  const [sessionFailed, setSessionFailed] = useState(false);

  useEffect(() => {
    getSession()
      .then(setSession)
      .catch(() => setSessionFailed(true));
  }, []);

  return (
    <main className="fpw-main">
      <header className="fpw-topbar">
        <Link to="/" className="fpw-brand">
          RDOC // FLEETPLANNER
        </Link>
        <span className="fpw-user" data-testid="session-state">
          {sessionFailed
            ? "OFFLINE"
            : session === null
              ? "…"
              : session.user
                ? session.user.username
                : "GAST"}
        </span>
      </header>
      <Routes>
        <Route path="/" element={<OverviewPage session={session} />} />
        <Route path="/ops/:id" element={<OpDetailPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="*" element={<ErrorState code={404} message="Seite nicht gefunden." />} />
      </Routes>
    </main>
  );
}
