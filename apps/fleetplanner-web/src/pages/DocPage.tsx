import { useEffect, useState } from "react";
import { getContent } from "../api/client";
import { lbl } from "../components/ui";

// Renders a static info/legal page whose content the backend serves as data
// (/api/v1/content/:slug). The HTML is trusted first-party content authored in
// the backend, so dangerouslySetInnerHTML is acceptable here.
export function DocPage({ slug, lang }: { slug: string; lang?: "de" | "en" }) {
  const [doc, setDoc] = useState<{ title: string; html: string } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDoc(null);
    setFailed(false);
    getContent(slug, lang)
      .then(setDoc)
      .catch(() => setFailed(true));
  }, [slug, lang]);

  if (failed) return <div className="fpw-state"><span style={lbl}>SEITE NICHT GEFUNDEN</span></div>;
  if (!doc) return <div className="fpw-state"><span style={lbl}>LADE…</span></div>;

  return (
    <div
      className="fpw-doc"
      data-testid={`doc-${slug}`}
      style={{ width: "100%" }}
      dangerouslySetInnerHTML={{ __html: doc.html }}
    />
  );
}
