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
];

export function LoginPage() {
  const t = useT();
  useSeo({ title: t("common.login"), noindex: true });
  return (
    <div data-testid="login-page" style={{ maxWidth: 420, margin: "3rem auto", textAlign: "center" }}>
      <div style={{ width: 58, height: 58, borderRadius: 15, background: "var(--wash)", border: "1px solid var(--border)", color: "var(--cyan)", display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1.2rem" }}><Ic name="shield" size={28} sw={1.5} /></div>
      <h1 style={{ fontFamily: MONO, fontSize: "1.5rem", letterSpacing: "0.1em", color: "var(--cyan)", margin: "0 0 0.5rem" }}>RDOC FLEETPLANNER</h1>
      <p style={{ color: "var(--dim)", fontSize: "0.9rem", margin: "0 0 1.6rem", lineHeight: 1.6 }}>{t("login.intro")}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem", marginBottom: "1.4rem" }}>
        {PROVIDERS.map((p) => (
          <a key={p.key} href={`/fleetplanner/auth/${p.key}/start`} rel="nofollow" style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "0.6rem", padding: "0.7rem", border: `1px solid ${p.border}`, background: p.bg, color: p.color, fontFamily: MONO, fontSize: "0.8rem", borderRadius: 10, textDecoration: "none" }}>
            {p.icon}{t(p.labelKey)}
          </a>
        ))}
      </div>
      <p style={{ color: "var(--dim)", fontSize: "0.8rem" }}>{t("login.publicPre")}<Link to="/operationen" style={{ color: "var(--cyan)" }}>{t("login.publicLink")}</Link>.</p>
    </div>
  );
}
