// Roles a ship can be offered as. The catalog's guess is only a default — it
// calls the Cutlass Black "Light Freight / Medium Fighter" — so the player
// declares the role and the operator can correct it.
//
// "Ground vehicle" is deliberately absent: vehicles are their own unit type,
// chosen by the offer form's mode, not by this picker.
import type { ShipClass } from "./api/types";

export const OFFERABLE_ROLES: ShipClass[] = [
  "Fighter",
  "Transport",
  "Support",
  "Mining",
  "Salvage",
  "Exploration",
  "Capital",
  "Sub-capital",
];

export const ROLE_LABEL: Record<string, string> = {
  Fighter: "Jäger",
  Transport: "Transport",
  Support: "Support",
  Mining: "Bergbau",
  Salvage: "Bergung",
  Exploration: "Erkundung",
  Capital: "Capital",
  "Sub-capital": "Sub-capital",
  "Ground vehicle": "Fahrzeug",
};

/** Display name for a class, falling back to the raw value for catalog oddities. */
export const roleLabel = (v: string | null | undefined) => (v ? ROLE_LABEL[v] ?? v : "");
