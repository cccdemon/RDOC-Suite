// Star Citizen wiki API client + ship cache service

import { prisma } from "../db.js";
import type { Ship } from "@prisma/client";

const WIKI_BASE = "https://api.star-citizen.wiki/api/v2";
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// ── Raw API shapes ─────────────────────────────────────────────────

interface WikiVehicleList {
  data: WikiVehicleStub[];
  meta?: { last_page?: number; current_page?: number };
}

interface WikiVehicleStub {
  slug: string;
  name: string;
}

interface WikiVehicleDetail {
  data: WikiVehicleData;
}

interface WikiVehicleData {
  slug: string;
  name: string;
  manufacturer?: { name?: string };
  size?: string | number | Record<string, unknown>;
  career?: { name?: string } | string;
  role?: { name?: string } | string;
  crew?: { min?: number; max?: number; weapon?: number; operation?: number };
  media?: Array<{ source_url?: string }>;
}

// ── Normalise wiki response → our Ship shape ───────────────────────

function normalise(d: WikiVehicleData): Omit<Ship, "id" | "syncedAt"> {
  const career = typeof d.career === "object" ? (d.career?.name ?? "") : (d.career ?? "");
  const role   = typeof d.role   === "object" ? (d.role?.name   ?? "") : (d.role   ?? "");
  const size   = labelFromWikiValue(d.size);
  return {
    slug:          d.slug,
    name:          d.name,
    manufacturer:  d.manufacturer?.name ?? "",
    size,
    career,
    role,
    minCrew:       d.crew?.min       ?? 1,
    maxCrew:       d.crew?.max       ?? 1,
    weaponCrew:    d.crew?.weapon    ?? 0,
    operationCrew: d.crew?.operation ?? 0,
    imageUrl:      d.media?.[0]?.source_url ?? null,
    rawJson:       JSON.stringify(d),
  };
}

function labelFromWikiValue(value: unknown): string {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const label = obj.en_EN ?? obj.name ?? obj.label ?? obj.type;
    return typeof label === "string" || typeof label === "number" ? String(label) : "";
  }
  return "";
}

// ── Search ships (local DB first, fall back to wiki) ───────────────

export async function searchShips(query: string, limit = 20): Promise<Ship[]> {
  const q = query.trim();
  if (!q) return [];

  const local = await prisma.ship.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    take: limit,
    orderBy: { name: "asc" },
  });
  if (local.length >= 5) return local;

  // Fetch from wiki and cache results
  try {
    const res = await fetch(`${WIKI_BASE}/vehicles?name=${encodeURIComponent(q)}&limit=20`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return local;
    const body = await res.json() as WikiVehicleList;
    for (const stub of body.data ?? []) {
      if (!stub.slug) continue;
      await fetchAndCacheShip(stub.slug).catch(() => null);
    }
    return prisma.ship.findMany({
      where: { name: { contains: q, mode: "insensitive" } },
      take: limit,
      orderBy: { name: "asc" },
    });
  } catch {
    return local;
  }
}

// ── Fetch single ship by slug (with cache) ─────────────────────────

export async function searchLocalShips(query: string, limit = 20): Promise<Ship[]> {
  const q = query.trim().slice(0, 80);
  const take = Math.min(Math.max(limit, 1), 100);
  if (!q) {
    return prisma.ship.findMany({
      take,
      orderBy: { name: "asc" },
    });
  }

  return prisma.ship.findMany({
    where: { name: { contains: q, mode: "insensitive" } },
    take,
    orderBy: { name: "asc" },
  });
}

export async function fetchAndCacheShip(slug: string, force = false): Promise<Ship | null> {
  const cached = await prisma.ship.findUnique({ where: { slug } });
  if (!force && cached && Date.now() - cached.syncedAt.getTime() < CACHE_TTL_MS) return cached;

  try {
    const res = await fetch(`${WIKI_BASE}/vehicles/${encodeURIComponent(slug)}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return cached;
    const body = await res.json() as WikiVehicleDetail;
    if (!body.data?.slug) return cached;
    const data = normalise(body.data);
    return prisma.ship.upsert({
      where: { slug },
      create: { ...data, syncedAt: new Date() },
      update: { ...data, syncedAt: new Date() },
    });
  } catch {
    return cached;
  }
}

// ── Full-catalog sync ──────────────────────────────────────────────
// Walks the whole SC-wiki vehicle list (paginated) and force-refreshes
// every ship into the local cache. Used by the weekly scheduler and the
// admin "Sync now" button. Returns a summary for the sync state row.

export type CatalogSyncResult = { fetched: number; failed: number; total: number };

export async function syncShipCatalog(
  onProgress?: (done: number, total: number) => void,
): Promise<CatalogSyncResult> {
  const slugs = await fetchAllVehicleSlugs();
  let fetched = 0;
  let failed = 0;
  for (const slug of slugs) {
    const ship = await fetchAndCacheShip(slug, true).catch(() => null);
    if (ship) fetched++;
    else failed++;
    onProgress?.(fetched + failed, slugs.length);
  }
  return { fetched, failed, total: slugs.length };
}

/** Paginate the wiki vehicle index and collect every slug. */
async function fetchAllVehicleSlugs(): Promise<string[]> {
  const slugs: string[] = [];
  const limit = 100;
  let page = 1;
  let lastPage = 1;
  do {
    const res = await fetch(`${WIKI_BASE}/vehicles?page=${page}&limit=${limit}`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) break;
    const body = (await res.json()) as WikiVehicleList;
    for (const stub of body.data ?? []) {
      if (stub.slug) slugs.push(stub.slug);
    }
    lastPage = body.meta?.last_page ?? page;
    page++;
  } while (page <= lastPage && page <= 100); // hard cap: never loop unbounded
  return slugs;
}

// ── Ship category for composition matching ─────────────────────────

export function shipCategory(ship: Ship): string {
  const size   = ship.size.toLowerCase();
  const career = ship.career.toLowerCase();
  if (size.includes("capital"))                              return "capital";
  if (size.includes("large") && career.includes("combat"))  return "subcapital";
  if ((size.includes("small") || size.includes("medium")) && career.includes("combat")) return "fighter";
  if (career.includes("support") || career.includes("medical") || career.includes("repair")) return "support";
  if (career.includes("ground") || career.includes("vehicle")) return "ground";
  if (career.includes("transport") || career.includes("cargo")) return "transport";
  if (career.includes("mining"))                                 return "mining";
  if (career.includes("salvage"))                                return "salvage";
  if (career.includes("exploration") || career.includes("pathfinder")) return "exploration";
  return "any";
}
