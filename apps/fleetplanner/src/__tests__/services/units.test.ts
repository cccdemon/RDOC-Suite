import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    ship: { findUnique: vi.fn() },
    seatAssignment: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    fleetUnit: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    user: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../db.js";
import {
  registerUnit,
  deleteUnit,
  setUnitStatus,
  claimSeat,
  assignSeat,
  unclaimSeat,
} from "../../services/units.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  // Default $transaction: callback mode passes prisma as the tx client
  db.$transaction.mockImplementation(async (fn: unknown) => {
    if (typeof fn === "function") return fn(db);
    return Promise.all(fn as Promise<unknown>[]);
  });
});

// ── registerUnit ─────────────────────────────────────────────────────────────

describe("registerUnit", () => {
  it("throws if ship type has no shipId", async () => {
    await expect(registerUnit("op-1", "cap-1", { unitType: "ship" }))
      .rejects.toThrow("shipId required");
  });

  it("throws if squad type has no squadName", async () => {
    await expect(registerUnit("op-1", "cap-1", { unitType: "squad", squadSize: 4 }))
      .rejects.toThrow("squadName and squadSize required");
  });

  it("throws if squad type has no squadSize", async () => {
    await expect(registerUnit("op-1", "cap-1", { unitType: "squad", squadName: "Alpha" }))
      .rejects.toThrow("squadName and squadSize required");
  });

  it("throws when ship not found in DB", async () => {
    db.ship.findUnique.mockResolvedValue(null);
    await expect(registerUnit("op-1", "cap-1", { unitType: "ship", shipId: "ship-999" }))
      .rejects.toThrow("Ship not found");
  });

  it("creates unit + seats for ship type", async () => {
    const ship = { id: "ship-1", maxCrew: 2, weaponCrew: 0, operationCrew: 0 };
    db.ship.findUnique.mockResolvedValue(ship);
    const unit = { id: "unit-1", operationId: "op-1", captainId: "cap-1", status: "pending" };
    db.fleetUnit.create.mockResolvedValue(unit);
    db.seatAssignment.create.mockResolvedValue({});

    const result = await registerUnit("op-1", "cap-1", { unitType: "ship", shipId: "ship-1" });

    expect(result).toEqual(unit);
    expect(db.fleetUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ operationId: "op-1", captainId: "cap-1", status: "pending" }),
      }),
    );
    // maxCrew=2, weaponCrew=0, operationCrew=0 → Pilot + 1 flex = 2 seats
    expect(db.seatAssignment.create).toHaveBeenCalledTimes(2);
  });

  it("auto-assigns captain to the first seat (order=0)", async () => {
    db.ship.findUnique.mockResolvedValue({ id: "ship-1", maxCrew: 2, weaponCrew: 0, operationCrew: 0 });
    db.fleetUnit.create.mockResolvedValue({ id: "unit-1" });
    db.seatAssignment.create.mockResolvedValue({});

    await registerUnit("op-1", "cap-1", { unitType: "ship", shipId: "ship-1" });

    const firstCall = db.seatAssignment.create.mock.calls[0][0];
    expect(firstCall.data).toMatchObject({ order: 0, userId: "cap-1" });

    const secondCall = db.seatAssignment.create.mock.calls[1][0];
    expect(secondCall.data.userId).toBeUndefined();
  });

  it("does not assign captain to non-first seats", async () => {
    // 3-seat ship: Pilot + Gunner + flex
    db.ship.findUnique.mockResolvedValue({ id: "ship-1", maxCrew: 3, weaponCrew: 1, operationCrew: 0 });
    db.fleetUnit.create.mockResolvedValue({ id: "unit-1" });
    db.seatAssignment.create.mockResolvedValue({});

    await registerUnit("op-1", "cap-1", { unitType: "ship", shipId: "ship-1" });

    for (let i = 1; i < db.seatAssignment.create.mock.calls.length; i++) {
      expect(db.seatAssignment.create.mock.calls[i][0].data.userId).toBeUndefined();
    }
  });

  it("creates squad unit with correct data", async () => {
    db.fleetUnit.create.mockResolvedValue({ id: "unit-2" });
    db.seatAssignment.create.mockResolvedValue({});

    await registerUnit("op-1", "cap-1", { unitType: "squad", squadName: "Alpha", squadSize: 3 });

    expect(db.fleetUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitType: "squad", squadName: "Alpha", squadSize: 3 }),
      }),
    );
    // Squad Captain + FPS 1 + FPS 2 = 3 seats
    expect(db.seatAssignment.create).toHaveBeenCalledTimes(3);
  });

  it("passes optional requirementId and captainNote to unit", async () => {
    db.ship.findUnique.mockResolvedValue({ id: "ship-1", maxCrew: 1, weaponCrew: 0, operationCrew: 0 });
    db.fleetUnit.create.mockResolvedValue({ id: "unit-1" });
    db.seatAssignment.create.mockResolvedValue({});

    await registerUnit("op-1", "cap-1", {
      unitType: "ship",
      shipId: "ship-1",
      requirementId: "req-5",
      captainNote: "I'll take the Pilot seat",
    });

    expect(db.fleetUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ requirementId: "req-5", captainNote: "I'll take the Pilot seat" }),
      }),
    );
  });
});

// ── deleteUnit ────────────────────────────────────────────────────────────────

describe("deleteUnit", () => {
  it("throws when unit not found", async () => {
    db.fleetUnit.findUnique.mockResolvedValue(null);
    await expect(deleteUnit("unit-1", "user-1", "crew")).rejects.toThrow("Unit not found");
  });

  it("throws when non-captain non-operator tries to delete", async () => {
    db.fleetUnit.findUnique.mockResolvedValue({ id: "unit-1", captainId: "other-cap" });
    await expect(deleteUnit("unit-1", "user-1", "crew")).rejects.toThrow("Forbidden");
  });

  it("captain can delete own unit", async () => {
    db.fleetUnit.findUnique.mockResolvedValue({ id: "unit-1", captainId: "cap-1" });
    db.fleetUnit.delete.mockResolvedValue({});
    await deleteUnit("unit-1", "cap-1", "crew");
    expect(db.fleetUnit.delete).toHaveBeenCalledWith({ where: { id: "unit-1" } });
  });

  it("fleetoperator can delete any unit", async () => {
    db.fleetUnit.findUnique.mockResolvedValue({ id: "unit-1", captainId: "other-cap" });
    db.fleetUnit.delete.mockResolvedValue({});
    await deleteUnit("unit-1", "op-user", "fleetoperator");
    expect(db.fleetUnit.delete).toHaveBeenCalled();
  });

  it("superadmin can delete any unit", async () => {
    db.fleetUnit.findUnique.mockResolvedValue({ id: "unit-1", captainId: "other-cap" });
    db.fleetUnit.delete.mockResolvedValue({});
    await deleteUnit("unit-1", "admin-user", "superadmin");
    expect(db.fleetUnit.delete).toHaveBeenCalled();
  });
});

// ── setUnitStatus ─────────────────────────────────────────────────────────────

describe("setUnitStatus", () => {
  it("sets accepted status", async () => {
    db.fleetUnit.update.mockResolvedValue({ id: "unit-1", status: "accepted" });
    await setUnitStatus("unit-1", "accepted");
    expect(db.fleetUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "accepted" }) }),
    );
  });

  it("sets rejected status with a leader note", async () => {
    db.fleetUnit.update.mockResolvedValue({});
    await setUnitStatus("unit-1", "rejected", "Not enough capacity");
    expect(db.fleetUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "rejected", leaderNote: "Not enough capacity" }),
      }),
    );
  });

  it("does not include leaderNote when note is undefined", async () => {
    db.fleetUnit.update.mockResolvedValue({});
    await setUnitStatus("unit-1", "accepted");
    const { data } = db.fleetUnit.update.mock.calls[0][0];
    expect("leaderNote" in data).toBe(false);
  });
});

// ── claimSeat ─────────────────────────────────────────────────────────────────

function makeSeat(overrides: {
  order?: number;
  active?: boolean;
  userId?: string | null;
  unitStatus?: string;
  career?: string;
}) {
  return {
    id: "seat-1",
    order: overrides.order ?? 1,
    active: overrides.active ?? true,
    userId: overrides.userId ?? null,
    fleetUnit: {
      id: "unit-1",
      operationId: "op-1",
      unitType: "ship",
      status: overrides.unitStatus ?? "accepted",
      requirement: null,
      ship: { career: overrides.career ?? "Combat" },
    },
  };
}

describe("claimSeat", () => {
  it("throws when seat not found", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(null);
    await expect(claimSeat("seat-999", "user-1")).rejects.toThrow("Seat not found");
  });

  it("throws when unit is not yet accepted", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ unitStatus: "pending" }));
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Unit not yet accepted");
  });

  it("throws for the captain seat (order=0)", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ order: 0 }));
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Captain seat cannot be claimed");
  });

  it("throws when seat is disabled (active=false)", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ active: false }));
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Seat is disabled");
  });

  it("throws when seat is already occupied", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ userId: "other-user" }));
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Seat already taken");
  });

  it("throws when concurrent claim wins the race (updateMany count=0)", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    db.seatAssignment.findMany.mockResolvedValue([]);
    db.seatAssignment.updateMany.mockResolvedValue({ count: 0 });
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Seat already taken");
  });

  it("claims seat successfully when all conditions pass", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    db.seatAssignment.findMany.mockResolvedValue([]);
    db.seatAssignment.updateMany.mockResolvedValue({ count: 1 });
    await claimSeat("seat-1", "user-1");
    expect(db.seatAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: "user-1" } }),
    );
  });

  it("prevents claiming a second primary seat in the same op", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    // user already holds a primary (combat) seat in this op
    db.seatAssignment.findMany.mockResolvedValue([
      {
        fleetUnit: {
          operationId: "op-1",
          unitType: "ship",
          requirement: null,
          ship: { career: "Combat" },
        },
      },
    ]);
    await expect(claimSeat("seat-1", "user-1")).rejects.toThrow("Already assigned to a primary seat");
  });
});

// ── assignSeat ────────────────────────────────────────────────────────────────

describe("assignSeat", () => {
  it("throws when seat not found", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(null);
    await expect(assignSeat("seat-1", "user-1")).rejects.toThrow("Seat not found");
  });

  it("throws when unit is not accepted", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ unitStatus: "pending" }));
    await expect(assignSeat("seat-1", "user-1")).rejects.toThrow("Unit not yet accepted");
  });

  it("throws for the captain seat (order=0)", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({ order: 0 }));
    await expect(assignSeat("seat-1", "user-1")).rejects.toThrow("Captain seat cannot be assigned");
  });

  it("throws when target user not found or inactive", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    db.user.findUnique.mockResolvedValue(null);
    await expect(assignSeat("seat-1", "user-1")).rejects.toThrow("User account not found or inactive");
  });

  it("throws when target user is inactive", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    db.user.findUnique.mockResolvedValue({ id: "user-1", active: false });
    await expect(assignSeat("seat-1", "user-1")).rejects.toThrow("User account not found or inactive");
  });

  it("assigns seat to active user", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(makeSeat({}));
    db.user.findUnique.mockResolvedValue({ id: "user-1", active: true });
    db.seatAssignment.findMany.mockResolvedValue([]);
    db.seatAssignment.updateMany.mockResolvedValue({ count: 1 });
    await assignSeat("seat-1", "user-1");
    expect(db.seatAssignment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { userId: "user-1" } }),
    );
  });
});

// ── unclaimSeat ───────────────────────────────────────────────────────────────

describe("unclaimSeat", () => {
  it("throws when seat not found", async () => {
    db.seatAssignment.findUnique.mockResolvedValue(null);
    await expect(unclaimSeat("seat-1", "user-1", "crew")).rejects.toThrow("Seat not found");
  });

  it("throws when crew member tries to release another user's seat", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "other-user", order: 1,
      fleetUnit: { id: "unit-1" },
    });
    await expect(unclaimSeat("seat-1", "user-1", "crew")).rejects.toThrow("Forbidden");
  });

  it("throws when crew tries to release the captain seat (order=0)", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "user-1", order: 0,
      fleetUnit: { id: "unit-1" },
    });
    await expect(unclaimSeat("seat-1", "user-1", "crew")).rejects.toThrow("Cannot release captain seat");
  });

  it("seat owner can release a non-captain seat", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "user-1", order: 1,
      fleetUnit: { id: "unit-1" },
    });
    db.seatAssignment.update.mockResolvedValue({});
    await unclaimSeat("seat-1", "user-1", "crew");
    expect(db.seatAssignment.update).toHaveBeenCalledWith({
      where: { id: "seat-1" },
      data: { userId: null },
    });
  });

  it("fleetoperator can release the captain seat", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "cap-1", order: 0,
      fleetUnit: { id: "unit-1" },
    });
    db.seatAssignment.update.mockResolvedValue({});
    await unclaimSeat("seat-1", "op-user", "fleetoperator");
    expect(db.seatAssignment.update).toHaveBeenCalledWith({
      where: { id: "seat-1" },
      data: { userId: null },
    });
  });

  it("superadmin can release any seat including captain seat", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "cap-1", order: 0,
      fleetUnit: { id: "unit-1" },
    });
    db.seatAssignment.update.mockResolvedValue({});
    await unclaimSeat("seat-1", "admin-1", "superadmin");
    expect(db.seatAssignment.update).toHaveBeenCalled();
  });

  it("fleetoperator can release another user's non-captain seat", async () => {
    db.seatAssignment.findUnique.mockResolvedValue({
      id: "seat-1", userId: "some-user", order: 2,
      fleetUnit: { id: "unit-1" },
    });
    db.seatAssignment.update.mockResolvedValue({});
    await unclaimSeat("seat-1", "op-user", "fleetoperator");
    expect(db.seatAssignment.update).toHaveBeenCalled();
  });
});
