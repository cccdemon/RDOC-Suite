import { describe, it, expect } from "vitest";
import { shipCategory, shipCanCarryVehicle } from "../../services/scwiki.js";
import type { Ship } from "@prisma/client";

function makeShip(over: Partial<Ship> = {}): Ship {
  return {
    id: "s",
    slug: "s",
    name: "S",
    manufacturer: "",
    size: "",
    career: "",
    role: "",
    minCrew: 1,
    maxCrew: 1,
    weaponCrew: 0,
    operationCrew: 0,
    imageUrl: null,
    rawJson: "{}",
    syncedAt: new Date(),
    ...over,
  };
}

describe("shipCategory", () => {
  it("maps size/career to a category", () => {
    expect(shipCategory(makeShip({ size: "Capital" }))).toBe("capital");
    expect(shipCategory(makeShip({ size: "Large", career: "Combat" }))).toBe("subcapital");
    expect(shipCategory(makeShip({ size: "Small", career: "Combat" }))).toBe("fighter");
    expect(shipCategory(makeShip({ size: "Medium", career: "Combat" }))).toBe("fighter");
    expect(shipCategory(makeShip({ career: "Support" }))).toBe("support");
    expect(shipCategory(makeShip({ career: "Medical" }))).toBe("support");
    expect(shipCategory(makeShip({ career: "Ground" }))).toBe("ground");
    expect(shipCategory(makeShip({ career: "Transport" }))).toBe("transport");
    expect(shipCategory(makeShip({ career: "Cargo" }))).toBe("transport");
    expect(shipCategory(makeShip({ career: "Mining" }))).toBe("mining");
    expect(shipCategory(makeShip({ career: "Salvage" }))).toBe("salvage");
    expect(shipCategory(makeShip({ career: "Exploration" }))).toBe("exploration");
    expect(shipCategory(makeShip({ size: "Small", career: "Touring" }))).toBe("any");
  });
  it("large but non-combat is not subcapital", () => {
    expect(shipCategory(makeShip({ size: "Large", career: "Transport" }))).toBe("transport");
  });
});

describe("shipCanCarryVehicle", () => {
  const grid = (w: number, h: number, l: number) =>
    JSON.stringify({ cargo_grids: [{ width: w, height: h, length: l }] });

  it("false for null / vehicle / no grid / bad json", () => {
    expect(shipCanCarryVehicle(null)).toBe(false);
    expect(shipCanCarryVehicle({ size: "Vehicle", rawJson: grid(5, 5, 10) })).toBe(false);
    expect(shipCanCarryVehicle({ size: "Large", rawJson: "{}" })).toBe(false);
    expect(shipCanCarryVehicle({ size: "Large", rawJson: "not json" })).toBe(false);
  });

  it("true only when a grid opening fits a vehicle (>=2.4 x 2.4 x >=4)", () => {
    expect(shipCanCarryVehicle({ size: "Large", rawJson: grid(10, 2.5, 7.5) })).toBe(true);
    expect(shipCanCarryVehicle({ size: "Medium", rawJson: grid(1.25, 1.25, 5) })).toBe(false);
    expect(shipCanCarryVehicle({ size: "Large", rawJson: grid(2.4, 2.4, 3.9) })).toBe(false);
  });
});
