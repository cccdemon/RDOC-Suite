import { Navigate, useParams } from "react-router-dom";
import { DocPage } from "./DocPage";
import { LinkTabs } from "../components/ui";
import { useSeo } from "../seo";
import { Breadcrumbs } from "../components/Breadcrumbs";

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
  useSeo({ title: active ? `${active.label} — Rechtliches` : "Rechtliches" });
  if (!active) return <Navigate to="/rechtliches/lizenz" replace />;

  return (
    <div data-testid="rechtliches-page" style={{ width: "100%" }}>
      <Breadcrumbs items={[{ label: "Rechtliches", to: "/rechtliches" }, { label: active.label }]} />
      <LinkTabs
        ariaLabel="Rechtliche Dokumente"
        panelId="rechtliches-panel"
        activeKey={active.key}
        testid={(k) => `rechtliches-sec-${k}`}
        items={SECTIONS.map((x) => ({ key: x.key, label: x.label, to: `/rechtliches/${x.key}` }))}
      />
      <div role="tabpanel" id="rechtliches-panel" aria-labelledby={`rechtliches-panel-tab-${active.key}`} tabIndex={-1}>
        <DocPage slug={active.slug} />
      </div>
    </div>
  );
}
