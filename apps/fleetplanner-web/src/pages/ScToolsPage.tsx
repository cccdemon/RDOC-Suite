import { DocPage } from "./DocPage";
import { useSeo } from "../seo";
import { useT } from "../i18n";

// Top-level SC-Tools view (promoted out of the Handbuch hub). Content still comes
// from the backend (GET /api/v1/content/sc-tools → OG cards for the curated tools).
export function ScToolsPage() {
  const t = useT();
  useSeo({
    title: `${t("nav.scTools")} — ${t("handbuch.title")}`,
    description: "Star-Citizen-Tools rund um Flotten- und Operationsplanung im RDOC Fleetplanner.",
  });
  return <DocPage slug="sc-tools" />;
}
