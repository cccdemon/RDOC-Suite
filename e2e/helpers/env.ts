// Where the suite points. Default is the LOCAL TEST STACK (docker-compose.test.yml),
// not production — running the E2E suite must not require a live instance or a
// backdoor secret on a public host.
//
//   local stack : E2E_BASE_URL=http://localhost:8099   E2E_BASE_PATH=""
//   production  : E2E_BASE_URL=https://suite.raumdock.org  E2E_BASE_PATH="/fleetplanner"

export const BASE = (process.env.E2E_BASE_URL ?? "http://localhost:8099").replace(/\/+$/, "");

// Path prefix the app is mounted under. Empty on the local stack (nginx is hit
// directly); "/fleetplanner" in production (Caddy adds the prefix).
export const BASE_PATH = (process.env.E2E_BASE_PATH ?? "").replace(/\/+$/, "");

/** App root, no trailing slash: `http://localhost:8099` or `https://…/fleetplanner`. */
export const APP = `${BASE}${BASE_PATH}`;

/** Cookies can only carry `secure` over https — the local stack is plain http. */
export const SECURE_COOKIES = new URL(BASE).protocol === "https:";

export const HOSTNAME = new URL(BASE).hostname;

/** Discord simulator control plane (tests/discord-mock). Absent → Discord specs skip. */
export const DISCORD_MOCK_URL = process.env.E2E_DISCORD_MOCK_URL?.replace(/\/+$/, "") ?? "";
