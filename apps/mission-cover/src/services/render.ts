import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { getEnv, allowedImageHosts } from "../config/env.js";
import { cssDimensions, type EngineConfig } from "./prefill.js";

let _browser: Browser | null = null;

async function browser(): Promise<Browser> {
  if (!_browser || !_browser.isConnected()) {
    _browser = await chromium.launch({
      headless: true,
      // No --no-sandbox: rely on the container running as a non-root user with
      // the Playwright base image's sandbox support intact.
      args: ["--disable-dev-shm-usage", "--force-color-profile=srgb"],
    });
  }
  return _browser;
}

export async function closeBrowser(): Promise<void> {
  if (_browser) {
    await _browser.close().catch(() => {});
    _browser = null;
  }
}

export type RenderResult = { png: Buffer; width: number; height: number };

// Fixed font CDNs the engine's CSS pulls. Always allowed (not user-supplied →
// no SSRF surface) so webfonts render correctly. Everything else off the
// configured allowlist is blocked.
const ALWAYS_ALLOW_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com"];

// Serialize renders — one Chromium, bounded memory.
let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task, task);
  queue = run.catch(() => {});
  return run;
}

// Render directly from a full engine config (editor save round-trip). The
// format is read from the config's own coverFormat.
export function renderEngineConfig(config: EngineConfig, bg: string | null): Promise<RenderResult> {
  const format = (typeof config.coverFormat === "string" ? config.coverFormat : "16:9") as
    | "16:9" | "1:1" | "9:16" | "4:3" | "custom";
  const { w, h } = cssDimensions(
    format,
    { title: "" },
    config,
  );
  return enqueue(() => doRender(config, bg, w, h));
}

async function doRender(config: EngineConfig, bg: string | null, w: number, h: number): Promise<RenderResult> {
  const env = getEnv();
  const allow = allowedImageHosts();

  const b = await browser();
  const ctx = await b.newContext({
    deviceScaleFactor: env.RENDER_SCALE,
    viewport: { width: w + 80, height: h + 80 },
    // Engine persists to localStorage; isolate per render via a fresh context.
  });

  // Egress lockdown: allow the local bundle (file:), inline data:, and only
  // explicitly allowlisted image hosts. Everything else is aborted (anti-SSRF).
  await ctx.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file:") || url.startsWith("data:") || url.startsWith("blob:")) {
      return route.continue();
    }
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (ALWAYS_ALLOW_HOSTS.includes(host) || allow.includes(host)) return route.continue();
    } catch {
      /* fallthrough to abort */
    }
    return route.abort();
  });

  try {
    const page = await ctx.newPage();

    // Seed via window globals BEFORE the engine's scripts run. Globals (not
    // localStorage) so large uploaded images — background and custom logo data
    // URLs — never hit the localStorage quota and silently vanish.
    await page.addInitScript(
      (args: { config: unknown; bg: string | null }) => {
        (window as unknown as { __MC_CONFIG__: unknown }).__MC_CONFIG__ = args.config;
        (window as unknown as { __MC_BG__: string | null }).__MC_BG__ = args.bg;
        try {
          localStorage.setItem("star-citizen-cover-generator-lang", "de");
        } catch {
          /* ignore */
        }
      },
      { config, bg },
    );

    await page.goto(pathToFileURL(env.ENGINE_HTML).href, {
      waitUntil: "load",
      timeout: env.RENDER_TIMEOUT_MS,
    });

    const node = page.locator("#mission-cover-canvas");
    await node.waitFor({ state: "visible", timeout: env.RENDER_TIMEOUT_MS });

    // Pin the canvas for the shot. In the editor it is `width:100%` with a
    // max-width and an aspect-ratio, so its real size depends on the editor's
    // responsive layout: in a portrait viewport (9:16) it grew taller than the
    // window, Playwright scrolled to capture the element, and the sticky editor
    // toolbars slid into the frame — every non-16:9 export contained "PRESETS &
    // SCHRIFT" and half a cover. Fixed at 0,0 in exactly the requested size, with
    // everything else hidden, the export is the cover and nothing else.
    await page.addStyleTag({
      content: `
        html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; background: #000 !important; }
        body > * { visibility: hidden !important; }
        #mission-cover-canvas, #mission-cover-canvas * { visibility: visible !important; }
        /* Editor affordances are not cover content: the "load a background"
           hint and the dashed drag frames around the badges were both being
           baked into the delivered PNG. */
        #mission-cover-canvas [data-editor-only] { display: none !important; }
        #mission-cover-canvas [data-badge-frame] {
          border: 0 !important;
          background: transparent !important;
          backdrop-filter: none !important;
          box-shadow: none !important;
          padding: 0 !important;
        }
        #mission-cover-canvas {
          position: fixed !important;
          top: 0 !important;
          left: 0 !important;
          width: ${w}px !important;
          height: ${h}px !important;
          max-width: none !important;
          min-width: 0 !important;
          aspect-ratio: auto !important;
          transform: none !important;
          box-shadow: none !important;
          border: 0 !important;
          margin: 0 !important;
          z-index: 2147483647 !important;
        }
      `,
    });
    await page.evaluate(() => window.scrollTo(0, 0));

    // Let webfonts + QR + background settle before snapshot.
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    await page.waitForTimeout(400);

    const png = await node.screenshot({ type: "png", timeout: env.RENDER_TIMEOUT_MS });
    return { png, width: Math.round(w * env.RENDER_SCALE), height: Math.round(h * env.RENDER_SCALE) };
  } finally {
    await ctx.close().catch(() => {});
  }
}
