import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@dccc/db";
import { type AdminRole, addAdmin, isAdminRole } from "./admins.js";

/**
 * Single-use, time-limited invite links that onboard a new Discord
 * user as an Admin without anyone having to type a Discord snowflake.
 *
 * Lifecycle:
 *   1. Existing Admin clicks "New invite link" in the web UI.
 *   2. Bridge mints 32 random bytes, persists sha256(token) + metadata,
 *      returns the raw token ONCE so the issuing Admin can DM it.
 *   3. Recipient opens `${host}/admin/invite/<raw-token>` in a browser
 *      → Discord OAuth (just `identify` scope) → callback.
 *   4. `consumeInviteLink` runs the AdminUser upsert + the invite-mark-
 *      used in a single transaction; afterwards the same URL is dead.
 *
 * Hash + storage policy is identical to other tokens in this codebase
 * (sha256-hex, no salt, fast verify) — the entropy of the raw token
 * carries the security, not the hash.
 */

const DEFAULT_TTL_DAYS = 7;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type IssuedInviteLink = {
  id: string;
  guildId: string;
  label: string;
  role: AdminRole;
  expiresAt: Date;
  /** Raw token. Returned ONCE here, never persisted. */
  plaintext: string;
};

export async function mintAdminInviteLink(opts: {
  guildId: string;
  label: string;
  role: AdminRole; // role the invitee will receive on consume
  createdBy: string; // Discord userId of issuing admin
  ttlDays?: number;
}): Promise<IssuedInviteLink> {
  const raw = randomBytes(32).toString("hex"); // 64-char hex / 256 bits
  const tokenHash = sha256Hex(raw);
  const expiresAt = new Date(
    Date.now() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
  );
  const row = await getPrisma().adminInviteLink.create({
    data: {
      guildId: opts.guildId,
      tokenHash,
      label: opts.label,
      role: opts.role,
      createdBy: opts.createdBy,
      expiresAt,
    },
  });
  return {
    id: row.id,
    guildId: row.guildId,
    label: row.label,
    role: isAdminRole(row.role) ? row.role : "vice_admiral",
    expiresAt: row.expiresAt,
    plaintext: raw,
  };
}

export type ConsumeResult =
  | { ok: true; guildId: string }
  | { ok: false; reason: "invalid_token" | "expired" | "already_used" };

/**
 * Atomically: validate the raw token, mark the invite as used, and
 * insert the new admin into AdminUser. Runs inside a Prisma transaction
 * so a crash mid-call can't leave a half-consumed invite.
 */
export async function consumeInviteLink(opts: {
  rawToken: string;
  discordUserId: string;
}): Promise<ConsumeResult> {
  if (!opts.rawToken) return { ok: false, reason: "invalid_token" };
  const tokenHash = sha256Hex(opts.rawToken);
  const prisma = getPrisma();
  const row = await prisma.adminInviteLink.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.usedAt !== null) return { ok: false, reason: "already_used" };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  const inviteRole: AdminRole = isAdminRole(row.role) ? row.role : "vice_admiral";
  await prisma.$transaction(async (tx) => {
    // Re-check usedAt inside the transaction in case two concurrent
    // callers both clicked the link at the same time. The first wins.
    const fresh = await tx.adminInviteLink.findUnique({ where: { id: row.id } });
    if (!fresh || fresh.usedAt !== null) {
      throw new Error("already_used");
    }
    await tx.adminInviteLink.update({
      where: { id: row.id },
      data: { usedAt: new Date(), usedBy: opts.discordUserId },
    });
    await tx.adminUser.upsert({
      where: {
        guildId_userId: { guildId: row.guildId, userId: opts.discordUserId },
      },
      create: {
        guildId: row.guildId,
        userId: opts.discordUserId,
        role: inviteRole,
        addedBy: row.createdBy,
      },
      // If already an admin, do NOT downgrade or otherwise touch their
      // existing role / protected flag. The invite is still marked used
      // so it can't be replayed, but their privileges stay intact.
      update: {},
    });
  }).catch((err: Error) => {
    if (err.message === "already_used") return null;
    throw err;
  });
  return { ok: true, guildId: row.guildId };
}

export async function listInviteLinks(guildId: string): Promise<
  Array<{
    id: string;
    label: string;
    role: AdminRole;
    createdBy: string;
    createdAt: Date;
    expiresAt: Date;
    usedAt: Date | null;
    usedBy: string | null;
  }>
> {
  const rows = await getPrisma().adminInviteLink.findMany({
    where: { guildId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    role: isAdminRole(r.role) ? r.role : "vice_admiral",
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    usedBy: r.usedBy,
  }));
}

/**
 * Revoke an unused invite (delete from DB). Used invites stay for
 * audit. No-op on already-used or already-deleted rows.
 */
export async function revokeInviteLink(opts: {
  id: string;
  guildId: string;
}): Promise<boolean> {
  // Scope by guildId so an admin can't accidentally nuke another
  // guild's invite by id.
  const res = await getPrisma().adminInviteLink.deleteMany({
    where: { id: opts.id, guildId: opts.guildId, usedAt: null },
  });
  return res.count > 0;
}

// Re-export the addAdmin convenience so admin/routes.ts can do
// everything via this one module if it prefers (small simplification).
export { addAdmin };
