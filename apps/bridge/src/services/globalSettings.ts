import { getPrisma } from "@rdoc-suite/db";

/**
 * Raumdock-wide gates that are NOT part of the per-guild tenant system.
 * Stored as a single row (id = "global"). Configured by the protected
 * bootstrap admiral via the bridge admin UI — never via .env.
 */
export type GlobalSettings = {
  /** Discord guild the global role gates check membership against. */
  raumdockGuildId: string | null;
  /** Role required (in raumdockGuildId) to use bridge mode / Squad Link. */
  bridgeRequiredRoleId: string | null;
  /** Role required (in raumdockGuildId) to get a relay publisher token. */
  relayRequiredRoleId: string | null;
  updatedAt: Date | null;
  updatedById: string | null;
};

const EMPTY: GlobalSettings = {
  raumdockGuildId: null,
  bridgeRequiredRoleId: null,
  relayRequiredRoleId: null,
  updatedAt: null,
  updatedById: null,
};

const SINGLETON_ID = "global";

/** Read the singleton. Returns empty defaults when never configured. */
export async function getGlobalSettings(): Promise<GlobalSettings> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (await (getPrisma() as any).globalSettings.findUnique({
    where: { id: SINGLETON_ID },
  })) as GlobalSettings | null;
  if (!row) return { ...EMPTY };
  return {
    raumdockGuildId: row.raumdockGuildId ?? null,
    bridgeRequiredRoleId: row.bridgeRequiredRoleId ?? null,
    relayRequiredRoleId: row.relayRequiredRoleId ?? null,
    updatedAt: row.updatedAt ?? null,
    updatedById: row.updatedById ?? null,
  };
}

/** Upsert the singleton. Empty strings are normalised to null (cleared). */
export async function saveGlobalSettings(
  patch: {
    raumdockGuildId?: string | null;
    bridgeRequiredRoleId?: string | null;
    relayRequiredRoleId?: string | null;
  },
  updatedById: string,
): Promise<GlobalSettings> {
  const norm = (v: string | null | undefined): string | null => {
    const t = (v ?? "").trim();
    return t === "" ? null : t;
  };
  const data: Record<string, unknown> = { updatedById };
  if (patch.raumdockGuildId !== undefined) data.raumdockGuildId = norm(patch.raumdockGuildId);
  if (patch.bridgeRequiredRoleId !== undefined)
    data.bridgeRequiredRoleId = norm(patch.bridgeRequiredRoleId);
  if (patch.relayRequiredRoleId !== undefined)
    data.relayRequiredRoleId = norm(patch.relayRequiredRoleId);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const row = (await (getPrisma() as any).globalSettings.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      raumdockGuildId: norm(patch.raumdockGuildId),
      bridgeRequiredRoleId: norm(patch.bridgeRequiredRoleId),
      relayRequiredRoleId: norm(patch.relayRequiredRoleId),
      updatedById,
    },
    update: data,
  })) as GlobalSettings;
  return {
    raumdockGuildId: row.raumdockGuildId ?? null,
    bridgeRequiredRoleId: row.bridgeRequiredRoleId ?? null,
    relayRequiredRoleId: row.relayRequiredRoleId ?? null,
    updatedAt: row.updatedAt ?? null,
    updatedById: row.updatedById ?? null,
  };
}
