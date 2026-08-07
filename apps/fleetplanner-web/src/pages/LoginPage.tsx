import { Link } from "react-router-dom";
import { Ic } from "../components/Icons";
import { MONO } from "../components/ui";
import { useSeo } from "../seo";
import { useT } from "../i18n";

// Login = the existing same-origin OAuth flow; the SPA never sees tokens. The
// callback sets the HttpOnly cookie and returns to the SPA.
const PROVIDERS: Array<{ key: string; labelKey: string; border: string; bg: string; color: string; icon: React.ReactNode }> = [
  {
    key: "discord", labelKey: "login.discord", border: "rgba(88,101,242,0.5)", bg: "rgba(88,101,242,0.14)", color: "#c2c8fb",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 2.9a13.8 13.8 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.5 0A12.6 12.6 0 0 0 8.6 2.9 19.7 19.7 0 0 0 3.7 4.4C.6 9 .1 13.6.3 18.1a19.9 19.9 0 0 0 6 3 14.3 14.3 0 0 0 1.2-2 13 13 0 0 1-1.9-.9l.4-.3c3.7 1.7 7.7 1.7 11.3 0l.4.3c-.6.4-1.2.7-1.9.9.3.7.8 1.4 1.2 2a19.8 19.8 0 0 0 6-3c.4-5.2-.7-9.8-3.5-13.7zM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4S7.3 10.5 8.5 10.5s2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4z" /></svg>,
  },
  {
    key: "github", labelKey: "login.github", border: "rgba(255,255,255,0.16)", bg: "rgba(255,255,255,0.04)", color: "var(--text)",
    icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .3a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.3-1.8-1.3-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.3-.5-1.5.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .3z" /></svg>,
  },
  {
    key: "google", labelKey: "login.google", border: "rgba(255,255,255,0.16)", bg: "rgba(255,255,255,0.04)", color: "var(--text)",
    icon: <svg width="18" height="18" viewBox="0 0 24 24"><path d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h6c-.3 1.4-1 2.5-2.2 3.3v2.8h3.6c2-1.9 3.2-4.7 3.2-8z" fill="#4285F4" /><path d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" fill="#34A853" /><path d="M5.8 14.1a6.6 6.6 0 0 1 0-4.2V7.1H2.2a11 11 0 0 0 0 9.8z" fill="#FBBC05" /><path d="M12 5.4c1.6 0 3.1.6 4.2 1.6l3.1-3.1A11 11 0 0 0 2.2 7.1l3.6 2.8C6.7 7.3 9.1 5.4 12 5.4z" fill="#EA4335" /></svg>,
  },
];

export function LoginPage() {
  const t = useT();
  useSeo({ title: t("common.login"), noindex: true });
  return (
    <div data-testid="login-page" style={{ maxWidth: 420, margin: "3rem auto", textAlign: "center" }}>
      <div style={{ width: 58, height: 58, borderRadius: 15, background: "rgba(43, 49, 53, 0.08)", border: "1px solid var(--border)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1.2rem" }}><Ic name="shield" size={28} sw={1.5} /></div>
      <h1 style={{ fontFamily: MONO, fontSize: "1.5rem", letterSpacing: "0.1em", color: "var(--cyan)", margin: "0 0 0.5rem" }}>RDOC FLEETPLANNER</h1>
      <p style={{ color: "var(--dim)", fontSize: "0.9rem", margin: "0 0 1.6rem", lineHeight: 1.6 }}>{t("login.intro")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.4rem" }}>
        {PROVIDERS.map((p) => (
          <a key={p.key} href={`/fleetplanner/auth/${p.key}/start`} rel="nofollow" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.7rem", border: `1px solid ${p.border}`, background: p.bg, color: p.color, fontFamily: MONO, fontSize: "0.8rem", borderRadius: 10, textDecoration: "none" }}>
            {p.icon}{t(p.labelKey)}
          </a>
        ))}
      </div>
      <p style={{ color: "var(--dim)", fontSize: "0.8rem" }}>{t("login.publicPre")}<Link to="/" style={{ color: "var(--cyan)" }}>{t("login.publicLink")}</Link>.</p>
    </div>
  );
}
