import { prisma } from "../db.js";
import type { Location } from "@prisma/client";
import { recordEvent, pruneSystemEvents } from "./systemEvents.js";

const LOCATIONS_API = "https://api.star-citizen.wiki/api/locations";
const SINGLETON_ID = "singleton";
const TICK_MS = 60 * 60 * 1000;
// A crashed/killed run (container restart, deploy mid-sync) leaves running=true
// forever and blocks every future sync. Treat a claim older than this as stale
// and re-claim it. A full catalog sync finishes well under this.
const STALE_RUN_MS = 30 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

type WikiLocation = {
  uuid?: string;
  slug?: string;
  name?: string;
  system?: string;
  star?: { name?: string; slug?: string };
  parent?: { name?: string; slug?: string } | null;
  type?: { name?: string; classification?: string } | null;
  hide_in_starmap?: boolean;
  hide_in_world?: boolean;
  has_resources?: boolean;
  web_url?: string;
};

type WikiLocationList = {
  data?: WikiLocation[];
  meta?: { current_page?: number; last_page?: number; total?: number };
};

function normalizeLocation(raw: WikiLocation): Omit<Location, "id" | "syncedAt"> | null {
  if (!raw.uuid || !raw.slug || !raw.name) return null;
  const systemName = raw.star?.name || String(raw.system || "").replace(/\s+System$/i, "");
  const systemSlug = raw.star?.slug || systemName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return {
    uuid: raw.uuid,
    slug: raw.slug,
    name: raw.name,
    system: systemName,
    systemSlug,
    parentName: raw.parent?.name ?? "",
    parentSlug: raw.parent?.slug ?? "",
    typeName: raw.type?.name ?? "",
    classification: raw.type?.classification ?? "",
    hidden: !!raw.hide_in_starmap || !!raw.hide_in_world,
    hasResources: !!raw.has_resources,
    webUrl: raw.web_url ?? null,
    rawJson: JSON.stringify(raw),
  };
}

export async function searchLocations(
  systemSlug?: string,
  query = "",
  limit = 300,
  onlyManmade = false,
): Promise<Location[]> {
  const q = query.trim().slice(0, 80);
  return prisma.location.findMany({
    where: {
      hidden: false,
      ...(systemSlug ? { systemSlug } : {}),
      ...(q ? { name: { contains: q, mode: "insensitive" } } : {}),
      ...(onlyManmade ? { classification: { equals: "Manmade", mode: "insensitive" } } : {}),
    },
    // No hard cap — manmade filter keeps result sets small enough.
    // Caller may still pass a limit for search-as-you-type UX.
    ...(limit > 0 ? { take: Math.min(limit, 5000) } : {}),
    orderBy: [{ system: "asc" }, { name: "asc" }],
  });
}

async function syncLocationCatalog(): Promise<{ fetched: number; failed: number; total: number }> {
  let fetched = 0;
  let failed = 0;
  let total = 0;
  let page = 1;
  let lastPage = 1;

  do {
    const url = `${LOCATIONS_API}?page%5Bsize%5D=100&page%5Bnumber%5D=${page}`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    if (!res.ok) throw new Error(`Location catalog fetch failed (${res.status})`);
    const body = await res.json() as WikiLocationList;
    total = body.meta?.total ?? total;
    lastPage = body.meta?.last_page ?? page;

    for (const raw of body.data ?? []) {
      const data = normalizeLocation(raw);
      if (!data) {
        failed++;
        continue;
      }
      await prisma.location.upsert({
        where: { uuid: data.uuid },
        create: { ...data, syncedAt: new Date() },
        update: { ...data, syncedAt: new Date() },
      });
      fetched++;
    }
    page++;
  } while (page <= lastPage && page <= 100);

  return { fetched, failed, total: total || fetched + failed };
}

export async function getLocationSyncState() {
  return prisma.locationSyncState.upsert({
    where: { id: SINGLETON_ID },
    create: { id: SINGLETON_ID },
    update: {},
  });
}

function clampInterval(days: number): number {
  if (!Number.isFinite(days)) return 7;
  return Math.min(90, Math.max(1, Math.trunc(days)));
}

export async function updateLocationSyncConfig(input: { enabled?: boolean; intervalDays?: number }): Promise<void> {
  await prisma.locationSyncState.upsert({
    where: { id: SINGLETON_ID },
    create: {
      id: SINGLETON_ID,
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.intervalDays !== undefined && { intervalDays: clampInterval(input.intervalDays) }),
    },
    update: {
      ...(input.enabled !== undefined && { enabled: input.enabled }),
      ...(input.intervalDays !== undefined && { intervalDays: clampInterval(input.intervalDays) }),
    },
  });
}

function isDue(state: { lastRunAt: Date | null; intervalDays: number }): boolean {
  if (!state.lastRunAt) return true;
  return Date.now() >= state.lastRunAt.getTime() + state.intervalDays * 24 * 60 * 60 * 1000;
}

export async function runLocationSync(trigger: "manual" | "scheduled") {
  // Atomic claim: take the lock if it's free OR if an existing claim is stale
  // (a previous run crashed without releasing it). updatedAt is bumped to now on
  // claim, so a live run that started < STALE_RUN_MS ago still blocks overlaps.
  const staleBefore = new Date(Date.now() - STALE_RUN_MS);
  const claimed = await prisma.locationSyncState.updateMany({
    where: {
      id: SINGLETON_ID,
      OR: [{ running: false }, { running: true, updatedAt: { lt: staleBefore } }],
    },
    data: { running: true },
  });
  if (claimed.count === 0) {
    const existing = await prisma.locationSyncState.findUnique({ where: { id: SINGLETON_ID } });
    if (existing?.running) return null; // genuinely in flight (claimed recently)
    await prisma.locationSyncState.create({ data: { id: SINGLETON_ID, running: true } });
  }

  void recordEvent("info", "sync.location", `Standort-Sync gestartet (${trigger})`);
  try {
    const result = await syncLocationCatalog();
    const locationCount = await prisma.location.count();
    await prisma.locationSyncState.update({
      where: { id: SINGLETON_ID },
      data: {
        running: false,
        lastRunAt: new Date(),
        locationCount,
        lastResult: `${trigger}: ${result.fetched}/${result.total} locations (${result.failed} failed)`,
      },
    });
    void recordEvent(
      result.failed > 0 ? "warn" : "info",
      "sync.location",
      `Standort-Sync fertig: ${result.fetched}/${result.total} (${result.failed} fehlgeschlagen)`,
      result,
    );
    return result;
  } catch (err) {
    await prisma.locationSyncState.update({
      where: { id: SINGLETON_ID },
      data: {
        running: false,
        lastRunAt: new Date(),
        lastResult: `${trigger}: ERROR ${err instanceof Error ? err.message : String(err)}`,
      },
    }).catch(() => null);
    void recordEvent("error", "sync.location", `Standort-Sync fehlgeschlagen (${trigger})`, err instanceof Error ? err.stack ?? err.message : String(err));
    throw err;
  }
}

export function startLocationSyncScheduler(log?: { info: (msg: string) => void; error: (e: unknown, msg: string) => void }): void {
  if (timer) return;
  const tick = async () => {
    try {
      // Opportunistic retention sweep for the system-event log (10-day window).
      void pruneSystemEvents();
      const state = await getLocationSyncState();
      if (!state.enabled || state.running || !isDue(state)) return;
      log?.info("[locationSync] catalog refresh due - starting scheduled sync");
      const r = await runLocationSync("scheduled");
      if (r) log?.info(`[locationSync] scheduled sync done: ${r.fetched}/${r.total}`);
    } catch (err) {
      log?.error(err, "[locationSync] scheduled sync failed");
    }
  };
  setTimeout(() => void tick(), 45_000).unref?.();
  timer = setInterval(() => void tick(), TICK_MS);
  timer.unref?.();
}
