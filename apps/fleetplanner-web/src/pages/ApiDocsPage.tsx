import { useEffect, useRef } from "react";
import { API_BASE } from "../api/client";
import "swagger-ui-dist/swagger-ui.css";
import { Breadcrumbs } from "../components/Breadcrumbs";

// Interactive API reference. Swagger UI is bundled into the SPA (same-origin, so
// it passes the strict app CSP — no unpkg CDN) and renders the live
// /api/v1/openapi.json document. The backend is API-only and serves only the
// spec as data; it renders no HTML/JS docs page.
export function ApiDocsPage() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    void import("swagger-ui-dist/swagger-ui-bundle.js").then((mod) => {
      if (cancelled || !ref.current) return;
      const SwaggerUIBundle = mod.default;
      SwaggerUIBundle({
        url: `${API_BASE}/openapi.json`,
        domNode: ref.current,
        deepLinking: true,
        tryItOutEnabled: true,
        // Cookie session is sent same-origin automatically.
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ width: "100%" }}>
      {/* Developer surface, reachable from the sidebar foot — not primary nav. */}
      <Breadcrumbs items={[{ label: "Fleetplanner", to: "/" }, { label: "Entwickler" }, { label: "API-Doku" }]} />
      <div
        data-testid="api-docs"
        ref={ref}
        style={{ background: "var(--text-hi)", borderRadius: 8, overflow: "hidden" }}
      />
    </div>
  );
}
