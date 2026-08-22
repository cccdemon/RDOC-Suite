import { Link } from "react-router-dom";
import { Ic } from "./Icons";
import { MONO } from "./ui";

// IA goal 10 — detail and sub screens say where they sit and offer one obvious
// way back. Purely structural: same mono/dim type the eyebrows already use, no
// new colours, no new brand elements.
export type Crumb = { label: string; to?: string };

const crumbStyle: React.CSSProperties = {
  fontFamily: MONO,
  fontSize: "0.62rem",
  letterSpacing: "0.08em",
  color: "var(--dim2)",
  textTransform: "uppercase",
};

export function Breadcrumbs({ items, testid = "breadcrumbs" }: { items: Crumb[]; testid?: string }) {
  if (items.length === 0) return null;
  // The nearest linked ancestor is the "back" target — the last crumb is the
  // page itself and never links anywhere.
  const parent = [...items.slice(0, -1)].reverse().find((c) => c.to);

  return (
    <nav data-testid={testid} aria-label="Breadcrumb" style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap", marginBottom: "0.9rem" }}>
      {parent?.to && (
        <Link
          to={parent.to}
          data-testid={`${testid}-back`}
          style={{ ...crumbStyle, display: "inline-flex", alignItems: "center", gap: 5, textDecoration: "none", border: "1px solid var(--border)", borderRadius: 7, padding: "0.25rem 0.55rem" }}
        >
          <Ic name="back" size={12} sw={1.7} /> {parent.label}
        </Link>
      )}
      <ol style={{ display: "flex", alignItems: "center", gap: "0.4rem", flexWrap: "wrap", listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((c, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${c.label}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem" }}>
              {i > 0 && <span style={{ ...crumbStyle, color: "var(--dim3, var(--dim2))" }}>/</span>}
              {c.to && !last ? (
                <Link to={c.to} style={{ ...crumbStyle, textDecoration: "none" }}>
                  {c.label}
                </Link>
              ) : (
                <span aria-current={last ? "page" : undefined} style={{ ...crumbStyle, color: last ? "var(--dim)" : "var(--dim2)" }}>
                  {c.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
