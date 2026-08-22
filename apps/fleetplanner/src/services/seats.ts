import type { Ship, SeatAssignment } from "@prisma/client";
import { prisma } from "../db.js";

export type SeatSpec = { label: string; seatType: string; order: number };

export function specForShip(ship: Ship): SeatSpec[] {
  const specs: SeatSpec[] = [];
  let order = 0;

  specs.push({ label: "Pilot", seatType: "pilot", order: order++ });

  for (let i = 0; i < ship.weaponCrew; i++) {
    const label = ship.weaponCrew === 1 ? "Gunner" : `Gunner ${i + 1}`;
    specs.push({ label, seatType: "gunner", order: order++ });
  }

  for (let i = 0; i < ship.operationCrew; i++) {
    const label = ship.operationCrew === 1 ? "Engineer" : `Engineer ${i + 1}`;
    specs.push({ label, seatType: "operation", order: order++ });
  }

  const flex = Math.max(0, ship.maxCrew - 1 - ship.weaponCrew - ship.operationCrew);
  for (let i = 0; i < flex; i++) {
    const label = flex === 1 ? "Crew" : `Crew ${i + 1}`;
    specs.push({ label, seatType: "flex", order: order++ });
  }

  return specs;
}

export function specForSquad(squadSize: number): SeatSpec[] {
  const specs: SeatSpec[] = [];
  specs.push({ label: "Squad Captain", seatType: "fps", order: 0 });
  for (let i = 1; i < squadSize; i++) {
    specs.push({ label: `FPS ${i}`, seatType: "fps", order: i });
  }
  return specs;
}
