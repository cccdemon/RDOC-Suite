// ── Composition category ↔ ship matching ────────────────────────────
// Pure helpers (no DB) that map a composition requirement `category`
// to the ship attributes (`size`/`career`/`role`) synced from the wiki.
// Used to (a) flag units sitting in a slot whose category they don't
// match and (b) suggest the best-fitting open slot for a unit.
//
// Intentionally tolerant: matching is a *hint*, never a hard gate.

export type ShipLike = {
  size?: string | null;
  career?: string | null;
  role?: string | null;
};

export type UnitLike = {
  unitType: string; // "ship" | "squad"
  ship?: ShipLike | null;
};

/**
 * CQB (soldier / personnel) categories vs ship-hull categories. The two
 * fleet-need axes: hull-needs are satisfied by ships, CQB-needs by soldiers
 * the operator bundles into squads. (FR-P1 fleet-needs redesign.)
 */
export function isCqbCategory(category: string): boolean {
  const c = (category ?? "").toLowerCase().trim();
  return c === "fps" || c === "ground";
}

/** Does a unit plausibly satisfy a requirement category? */
export function matchesCategory(category: string, unit: UnitLike): boolean {
  const cat = (category ?? "").toLowerCase().trim();
  if (cat === "" || cat === "any") return true;

  // Ground / FPS categories are about squads and ground vehicles, not ships.
  if (cat === "fps" || cat === "ground")
    return unit.unitType === "squad" || unit.unitType === "vehicle";

  // Remaining categories are ship categories — a squad never matches.
  if (unit.unitType !== "ship") return false;
  const ship = unit.ship;
  if (!ship) return false;

  const size = (ship.size ?? "").toLowerCase();
  const career = (ship.career ?? "").toLowerCase();
  const role = (ship.role ?? "").toLowerCase();

  switch (cat) {
    case "capital":
      return size === "capital";
    case "subcapital":
      return size === "large";
    case "fighter":
      return role.includes("fighter") || (size === "small" && career === "combat");
    case "support":
      return career === "support" || role.includes("support");
    case "transport":
      return career === "transport" || role.includes("transport") || role.includes("cargo");
    case "mining":
      return career === "mining" || role.includes("mining");
    case "salvage":
      return career === "salvage" || role.includes("salvage");
    case "exploration":
      return career === "exploration" || role.includes("explor");
    default:
      // Unknown category → don't claim a mismatch.
      return true;
  }
}

export type SlotLike = {
  id: string;
  category: string;
  /** open seats remaining (count − non-rejected fleetUnits) */
  open: number;
};

/**
 * Suggest the best open slot for a unit: the first open slot whose
 * category the unit matches. Returns null when nothing fits (caller
 * can then offer "any"/manual). Order of `slots` is respected as the
 * tie-breaker, so callers should pass them in display order.
 */
export function suggestSlot(unit: UnitLike, slots: SlotLike[]): string | null {
  const openSlots = slots.filter((s) => s.open > 0);
  const exact = openSlots.find(
    (s) => s.category.toLowerCase() !== "any" && matchesCategory(s.category, unit),
  );
  if (exact) return exact.id;
  const anySlot = openSlots.find((s) => s.category.toLowerCase() === "any");
  return anySlot?.id ?? null;
}
