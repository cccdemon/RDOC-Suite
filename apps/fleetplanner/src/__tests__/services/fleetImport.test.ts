import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    ship: { findMany: vi.fn() },
    userShip: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import { applyFleetEntries, importUserFleet } from "../../services/fleetImport.js";

const db = prisma as {
  ship: { findMany: ReturnType<typeof vi.fn> };
  userShip: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
  db.ship.findMany.mockResolvedValue([
    { id: "ship-carrack", name: "Carrack" },
    { id: "ship-ion", name: "Ares Star Fighter Ion" },
    { id: "ship-freelancer", name: "MISC Freelancer MAX" },
  ]);
  db.userShip.findUnique.mockResolvedValue(null);
});

describe("importUserFleet", () => {
  it("rejects invalid JSON and non-array exports", async () => {
    await expect(importUserFleet("user-1", "{")).rejects.toThrow("Invalid JSON");
    await expect(importUserFleet("user-1", "{}")).rejects.toThrow("Expected a JSON array of ships");
  });

  it("matches exact names, token-subset names and substring fallbacks", async () => {
    const result = await importUserFleet(
      "user-1",
      JSON.stringify([
        { name: " carrack ", shipname: "Expedition" },
        { name: "Ares Ion" },
        { name: "Freelancer" },
        { name: "Unknown Hull" },
        { shipname: "ignored" },
      ]),
    );

    expect(result).toEqual({
      total: 4,
      added: 3,
      already: 0,
      unmatched: ["Unknown Hull"],
    });
    expect(db.userShip.create).toHaveBeenCalledTimes(3);
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-carrack", nickname: "Expedition", quantity: 1, loanerQuantity: 0 },
    });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-ion", nickname: null, quantity: 1, loanerQuantity: 0 },
    });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-freelancer", nickname: null, quantity: 1, loanerQuantity: 0 },
    });
  });

  it("collapses duplicate hulls of one model into a quantity", async () => {
    const result = await importUserFleet(
      "user-1",
      JSON.stringify([{ name: "Carrack" }, { name: "Carrack" }, { name: "carrack" }]),
    );

    expect(result).toEqual({ total: 3, added: 1, already: 0, unmatched: [] });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-carrack", nickname: null, quantity: 3, loanerQuantity: 0 },
    });
  });

  it("updates existing entries with trimmed, capped nicknames and dedupes unmatched names", async () => {
    db.userShip.findUnique.mockResolvedValue({ id: "owned-1" });
    const longNick = "X".repeat(100);

    const result = await importUserFleet(
      "user-1",
      JSON.stringify([
        { name: "Carrack", shipname: ` ${longNick} ` },
        { name: "Missing" },
        { name: "Missing" },
      ]),
    );

    expect(result).toEqual({
      total: 3,
      added: 0,
      already: 1,
      unmatched: ["Missing"],
    });
    expect(db.userShip.update).toHaveBeenCalledWith({
      where: { userId_shipId: { userId: "user-1", shipId: "ship-carrack" } },
      data: { quantity: 1, loanerQuantity: 0, nickname: "X".repeat(80) },
    });
  });

  it("processes at most 1000 entries", async () => {
    const entries = Array.from({ length: 1005 }, (_, i) => ({ name: i % 2 === 0 ? "Carrack" : "Freelancer" }));

    const result = await importUserFleet("user-1", JSON.stringify(entries));

    // 1000 entries read, collapsed to the two distinct models they resolve to.
    expect(result.total).toBe(1000);
    expect(db.userShip.findUnique).toHaveBeenCalledTimes(2);
    expect(result.added).toBe(2);
  });
});

describe("applyFleetEntries", () => {
  it("counts loaner hulls separately from owned hulls of the same model", async () => {
    const result = await applyFleetEntries("user-1", [
      { name: "Carrack" },
      { name: "Carrack", loaner: true },
      { name: "Ares Ion", loaner: true },
    ]);

    expect(result).toEqual({ total: 3, added: 2, already: 0, unmatched: [] });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-carrack", nickname: null, quantity: 1, loanerQuantity: 1 },
    });
    // Loaner-only model: quantity 0 is what flags it in the hangar UI.
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-ion", nickname: null, quantity: 0, loanerQuantity: 1 },
    });
  });

  it("skips name matching when the caller already resolved the ship id", async () => {
    const result = await applyFleetEntries("user-1", [{ name: "whatever", shipId: "ship-carrack" }]);

    expect(result).toEqual({ total: 1, added: 1, already: 0, unmatched: [] });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-carrack", nickname: null, quantity: 1, loanerQuantity: 0 },
    });
  });
});
