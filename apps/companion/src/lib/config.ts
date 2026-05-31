const isDev =
  typeof import.meta !== "undefined" &&
  (import.meta as { env?: { DEV?: boolean } }).env?.DEV === true;

export const DEFAULT_BRIDGE_URL = isDev
  ? "http://localhost:8787"
  : "https://suite.raumdock.org";

export const DEFAULT_FLEETPLANNER_URL = isDev
  ? "http://localhost:3200/fleetplanner"
  : "https://suite.raumdock.org/fleetplanner";

export const DEFAULT_HOTKEY = "Mouse4";

export const DEFAULT_RELAY_HOTKEY = "R";

export type CompanionConfig = {
  bridgeHttpUrl: string;
  bridgeWsUrl: string;
};

export function buildConfig(bridgeUrl: string): CompanionConfig {
  const http = bridgeUrl.replace(/\/+$/, "");
  const ws = http.replace(/^http/i, (m) => (m === "http" ? "ws" : "wss"));
  return { bridgeHttpUrl: http, bridgeWsUrl: ws };
}
