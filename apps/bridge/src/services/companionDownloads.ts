import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@rdoc-suite/db";

/**
 * Single-use download links for the Companion EXE.
 *
 * An admin clicks "Create download link" in the web UI. Bridge mints
 * 32 random bytes, persists ONLY sha256(token) + metadata, and returns
 * the raw token ONCE so the issuing admin can DM the URL to the
 * recipient. The raw token is never written to the DB — a DB read can
 * therefore not recover any live download link. (The admin UI's old
 * "re-copy URL" button is gone; re-mint instead.)
 * When the recipient opens the URL, the bridge consumes the token
 * (marks usedAt + usedFrom) and streams the latest GitHub release
 * asset to the browser. The same URL is dead on the second click.
 *
 * Tokens stay in the table after consume for audit purposes;
 * revokeDownloadToken() deletes UNUSED tokens (used ones must stay).
 */

const DEFAULT_TTL_DAYS = 7;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type IssuedDownloadToken = {
  id: string;
  label: string;
  createdBy: string;
  expiresAt: Date;
  /** Raw token. Returned ONCE here, never persisted. */
  plaintext: string;
};

export async function mintDownloadToken(opts: {
  label: string;
  createdBy: string;
  ttlDays?: number;
}): Promise<IssuedDownloadToken> {
  const raw = randomBytes(32).toString("hex"); // 64-char hex / 256 bits
  const tokenHash = sha256Hex(raw);
  const expiresAt = new Date(
    Date.now() + (opts.ttlDays ?? DEFAULT_TTL_DAYS) * 24 * 60 * 60 * 1000,
  );
  const row = await getPrisma().companionDownloadToken.create({
    data: {
      tokenHash,
      // Never persist the raw token. Only sha256(token) is stored, so a
      // DB compromise cannot recover usable download links. The legacy
      // `plaintext` column is kept (nullable) to avoid a migration but is
      // always null.
      plaintext: null,
      label: opts.label,
      createdBy: opts.createdBy,
      expiresAt,
    },
  });
  return {
    id: row.id,
    label: row.label,
    createdBy: row.createdBy,
    expiresAt: row.expiresAt,
    plaintext: raw,
  };
}

export type ConsumeResult =
  | { ok: true; id: string }
  | { ok: false; reason: "invalid_token" | "expired" | "already_used" };

export type PeekResult =
  | { ok: true; label: string; expiresAt: Date }
  | { ok: false; reason: "invalid_token" | "expired" | "already_used" };

/** Read-only check: is this token currently usable? Returns the
 *  human label + expiry so the landing page can show "Du lädst die
 *  EXE für 'Alice' herunter, läuft ab am …". Does NOT mutate the
 *  row, so opening the URL to read the SmartScreen hint doesn't
 *  burn the token. */
export async function peekDownloadToken(rawToken: string): Promise<PeekResult> {
  if (!rawToken) return { ok: false, reason: "invalid_token" };
  const tokenHash = sha256Hex(rawToken);
  const row = await getPrisma().companionDownloadToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.usedAt !== null) return { ok: false, reason: "already_used" };
  if (row.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, label: row.label, expiresAt: row.expiresAt };
}

/** Validate the raw token, mark used atomically. Returns the token row
 *  id on success (so the caller can log which token was used). */
export async function consumeDownloadToken(opts: {
  rawToken: string;
  usedFrom?: string;
}): Promise<ConsumeResult> {
  if (!opts.rawToken) return { ok: false, reason: "invalid_token" };
  const tokenHash = sha256Hex(opts.rawToken);
  const prisma = getPrisma();
  const row = await prisma.companionDownloadToken.findUnique({ where: { tokenHash } });
  if (!row) return { ok: false, reason: "invalid_token" };
  if (row.usedAt !== null) return { ok: false, reason: "already_used" };
  if (row.expiresAt.getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  // Single transaction so two near-simultaneous downloads can't both
  // succeed. updateMany with the `usedAt: null` filter is the lock.
  // plaintext is nulled here so a DB compromise after this point
  // can't replay the link.
  const updateRes = await prisma.companionDownloadToken.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date(), usedFrom: opts.usedFrom ?? null, plaintext: null },
  });
  if (updateRes.count === 0) {
    return { ok: false, reason: "already_used" };
  }
  return { ok: true, id: row.id };
}

export async function listDownloadTokens(): Promise<
  Array<{
    id: string;
    label: string;
    createdBy: string;
    createdAt: Date;
    expiresAt: Date;
    usedAt: Date | null;
    usedFrom: string | null;
    /** Always null now — raw tokens are no longer stored. Kept in the
     *  shape so the admin UI compiles; it simply renders no re-copy. */
    plaintext: string | null;
  }>
> {
  const rows = await getPrisma().companionDownloadToken.findMany({
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    usedFrom: r.usedFrom,
    plaintext: r.plaintext,
  }));
}

/** Revoke an UNUSED download token. Used ones stay in the audit log;
 *  the boolean is true when a row was actually deleted. */
export async function revokeDownloadToken(id: string): Promise<boolean> {
  const res = await getPrisma().companionDownloadToken.deleteMany({
    where: { id, usedAt: null },
  });
  return res.count > 0;
}
