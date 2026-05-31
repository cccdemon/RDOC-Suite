import { describe, it, expect } from "vitest";
import { shipCategory } from "../../services/scwiki.js";
import type { Ship } from "@prisma/client";

function makeShip(size: string, career: string): Ship {
  return {
    id: "ship-1",
    slug: "test",
    name: "Test Ship",
    manufacturer: "",
    size,
    career,
    role: "",
    minCrew: 1,
    maxCrew: 1,
    weaponCrew: 0,
    operationCrew: 0,
    imageUrl: null,
    rawJson: "{}",
    syncedAt: new Date(),
  };
}

describe("shipCategory", () => {
  it("capital size → 'capital'", () => {
    expect(shipCategory(makeShip("Capital", "Combat"))).toBe("capital");
  });

  it("large + combat career → 'subcapital'", () => {
    expect(shipCategory(makeShip("Large", "Combat"))).toBe("subcapital");
  });

  it("small + combat career → 'fighter'", () => {
    expect(shipCategory(makeShip("Small", "Combat"))).toBe("fighter");
  });

  it("medium + combat career → 'fighter'", () => {
    expect(shipCategory(makeShip("Medium", "Combat"))).toBe("fighter");
  });

  it("support career → 'support'", () => {
    expect(shipCategory(makeShip("Medium", "Support"))).toBe("support");
  });

  it("medical career → 'support'", () => {
    expect(shipCategory(makeShip("Small", "Medical"))).toBe("support");
  });

  it("repair career → 'support'", () => {
    expect(shipCategory(makeShip("Medium", "Repair"))).toBe("support");
  });

  it("ground career → 'ground'", () => {
    expect(shipCategory(makeShip("Small", "Ground"))).toBe("ground");
  });

  it("vehicle career → 'ground'", () => {
    expect(shipCategory(makeShip("Small", "Vehicle"))).toBe("ground");
  });

  it("transport career → 'transport'", () => {
    expect(shipCategory(makeShip("Large", "Transport"))).toBe("transport");
  });

  it("cargo career → 'transport'", () => {
    expect(shipCategory(makeShip("Large", "Cargo"))).toBe("transport");
  });

  it("mining career → 'mining'", () => {
    expect(shipCategory(makeShip("Medium", "Mining"))).toBe("mining");
  });

  it("salvage career → 'salvage'", () => {
    expect(shipCategory(makeShip("Medium", "Salvage"))).toBe("salvage");
  });

  it("exploration career → 'exploration'", () => {
    expect(shipCategory(makeShip("Large", "Exploration"))).toBe("exploration");
  });

  it("pathfinder career → 'exploration'", () => {
    expect(shipCategory(makeShip("Small", "Pathfinder"))).toBe("exploration");
  });

  it("unknown size and career → 'any'", () => {
    expect(shipCategory(makeShip("Unknown", "Science"))).toBe("any");
  });

  it("empty size and career → 'any'", () => {
    expect(shipCategory(makeShip("", ""))).toBe("any");
  });

  it("case-insensitive: CAPITAL matches capital", () => {
    expect(shipCategory(makeShip("CAPITAL", "combat"))).toBe("capital");
  });

  it("case-insensitive: small combat matches fighter", () => {
    expect(shipCategory(makeShip("small", "COMBAT"))).toBe("fighter");
  });

  it("capital takes precedence over career (capital combat is not subcapital)", () => {
    // capital size is checked first in the function
    expect(shipCategory(makeShip("Capital", "Combat"))).toBe("capital");
  });
});
