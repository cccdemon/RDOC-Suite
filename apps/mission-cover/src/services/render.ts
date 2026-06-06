import { pathToFileURL } from "node:url";
import { chromium, type Browser } from "playwright";
import { getEnv, allowedImageHosts } from "../config/env.js";
import { buildEngineConfig, cssDimensions, type EngineConfig } from "./prefill.js";
import type { CoverRequest } from "../schema.js";

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

export function renderCover(req: CoverRequest): Promise<RenderResult> {
  const config = buildEngineConfig(req);
  const { w, h } = cssDimensions(req.format, req.data, config);
  const bg = req.data.backgroundImage ?? null;
  return enqueue(() => doRender(config, bg, w, h));
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

    // Let webfonts + QR + background settle before snapshot.
    await page.evaluate(() => (document as any).fonts?.ready).catch(() => {});
    await page.waitForTimeout(400);

    const png = await node.screenshot({ type: "png", timeout: env.RENDER_TIMEOUT_MS });
    return { png, width: Math.round(w * env.RENDER_SCALE), height: Math.round(h * env.RENDER_SCALE) };
  } finally {
    await ctx.close().catch(() => {});
  }
}
