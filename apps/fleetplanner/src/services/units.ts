import { prisma } from "../db.js";
import { specForShip, specForSquad, createSeats } from "./seats.js";

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

  const unit = await prisma.fleetUnit.create({
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

  let specs;
  if (input.unitType === "ship" && input.shipId) {
    const ship = await prisma.ship.findUnique({ where: { id: input.shipId } });
    if (!ship) throw new Error("Ship not found");
    specs = specForShip(ship);
  } else {
    specs = specForSquad(input.squadSize!);
  }

  const seats = await createSeats(unit.id, specs);

  // Auto-assign captain to the first seat (Pilot / Squad Captain)
  if (seats.length > 0) {
    await prisma.seatAssignment.update({ where: { id: seats[0].id }, data: { userId: captainId } });
  }

  return unit;
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

  // A user can only hold one seat per operation — check across all units in the op
  const alreadyClaimed = await prisma.seatAssignment.findFirst({
    where: {
      userId,
      fleetUnit: { operationId: seat.fleetUnit.operationId },
    },
  });
  if (alreadyClaimed) throw new Error("Already assigned to a seat in this operation");

  await prisma.seatAssignment.update({ where: { id: seatId }, data: { userId } });
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
