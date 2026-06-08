// FR-P1 step 6: cache Fleetyards.net ship data locally (top-down silhouette +
// hardpoint counts) for the seat/turret card. Best-effort: a failed/empty sync
// just means no silhouette — the card falls back to the abstract seat chips.
// Mirrors the ship-catalog sync pattern (DB cache + sync-state singleton).

import { prisma } from "../db.js";

const FY_BASE = "https://api.fleetyards.net/v1";

/** Normalize a ship name for loose matching (Fleetyards slugs ≠ wiki slugs). */
export function normShipName(name: string): string {
  return String(name || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

type FyModel = Record<string, unknown>;

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function pick(...vals: unknown[]): string | null {
  for (const v of vals) {
    const s = str(v);
    if (s) return s;
  }
  return null;
}

// Defensive extraction across a few plausible Fleetyards field shapes.
function extract(m: FyModel): { silhouette: string | null; store: string | null } {
  const media = obj(m.media);
  const silhouette = pick(
    obj(media.fleetchart).source,
    obj(media.fleetchartImage).source,
    m.fleetchartImage,
    obj(media.topView).source,
    m.topView,
  );
  const store = pick(
    obj(media.storeImage).source,
    obj(media.storeImageMedium).source,
    m.storeImage,
  );
  return { silhouette, store };
}

/** Pull the Fleetyards model list into the local cache. Returns count synced. */
export async function syncFleetyards(): Promise<{ count: number }> {
  await prisma.fleetyardsSyncState.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", running: true },
    update: { running: true },
  });
  let count = 0;
  try {
    for (let page = 1; page <= 30; page++) {
      const res = await fetch(`${FY_BASE}/models?perPage=240&page=${page}`, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) break;
      const list = (await res.json()) as FyModel[];
      if (!Array.isArray(list) || list.length === 0) break;
      for (const m of list) {
        const slug = str(m.slug);
        if (!slug) continue;
        const name = str(m.name) ?? "";
        const { silhouette, store } = extract(m);
        const data = {
          name,
          nameKey: normShipName(name),
          silhouetteUrl: silhouette,
          storeImageUrl: store,
          hardpointsJson: JSON.stringify(m.hardpoints ?? []),
          rawJson: JSON.stringify(m),
        };
        await prisma.fleetyardsShip.upsert({
          where: { slug },
          create: { slug, ...data },
          update: { ...data, syncedAt: new Date() },
        });
        count++;
      }
      if (list.length < 240) break;
    }
    await prisma.fleetyardsSyncState.update({
      where: { id: "singleton" },
      data: { running: false, lastRunAt: new Date(), lastResult: `OK ${count} models`, shipCount: count },
    });
    return { count };
  } catch (e) {
    await prisma.fleetyardsSyncState
      .update({
        where: { id: "singleton" },
        data: { running: false, lastRunAt: new Date(), lastResult: `ERROR ${(e as Error).message}` },
      })
      .catch(() => {});
    throw e;
  }
}

/** Map normalized ship name → silhouette URL for the given names (one query). */
export async function silhouettesFor(names: string[]): Promise<Map<string, string>> {
  const keys = [...new Set(names.map(normShipName).filter(Boolean))];
  if (keys.length === 0) return new Map();
  const rows = await prisma.fleetyardsShip.findMany({
    where: { nameKey: { in: keys }, silhouetteUrl: { not: null } },
    select: { nameKey: true, silhouetteUrl: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) if (r.silhouetteUrl) map.set(r.nameKey, r.silhouetteUrl);
  return map;
}

/** Kick a sync on boot if the cache is empty or stale (fire-and-forget). */
export async function ensureFleetyardsFresh(): Promise<void> {
  try {
    const state = await prisma.fleetyardsSyncState.findUnique({ where: { id: "singleton" } });
    const count = await prisma.fleetyardsShip.count();
    const staleMs = (state?.intervalDays ?? 7) * 24 * 60 * 60 * 1000;
    const last = state?.lastRunAt?.getTime() ?? 0;
    if (state?.enabled === false) return;
    if (state?.running) return;
    if (count > 0 && Date.now() - last < staleMs) return;
    await syncFleetyards();
  } catch {
    /* best-effort */
  }
}
