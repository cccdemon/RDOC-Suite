/** App version + build metadata, baked into the bundle at compile
 *  time by vite.config.ts. See vite-env.d.ts for the declared globals. */

export const APP_VERSION = __APP_VERSION__;
export const APP_BUILD = __APP_BUILD__;
export const APP_HASH = __APP_HASH__;
export const APP_BUILT_AT = __APP_BUILT_AT__;

/** "v0.0.0 · build 234 (abc1234)" — compact, footer-sized. */
export function shortVersion(): string {
  return `v${APP_VERSION} · build ${APP_BUILD} (${APP_HASH})`;
}

/** "v0.0.0 build 234 (abc1234) — 2026-05-24T15:45:24Z" — for the
 *  About modal / a tooltip / a diagnostic copy-to-clipboard. */
export function longVersion(): string {
  return `v${APP_VERSION} build ${APP_BUILD} (${APP_HASH}) — ${APP_BUILT_AT}`;
}
