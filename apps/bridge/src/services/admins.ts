import { getPrisma } from "@rdoc-suite/db";
import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Admin = a Discord user authorized to sign into the web admin UI for
 * a given guild. Bootstrap is via the bot slash command
 * `/cc admin add @user` (gated by Discord's Manage Guild permission);
 * after that, any admiral can add more via the web UI.
 *
 * Two-tier role model:
 *   - "admiral"     — full power including managing other admins
 *                     (add/remove/promote/demote/issue-invite-links).
 *   - "vice_admiral" — dashboard + config edit, but cannot touch
 *                      other admins or mint invite-links.
 *
 * `protected: true` is set only on the bootstrap admin per guild.
 * No UI path can ever remove, role-edit, or self-edit a protected row
 * — only direct DB access can. Prevents accidental or hostile lockout
 * of the original operator.
 */

export const ADMIN_ROLES = ["admiral", "vice_admiral"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export function isAdminRole(s: string): s is AdminRole {
  return (ADMIN_ROLES as readonly string[]).includes(s);
}

export type AdminRecord = {
  guildId: string;
  userId: string;
  role: AdminRole;
  protected: boolean;
  addedBy: string | null;
  createdAt: Date;
};

function rowToRecord(row: {
  guildId: string;
  userId: string;
  role: string;
  protected: boolean;
  addedBy: string | null;
  createdAt: Date;
}): AdminRecord {
  return {
    guildId: row.guildId,
    userId: row.userId,
    role: isAdminRole(row.role) ? row.role : "vice_admiral",
    protected: row.protected,
    addedBy: row.addedBy,
    createdAt: row.createdAt,
  };
}

export async function addAdmin(opts: {
  guildId: string;
  userId: string;
  role?: AdminRole;
  addedBy?: string | null;
  protected?: boolean;
}): Promise<void> {
  await getPrisma().adminUser.upsert({
    where: { guildId_userId: { guildId: opts.guildId, userId: opts.userId } },
    create: {
      guildId: opts.guildId,
      userId: opts.userId,
      role: opts.role ?? "vice_admiral",
      protected: opts.protected ?? false,
      addedBy: opts.addedBy ?? null,
    },
    update: {}, // idempotent: re-adding an existing admin is a no-op
                // (does NOT promote / unprotect an existing row)
  });
}

/**
 * Seeds the first admin (a protected admiral) from env on startup. Replaces
 * the removed `/cc admin add` bootstrap: without this, a fresh guild would
 * have no AdminUser and nobody could sign into the admin web UI.
 *
 * Idempotent — `addAdmin` upserts with `update: {}`, so an existing row is
 * never modified (no re-protect / re-promote). Runs on every boot; no-op when
 * the env vars are unset or the row already exists.
 */
export async function seedSuperadmin(): Promise<void> {
  const env = getEnv();
  const userId = env.BRIDGE_SUPERADMIN_DISCORD_ID;
  const guildId = env.BRIDGE_SUPERADMIN_GUILD_ID;
  if (!userId || !guildId) {
    logger.info("superadmin seed skipped: BRIDGE_SUPERADMIN_DISCORD_ID/GUILD_ID not set");
    return;
  }
  const existing = await getAdminRecord({ guildId, userId });
  await addAdmin({ guildId, userId, role: "admiral", protected: true });
  logger.info(
    { guildId, userId, created: !existing },
    existing ? "superadmin seed: already present" : "superadmin seed: created protected admiral",
  );
}

export async function getAdminRecord(opts: {
  guildId: string;
  userId: string;
}): Promise<AdminRecord | null> {
  const row = await getPrisma().adminUser.findUnique({
    where: { guildId_userId: { guildId: opts.guildId, userId: opts.userId } },
  });
  return row ? rowToRecord(row) : null;
}

export async function isAdmin(opts: {
  guildId: string;
  userId: string;
}): Promise<boolean> {
  return (await getAdminRecord(opts)) !== null;
}

export async function listAdmins(guildId: string): Promise<AdminRecord[]> {
  const rows = await getPrisma().adminUser.findMany({
    where: { guildId },
    orderBy: [{ protected: "desc" }, { createdAt: "asc" }],
  });
  return rows.map(rowToRecord);
}

/**
 * Number of admiral-role admins in a guild. Used to refuse the LAST
 * admiral being removed/demoted (always at least one admin able to
 * manage the others).
 */
export async function countAdmirals(guildId: string): Promise<number> {
  return await getPrisma().adminUser.count({
    where: { guildId, role: "admiral" },
  });
}

export type AdminMutationResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "target_not_found"
        | "target_protected"
        | "not_authorized"
        | "would_remove_last_admiral"
        | "invalid_role";
    };

async function authorizeAdmiralMutation(opts: {
  guildId: string;
  byUserId: string;
  targetUserId: string;
}): Promise<AdminMutationResult> {
  const caller = await getAdminRecord({
    guildId: opts.guildId,
    userId: opts.byUserId,
  });
  if (!caller || caller.role !== "admiral") {
    return { ok: false, reason: "not_authorized" };
  }
  const target = await getAdminRecord({
    guildId: opts.guildId,
    userId: opts.targetUserId,
  });
  if (!target) return { ok: false, reason: "target_not_found" };
  if (target.protected) return { ok: false, reason: "target_protected" };
  return { ok: true };
}

export async function removeAdmin(opts: {
  guildId: string;
  byUserId: string;
  targetUserId: string;
}): Promise<AdminMutationResult> {
  const auth = await authorizeAdmiralMutation(opts);
  if (!auth.ok) return auth;
  // Don't allow removing the last admiral — guild would lose all
  // admin-tier management. (Protected admiral catches this for the
  // single-admin case; this check handles multi-admiral guilds where
  // none is protected.)
  const target = await getAdminRecord({
    guildId: opts.guildId,
    userId: opts.targetUserId,
  });
  if (target?.role === "admiral") {
    const admiralCount = await countAdmirals(opts.guildId);
    if (admiralCount <= 1) {
      return { ok: false, reason: "would_remove_last_admiral" };
    }
  }
  await getPrisma().adminUser.deleteMany({
    where: { guildId: opts.guildId, userId: opts.targetUserId },
  });
  return { ok: true };
}

export async function setAdminRole(opts: {
  guildId: string;
  byUserId: string;
  targetUserId: string;
  newRole: AdminRole;
}): Promise<AdminMutationResult> {
  if (!isAdminRole(opts.newRole)) return { ok: false, reason: "invalid_role" };
  const auth = await authorizeAdmiralMutation(opts);
  if (!auth.ok) return auth;
  // Demoting an admiral to vice_admiral: refuse if they're the last
  // admiral standing.
  if (opts.newRole === "vice_admiral") {
    const target = await getAdminRecord({
      guildId: opts.guildId,
      userId: opts.targetUserId,
    });
    if (target?.role === "admiral") {
      const admiralCount = await countAdmirals(opts.guildId);
      if (admiralCount <= 1) {
        return { ok: false, reason: "would_remove_last_admiral" };
      }
    }
  }
  await getPrisma().adminUser.update({
    where: {
      guildId_userId: { guildId: opts.guildId, userId: opts.targetUserId },
    },
    data: { role: opts.newRole },
  });
  return { ok: true };
}
