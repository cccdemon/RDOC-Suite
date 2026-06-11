import { Link } from "react-router-dom";

/** Shared 401/403/404/503 state — terse, console-style, no internals. */
export function ErrorState({ code, message }: { code: number; message: string }) {
  const label =
    code === 401 ? "ANMELDUNG ERFORDERLICH" : code === 403 ? "KEIN ZUGRIFF" : code === 503 ? "WARTUNG" : "NICHT GEFUNDEN";
  return (
    <div className="fpw-state" data-testid={`error-${code}`}>
      <span className="fpw-mono-label">{code} · {label}</span>
      <p className="fpw-meta">{message}</p>
      {code === 401 ? (
        <Link className="fpw-btn" to="/login">
          Anmelden
        </Link>
      ) : (
        <Link className="fpw-btn" to="/">
          Zur Übersicht
        </Link>
      )}
    </div>
  );
}
