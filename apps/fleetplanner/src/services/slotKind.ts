// Slot-type taxonomy for the op-detail "mission board". A slot tells the player
// how binding a position is and what they must bring:
//
//   fest        – a concrete seat on an accepted, ship-bound unit (or a named
//                 squad role). Just take it.
//   typ         – only the ship/role TYPE is fixed. The player must bring their
//                 OWN ship of that type (the captain/pilot position of an
//                 unfilled ship-type requirement, or a fighter-wing pilot).
//   rolle_offen – a generic ride-along crew seat in a unit that does not need
//                 the player to bring a ship ("Sitz an Bord").
//   frei        – the operator places the player later (crew request / "Teilt
//                 mich ein").
//
// This module is pure (no DB) so the rendering code and the unit tests share the
// exact same classification. See web/pages.ts (opJoinPage) for the rendering.

export type SlotKind = "fest" | "typ" | "rolle_offen" | "frei";

export interface SlotInput {
  /** A concrete seat exists on an accepted, ship-bound FleetUnit. */
  hasConcreteShip?: boolean;
  /** Captain/pilot position (seat order 0) — the one who brings the ship. */
  isCaptainSeat?: boolean;
  /** Unfilled ship-type requirement: the player must bring their own ship. */
  needsOwnShip?: boolean;
  /** Operator-assigned: a crew request / "place me" entry. */
  operatorPlaced?: boolean;
}

/** Classify a single slot. Precedence: operator-placed > concrete > type/role. */
export function slotKind(s: SlotInput): SlotKind {
  if (s.operatorPlaced) return "frei";
  if (s.hasConcreteShip) return "fest";
  if (s.needsOwnShip) return s.isCaptainSeat ? "typ" : "rolle_offen";
  return "fest";
}

/** i18n key for a slot kind's short tag (FEST / TYP / ROLLE OFFEN / FREI). */
export function slotKindTagKey(kind: SlotKind): string {
  return {
    fest: "slot.fest",
    typ: "slot.typ",
    rolle_offen: "slot.rolleOffen",
    frei: "slot.frei",
  }[kind];
}

/** i18n key for the explanatory line shown in the take-slot modal. */
export function slotKindHelpKey(kind: SlotKind): string {
  return {
    fest: "slot.festHelp",
    typ: "slot.typHelp",
    rolle_offen: "slot.rolleOffenHelp",
    frei: "slot.freiHelp",
  }[kind];
}

/** Whether taking this slot requires picking/bringing an own ship. */
export function slotNeedsOwnShip(kind: SlotKind): boolean {
  return kind === "typ";
}

export type CategoryBucket = "ships" | "fighter" | "ground";

/**
 * Group a requirement/unit into one of the three mission-board categories,
 * derived from its needType. `ship` (and legacy null) → Schiffe & Crew,
 * `fighter_squad` → Jäger-Staffel, `cqb_team` → Bodentruppen.
 */
export function categoryForNeedType(needType: string | null | undefined): CategoryBucket {
  if (needType === "fighter_squad") return "fighter";
  if (needType === "cqb_team") return "ground";
  return "ships";
}

/** i18n key for a category bucket's section header. */
export function categoryHeaderKey(bucket: CategoryBucket): string {
  return {
    ships: "cat.shipsAndCrew",
    fighter: "cat.fighterWing",
    ground: "cat.groundTroops",
  }[bucket];
}
