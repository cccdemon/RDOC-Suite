import { useEffect } from "react";

// SEO A1 — per-route document head. The SPA ships one static <head> (index.html);
// without this every route would share the same <title>/description/canonical.
// useSeo sets route-specific values on mount and whenever the inputs change.
// Crawler-side SSR meta (A2) is a separate, larger follow-up; this is the pure
// client-side quick win (Googlebot renders JS, just delayed).

const SITE = "RDOC Fleetplanner";

function upsertMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

function upsertCanonical(href: string) {
  let el = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!el) {
    el = document.createElement("link");
    el.rel = "canonical";
    document.head.appendChild(el);
  }
  el.href = href;
}

export type SeoInput = {
  /** Page title without the site suffix; " — RDOC Fleetplanner" is appended unless already present. */
  title: string;
  description?: string;
  /** Absolute canonical URL. Defaults to the current origin + pathname (no query/hash). */
  canonical?: string;
  /** Marks the page noindex,nofollow (e.g. login). */
  noindex?: boolean;
};

export function useSeo({ title, description, canonical, noindex }: SeoInput) {
  useEffect(() => {
    const full = title.includes(SITE) ? title : `${title} — ${SITE}`;
    document.title = full;

    const url = canonical ?? window.location.origin + window.location.pathname;
    upsertCanonical(url);

    upsertMeta("property", "og:title", full);
    upsertMeta("property", "og:url", url);
    upsertMeta("name", "twitter:title", full);

    if (description) {
      upsertMeta("name", "description", description);
      upsertMeta("property", "og:description", description);
      upsertMeta("name", "twitter:description", description);
    }

    upsertMeta("name", "robots", noindex ? "noindex, nofollow" : "index, follow");
  }, [title, description, canonical, noindex]);
}

/** Collapse markdown/whitespace and clamp for a meta description. */
export function metaText(raw: string, max = 155): string {
  const flat = raw
    .replace(/[#*_`>~\-]+/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  return flat.length > max ? flat.slice(0, max - 1).trimEnd() + "…" : flat;
}
