import { buildConfig } from "./config";

export type SuiteCapabilities = {
  /** User may open Admiral-only session controls. */
  canManageSessions: boolean;
  /** User may publish to the Discord relay / Voice-to-All room. */
  canUseRelay: boolean;
  /** Fleet tools are available on the deployment. Kept web-first for now. */
  canUseFleetTools: boolean;
};

export const DEFAULT_SUITE_CAPABILITIES: SuiteCapabilities = {
  canManageSessions: false,
  canUseRelay: false,
  canUseFleetTools: false,
};

function parseCapabilities(input: unknown): SuiteCapabilities {
  if (!input || typeof input !== "object") return DEFAULT_SUITE_CAPABILITIES;
  const obj = input as Partial<Record<keyof SuiteCapabilities, unknown>>;
  return {
    canManageSessions: obj.canManageSessions === true,
    canUseRelay: obj.canUseRelay === true,
    canUseFleetTools: obj.canUseFleetTools === true,
  };
}

/** Best-effort capability lookup. Old bridges do not expose this endpoint,
 * so failures intentionally resolve to Commander-only defaults. */
export async function loadSuiteCapabilities(opts: {
  bridgeUrl: string;
  token: string;
  guildId: string;
}): Promise<SuiteCapabilities> {
  const { bridgeHttpUrl } = buildConfig(opts.bridgeUrl);
  try {
    const url = new URL(`${bridgeHttpUrl}/suite/capabilities`);
    url.searchParams.set("guildId", opts.guildId);
    const res = await fetch(url, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (!res.ok) return DEFAULT_SUITE_CAPABILITIES;
    return parseCapabilities(await res.json());
  } catch {
    return DEFAULT_SUITE_CAPABILITIES;
  }
}
