import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    fleetyardsShip: { findMany: vi.fn() },
    fleetyardsSyncState: { upsert: vi.fn(), update: vi.fn(), findUnique: vi.fn() },
    ship: { findMany: vi.fn() },
    userShip: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import {
  fetchPublicHangar,
  FleetyardsUserNotFound,
  importFleetFromFleetyards,
  isValidFleetyardsUsername,
} from "../../services/fleetyards.js";

const db = prisma as unknown as {
  fleetyardsShip: { findMany: ReturnType<typeof vi.fn> };
  ship: { findMany: ReturnType<typeof vi.fn> };
  userShip: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
};

/** One page of the Fleetyards /public/hangars response. */
function page(items: unknown[]) {
  return { ok: true, status: 200, json: async () => ({ items }) };
}
function hull(name: string, slug: string, loaner = false) {
  return { id: `h-${slug}-${loaner}`, loaner, model: { name, slug } };
}

const fetchMock = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  db.ship.findMany.mockResolvedValue([
    { id: "ship-carrack", name: "Carrack" },
    { id: "ship-325a", name: "Origin 325a" },
  ]);
  db.fleetyardsShip.findMany.mockResolvedValue([]);
  db.userShip.findUnique.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("isValidFleetyardsUsername", () => {
  it("accepts plain handles and rejects path-escaping input", () => {
    expect(isValidFleetyardsUsername("Some_Player-1")).toBe(true);
    expect(isValidFleetyardsUsername("a")).toBe(false);
    expect(isValidFleetyardsUsername("../admin")).toBe(false);
    expect(isValidFleetyardsUsername("has space")).toBe(false);
  });
});

describe("fetchPublicHangar", () => {
  it("rejects an invalid username before hitting the network", async () => {
    await expect(fetchPublicHangar("../etc")).rejects.toBeInstanceOf(FleetyardsUserNotFound);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("maps items to hulls and stops on a short page", async () => {
    fetchMock.mockResolvedValueOnce(page([hull("Carrack", "anvl-carrack"), hull("325a", "orig-325a", true)]));

    const hulls = await fetchPublicHangar("player");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hulls).toEqual([
      { modelSlug: "anvl-carrack", modelName: "Carrack", loaner: false },
      { modelSlug: "orig-325a", modelName: "325a", loaner: true },
    ]);
  });

  it("walks pages while they come back full", async () => {
    fetchMock
      .mockResolvedValueOnce(page(Array.from({ length: 240 }, () => hull("Carrack", "anvl-carrack"))))
      .mockResolvedValueOnce(page([hull("325a", "orig-325a")]));

    const hulls = await fetchPublicHangar("player");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(hulls).toHaveLength(241);
  });

  it("turns a 404 into FleetyardsUserNotFound and other failures into a generic error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({}) });
    await expect(fetchPublicHangar("nobody")).rejects.toBeInstanceOf(FleetyardsUserNotFound);

    fetchMock.mockResolvedValueOnce({ ok: false, status: 503, json: async () => ({}) });
    await expect(fetchPublicHangar("player")).rejects.toThrow("Fleetyards returned 503");
  });

  it("returns nothing for an empty or non-public hangar", async () => {
    fetchMock.mockResolvedValueOnce(page([]));
    await expect(fetchPublicHangar("player")).resolves.toEqual([]);
  });
});

describe("importFleetFromFleetyards", () => {
  it("prefers the cached Fleetyards name for the slug over the raw model name", async () => {
    // The hangar payload calls it "325a"; the local catalog knows "Origin 325a".
    // The FleetyardsShip cache carries the name the catalog was matched against.
    fetchMock.mockResolvedValueOnce(page([hull("325a", "orig-325a")]));
    db.fleetyardsShip.findMany.mockResolvedValue([{ slug: "orig-325a", name: "Origin 325a" }]);

    const r = await importFleetFromFleetyards("user-1", "player");

    expect(r).toMatchObject({ total: 1, added: 1, already: 0, loaners: 0, unmatched: [] });
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-325a", nickname: null, quantity: 1, loanerQuantity: 0 },
    });
  });

  it("imports loaners marked instead of skipping them", async () => {
    fetchMock.mockResolvedValueOnce(page([hull("Carrack", "anvl-carrack", true)]));

    const r = await importFleetFromFleetyards("user-1", "player");

    expect(r.loaners).toBe(1);
    expect(db.userShip.create).toHaveBeenCalledWith({
      data: { userId: "user-1", shipId: "ship-carrack", nickname: null, quantity: 0, loanerQuantity: 1 },
    });
  });

  it("reports hulls the local catalog does not know", async () => {
    fetchMock.mockResolvedValueOnce(page([hull("Nonexistent Hull", "xx-nope")]));

    const r = await importFleetFromFleetyards("user-1", "player");

    expect(r.unmatched).toEqual(["Nonexistent Hull"]);
    expect(db.userShip.create).not.toHaveBeenCalled();
  });
});
