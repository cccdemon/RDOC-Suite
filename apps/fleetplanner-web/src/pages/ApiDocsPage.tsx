import { useEffect, useRef } from "react";
import { API_BASE } from "../api/client";
import "swagger-ui-dist/swagger-ui.css";

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
    <div
      data-testid="api-docs"
      ref={ref}
      style={{ background: "#fff", borderRadius: 8, overflow: "hidden" }}
    />
  );
}
