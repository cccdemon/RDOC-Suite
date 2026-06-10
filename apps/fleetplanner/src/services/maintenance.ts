import { getSetting, setSetting } from "./settings.js";

// Maintenance mode: a global gate that shows a maintenance screen to everyone
// except superadmins while the operator does updates/changes.
//
// Two sources, OR-combined:
//  1. Env override MAINTENANCE_MODE (1/true/on) — forces it on (deploys, hard cases).
//  2. A superadmin toggle persisted in AppSetting (key maintenance.enabled) and
//     cached in memory so the per-request gate never hits the DB.
const KEY = "maintenance.enabled";

let dbFlag = false;

function envForced(): boolean {
  const v = (process.env.MAINTENANCE_MODE ?? "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "on" || v === "yes";
}

/** Load the persisted flag into memory. Call once at boot. */
export async function loadMaintenance(): Promise<void> {
  dbFlag = (await getSetting(KEY)) === "1";
}

/** Flip the persisted flag and update the in-memory cache immediately. */
export async function setMaintenance(on: boolean): Promise<void> {
  await setSetting(KEY, on ? "1" : "0");
  dbFlag = on;
}

/** True when the env override OR the toggled flag is on. */
export function isMaintenanceOn(): boolean {
  return envForced() || dbFlag;
}

/** True only when the env override forces it (the toggle can't turn it off). */
export function isMaintenanceForcedByEnv(): boolean {
  return envForced();
}
