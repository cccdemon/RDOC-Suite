import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    fleetUnit: { findMany: vi.fn() },
    opPrimaryUnit: {
      findMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    user: { findMany: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import {
  defaultPrimaryUnit,
  getMultiPositionAssignments,
  resolvePrimaryUnits,
  setPrimaryUnit,
  userUnitsByUser,
  type UserUnit,
} from "../../services/primaryUnits.js";

const db = prisma as {
  fleetUnit: { findMany: ReturnType<typeof vi.fn> };
  opPrimaryUnit: {
    findMany: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  user: { findMany: ReturnType<typeof vi.fn> };
};

const createdAt = (day: number) => new Date(Date.UTC(2026, 5, day, 12));

beforeEach(() => {
  vi.clearAllMocks();
  db.opPrimaryUnit.findMany.mockResolvedValue([]);
});

describe("defaultPrimaryUnit", () => {
  it("prefers squads over ships, otherwise the earliest unit", () => {
    const ship: UserUnit = {
      unitId: "ship-1",
      unitType: "ship",
      name: "Carrack",
      createdAt: createdAt(1),
      hasChannel: true,
    };
    const squad: UserUnit = {
      unitId: "squad-1",
      unitType: "squad",
      name: "Alpha",
      createdAt: createdAt(2),
      hasChannel: false,
    };

    expect(defaultPrimaryUnit([ship, squad])).toBe(squad);
    expect(defaultPrimaryUnit([ship])).toBe(ship);
    expect(defaultPrimaryUnit([])).toBeNull();
  });
});

describe("userUnitsByUser", () => {
  it("groups captain and active seat memberships without duplicating the same unit", async () => {
    db.fleetUnit.findMany.mockResolvedValue([
      {
        id: "unit-1",
        unitType: "ship",
        squadName: null,
        createdAt: createdAt(1),
        captainId: "user-a",
        ship: { name: "Carrack" },
        seats: [{ userId: "user-a" }, { userId: "user-b" }],
      },
      {
        id: "unit-2",
        unitType: "squad",
        squadName: "Ground",
        createdAt: createdAt(2),
        captainId: "user-b",
        ship: null,
        seats: [],
      },
    ]);

    const byUser = await userUnitsByUser("op-1");

    expect(byUser.get("user-a")).toEqual([
      {
        unitId: "unit-1",
        unitType: "ship",
        name: "Carrack",
        createdAt: createdAt(1),
        hasChannel: false,
      },
    ]);
    expect(byUser.get("user-b")?.map((u) => u.unitId)).toEqual(["unit-1", "unit-2"]);
  });
});

describe("resolvePrimaryUnits", () => {
  it("uses valid explicit choices and falls back when a choice is stale", async () => {
    db.fleetUnit.findMany.mockResolvedValue([
      {
        id: "ship-1",
        unitType: "ship",
        squadName: null,
        createdAt: createdAt(1),
        captainId: "user-a",
        ship: { name: "Carrack" },
        seats: [{ userId: "user-b" }],
      },
      {
        id: "squad-1",
        unitType: "squad",
        squadName: "Ground",
        createdAt: createdAt(2),
        captainId: "user-b",
        ship: null,
        seats: [],
      },
    ]);
    db.opPrimaryUnit.findMany.mockResolvedValue([
      { userId: "user-a", unitId: "ship-1" },
      { userId: "user-b", unitId: "stale-unit" },
    ]);

    const resolved = await resolvePrimaryUnits("op-1");

    expect(resolved.get("user-a")).toBe("ship-1");
    expect(resolved.get("user-b")).toBe("squad-1");
  });
});

describe("setPrimaryUnit", () => {
  it("rejects choices for units the user is not assigned to", async () => {
    db.fleetUnit.findMany.mockResolvedValue([
      {
        id: "unit-1",
        unitType: "ship",
        squadName: null,
        createdAt: createdAt(1),
        captainId: "user-a",
        ship: { name: "Carrack" },
        seats: [],
      },
    ]);

    await expect(setPrimaryUnit("op-1", "user-b", "unit-1", "leader")).rejects.toThrow(
      "User is not assigned to that unit",
    );
    expect(db.opPrimaryUnit.upsert).not.toHaveBeenCalled();
  });

  it("upserts valid choices with the setter id", async () => {
    db.fleetUnit.findMany.mockResolvedValue([
      {
        id: "unit-1",
        unitType: "ship",
        squadName: null,
        createdAt: createdAt(1),
        captainId: "user-a",
        ship: { name: "Carrack" },
        seats: [],
      },
    ]);

    await setPrimaryUnit("op-1", "user-a", "unit-1", "leader");

    expect(db.opPrimaryUnit.upsert).toHaveBeenCalledWith({
      where: { operationId_userId: { operationId: "op-1", userId: "user-a" } },
      update: { unitId: "unit-1", setByUserId: "leader" },
      create: { operationId: "op-1", userId: "user-a", unitId: "unit-1", setByUserId: "leader" },
    });
  });
});

describe("getMultiPositionAssignments", () => {
  it("returns only users in multiple units, sorted by username", async () => {
    db.fleetUnit.findMany.mockResolvedValue([
      {
        id: "ship-1",
        unitType: "ship",
        squadName: null,
        createdAt: createdAt(1),
        captainId: "user-a",
        ship: { name: "Carrack" },
        seats: [{ userId: "user-b" }],
      },
      {
        id: "squad-1",
        unitType: "squad",
        squadName: "Ground",
        createdAt: createdAt(2),
        captainId: "user-b",
        ship: null,
        seats: [],
      },
    ]);
    db.user.findMany.mockResolvedValue([
      { id: "user-b", username: "Bravo" },
      { id: "user-a", username: "Alpha" },
    ]);
    db.opPrimaryUnit.findMany.mockResolvedValue([{ userId: "user-b", unitId: "ship-1" }]);

    const result = await getMultiPositionAssignments("op-1");

    expect(result).toEqual([
      {
        userId: "user-b",
        username: "Bravo",
        units: expect.arrayContaining([
          expect.objectContaining({ unitId: "ship-1" }),
          expect.objectContaining({ unitId: "squad-1" }),
        ]),
        chosenUnitId: "ship-1",
        effectiveUnitId: "ship-1",
      },
    ]);
  });
});
