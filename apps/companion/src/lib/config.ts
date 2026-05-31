export const DEFAULT_BRIDGE_URL = "https://suite.raumdock.org";

export const DEFAULT_FLEETPLANNER_URL = "https://suite.raumdock.org/fleetplanner";

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
