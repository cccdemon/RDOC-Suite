/** Bridge URL default.
 *
 *  Production builds ship with an EMPTY default: the EXE is portable
 *  and meant to work on any deployment, so the user must enter their
 *  bridge URL once via the Settings modal. The value persists in the
 *  Tauri store from then on.
 *
 *  Dev runs (`pnpm dev` / `tauri:dev`) fall back to `http://localhost:8787`
 *  so the developer doesn't have to fill in the field every time the
 *  store is cleared. If a deployer wants to build a pre-configured EXE
 *  for their crew, they can set `VITE_BRIDGE_URL` at build time. */
const envBridgeUrl =
  (typeof import.meta !== "undefined" &&
    (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_BRIDGE_URL) ||
  "";
const devFallback =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV
    ? "http://localhost:8787"
    : "";

export const DEFAULT_BRIDGE_URL = envBridgeUrl || devFallback;

/** Default to the back-side mouse button (Mouse4), which gaming mice
 *  almost universally expose. Keyboard alternatives (Alt+F1,
 *  Ctrl+Shift+T, etc.) work too; see hotkey.ts for the dispatch. */
export const DEFAULT_HOTKEY = "Mouse4";

export type CompanionConfig = {
  bridgeHttpUrl: string;
  bridgeWsUrl: string;
};

/** Derive HTTP + WS endpoints from the user-configured bridge URL.
 *  Pass the value from the Settings store; the function itself does
 *  not touch the store so it stays trivially testable + pure. */
export function buildConfig(bridgeUrl: string): CompanionConfig {
  const http = bridgeUrl.replace(/\/+$/, "");
  const ws = http.replace(/^http/i, (m) => (m === "http" ? "ws" : "wss"));
  return { bridgeHttpUrl: http, bridgeWsUrl: ws };
}
