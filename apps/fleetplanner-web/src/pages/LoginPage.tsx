/** Login = the existing same-origin OAuth flow; the SPA never sees tokens.
 *  After the OAuth callback sets the HttpOnly cookie, the user lands back on
 *  the SSR app for now (Phase 4 wires the return path to the SPA). */
export function LoginPage() {
  return (
    <div className="fpw-state">
      <span className="fpw-mono-label">ANMELDEN</span>
      <p className="fpw-meta">Anmeldung läuft über Discord (Cookie-Session, same-origin).</p>
      <a className="fpw-btn" href="/fleetplanner/auth/discord/start" rel="nofollow">
        Mit Discord anmelden
      </a>
    </div>
  );
}
