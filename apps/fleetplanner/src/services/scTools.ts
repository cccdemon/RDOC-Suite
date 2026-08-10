// Star Citizen community tools — external links rendered as OpenGraph cards.
// We fetch each site's og:title / og:description / og:image once and cache it
// (24h), falling back to a curated name/description when a site has no OG.

export type ToolCard = {
  url: string;
  domain: string;
  name: string;
  desc: string;
  image: string | null;
};

const TOOLS: Array<{ url: string; name: string; desc: string }> = [
  { url: "https://rjcncpt.github.io/StarCitizen-Deutsch-INI/", name: "SC Deutsch INI", desc: "Deutsche Sprachdatei (global.ini) für Star Citizen." },
  { url: "https://scmdb.net/", name: "SCMDB", desc: "Star Citizen Mobi / Datenbank für Schiffe & Items." },
  { url: "https://www.erkul.games/", name: "Erkul DPS Calculator", desc: "Ship-Loadout- & DPS-Rechner." },
  { url: "https://www.spviewer.eu/", name: "SPViewer", desc: "Schiffsdaten, Performance & Vergleiche." },
  { url: "https://uexcorp.space/", name: "UEX Corp", desc: "Handels-, Preis- & Routen-Daten." },
  { url: "https://finder.cstone.space/", name: "Cornerstone Finder", desc: "Item- & Komponenten-Finder." },
  { url: "https://sc-cargo.space/#/v1/viewer", name: "SC Cargo Viewer", desc: "Cargo-Deck- / Grid-Viewer." },
  { url: "https://www.sc-deutsch-launcher.de/", name: "SC Deutsch Launcher", desc: "Launcher für die deutsche Übersetzung." },
  { url: "https://mining.doesi.wtf/", name: "Doesi Mining", desc: "Mining-Rechner & Refinery-Optimierung." },
  { url: "https://subraum.cc/", name: "Subraum", desc: "Subraum — channelübergreifendes Commander-Voice (frueher RDOC Squad Link)." },
];

const cache = new Map<string, { card: ToolCard; at: number }>();
const TTL_MS = 24 * 60 * 60 * 1000;

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

async function fetchOg(t: { url: string; name: string; desc: string }): Promise<ToolCard> {
  let domain = t.url;
  try {
    domain = new URL(t.url).hostname.replace(/^www\./, "");
  } catch {
    /* keep raw */
  }
  const base: ToolCard = { url: t.url, domain, name: t.name, desc: t.desc, image: null };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(t.url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; RDOC-Fleetplanner OG)" },
    }).finally(() => clearTimeout(timer));
    if (!res.ok) return base;
    const html = (await res.text()).slice(0, 120000);
    const og = (prop: string): string | null => {
      const m =
        html.match(
          new RegExp(`<meta[^>]+(?:property|name)=["']og:${prop}["'][^>]+content=["']([^"']+)["']`, "i"),
        ) ??
        html.match(
          new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']og:${prop}["']`, "i"),
        );
      return m ? decodeEntities(m[1]) : null;
    };
    let image = og("image");
    if (image) {
      try {
        image = new URL(image, t.url).href;
      } catch {
        image = null;
      }
    }
    return {
      ...base,
      name: og("title") || base.name,
      desc: og("description") || base.desc,
      image: image ?? null,
    };
  } catch {
    return base;
  }
}

/** OG cards for all SC tools (per-URL 24h cache; failures fall back to curated). */
export async function getScToolCards(): Promise<ToolCard[]> {
  const now = Date.now();
  return Promise.all(
    TOOLS.map(async (t) => {
      const hit = cache.get(t.url);
      if (hit && now - hit.at < TTL_MS) return hit.card;
      const card = await fetchOg(t);
      cache.set(t.url, { card, at: now });
      return card;
    }),
  );
}
