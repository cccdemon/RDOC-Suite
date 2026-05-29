// DCCC Admin PWA service worker.
// Goal: make the admin shell installable. Strategy is network-first
// for everything in scope so JS/CSS fixes propagate to installed PWA
// instances on the next reload instead of needing two cold-starts to
// flush a stale-while-revalidate cache. The cache acts as an offline
// fallback only.
//
// Scope is whatever directory this file lives in (currently
// /admin/static/ or /dccc/admin/static/). Browsers don't let us claim
// a wider scope without a Service-Worker-Allowed response header,
// which we don't set; we'd rather not control the page navigations
// anyway.

// Bump the cache version whenever the shell file list changes or we
// need to force-evict every cached asset on the next activation.
const CACHE = "dccc-admin-shell-v2";
const SCOPE = self.location.pathname.replace(/sw\.js$/, "");
const SHELL_FILES = [
  "admin.css",
  "colors_and_type.css",
  "admin.js",
  "manifest.webmanifest",
  "pwa-icons/icon-192.png",
  "pwa-icons/icon-512.png",
];
const SHELL_URLS = SHELL_FILES.map((f) => SCOPE + f);

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // addAll fails atomically if any single file 404s — we want
      // graceful per-file behaviour so a missing icon doesn't break
      // the install entirely.
      await Promise.all(
        SHELL_URLS.map(async (u) => {
          try {
            const resp = await fetch(u, { cache: "reload" });
            if (resp.ok) await cache.put(u, resp);
          } catch {
            // ignore — fallthrough at fetch-time
          }
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return; // pass-through writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // cross-origin: untouched
  if (!url.pathname.startsWith(SCOPE)) return; // out of scope: untouched

  // Network-first. Hit the network, refresh the cache on success,
  // fall back to cache only when offline. Trade-off: every visit
  // costs a network round-trip; benefit: bug fixes in JS/CSS land
  // immediately on the next reload.
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const resp = await fetch(req);
        if (resp.ok && SHELL_URLS.includes(url.pathname)) {
          cache.put(req, resp.clone()).catch(() => {});
        }
        return resp;
      } catch {
        const cached = await cache.match(req, { ignoreVary: true });
        if (cached) return cached;
        return new Response("Offline. Bitte Verbindung pruefen.", {
          status: 503,
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
