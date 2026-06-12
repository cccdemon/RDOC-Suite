import { Link, Navigate, useParams } from "react-router-dom";
import { DocPage } from "./DocPage";
import { MONO } from "../components/ui";

// IA merge B: license/imprint/privacy move out of the primary nav into a
// footer-level "Rechtliches" page. Same /api/v1/content/:slug source.
const SECTIONS = [
  { key: "lizenz", label: "Lizenz", slug: "license" },
  { key: "impressum", label: "Impressum", slug: "impressum" },
  { key: "datenschutz", label: "Datenschutz", slug: "datenschutz" },
] as const;

export function RechtlichesPage() {
  const { section } = useParams<{ section: string }>();
  const active = SECTIONS.find((s) => s.key === section);
  if (!active) return <Navigate to="/rechtliches/lizenz" replace />;

  return (
    <div data-testid="rechtliches-page" style={{ maxWidth: 920, margin: "0 auto" }}>
      <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap", borderBottom: "1px solid var(--border)", marginBottom: "1.4rem", paddingBottom: "0.2rem" }}>
        {SECTIONS.map((s) => (
          <Link
            key={s.key}
            to={`/rechtliches/${s.key}`}
            data-testid={`rechtliches-sec-${s.key}`}
            style={{
              display: "inline-flex", alignItems: "center", padding: "0.5rem 0.9rem",
              fontFamily: MONO, fontSize: "0.72rem", letterSpacing: "0.03em", borderRadius: 0,
              textDecoration: "none", borderBottom: "2px solid transparent",
              color: s.key === active.key ? "var(--cyan)" : "var(--dim)",
              borderBottomColor: s.key === active.key ? "var(--cyan)" : "transparent",
            }}
          >
            {s.label}
          </Link>
        ))}
      </div>
      <DocPage slug={active.slug} />
    </div>
  );
}
