// Bulk-import a user's owned ships into their hangar.
//
// Two sources feed the same core:
//   1. A CCU-Game JSON export pasted by the player, e.g.
//      [{ "name": "600i Explorer", "shipname": "Libertalia", "type": "ship" }, ...]
//   2. A Fleetyards.net public hangar (see services/fleetyards.ts).
//
// Each entry name is matched to the local ship catalog (case-insensitive, with a
// light fuzzy fallback). UserShip is unique per (user, model), so the import
// dedupes per model: multiple hulls of the same model collapse to one row
// carrying `quantity` (owned) and `loanerQuantity` (loaners).
import { prisma } from "../db.js";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type FleetImportResult = {
  total: number;
  added: number;
  already: number;
  unmatched: string[];
};

/** One hull to import. `shipId` short-circuits name matching when the source
 *  already resolved the catalog ship (Fleetyards slug → FleetyardsShip cache). */
export type FleetEntry = {
  name: string;
  nickname?: string | null;
  loaner?: boolean;
  shipId?: string | null;
};

/**
 * Name → catalog ship resolver. Built once per import (one catalog query) and
 * reused for every entry.
 */
async function buildShipMatcher(): Promise<(rawName: string) => { id: string } | undefined> {
  const ships = await prisma.ship.findMany({ select: { id: true, name: true } });
  const byName = new Map(ships.map((s) => [norm(s.name), s]));
  const toks = (s: string) => norm(s).split(" ").filter(Boolean);
  // Precompute token sets so a CCU short name ("Ares Ion") matches the fuller
  // catalog name ("Ares Star Fighter Ion") when all its words are present.
  const shipToks = ships.map((s) => ({ ship: s, set: new Set(toks(s.name)), len: s.name.length }));

  return (rawName: string) => {
    const key = norm(rawName);
    if (!key) return undefined;
    const exact = byName.get(key);
    if (exact) return exact;
    // All input words present in the catalog name (order-independent);
    // prefer the shortest (most specific) matching catalog name.
    const inputToks = toks(rawName);
    const cands = shipToks
      .filter((x) => inputToks.every((t) => x.set.has(t)))
      .sort((a, b) => a.len - b.len);
    if (cands[0]) return cands[0].ship;
    return ships.find((s) => {
      const n = norm(s.name);
      return n.includes(key) || key.includes(n);
    });
  };
}

/**
 * Match every entry to the catalog, collapse hulls per model, and upsert the
 * player's UserShip rows. Additive: models absent from `entries` are left alone.
 */
export async function applyFleetEntries(userId: string, entries: FleetEntry[]): Promise<FleetImportResult> {
  const match = await buildShipMatcher();

  let total = 0;
  const unmatched: string[] = [];
  // Tally hulls per matched model first; duplicates of the same model collapse
  // to one UserShip row carrying `quantity` (instead of being dropped).
  const byShip = new Map<string, { count: number; loaners: number; nickname: string | null }>();

  for (const entry of entries.slice(0, 1000)) {
    const rawName = typeof entry.name === "string" ? entry.name : "";
    if (!rawName.trim() && !entry.shipId) continue;
    total++;

    const ship = entry.shipId ? { id: entry.shipId } : match(rawName);
    if (!ship) {
      unmatched.push(rawName.trim());
      continue;
    }

    const nickname = entry.nickname?.trim() ? entry.nickname.trim().slice(0, 80) : null;
    const acc = byShip.get(ship.id);
    if (acc) {
      if (entry.loaner) acc.loaners++;
      else acc.count++;
      if (!acc.nickname && nickname) acc.nickname = nickname; // keep first named hull
    } else {
      byShip.set(ship.id, { count: entry.loaner ? 0 : 1, loaners: entry.loaner ? 1 : 0, nickname });
    }
  }

  let added = 0;
  let already = 0;
  for (const [shipId, { count, loaners, nickname }] of byShip) {
    const existing = await prisma.userShip.findUnique({
      where: { userId_shipId: { userId, shipId } },
      select: { id: true },
    });
    if (existing) {
      already++;
      // Re-import refreshes the hull counts (and nickname if the export carries one).
      // A model seen only as a loaner keeps quantity 0 so the UI can flag it.
      await prisma.userShip.update({
        where: { userId_shipId: { userId, shipId } },
        data: { quantity: count, loanerQuantity: loaners, ...(nickname ? { nickname } : {}) },
      });
    } else {
      await prisma.userShip.create({
        data: { userId, shipId, nickname, quantity: count, loanerQuantity: loaners },
      });
      added++;
    }
  }

  return { total, added, already, unmatched: [...new Set(unmatched)] };
}

/** Import from a pasted CCU-Game JSON export. */
export async function importUserFleet(userId: string, raw: string): Promise<FleetImportResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array of ships");

  const entries: FleetEntry[] = [];
  for (const e of parsed) {
    const o = (e && typeof e === "object" ? e : {}) as { name?: unknown; shipname?: unknown };
    const name = typeof o.name === "string" ? o.name : "";
    if (!name.trim()) continue;
    entries.push({ name, nickname: typeof o.shipname === "string" ? o.shipname : null });
  }
  return applyFleetEntries(userId, entries);
}
