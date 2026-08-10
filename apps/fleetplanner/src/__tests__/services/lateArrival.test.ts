import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    fleetUnit: { findFirst: vi.fn(), update: vi.fn() },
    seatAssignment: { findFirst: vi.fn(), update: vi.fn() },
    cqbSignup: { findFirst: vi.fn(), update: vi.fn() },
  },
}));

import { prisma } from "../../db.js";
import {
  cqbOwner,
  seatOwner,
  setCqbLateEta,
  setSeatLateEta,
  setUnitLateEta,
  unitOwner,
} from "../../services/lateArrival.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("ownership lookups are scoped to the operation", () => {
  it("returns a unit's captain, and null for a unit of another op", async () => {
    db.fleetUnit.findFirst.mockResolvedValue({ captainId: "u1" });
    expect(await unitOwner("op1", "unit1")).toBe("u1");
    // The where clause carries the operationId — a stray id from another op
    // must not resolve to an owner the caller would then trust.
    expect(db.fleetUnit.findFirst.mock.calls[0][0].where).toEqual({ id: "unit1", operationId: "op1" });

    db.fleetUnit.findFirst.mockResolvedValue(null);
    expect(await unitOwner("op1", "foreign")).toBeNull();
  });

  it("distinguishes an unclaimed seat (null) from a missing one (undefined)", async () => {
    db.seatAssignment.findFirst.mockResolvedValue({ userId: null });
    expect(await seatOwner("op1", "seat1")).toBeNull();
    db.seatAssignment.findFirst.mockResolvedValue(null);
    expect(await seatOwner("op1", "seat9")).toBeUndefined();
    db.seatAssignment.findFirst.mockResolvedValue({ userId: "u2" });
    expect(await seatOwner("op1", "seat2")).toBe("u2");
  });

  it("scopes the seat lookup through its fleet unit's operation", async () => {
    db.seatAssignment.findFirst.mockResolvedValue(null);
    await seatOwner("op1", "seat1");
    expect(db.seatAssignment.findFirst.mock.calls[0][0].where).toEqual({
      id: "seat1",
      fleetUnit: { operationId: "op1" },
    });
  });

  it("returns a CQB signup's owner scoped to the op", async () => {
    db.cqbSignup.findFirst.mockResolvedValue({ userId: "u3" });
    expect(await cqbOwner("op1", "s1")).toBe("u3");
    expect(db.cqbSignup.findFirst.mock.calls[0][0].where).toEqual({ id: "s1", operationId: "op1" });
    db.cqbSignup.findFirst.mockResolvedValue(null);
    expect(await cqbOwner("op1", "s9")).toBeNull();
  });
});

describe("setting and clearing the ETA", () => {
  it("writes the ETA on a unit and clears it with null", async () => {
    await setUnitLateEta("unit1", "20:30");
    expect(db.fleetUnit.update).toHaveBeenCalledWith({ where: { id: "unit1" }, data: { lateEta: "20:30" } });
    await setUnitLateEta("unit1", null);
    expect(db.fleetUnit.update).toHaveBeenLastCalledWith({ where: { id: "unit1" }, data: { lateEta: null } });
  });

  it("writes the ETA on a seat", async () => {
    await setSeatLateEta("seat1", "21:00");
    expect(db.seatAssignment.update).toHaveBeenCalledWith({ where: { id: "seat1" }, data: { lateEta: "21:00" } });
  });

  it("writes the ETA on a CQB signup", async () => {
    await setCqbLateEta("s1", "19:45");
    expect(db.cqbSignup.update).toHaveBeenCalledWith({ where: { id: "s1" }, data: { lateEta: "19:45" } });
  });
});
