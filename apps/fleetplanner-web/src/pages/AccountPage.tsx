import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, getAccount } from "../api/client";
import type { AccountResponse, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { CardHead, MONO, card, lbl, tint } from "../components/ui";
import { useT } from "../i18n";

// Legacy GitHub/Google identities from before 2026-09-14 fall through to the
// generic badge. Discord keeps its own colour: it identifies Discord, it is not
// an RDOC accent.
const PROVIDER_LABELS: Record<string, string> = { discord: "Discord", e2e: "E2E" };
function providerBadge(provider: string): { short: string; color: string } {
  switch (provider) {
    case "discord": return { short: "DC", color: "#5865f2" };
    default: return { short: provider.slice(0, 2).toUpperCase(), color: "var(--dim)" };
  }
}

export function AccountPage({ session }: { session: SessionResponse | null }) {
  const me = session?.user ?? null;
  const [account, setAccount] = useState<AccountResponse | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const t = useT();

  useEffect(() => {
    if (me) getAccount().then(setAccount).catch((e) => setNotice(e instanceof ApiError ? e.message : t("account.failed")));
  }, [me]);

  if (session === null) return <div className="fpw-state"><span style={lbl}>{t("common.loading")}</span></div>;
  if (!me)
    return (
      <div className="fpw-state" data-testid="account-anon">
        <span style={lbl}>{t("common.authRequired")}</span>
        <Link className="fpw-btn" to="/login">{t("common.login")}</Link>
      </div>
    );

  return (
    <div data-testid="account-page" style={{ width: "100%" }}>
      <div style={{ marginBottom: "1.3rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.4rem" }}>
          <span style={{ color: "var(--cyan)", display: "inline-flex" }}><Ic name="link" size={17} sw={1.7} /></span>
          <span style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.14em", color: "var(--dim2)" }}>{t("account.label")}</span>
        </div>
        <h1 style={{ fontWeight: 700, fontSize: "1.7rem", lineHeight: 1.12, color: "var(--text-hi)", margin: 0 }}>{t("account.title")}</h1>
      </div>
      {notice && <p className="fpw-tag gold" role="alert" data-testid="account-notice" style={{ display: "inline-flex", marginBottom: "1rem" }}>{notice}</p>}

      <section style={card}>
        <CardHead icon="shield" label={t("account.connected")} tone="cyan" />
        {account === null ? (
          <p className="fpw-meta">{t("common.loading")}</p>
        ) : account.identities.length === 0 ? (
          <p className="fpw-meta">{t("account.none")}</p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
            {account.identities.map((i, n) => {
              const b = providerBadge(i.provider);
              return (
                <div key={n} data-testid={`identity-${i.provider}`} style={{ display: "flex", alignItems: "center", gap: "0.7rem", padding: "0.7rem 0.85rem", border: "1px solid var(--border)", borderRadius: 10, background: "var(--row)" }}>
                  <span style={{ width: 32, height: 32, borderRadius: 8, flexShrink: 0, background: `${tint(b.color, 14)}`, border: `1px solid ${tint(b.color, 40)}`, color: b.color, display: "inline-flex", alignItems: "center", justifyContent: "center", fontFamily: MONO, fontSize: "0.62rem", fontWeight: 700 }}>{b.short}</span>
                  <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
                    <div style={{ fontSize: "0.9rem", color: "var(--text-hi)" }}>{PROVIDER_LABELS[i.provider] ?? i.provider}</div>
                    <div style={{ fontSize: "0.76rem", color: "var(--dim)" }}>{i.username ?? "—"}</div>
                  </div>
                  <span style={{ fontFamily: MONO, fontSize: "0.66rem", color: "var(--dim)", whiteSpace: "nowrap" }}>{t("account.since")} {new Date(i.since).toLocaleDateString("de-DE")}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
