import { describe, it, expect } from "vitest";
import { specForShip, specForSquad } from "../../services/seats.js";
import type { Ship } from "@prisma/client";

function makeShip(overrides: Partial<Ship> = {}): Ship {
  return {
    id: "ship-1",
    slug: "gladius",
    name: "Gladius",
    manufacturer: "Aegis",
    size: "Small",
    career: "Combat",
    role: "Fighter",
    minCrew: 1,
    maxCrew: 1,
    weaponCrew: 0,
    operationCrew: 0,
    imageUrl: null,
    rawJson: "{}",
    syncedAt: new Date(),
    ...overrides,
  };
}

describe("specForShip", () => {
  it("solo fighter → just Pilot", () => {
    const specs = specForShip(makeShip({ maxCrew: 1, weaponCrew: 0, operationCrew: 0 }));
    expect(specs).toEqual([{ label: "Pilot", seatType: "pilot", order: 0 }]);
  });

  it("pilot is always first with order 0", () => {
    const specs = specForShip(makeShip({ maxCrew: 5, weaponCrew: 2, operationCrew: 1 }));
    expect(specs[0]).toMatchObject({ label: "Pilot", seatType: "pilot", order: 0 });
  });

  it("single gunner → label 'Gunner' (not 'Gunner 1')", () => {
    const specs = specForShip(makeShip({ maxCrew: 2, weaponCrew: 1, operationCrew: 0 }));
    const gunners = specs.filter((s) => s.seatType === "gunner");
    expect(gunners).toHaveLength(1);
    expect(gunners[0]!.label).toBe("Gunner");
  });

  it("multiple gunners → numbered labels", () => {
    const specs = specForShip(makeShip({ maxCrew: 4, weaponCrew: 3, operationCrew: 0 }));
    const gunners = specs.filter((s) => s.seatType === "gunner");
    expect(gunners).toHaveLength(3);
    expect(gunners[0]!.label).toBe("Gunner 1");
    expect(gunners[1]!.label).toBe("Gunner 2");
    expect(gunners[2]!.label).toBe("Gunner 3");
  });

  it("single engineer → label 'Engineer' (not 'Engineer 1')", () => {
    const specs = specForShip(makeShip({ maxCrew: 2, weaponCrew: 0, operationCrew: 1 }));
    const eng = specs.filter((s) => s.seatType === "operation");
    expect(eng).toHaveLength(1);
    expect(eng[0]!.label).toBe("Engineer");
  });

  it("multiple engineers → numbered labels", () => {
    const specs = specForShip(makeShip({ maxCrew: 4, weaponCrew: 0, operationCrew: 3 }));
    const eng = specs.filter((s) => s.seatType === "operation");
    expect(eng).toHaveLength(3);
    expect(eng[0]!.label).toBe("Engineer 1");
    expect(eng[2]!.label).toBe("Engineer 3");
  });

  it("single flex seat → label 'Crew' (not 'Crew 1')", () => {
    // maxCrew=2, weaponCrew=0, operationCrew=0 → flex = 2-1-0-0 = 1
    const specs = specForShip(makeShip({ maxCrew: 2, weaponCrew: 0, operationCrew: 0 }));
    const flex = specs.filter((s) => s.seatType === "flex");
    expect(flex).toHaveLength(1);
    expect(flex[0]!.label).toBe("Crew");
  });

  it("multiple flex seats → numbered labels", () => {
    // maxCrew=5, weaponCrew=1, operationCrew=1 → flex = 5-1-1-1 = 2
    const specs = specForShip(makeShip({ maxCrew: 5, weaponCrew: 1, operationCrew: 1 }));
    const flex = specs.filter((s) => s.seatType === "flex");
    expect(flex).toHaveLength(2);
    expect(flex[0]!.label).toBe("Crew 1");
    expect(flex[1]!.label).toBe("Crew 2");
  });

  it("order values are sequential from 0", () => {
    const specs = specForShip(makeShip({ maxCrew: 6, weaponCrew: 2, operationCrew: 1 }));
    specs.forEach((s, i) => expect(s.order).toBe(i));
  });

  it("no flex seats when named roles fill all slots", () => {
    // maxCrew=3, weaponCrew=1, operationCrew=1 → flex = 3-1-1-1 = 0
    const specs = specForShip(makeShip({ maxCrew: 3, weaponCrew: 1, operationCrew: 1 }));
    expect(specs.filter((s) => s.seatType === "flex")).toHaveLength(0);
    expect(specs).toHaveLength(3);
  });

  it("no negative flex when named seats exceed maxCrew-1", () => {
    // weaponCrew+operationCrew > maxCrew-1 → flex clamped to 0
    const specs = specForShip(makeShip({ maxCrew: 2, weaponCrew: 2, operationCrew: 1 }));
    expect(specs.filter((s) => s.seatType === "flex")).toHaveLength(0);
  });

  it("large ship: correct counts for all seat types", () => {
    // Idris-style: maxCrew=10, weaponCrew=3, operationCrew=2 → flex=4
    const specs = specForShip(makeShip({ maxCrew: 10, weaponCrew: 3, operationCrew: 2 }));
    expect(specs.filter((s) => s.seatType === "pilot")).toHaveLength(1);
    expect(specs.filter((s) => s.seatType === "gunner")).toHaveLength(3);
    expect(specs.filter((s) => s.seatType === "operation")).toHaveLength(2);
    expect(specs.filter((s) => s.seatType === "flex")).toHaveLength(4);
    expect(specs).toHaveLength(10);
  });
});

describe("specForSquad", () => {
  it("squad of 1 → just Squad Captain", () => {
    const specs = specForSquad(1);
    expect(specs).toEqual([{ label: "Squad Captain", seatType: "fps", order: 0 }]);
  });

  it("squad of 4 → Squad Captain + FPS 1..3", () => {
    const specs = specForSquad(4);
    expect(specs).toHaveLength(4);
    expect(specs[0]).toEqual({ label: "Squad Captain", seatType: "fps", order: 0 });
    expect(specs[1]).toEqual({ label: "FPS 1", seatType: "fps", order: 1 });
    expect(specs[2]).toEqual({ label: "FPS 2", seatType: "fps", order: 2 });
    expect(specs[3]).toEqual({ label: "FPS 3", seatType: "fps", order: 3 });
  });

  it("all seats have seatType 'fps'", () => {
    const specs = specForSquad(6);
    expect(specs.every((s) => s.seatType === "fps")).toBe(true);
  });

  it("order values are sequential from 0", () => {
    const specs = specForSquad(5);
    specs.forEach((s, i) => expect(s.order).toBe(i));
  });

  it("FPS member labels start at 1 (not 0)", () => {
    const specs = specForSquad(3);
    expect(specs[1]!.label).toBe("FPS 1");
    expect(specs[2]!.label).toBe("FPS 2");
  });
});
