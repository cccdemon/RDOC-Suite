import { describe, it, expect } from "vitest";
import {
  slotKind,
  slotKindTagKey,
  slotKindHelpKey,
  slotNeedsOwnShip,
  categoryForNeedType,
  categoryHeaderKey,
} from "../../services/slotKind.js";

describe("slotKind", () => {
  it("operator-placed wins over everything → frei", () => {
    expect(slotKind({ operatorPlaced: true, hasConcreteShip: true })).toBe("frei");
  });

  it("a concrete seat on an accepted ship → fest", () => {
    expect(slotKind({ hasConcreteShip: true })).toBe("fest");
    expect(slotKind({ hasConcreteShip: true, isCaptainSeat: true })).toBe("fest");
  });

  it("captain seat of an unfilled ship-type requirement → typ (bring own ship)", () => {
    expect(slotKind({ needsOwnShip: true, isCaptainSeat: true })).toBe("typ");
  });

  it("crew seat of an unfilled ship-type requirement → rolle_offen (ride along)", () => {
    expect(slotKind({ needsOwnShip: true, isCaptainSeat: false })).toBe("rolle_offen");
  });

  it("defaults to fest when nothing special applies", () => {
    expect(slotKind({})).toBe("fest");
  });

  it("only the typ kind needs an own ship", () => {
    expect(slotNeedsOwnShip("typ")).toBe(true);
    expect(slotNeedsOwnShip("fest")).toBe(false);
    expect(slotNeedsOwnShip("rolle_offen")).toBe(false);
    expect(slotNeedsOwnShip("frei")).toBe(false);
  });

  it("maps every kind to a tag + help i18n key", () => {
    for (const k of ["fest", "typ", "rolle_offen", "frei"] as const) {
      expect(slotKindTagKey(k)).toMatch(/^slot\./);
      expect(slotKindHelpKey(k)).toMatch(/^slot\..*Help$/);
    }
    expect(slotKindTagKey("rolle_offen")).toBe("slot.rolleOffen");
  });
});

describe("categoryForNeedType", () => {
  it("buckets needTypes into ships / fighter / ground", () => {
    expect(categoryForNeedType("ship")).toBe("ships");
    expect(categoryForNeedType(null)).toBe("ships");
    expect(categoryForNeedType(undefined)).toBe("ships");
    expect(categoryForNeedType("fighter_squad")).toBe("fighter");
    expect(categoryForNeedType("cqb_team")).toBe("ground");
  });

  it("maps each bucket to a header key", () => {
    expect(categoryHeaderKey("ships")).toBe("cat.shipsAndCrew");
    expect(categoryHeaderKey("fighter")).toBe("cat.fighterWing");
    expect(categoryHeaderKey("ground")).toBe("cat.groundTroops");
  });
});
