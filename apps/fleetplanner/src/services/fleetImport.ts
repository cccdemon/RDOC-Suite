// Bulk-import a user's owned ships from a CCU-Game JSON export, e.g.
//   [{ "name": "600i Explorer", "shipname": "Libertalia", "type": "ship" }, ...]
// Each `name` is matched to the local ship catalog (case-insensitive, with a
// light fuzzy fallback). `shipname` becomes the UserShip nickname. UserShip is
// unique per (user, model), so the import dedupes per model (multiple hulls of
// the same model collapse to one owned entry).
import { prisma } from "../db.js";

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

export type FleetImportResult = {
  total: number;
  added: number;
  already: number;
  unmatched: string[];
};

export async function importUserFleet(userId: string, raw: string): Promise<FleetImportResult> {
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON");
  }
  if (!Array.isArray(entries)) throw new Error("Expected a JSON array of ships");

  const ships = await prisma.ship.findMany({ select: { id: true, name: true } });
  const byName = new Map(ships.map((s) => [norm(s.name), s]));
  const toks = (s: string) => norm(s).split(" ").filter(Boolean);
  // Precompute token sets so a CCU short name ("Ares Ion") matches the fuller
  // catalog name ("Ares Star Fighter Ion") when all its words are present.
  const shipToks = ships.map((s) => ({ ship: s, set: new Set(toks(s.name)), len: s.name.length }));

  let total = 0;
  const unmatched: string[] = [];
  // FR-P3: tally hulls per matched model first; duplicates of the same model
  // collapse to one UserShip row carrying a `quantity` (instead of being dropped).
  const byShip = new Map<string, { count: number; nickname: string | null }>();

  for (const entry of entries.slice(0, 1000)) {
    const rawName =
      entry && typeof (entry as { name?: unknown }).name === "string"
        ? ((entry as { name: string }).name as string)
        : "";
    if (!rawName.trim()) continue;
    total++;

    const key = norm(rawName);
    let ship = byName.get(key);
    if (!ship) {
      // All input words present in the catalog name (order-independent);
      // prefer the shortest (most specific) matching catalog name.
      const inputToks = toks(rawName);
      const cands = shipToks
        .filter((x) => inputToks.every((t) => x.set.has(t)))
        .sort((a, b) => a.len - b.len);
      ship = cands[0]?.ship;
    }
    if (!ship) {
      ship = ships.find((s) => {
        const n = norm(s.name);
        return n.includes(key) || key.includes(n);
      });
    }
    if (!ship) {
      unmatched.push(rawName.trim());
      continue;
    }

    const rawNick =
      entry && typeof (entry as { shipname?: unknown }).shipname === "string"
        ? (entry as { shipname: string }).shipname.trim()
        : "";
    const nickname = rawNick ? rawNick.slice(0, 80) : null;

    const acc = byShip.get(ship.id);
    if (acc) {
      acc.count++;
      if (!acc.nickname && nickname) acc.nickname = nickname; // keep first named hull
    } else {
      byShip.set(ship.id, { count: 1, nickname });
    }
  }

  let added = 0;
  let already = 0;
  for (const [shipId, { count, nickname }] of byShip) {
    const existing = await prisma.userShip.findUnique({
      where: { userId_shipId: { userId, shipId } },
      select: { id: true },
    });
    if (existing) {
      already++;
      // Re-import refreshes the hull count (and nickname if the export carries one).
      await prisma.userShip.update({
        where: { userId_shipId: { userId, shipId } },
        data: { quantity: count, ...(nickname ? { nickname } : {}) },
      });
    } else {
      await prisma.userShip.create({ data: { userId, shipId, nickname, quantity: count } });
      added++;
    }
  }

  return { total, added, already, unmatched: [...new Set(unmatched)] };
}
