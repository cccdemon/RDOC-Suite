import { prisma } from "../db.js";
import { specForShip, specForSquad } from "./seats.js";

export type RegisterUnitInput = {
  unitType: "ship" | "squad";
  shipId?: string;
  squadName?: string;
  squadSize?: number;
  requirementId?: string;
  captainNote?: string;
};

export async function registerUnit(operationId: string, captainId: string, input: RegisterUnitInput) {
  if (input.unitType === "ship" && !input.shipId) throw new Error("shipId required for ship units");
  if (input.unitType === "squad" && (!input.squadName || !input.squadSize)) {
    throw new Error("squadName and squadSize required for squad units");
  }

  // Validate the ship and compute seat specs BEFORE writing anything, so a
  // bad shipId can never leave an orphan unit row behind.
  let specs;
  if (input.unitType === "ship" && input.shipId) {
    const ship = await prisma.ship.findUnique({ where: { id: input.shipId } });
    if (!ship) throw new Error("Ship not found");
    specs = specForShip(ship);
  } else {
    specs = specForSquad(input.squadSize!);
  }

  // Create the unit, its seats, and the captain auto-assignment atomically:
  // either the whole unit comes into existence with its seats, or nothing does.
  return prisma.$transaction(async (tx) => {
    const unit = await tx.fleetUnit.create({
      data: {
        operationId,
        captainId,
        unitType: input.unitType,
        shipId: input.shipId ?? null,
        squadName: input.squadName ?? null,
        squadSize: input.squadSize ?? null,
        requirementId: input.requirementId ?? null,
        captainNote: input.captainNote ?? null,
        status: "pending",
      },
    });

    for (const s of specs) {
      await tx.seatAssignment.create({
        data: {
          unitId: unit.id,
          label: s.label,
          seatType: s.seatType,
          order: s.order,
          // Auto-assign captain to the first seat (Pilot / Squad Captain).
          ...(s.order === 0 ? { userId: captainId } : {}),
        },
      });
    }

    return unit;
  });
}

export async function deleteUnit(unitId: string, userId: string, userRole: string) {
  const unit = await prisma.fleetUnit.findUnique({ where: { id: unitId } });
  if (!unit) throw new Error("Unit not found");
  const canForce = userRole === "superadmin" || userRole === "fleetoperator";
  if (unit.captainId !== userId && !canForce) throw new Error("Forbidden");
  await prisma.fleetUnit.delete({ where: { id: unitId } });
}

export async function setUnitStatus(unitId: string, status: "accepted" | "rejected", note?: string) {
  return prisma.fleetUnit.update({
    where: { id: unitId },
    data: { status, ...(note !== undefined && { leaderNote: note }) },
  });
}

export async function claimSeat(seatId: string, userId: string) {
  const seat = await prisma.seatAssignment.findUnique({
    where: { id: seatId },
    include: { fleetUnit: true },
  });
  if (!seat) throw new Error("Seat not found");
  if (seat.fleetUnit.status !== "accepted") throw new Error("Unit not yet accepted");
  if (seat.userId) throw new Error("Seat already taken");

  const operationId = seat.fleetUnit.operationId;

  // Race-safe claim. Two concurrent requests could both pass the checks
  // above, so do the single-seat-per-op check and the claim inside one
  // transaction, and claim with a conditional updateMany (userId: null)
  // that only succeeds if the seat is still empty. count===0 means another
  // request won the seat between our read and write.
  await prisma.$transaction(async (tx) => {
    const alreadyClaimed = await tx.seatAssignment.findFirst({
      where: { userId, fleetUnit: { operationId } },
    });
    if (alreadyClaimed) throw new Error("Already assigned to a seat in this operation");

    const result = await tx.seatAssignment.updateMany({
      where: { id: seatId, userId: null },
      data: { userId },
    });
    if (result.count === 0) throw new Error("Seat already taken");
  });
}

export async function unclaimSeat(seatId: string, userId: string, userRole: string) {
  const seat = await prisma.seatAssignment.findUnique({
    where: { id: seatId },
    include: { fleetUnit: true },
  });
  if (!seat) throw new Error("Seat not found");
  const canForce = userRole === "superadmin" || userRole === "fleetoperator";
  if (seat.userId !== userId && !canForce) throw new Error("Forbidden");
  // Captain seat (order 0) can only be freed by admin/fleetop (would orphan the unit otherwise)
  if (seat.order === 0 && !canForce) throw new Error("Cannot release captain seat; delete the unit instead");
  await prisma.seatAssignment.update({ where: { id: seatId }, data: { userId: null } });
}

export async function getUnitWithDetails(unitId: string) {
  return prisma.fleetUnit.findUnique({
    where: { id: unitId },
    include: {
      ship: true,
      captain: true,
      seats: { include: { user: true }, orderBy: { order: "asc" } },
    },
  });
}
