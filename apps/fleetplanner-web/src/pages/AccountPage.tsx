import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getAccount } from "../api/client";
import type { AccountResponse, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { CardHead, MONO, card, lbl } from "../components/ui";

const PROVIDER_LABELS: Record<string, string> = { discord: "Discord", github: "GitHub", google: "Google", e2e: "E2E" };
function providerBadge(provider: string): { short: string; color: string; rgb: string } {
  switch (provider) {
    case "discord": return { short: "DC", color: "#9aa6f5", rgb: "88,101,242" };
    case "github": return { short: "GH", color: "#ccdde8", rgb: "255,255,255" };
    case "google": return { short: "GO", color: "#ea4335", rgb: "234,67,53" };
    default: return { short: provider.slice(0, 2).toUpperCase(), color: "var(--dim)", rgb: "126,146,164" };
  }
}

export function AccountPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (me) getAccount().then(setAccount).catch((e) => setNotice(e instanceof ApiError ? e.message : "Konten nicht ladbar."));
  }, [me]);

  if (session === null) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="account-anon">
        <span style={lbl}>ANMELDUNG ERFORDERLICH</span>
        <Link className="fpw-btn" to="/login">Anmelden</Link>
      </div>
    );

  return (
    <div data-testid="account-page" style={{ maxWidth: 680, margin: "0 auto" }}>
      <div style={{ marginBottom: "1.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="link" size={17} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>NUTZER // KONTO</span>
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>Verknüpfte Logins</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="account-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <section style={card}>
        <CardHead icon="shield" label="VERBUNDENE KONTEN" tone="cyan" />
        {account === null ? (
          <p className="fpw-meta">Lade…</p>
        ) : account.identities.length === 0 ? (
          <p className="fpw-meta">Noch keine verknüpften Logins.</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {account.identities.map((i, n) => {
              const b = providerBadge(i.provider);
              return (
                <div key={n} data-testid={`identity-${i.provider}`} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 0.85rem", border: "1px solid rgba(0,212,255,0.1)", borderRadius: 10, background: "#0a1018" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `rgba(${b.rgb},0.14)`, border: `1px solid rgba(${b.rgb},0.4)`, color: b.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>{b.short}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <div style={{ fontSize: "0.9rem", color: "var(--text-hi)" }}>{PROVIDER_LABELS[i.provider] ?? i.provider}</div>
                    <div style={{ fontSize: "0.76rem", color: "#9fb1c2" }}>{i.username ?? "—"}</div>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim)", whiteSpace: "nowrap" }}>seit {new Date(i.since).toLocaleDateString("de-DE")}</span>
                </div>
              );
            })}
          </div>
        )}
        <a href="/fleetplanner/auth/discord/link/start" data-testid="link-discord" style={{ marginTop: "0.9rem", display: "inline-flex", alignItems: "center", gap: 7, padding: "0.5rem 1.1rem", border: "1px solid rgba(88,101,242,0.5)", background: "rgba(88,101,242,0.12)", color: "#9aa6f5", fontFamily: MONO, fontSize: "0.72rem", borderRadius: 9, textDecoration: "none" }}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 2.9a13.8 13.8 0 0 0-.6 1.3 18.3 18.3 0 0 0-5.5 0A12.6 12.6 0 0 0 8.6 2.9 19.7 19.7 0 0 0 3.7 4.4C.6 9 .1 13.6.3 18.1a19.9 19.9 0 0 0 6 3 14.3 14.3 0 0 0 1.2-2 13 13 0 0 1-1.9-.9l.4-.3c3.7 1.7 7.7 1.7 11.3 0l.4.3c-.6.4-1.2.7-1.9.9.3.7.8 1.4 1.2 2a19.8 19.8 0 0 0 6-3c.4-5.2-.7-9.8-3.5-13.7zM8.5 15.3c-1.2 0-2.1-1.1-2.1-2.4S7.3 10.5 8.5 10.5s2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4zm7 0c-1.2 0-2.1-1.1-2.1-2.4s.9-2.4 2.1-2.4 2.1 1.1 2.1 2.4-.9 2.4-2.1 2.4z" /></svg>
          Discord verknüpfen
        </a>
      </section>
    </div>
  );
}
