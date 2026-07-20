// ── Composition category ↔ ship matching ────────────────────────────
// Pure helpers (no DB) that map a composition requirement `category`
// to the ship attributes (`size`/`career`/`role`) synced from the wiki.
// Used to (a) flag units sitting in a slot whose category they don't
// match and (b) suggest the best-fitting open slot for a unit.
//
// Intentionally tolerant: matching is a *hint*, never a hard gate.

// SHIP_CLASSES lives in the contracts package (single source of truth for API
// types); the SPA offers exactly these options in its role picker.
import { SHIP_CLASSES, type ShipClass } from "@rdoc-suite/fleetplanner-contracts";

export type ShipLike = {
  size?: string | null;
  career?: string | null;
  role?: string | null;
};

export type UnitLike = {
  unitType: string; // "ship" | "squad"
  ship?: ShipLike | null;
  /** Role declared for THIS operation; overrides the derived class. */
  roleOverride?: string | null;
};

function isShipClass(v: string | null | undefined): v is ShipClass {
  return !!v && (SHIP_CLASSES as readonly string[]).includes(v);
}

/** Requirement category → the ship class that satisfies it. */
const CLASS_BY_CATEGORY: Record<string, ShipClass> = {
  capital: "Capital",
  subcapital: "Sub-capital",
  fighter: "Fighter",
  support: "Support",
  transport: "Transport",
  mining: "Mining",
  salvage: "Salvage",
  exploration: "Exploration",
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
  if (!unit.ship) return false;

  const want = CLASS_BY_CATEGORY[cat];
  // Unknown category → don't claim a mismatch.
  if (!want) return true;
  return effectiveShipClass(unit) === want;
}

/**
 * Human-readable ship class derived from catalog attributes (size×career×role).
 * Replaces the static category list for display + auto-match hints. (FR-P1 step 5.)
 */
export function shipClass(ship: ShipLike | null | undefined): string {
  if (!ship) return "Ship";
  const size = (ship.size ?? "").toLowerCase();
  const career = (ship.career ?? "").toLowerCase();
  const role = (ship.role ?? "").toLowerCase();

  // The catalog's own vocabulary, not what one would guess it is. Verified
  // against the live catalog (298 ships): the transport career is spelled
  // "Transporter" (42 ships) — plain "transport" hits exactly 1 — mining ships
  // are careered "Industrial" (19), and freighters are roled "… Freight",
  // which contains neither "transport" nor "cargo". Getting these wrong silently
  // dropped ~40 freighters out of every class and into their raw size.
  const isTransport =
    career === "transporter" || career === "transport" || role.includes("freight") || role.includes("cargo") || role.includes("transport");
  // "Industrial" covers mining, salvage AND freight (Golem OX is Light Freight /
  // Industrial), so the career alone decides nothing — the role does.
  const isMining = career === "mining" || role.includes("mining");
  const isSalvage = career === "salvage" || role.includes("salvage") || role.includes("recovery");
  const isExploration = career === "exploration" || role.includes("explor") || role.includes("expedition") || role.includes("pathfinder");
  const isSupport =
    career === "support" || role.includes("support") || role.includes("medical") || role.includes("refuel") || role.includes("repair");

  // Purpose beats hull size. A Hull C is a Transport that happens to be large —
  // classifying it as "Sub-capital" made it fail every transport requirement,
  // and it also disagreed with the old matchesCategory, which checked career
  // independently of size. Capital/Sub-capital is the fallback for big hulls
  // with no clearer purpose (Idris, Heavy Gunship), not a hard override.
  if (size === "vehicle") return "Ground vehicle"; // vehicles are their own unit type
  if (role.includes("fighter") || role.includes("bomber") || role.includes("interceptor") || (size === "small" && career === "combat"))
    return "Fighter";
  if (isMining) return "Mining";
  if (isSalvage) return "Salvage";
  if (isTransport) return "Transport";
  if (isExploration) return "Exploration";
  if (isSupport) return "Support";
  if (size === "capital") return "Capital";
  if (size === "large") return "Sub-capital";
  return ship.size ? String(ship.size) : "Ship";
}

/**
 * The role a unit actually plays in its operation: the declared override when
 * set, otherwise the catalog-derived class. Everything downstream — board lane,
 * squadron eligibility, requirement matching — reads this, so declaring a role
 * moves the unit everywhere at once.
 */
export function effectiveShipClass(unit: UnitLike): string {
  if (isShipClass(unit.roleOverride)) return unit.roleOverride;
  return shipClass(unit.ship);
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
