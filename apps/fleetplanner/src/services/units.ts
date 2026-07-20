import { prisma } from "../db.js";
import { shipClass } from "./composition.js";
import { autoAssignFighterToSquad } from "./formations.js";
import { specForShip, specForSquad } from "./seats.js";
import type { Prisma, Ship } from "@prisma/client";

export type RegisterUnitInput = {
  unitType: "ship" | "squad" | "vehicle";
  shipId?: string;
  squadName?: string;
  squadSize?: number;
  requirementId?: string;
  captainNote?: string;
  /** Required for unitType "vehicle": the parent ship unit that carries it. */
  carrierUnitId?: string;
};

export async function registerUnit(
  operationId: string,
  captainId: string,
  input: RegisterUnitInput,
) {
  // A ship OR a ground vehicle is picked from the ship catalog (vehicles live
  // there too); a squad is free-formed.
  const isShipLike = input.unitType === "ship" || input.unitType === "vehicle";
  if (isShipLike && !input.shipId) throw new Error("shipId required for ship/vehicle units");
  if (input.unitType === "squad" && (!input.squadName || !input.squadSize)) {
    throw new Error("squadName and squadSize required for squad units");
  }

  // Resolve the catalog ship early: ground vehicles live in the same catalog
  // (size = "vehicle"), so anything picked that is vehicle-class is ALWAYS
  // created as a vehicle unit — never a ship — regardless of which form added it.
  let ship: Ship | null = null;
  if (isShipLike && input.shipId) {
    ship = await prisma.ship.findUnique({ where: { id: input.shipId } });
    if (!ship) throw new Error("Ship not found");
  }
  const unitType =
    ship && (ship.size ?? "").toLowerCase() === "vehicle" ? "vehicle" : input.unitType;

  // A vehicle or a Jäger MAY ride in a ship; if no carrier is given it's an
  // "orphan" the operator assigns later. It inherits the carrier's accept/reject
  // status when carried. Anything bigger than a fighter can't be loaded.
  const loadable = unitType === "vehicle" || (unitType === "ship" && shipClass(ship) === "Fighter");
  let vehicleStatus = "pending";
  let carrierUnitId: string | null = null;
  if (loadable && input.carrierUnitId) {
    const carrier = await prisma.fleetUnit.findUnique({
      where: { id: input.carrierUnitId },
      select: { operationId: true, status: true, unitType: true, ship: { select: { size: true, career: true, role: true } } },
    });
    if (!carrier || carrier.operationId !== operationId) {
      throw new Error("Carrier ship not found in this operation");
    }
    if (carrier.unitType !== "ship") throw new Error("Vehicles and fighters can only attach to a ship");
    if (shipClass(carrier.ship) === "Fighter") throw new Error("A fighter can't carry anything");
    carrierUnitId = input.carrierUnitId;
    vehicleStatus = carrier.status;
  }

  const specs = isShipLike && ship ? specForShip(ship) : specForSquad(input.squadSize!);

  // Create the unit, its seats, and the captain auto-assignment atomically:
  // either the whole unit comes into existence with its seats, or nothing does.
  return prisma.$transaction(async (tx) => {
    const unit = await tx.fleetUnit.create({
      data: {
        operationId,
        captainId,
        unitType,
        shipId: input.shipId ?? null,
        squadName: input.squadName ?? null,
        squadSize: input.squadSize ?? null,
        carrierUnitId: loadable ? carrierUnitId : null,
        requirementId: input.requirementId ?? null,
        captainNote: input.captainNote ?? null,
        status: unitType === "vehicle" ? vehicleStatus : "pending",
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

/**
 * Re-pool the seated CREW of the given units back into the operation's
 * crew-assignment pool (CrewAssignmentRequest). When a captain withdraws his
 * ship (or it gets rejected), the crew sitting in it must NOT silently vanish —
 * they go back to "freie Zuteilung" so the fleet operator can redistribute them
 * onto the remaining ships, ground squads and vehicles. Existing flex requests
 * are kept untouched (upsert no-op on conflict).
 *
 * `excludeUserId` is the withdrawing/offering captain: he pulled his own ship
 * (or it was turned down) and is NOT auto-pooled — only his crew is.
 */
async function repoolSeatedUsers(
  tx: Prisma.TransactionClient,
  operationId: string,
  unitIds: string[],
  note: string,
  excludeUserId?: string,
) {
  const seated = await tx.seatAssignment.findMany({
    where: { unitId: { in: unitIds }, userId: { not: null } },
    select: { userId: true },
  });
  const userIds = [
    ...new Set(seated.map((s) => s.userId).filter((x): x is string => !!x && x !== excludeUserId)),
  ];
  for (const userId of userIds) {
    await tx.crewAssignmentRequest.upsert({
      where: { operationId_userId: { operationId, userId } },
      update: {}, // keep an already-pending flex request as-is
      create: { operationId, userId, note },
    });
  }
}

export async function deleteUnit(unitId: string, userId: string, userRole: string) {
  const unit = await prisma.fleetUnit.findUnique({
    where: { id: unitId },
    include: { ship: { select: { name: true } } },
  });
  if (!unit) throw new Error("Unit not found");
  const canForce = userRole === "superadmin" || userRole === "fleetoperator";
  if (unit.captainId !== userId && !canForce) throw new Error("Forbidden");

  // Carried vehicles cascade-delete with the ship — collect them so their crew
  // is re-pooled too, not just the ship's own seats.
  const vehicleIds = (
    await prisma.fleetUnit.findMany({ where: { carrierUnitId: unitId }, select: { id: true } })
  ).map((v) => v.id);
  const unitName = unit.squadName || unit.ship?.name || "Einheit";

  await prisma.$transaction(async (tx) => {
    // Free the crew (NOT the withdrawing captain; carried-vehicle crew included)
    // back into the pool BEFORE the cascade delete removes their seats.
    await repoolSeatedUsers(
      tx,
      unit.operationId,
      [unitId, ...vehicleIds],
      `Aus zurückgezogener Einheit „${unitName}"`,
      unit.captainId,
    );
    await tx.fleetUnit.delete({ where: { id: unitId } });
  });
}

export async function setUnitStatus(
  unitId: string,
  status: "accepted" | "rejected",
  note?: string,
) {
  // Carried vehicles follow their carrier ship's accept/reject decision
  // ("accept the ship with its vehicle").
  const vehicleIds = (
    await prisma.fleetUnit.findMany({ where: { carrierUnitId: unitId }, select: { id: true } })
  ).map((v) => v.id);
  // A rejected unit (and its vehicles) holds nobody — free their seats so no
  // one keeps a phantom "claimed seat" in something that was turned down. The
  // freed crew is re-pooled into "freie Zuteilung" first, so they reappear for
  // redistribution instead of vanishing from the op.
  if (status === "rejected") {
    const unit = await prisma.fleetUnit.findUnique({
      where: { id: unitId },
      include: { ship: { select: { name: true } } },
    });
    if (unit) {
      const unitName = unit.squadName || unit.ship?.name || "Einheit";
      await prisma.$transaction(async (tx) => {
        await repoolSeatedUsers(
          tx,
          unit.operationId,
          [unitId, ...vehicleIds],
          `Aus abgelehnter Einheit „${unitName}"`,
          unit.captainId,
        );
        await tx.seatAssignment.updateMany({
          where: { unitId: { in: [unitId, ...vehicleIds] }, userId: { not: null } },
          data: { userId: null },
        });
      });
    }
  }
  if (vehicleIds.length) {
    await prisma.fleetUnit.updateMany({ where: { id: { in: vehicleIds } }, data: { status } });
  }
  const result = await prisma.fleetUnit.update({
    where: { id: unitId },
    data: { status, ...(note !== undefined && { leaderNote: note }) },
  });
  // Auto-fill: a freshly accepted fighter drops into the first squad with a free
  // slot (rest stays "Ohne Staffel"). No-op for non-fighters / already-squadded.
  if (status === "accepted") await autoAssignFighterToSquad(result.operationId, unitId);
  return result;
}

// Ground-domain + support categories that may stack with a primary (ship) seat.
// "fps" is the requirement-category equivalent of "ground" — a member can be both
// an FPS-squad seat AND command a ship in the same op, so it must NOT count as primary.
const SECONDARY_ASSIGNMENT_CATEGORIES = new Set([
  "fps",
  "ground",
  "mining",
  "salvage",
  "transport",
]);

function categoryForUnit(unit: {
  unitType: string;
  requirement?: { category: string } | null;
  ship?: Ship | null;
}): string {
  if (unit.requirement?.category) return unit.requirement.category;
  if (unit.unitType === "squad" || unit.unitType === "vehicle") return "ground";
  const career = unit.ship?.career.toLowerCase() ?? "";
  if (career.includes("ground") || career.includes("vehicle")) return "ground";
  if (career.includes("mining")) return "mining";
  if (career.includes("salvage")) return "salvage";
  if (career.includes("transport") || career.includes("cargo")) return "transport";
  return "primary";
}

async function assertUserCanTakeSeat(
  tx: Prisma.TransactionClient,
  operationId: string,
  userId: string,
  targetCategory: string,
) {
  const existing = await tx.seatAssignment.findMany({
    where: { userId, fleetUnit: { operationId } },
    include: { fleetUnit: { include: { requirement: true, ship: true } } },
  });
  if (!existing.length) return;

  const existingCategories = existing.map((seat) => categoryForUnit(seat.fleetUnit));
  const targetIsSecondary = SECONDARY_ASSIGNMENT_CATEGORIES.has(targetCategory);
  if (targetIsSecondary) {
    if (existingCategories.includes(targetCategory)) {
      throw new Error(`Already assigned to a ${targetCategory} seat in this operation`);
    }
    return;
  }

  if (existingCategories.some((category) => !SECONDARY_ASSIGNMENT_CATEGORIES.has(category))) {
    throw new Error("Already assigned to a primary seat in this operation");
  }
}

export async function claimSeat(seatId: string, userId: string) {
  const seat = await prisma.seatAssignment.findUnique({
    where: { id: seatId },
    include: { fleetUnit: { include: { requirement: true, ship: true } } },
  });
  if (!seat) throw new Error("Seat not found");
  if (seat.fleetUnit.status !== "accepted") throw new Error("Unit not yet accepted");
  if (seat.order === 0 && seat.fleetUnit.captainId !== userId) {
    throw new Error("Captain seat can only be claimed by the unit captain");
  }
  if (!seat.active) throw new Error("Seat is disabled");
  if (seat.userId) throw new Error("Seat already taken");

  const operationId = seat.fleetUnit.operationId;
  const targetCategory = categoryForUnit(seat.fleetUnit);
  const unitName =
    seat.fleetUnit.squadName || seat.fleetUnit.ship?.name || "Unit";
  let vacatedCaptainSeat = false;

  // Race-safe claim. Two concurrent requests could both pass the checks
  // above, so do the single-seat-per-op check and the claim inside one
  // transaction, and claim with a conditional updateMany (userId: null)
  // that only succeeds if the seat is still empty. count===0 means another
  // request won the seat between our read and write.
  await prisma.$transaction(async (tx) => {
    // Moving to another seat in the SAME unit: release the seat the user
    // already holds here first (so they switch instead of double-booking).
    const priorHere = await tx.seatAssignment.findMany({
      where: { unitId: seat.unitId, userId, active: true, id: { not: seatId } },
      select: { id: true, order: true },
    });
    if (priorHere.some((s) => s.order === 0)) vacatedCaptainSeat = true;
    if (priorHere.length) {
      await tx.seatAssignment.updateMany({
        where: { id: { in: priorHere.map((s) => s.id) } },
        data: { userId: null },
      });
    }

    await assertUserCanTakeSeat(tx, operationId, userId, targetCategory);

    const result = await tx.seatAssignment.updateMany({
      where: { id: seatId, userId: null, active: true },
      data: { userId },
    });
    if (result.count === 0) throw new Error("Seat already taken");
  });
  return { operationId, unitName, vacatedCaptainSeat };
}

export async function assignSeat(seatId: string, targetUserId: string) {
  const seat = await prisma.seatAssignment.findUnique({
    where: { id: seatId },
    include: { fleetUnit: { include: { requirement: true, ship: true } } },
  });
  if (!seat) throw new Error("Seat not found");
  if (seat.fleetUnit.status !== "accepted") throw new Error("Unit not yet accepted");
  if (!seat.active) throw new Error("Seat is disabled");
  if (seat.userId) throw new Error("Seat already taken");

  const user = await prisma.user.findUnique({ where: { id: targetUserId } });
  if (!user || !user.active) throw new Error("User account not found or inactive");

  const operationId = seat.fleetUnit.operationId;
  const targetCategory = categoryForUnit(seat.fleetUnit);
  await prisma.$transaction(async (tx) => {
    await assertUserCanTakeSeat(tx, operationId, targetUserId, targetCategory);

    const result = await tx.seatAssignment.updateMany({
      where: { id: seatId, userId: null, active: true },
      data: { userId: targetUserId },
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
  if (seat.order === 0 && !canForce)
    throw new Error("Cannot release captain seat; delete the unit instead");
  await prisma.seatAssignment.update({ where: { id: seatId }, data: { userId: null } });
}
