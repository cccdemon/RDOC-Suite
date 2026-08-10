// Guild partnerships: tenant federation via single-use token.
//
// Guild A (fleetoperator) mints a token → raw token returned ONCE, only
// sha256(token) is stored. Guild B redeems it → partnership becomes
// active and is bidirectional: both guilds then see each other's
// operations with visibility "partners". Revocation is permanent.

import { createHash, randomBytes } from "node:crypto";
import { prisma } from "../db.js";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type MintedPartnerToken = {
  id: string;
  label: string;
  plaintext: string; // raw token, returned once, never persisted
  expiresAtHint: Date; // UI hint only — NOT enforced server-side
};

/**
 * Mint a single-use partner invite token for guildAId. Returns the raw
 * token once; only sha256(token) is stored. The `expiresAtHint` is a
 * display convenience (createdAt + 30 days); redemption is not
 * time-limited server-side — revoke instead if it leaks.
 */
export async function mintPartnerToken(
  guildAId: string,
  label: string,
  createdBy: string,
): Promise<MintedPartnerToken> {
  const raw = randomBytes(32).toString("hex"); // 256-bit
  const tokenHash = sha256Hex(raw);
  const row = await prisma.guildPartnership.create({
    data: {
      guildAId,
      guildBId: null,
      tokenHash,
      label,
      status: "pending",
      createdBy,
    },
  });
  return {
    id: row.id,
    label: row.label,
    plaintext: raw,
    expiresAtHint: new Date(row.createdAt.getTime() + 30 * 24 * 60 * 60 * 1000),
  };
}

export type AcceptResult =
  | { ok: true; label: string; partnerGuildId: string }
  | {
      ok: false;
      reason:
        | "invalid_token"
        | "already_used"
        | "revoked"
        | "self_partner"
        | "already_partners"
        | "pair_revoked";
    };

/**
 * Redeem a partner token on behalf of guildBId. Sets guildBId + status
 * active in a single transaction so two concurrent redemptions can't both
 * win. Fails on: unknown token, already-active, revoked, self-partner, or
 * a pre-existing active partnership between the same two guilds.
 */
export async function acceptPartnerToken(
  rawToken: string,
  guildBId: string,
): Promise<AcceptResult> {
  if (!rawToken) return { ok: false, reason: "invalid_token" };
  const tokenHash = sha256Hex(rawToken);
  const row = await prisma.guildPartnership.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.status === "active") return { ok: false, reason: "already_used" };
  if (row.status === "revoked") return { ok: false, reason: "revoked" };
  if (row.guildAId === guildBId) return { ok: false, reason: "self_partner" };

  // Guard against ANY existing row for this pair (either direction) — not just
  // an active one. (guildAId, guildBId) is unique in the schema, so a revoked
  // pair would otherwise make the claim below fail with a raw P2002 and a 500.
  // Revocation is permanent by design, so a revoked pair is a refusal, not a
  // crash.
  const existing = await prisma.guildPartnership.findFirst({
    where: {
      OR: [
        { guildAId: row.guildAId, guildBId },
        { guildAId: guildBId, guildBId: row.guildAId },
      ],
    },
  });
  if (existing?.status === "revoked") return { ok: false, reason: "pair_revoked" };
  if (existing) return { ok: false, reason: "already_partners" };

  // Atomic claim: only flip pending → active if still pending.
  const claim = await prisma.guildPartnership.updateMany({
    where: { id: row.id, status: "pending" },
    data: { guildBId, status: "active", activatedAt: new Date() },
  });
  if (claim.count === 0) return { ok: false, reason: "already_used" };

  return { ok: true, label: row.label, partnerGuildId: row.guildAId };
}

export type PartnershipRow = {
  id: string;
  guildAId: string;
  guildBId: string | null;
  label: string;
  status: string;
  createdBy: string;
  createdAt: Date;
  activatedAt: Date | null;
  /** The OTHER guild relative to the querying guild (null while pending). */
  partnerGuildId: string | null;
  partnerGuildName: string | null;
  /** True when the querying guild issued (minted) this partnership. */
  isInitiator: boolean;
};

/**
 * List partnerships involving a guild. Includes pending invites this
 * guild issued AND active partnerships in either direction. Resolves the
 * partner guild name where one exists.
 */
export async function listPartnerships(guildId: string): Promise<PartnershipRow[]> {
  const rows = await prisma.guildPartnership.findMany({
    where: {
      status: { in: ["pending", "active"] },
      OR: [{ guildAId: guildId }, { guildBId: guildId }],
    },
    include: {
      guildA: { select: { id: true, name: true } },
      guildB: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => {
    const isInitiator = r.guildAId === guildId;
    const partner = isInitiator ? r.guildB : r.guildA;
    return {
      id: r.id,
      guildAId: r.guildAId,
      guildBId: r.guildBId,
      label: r.label,
      status: r.status,
      createdBy: r.createdBy,
      createdAt: r.createdAt,
      activatedAt: r.activatedAt,
      partnerGuildId: partner?.id ?? null,
      partnerGuildName: partner?.name ?? null,
      isInitiator,
    };
  });
}

/**
 * Active partner guild IDs for a guild — the OTHER side of each active
 * partnership. Used to scope partner-visible operation queries.
 */
export async function getActivePartnerGuildIds(guildId: string): Promise<string[]> {
  const rows = await prisma.guildPartnership.findMany({
    where: {
      status: "active",
      OR: [{ guildAId: guildId }, { guildBId: guildId }],
    },
    select: { guildAId: true, guildBId: true },
  });
  const ids = new Set<string>();
  for (const r of rows) {
    const other = r.guildAId === guildId ? r.guildBId : r.guildAId;
    if (other) ids.add(other);
  }
  return [...ids];
}

/**
 * Revoke a partnership. Permitted only when requestingGuildId is one of
 * the two parties. Permanent: revoked never returns to active. Returns
 * false when not found or not authorized.
 */
export async function revokePartnership(
  partnershipId: string,
  requestingGuildId: string,
): Promise<boolean> {
  const res = await prisma.guildPartnership.updateMany({
    where: {
      id: partnershipId,
      status: { in: ["pending", "active"] },
      OR: [{ guildAId: requestingGuildId }, { guildBId: requestingGuildId }],
    },
    data: { status: "revoked" },
  });
  return res.count > 0;
}
