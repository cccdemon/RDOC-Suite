// Fleetyards.net integration. Two parts:
//   1. FR-P1 step 6 — cache Fleetyards ship data locally (top-down silhouette +
//      hardpoint counts) for the seat/turret card. Best-effort: a failed/empty
//      sync just means no silhouette — the card falls back to abstract seat chips.
//      Mirrors the ship-catalog sync pattern (DB cache + sync-state singleton).
//   2. Public-hangar fleet import — pull a player's owned hulls into their
//      hangar (see the "Public hangar import" section below).

import { prisma } from "../db.js";
import { applyFleetEntries, type FleetEntry, type FleetImportResult } from "./fleetImport.js";

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

// Fleetyards v1 shape: media.angledView = top-down "fleetchart" silhouette,
// media.storeImage = promo render. Each has url + smallUrl.
function extract(m: FyModel): { silhouette: string | null; store: string | null } {
  const media = obj(m.media);
  const angled = obj(media.angledView);
  const store = obj(media.storeImage);
  return {
    silhouette: pick(angled.smallUrl, angled.url),
    store: pick(store.smallUrl, store.url),
  };
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
      const body = (await res.json()) as { items?: FyModel[] };
      const list = Array.isArray(body.items) ? body.items : [];
      if (list.length === 0) break;
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

// ── Public hangar import ───────────────────────────────────────────────
// A Fleetyards player can make their hangar public; it is then readable without
// auth at /v1/public/hangars/:username. One item = one hull (duplicates of a
// model appear as separate items), so hull counts fall out of the item list.
// The endpoint answers 404 for an unknown user and an EMPTY item list both for
// an empty hangar and for a hangar that is not public — the two are not
// distinguishable from outside, so the caller surfaces one combined hint.

/** How many pages of 240 to walk before giving up (Fleetyards caps perPage at 240). */
const HANGAR_MAX_PAGES = 10;

export class FleetyardsUserNotFound extends Error {
  constructor(username: string) {
    super(`No Fleetyards user "${username}".`);
    this.name = "FleetyardsUserNotFound";
  }
}

export type FleetyardsHull = {
  /** Fleetyards model slug, e.g. "orig-325a" — the reliable join key. */
  modelSlug: string | null;
  /** Fleetyards model name, e.g. "325a" — fallback when the slug is unknown here. */
  modelName: string;
  loaner: boolean;
};

/** Fleetyards usernames are alphanumeric plus _ and -; reject anything else so
 *  nothing user-supplied can escape the path segment. */
export function isValidFleetyardsUsername(name: string): boolean {
  return /^[A-Za-z0-9_-]{2,64}$/.test(name);
}

/** Fetch every hull in a player's PUBLIC Fleetyards hangar. */
export async function fetchPublicHangar(username: string): Promise<FleetyardsHull[]> {
  if (!isValidFleetyardsUsername(username)) throw new FleetyardsUserNotFound(username);
  const hulls: FleetyardsHull[] = [];
  for (let page = 1; page <= HANGAR_MAX_PAGES; page++) {
    const url = `${FY_BASE}/public/hangars/${encodeURIComponent(username)}?perPage=240&page=${page}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(20000),
    });
    if (res.status === 404) throw new FleetyardsUserNotFound(username);
    if (!res.ok) throw new Error(`Fleetyards returned ${res.status}.`);
    const body = (await res.json()) as { items?: unknown };
    const list = Array.isArray(body.items) ? body.items : [];
    for (const raw of list) {
      const item = obj(raw);
      const model = obj(item.model);
      const modelName = str(model.name);
      const modelSlug = str(model.slug);
      if (!modelName && !modelSlug) continue;
      hulls.push({ modelSlug, modelName: modelName ?? "", loaner: item.loaner === true });
    }
    if (list.length < 240) break;
  }
  return hulls;
}

/**
 * Resolve Fleetyards hulls to local catalog ships and merge them into the
 * player's hangar. Matching order per hull:
 *   1. Fleetyards slug → local FleetyardsShip cache → its normalized name
 *   2. the raw Fleetyards model name
 * Both end up in the shared name matcher, so a stale/missing cache only costs
 * accuracy, never the import.
 */
export async function importFleetFromFleetyards(
  userId: string,
  username: string,
): Promise<FleetImportResult & { loaners: number }> {
  const hulls = await fetchPublicHangar(username);

  // One query for every slug in the hangar: slug → the cached Fleetyards name,
  // which is what the local catalog was matched against during the model sync.
  const slugs = [...new Set(hulls.map((h) => h.modelSlug).filter((s): s is string => !!s))];
  const cached =
    slugs.length > 0
      ? await prisma.fleetyardsShip.findMany({
          where: { slug: { in: slugs } },
          select: { slug: true, name: true },
        })
      : [];
  const nameBySlug = new Map(cached.map((c) => [c.slug, c.name]));

  const entries: FleetEntry[] = hulls.map((h) => ({
    name: (h.modelSlug ? nameBySlug.get(h.modelSlug) : null) || h.modelName,
    loaner: h.loaner,
  }));

  const result = await applyFleetEntries(userId, entries);
  return { ...result, loaners: hulls.filter((h) => h.loaner).length };
}
