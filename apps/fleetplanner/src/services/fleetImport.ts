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

  let added = 0;
  let already = 0;
  let total = 0;
  const unmatched: string[] = [];

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

    const existing = await prisma.userShip.findUnique({
      where: { userId_shipId: { userId, shipId: ship.id } },
      select: { id: true },
    });
    if (existing) {
      already++;
      if (nickname) {
        await prisma.userShip.update({
          where: { userId_shipId: { userId, shipId: ship.id } },
          data: { nickname },
        });
      }
    } else {
      await prisma.userShip.create({ data: { userId, shipId: ship.id, nickname } });
      added++;
    }
  }

  return { total, added, already, unmatched: [...new Set(unmatched)] };
}
