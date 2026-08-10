import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { getPublicOrgs } from "../api/client";
import type { PublicOrg, SessionResponse } from "../api/types";
import { Ic } from "../components/Icons";
import { tint } from "../components/ui";
import { useT } from "../i18n";
import { useSeo } from "../seo";

// The public front door. Until now `/` dropped every visitor into the operation
// list, which says nothing to somebody who has never seen the tool. App.tsx
// serves this page at `/` for signed-out visitors only, and at `/start` for
// everyone, so daily users keep landing on their operations.
//
// The copy follows ASD-STE100 in its "STE-flavored" mode: short declaratives,
// active voice, one thought per sentence, no marketing adjectives. It lives in
// i18n.tsx (de/en) like every other string in the SPA. Every claim on this page
// was checked against the code — the older FLEETPLANNER-UEBERBLICK.md still
// describes the removed LiveKit stack.

const MONO = "var(--mono)";

const FEATURES = [
  { key: "ops", icon: "board" },
  { key: "fleet", icon: "ship" },
  { key: "signup", icon: "users" },
  { key: "series", icon: "swap" },
  { key: "discord", icon: "chat" },
  { key: "voice", icon: "mic" },
  { key: "ships", icon: "ship" },
  { key: "cover", icon: "doc" },
  { key: "polls", icon: "check" },
  { key: "templates", icon: "save" },
  { key: "streams", icon: "eye" },
  { key: "ground", icon: "fps" },
  { key: "tenants", icon: "server" },
  { key: "after", icon: "cal" },
  { key: "open", icon: "link" },
] as const;

const STEPS = ["1", "2", "3"] as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        fontFamily: "var(--display)",
        fontWeight: 400,
        fontSize: "1.3rem",
        lineHeight: 1.25,
        color: "var(--text-hi)",
        margin: "0 0 1.1rem",
      }}
    >
      {children}
    </h2>
  );
}

/**
 * The orgs that run the Fleetplanner. Comes from the API, not from a list in
 * this file: an org appears only after its own operators tick the opt-in in the
 * guild settings, so the consent lives with the org and can be withdrawn there.
 * Failure and "nobody consented" are the same case — the panel stays away.
 *
 * Rendered as a sidebar beside the feature grid, so it is read as social proof
 * next to the capabilities rather than as a footnote below them.
 */
function OrgLogo({ org }: { org: PublicOrg }) {
  // A guild icon hash is written at install time and can go stale (the server
  // changed its icon), which makes Discord's CDN answer 404. A broken-image
  // glyph is worse than no image, so fall back to the neutral server mark.
  const [broken, setBroken] = useState(false);
  if (!org.iconUrl || broken) {
    return (
      <span
        style={{
          width: 36, height: 36, borderRadius: 9, flexShrink: 0,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          border: `1px solid ${tint("var(--cyan)", 35)}`,
          background: tint("var(--cyan)", 12),
          color: "var(--cyan)",
        }}
      >
        <Ic name="server" size={18} sw={1.7} />
      </span>
    );
  }
  return (
    <img
      src={org.iconUrl}
      alt=""
      width={36}
      height={36}
      loading="lazy"
      onError={() => setBroken(true)}
      style={{ borderRadius: 9, flexShrink: 0, objectFit: "cover" }}
    />
  );
}

function UsedBy() {
  const t = useT();
  const [orgs, setOrgs] = useState<PublicOrg[]>([]);

  useEffect(() => {
    let cancelled = false;
    getPublicOrgs()
      .then((r) => { if (!cancelled) setOrgs(r.orgs); })
      .catch(() => { /* landing page must not break over a decorative panel */ });
    return () => { cancelled = true; };
  }, []);

  if (orgs.length === 0) return null;

  return (
    <aside
      data-testid="start-usedby"
      style={{
        flex: "1 1 260px",
        maxWidth: "100%",
        alignSelf: "flex-start",
        position: "sticky",
        top: 84,
        border: `1px solid ${tint("var(--cyan)", 35)}`,
        borderRadius: "var(--r-card)",
        background: tint("var(--cyan)", 7),
        padding: "1.1rem 1.2rem",
      }}
    >
      <div
        style={{
          fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.09em",
          textTransform: "uppercase", color: "var(--cyan)", marginBottom: "0.9rem",
        }}
      >
        {t("start.usedby.title")}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.6rem" }}>
        {orgs.map((o) => (
          <a
            key={o.inviteUrl}
            href={o.inviteUrl}
            target="_blank"
            rel="noopener noreferrer"
            data-testid="start-usedby-org"
            className="fpw-cardlink"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "0.7rem",
              border: "1px solid var(--border)",
              borderRadius: "var(--r-card)",
              background: "var(--bg2)",
              padding: "0.7rem 0.85rem",
              textDecoration: "none",
            }}
          >
            <OrgLogo org={o} />
            <span style={{ minWidth: 0 }}>
              <span style={{ color: "var(--text-hi)", fontSize: "0.92rem", display: "block", overflowWrap: "anywhere" }}>
                {o.name}
              </span>
              <span style={{ color: "var(--cyan)", fontFamily: MONO, fontSize: "0.66rem" }}>
                {t("start.usedby.join")}
              </span>
            </span>
          </a>
        ))}
      </div>
    </aside>
  );
}

export function StartPage({ session }: { session: SessionResponse | null }) {
  const t = useT();
  const signedIn = !!session?.user;

  useSeo({
    title: t("start.seo.title"),
    description: t("start.seo.desc"),
    canonical: "https://suite.raumdock.org/fleetplanner/",
    image: "https://suite.raumdock.org/fleetplanner/og.png",
    imageAlt: "RDOC Fleetplanner",
  });

  return (
    <div data-testid="start-page" style={{ maxWidth: 1080 }}>
      {/* Hero. Flat surface, one Copper action — the brand guide allows exactly
          one primary action per view. */}
      <section
        style={{
          border: "1px solid var(--border)",
          borderRadius: "var(--r-hero)",
          background: "var(--bg2)",
          padding: "2.2rem 2rem",
          marginBottom: "1.6rem",
        }}
      >
        <div style={{ fontFamily: MONO, fontSize: "0.62rem", letterSpacing: "0.07em", color: "var(--dim2)", marginBottom: "0.8rem" }}>
          {t("start.eyebrow")}
        </div>
        <h1
          style={{
            fontFamily: "var(--display)",
            fontWeight: 400,
            fontSize: "clamp(1.5rem, 4vw, 2.1rem)",
            lineHeight: 1.2,
            color: "var(--text-hi)",
            margin: "0 0 0.9rem",
          }}
        >
          {t("start.title")}
        </h1>
        <p style={{ color: "var(--text)", fontSize: "1.02rem", lineHeight: 1.65, maxWidth: "62ch", margin: "0 0 1.4rem" }}>
          {t("start.lead")}
        </p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "0.7rem" }}>
          {signedIn ? (
            <Link className="btn btn-primary" to="/operationen" data-testid="start-cta-ops">
              <Ic name="board" size={14} sw={1.7} /> {t("start.ctaOps")}
            </Link>
          ) : (
            <Link className="btn btn-primary" to="/login" data-testid="start-cta-login">
              <Ic name="lock" size={14} sw={1.7} /> {t("start.ctaLogin")}
            </Link>
          )}
          <Link className="btn" to="/handbuch" data-testid="start-cta-handbook">
            <Ic name="doc" size={14} sw={1.7} /> {t("start.ctaHandbook")}
          </Link>
        </div>
      </section>

      {/* Three steps. */}
      <section style={{ marginBottom: "2rem" }}>
        <SectionTitle>{t("start.how.title")}</SectionTitle>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
          {STEPS.map((n) => (
            <div
              key={n}
              data-testid={`start-step-${n}`}
              style={{ border: "1px solid var(--border)", borderRadius: "var(--r-card)", background: "var(--bg2)", padding: "1.1rem 1.2rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.55rem" }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    flexShrink: 0,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    border: `1px solid ${tint("var(--cyan)", 40)}`,
                    background: tint("var(--cyan)", 12),
                    color: "var(--cyan)",
                    fontFamily: MONO,
                    fontSize: "0.72rem",
                  }}
                >
                  {n}
                </span>
                <span style={{ color: "var(--text-hi)", fontSize: "0.98rem" }}>{t(`start.how.${n}.title`)}</span>
              </div>
              <p style={{ color: "var(--dim)", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>{t(`start.how.${n}.body`)}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature blocks, with the "used by" panel as a sidebar beside them. On a
          narrow screen the sidebar wraps underneath (flex-wrap). */}
      <section style={{ marginBottom: "2rem" }}>
        <SectionTitle>{t("start.features.title")}</SectionTitle>
        <div style={{ display: "flex", gap: "1rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <div style={{ flex: "999 1 520px", minWidth: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: "1rem" }}>
          {FEATURES.map((f) => (
            <div
              key={f.key}
              data-testid={`start-feature-${f.key}`}
              style={{ border: "1px solid var(--border)", borderRadius: "var(--r-card)", background: "var(--bg2)", padding: "1.1rem 1.2rem" }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem", marginBottom: "0.55rem" }}>
                <span style={{ color: "var(--cyan)", display: "inline-flex", flexShrink: 0 }}>
                  <Ic name={f.icon} size={16} sw={1.7} />
                </span>
                <span style={{ color: "var(--text-hi)", fontSize: "0.98rem" }}>{t(`start.f.${f.key}.title`)}</span>
              </div>
              <p style={{ color: "var(--dim)", fontSize: "0.9rem", lineHeight: 1.6, margin: 0 }}>{t(`start.f.${f.key}.body`)}</p>
            </div>
          ))}
        </div>
        <UsedBy />
        </div>
      </section>

      {/* Roles. */}
      <section style={{ marginBottom: "2rem" }}>
        <SectionTitle>{t("start.roles.title")}</SectionTitle>
        <p style={{ color: "var(--dim)", fontSize: "0.94rem", lineHeight: 1.65, maxWidth: "70ch", margin: 0 }}>
          {t("start.roles.body")}
        </p>
      </section>

      {/* Closing call to action. Repeats the one Copper action rather than
          adding a second competing colour. */}
      {!signedIn && (
        <section
          data-testid="start-cta"
          style={{
            border: `1px solid ${tint("var(--accent)", 40)}`,
            borderRadius: "var(--r-card)",
            background: tint("var(--accent)", 8),
            padding: "1.4rem 1.5rem",
            marginBottom: "2rem",
          }}
        >
          <SectionTitle>{t("start.cta.title")}</SectionTitle>
          <p style={{ color: "var(--text)", fontSize: "0.94rem", lineHeight: 1.65, maxWidth: "62ch", margin: "0 0 1.1rem" }}>
            {t("start.cta.body")}
          </p>
          <Link className="btn btn-primary" to="/login" data-testid="start-cta-login-bottom">
            <Ic name="lock" size={14} sw={1.7} /> {t("start.ctaLogin")}
          </Link>
        </section>
      )}
    </div>
  );
}
