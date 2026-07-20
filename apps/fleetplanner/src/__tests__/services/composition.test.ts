import { describe, it, expect } from "vitest";
import {
  isCqbCategory,
  matchesCategory,
  shipClass,
  effectiveShipClass,
  suggestSlot,
} from "../../services/composition.js";

const fighter = { size: "Small", career: "Combat", role: "Fighter" };
const idris = { size: "Capital", career: "Combat", role: "Frigate" };
const freighter = { size: "Large", career: "Transport", role: "Freight" };

describe("isCqbCategory", () => {
  it("treats fps + ground as CQB", () => {
    expect(isCqbCategory("fps")).toBe(true);
    expect(isCqbCategory("ground")).toBe(true);
    expect(isCqbCategory("GROUND")).toBe(true);
  });
  it("treats ship categories as non-CQB", () => {
    expect(isCqbCategory("capital")).toBe(false);
    expect(isCqbCategory("fighter")).toBe(false);
    expect(isCqbCategory("")).toBe(false);
  });
});

describe("matchesCategory", () => {
  it("any/empty always matches", () => {
    expect(matchesCategory("any", { unitType: "ship", ship: freighter })).toBe(true);
    expect(matchesCategory("", { unitType: "squad" })).toBe(true);
  });
  it("CQB categories match squads/vehicles, not ships", () => {
    expect(matchesCategory("fps", { unitType: "squad" })).toBe(true);
    expect(matchesCategory("ground", { unitType: "vehicle" })).toBe(true);
    expect(matchesCategory("fps", { unitType: "ship", ship: fighter })).toBe(false);
  });
  it("ship categories never match squads", () => {
    expect(matchesCategory("fighter", { unitType: "squad" })).toBe(false);
  });
  it("maps ship attributes to categories", () => {
    expect(matchesCategory("capital", { unitType: "ship", ship: idris })).toBe(true);
    expect(matchesCategory("fighter", { unitType: "ship", ship: fighter })).toBe(true);
    expect(matchesCategory("transport", { unitType: "ship", ship: freighter })).toBe(true);
    expect(matchesCategory("capital", { unitType: "ship", ship: fighter })).toBe(false);
  });
});

describe("shipClass", () => {
  it("derives a human class from catalog attributes", () => {
    expect(shipClass(idris)).toBe("Capital");
    // Purpose beats hull size: a large freighter is a Transport, not a
    // "Sub-capital". Sub-capital is the fallback for big hulls with no clearer
    // purpose — which is what makes it match a transport requirement.
    expect(shipClass(freighter)).toBe("Transport");
    expect(shipClass({ size: "Large", career: "Combat", role: "Heavy Gunship" })).toBe("Sub-capital");
    expect(shipClass(fighter)).toBe("Fighter");
    expect(shipClass({ size: "Vehicle" })).toBe("Ground vehicle");
    expect(shipClass(null)).toBe("Ship");
  });

  it("uses the catalog's real vocabulary, not the obvious guesses", () => {
    // Verified against the live catalog: the transport career is spelled
    // "Transporter" (42 ships; plain "transport" hits 1), mining ships are
    // careered "Industrial", and freighters are roled "… Freight" — which
    // contains neither "transport" nor "cargo".
    expect(shipClass({ size: "Small", career: "Transporter", role: "Light Freight" })).toBe("Transport");
    expect(shipClass({ size: "Small", career: "Industrial", role: "Light Mining" })).toBe("Mining");
    expect(shipClass({ size: "Small", career: "Industrial", role: "Light Salvage" })).toBe("Salvage");
  });

  it("prefers a declared role over the catalog", () => {
    // The catalog calls the Cutlass Black "Light Freight / Medium Fighter"; the
    // player decides which one it is for this operation.
    const cutlass = { size: "Medium", career: "Multi-Role", role: "Light Freight / Medium Fighter" };
    expect(effectiveShipClass({ unitType: "ship", ship: cutlass })).toBe("Fighter");
    expect(effectiveShipClass({ unitType: "ship", ship: cutlass, roleOverride: "Transport" })).toBe("Transport");
    // Garbage overrides fall back to the derived class rather than leaking through.
    expect(effectiveShipClass({ unitType: "ship", ship: cutlass, roleOverride: "Nonsense" })).toBe("Fighter");
  });
});

describe("suggestSlot", () => {
  const slots = [
    { id: "cap", category: "capital", open: 0 },
    { id: "fig", category: "fighter", open: 2 },
    { id: "any", category: "any", open: 1 },
  ];
  it("prefers the first open slot whose category matches", () => {
    expect(suggestSlot({ unitType: "ship", ship: fighter }, slots)).toBe("fig");
  });
  it("falls back to an open 'any' slot when nothing matches", () => {
    expect(suggestSlot({ unitType: "ship", ship: freighter }, slots)).toBe("any");
  });
  it("returns null when no open slot fits", () => {
    expect(suggestSlot({ unitType: "ship", ship: fighter }, [{ id: "cap", category: "capital", open: 0 }])).toBeNull();
  });
});
