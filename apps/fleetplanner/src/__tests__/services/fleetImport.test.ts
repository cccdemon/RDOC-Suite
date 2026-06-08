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
import { importUserFleet } from "../../services/fleetImport.js";

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
      data: { userId: "user-1", shipId: "ship-carrack", nickname: "Expedition" },
    });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-ion", nickname: null },
    });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-freelancer", nickname: null },
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
      data: { nickname: "X".repeat(80) },
    });
  });

  it("processes at most 1000 entries", async () => {
    const entries = Array.from({ length: 1005 }, () => ({ name: "Carrack" }));

    const result = await importUserFleet("user-1", JSON.stringify(entries));

    expect(result.total).toBe(1000);
    expect(db.userShip.findUnique).toHaveBeenCalledTimes(1000);
  });
});
