import { createHash, randomBytes } from "node:crypto";
import { getPrisma } from "@rdoc-suite/db";

const DEFAULT_INVITE_TTL_HOURS = 24;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

export type SessionRecord = {
  id: string;
  guildId: string;
  label: string;
  createdBy: string;
  livekitRoom: string;
  status: "active" | "ended";
  createdAt: Date;
  endedAt: Date | null;
};

function toStatus(s: string): "active" | "ended" {
  return s === "ended" ? "ended" : "active";
}

function rowToRecord(row: {
  id: string;
  guildId: string;
  label: string;
  createdBy: string;
  livekitRoom: string;
  status: string;
  createdAt: Date;
  endedAt: Date | null;
}): SessionRecord {
  return { ...row, status: toStatus(row.status) };
}

export async function createSession(opts: {
  guildId: string;
  label: string;
  createdBy: string;
}): Promise<SessionRecord> {
  // ID generated here so livekitRoom can be derived without a second round-trip.
  const id = crypto.randomUUID();
  const row = await getPrisma().session.create({
    data: {
      id,
      guildId: opts.guildId,
      label: opts.label,
      createdBy: opts.createdBy,
      livekitRoom: `session-${id}`,
    },
  });
  return rowToRecord(row);
}

export async function getSession(opts: {
  sessionId: string;
  guildId: string;
}): Promise<SessionRecord | null> {
  const row = await getPrisma().session.findUnique({ where: { id: opts.sessionId } });
  if (!row || row.guildId !== opts.guildId) return null;
  return rowToRecord(row);
}

export async function listActiveSessions(guildId: string): Promise<SessionRecord[]> {
  const rows = await getPrisma().session.findMany({
    where: { guildId, status: "active" },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(rowToRecord);
}

export type EndSessionResult =
  | { ok: true; livekitRoom: string }
  | { ok: false; reason: "not_found" | "already_ended" };

export async function endSession(opts: {
  sessionId: string;
  guildId: string;
}): Promise<EndSessionResult> {
  const row = await getPrisma().session.findUnique({ where: { id: opts.sessionId } });
  if (!row || row.guildId !== opts.guildId) return { ok: false, reason: "not_found" };
  if (row.status === "ended") return { ok: false, reason: "already_ended" };
  await getPrisma().session.update({
    where: { id: opts.sessionId },
    data: { status: "ended", endedAt: new Date() },
  });
  return { ok: true, livekitRoom: row.livekitRoom };
}

export type IssuedSessionInvite = {
  id: string;
  sessionId: string;
  label: string;
  expiresAt: Date;
  plaintext: string;
};

/** Mint a single-use invite for one Commander. Returns null if the session
 *  doesn't exist for the given guild, or is already ended. */
export async function mintSessionInvite(opts: {
  sessionId: string;
  guildId: string;
  label: string;
  createdBy: string;
  ttlHours?: number;
}): Promise<IssuedSessionInvite | null> {
  const session = await getSession({ sessionId: opts.sessionId, guildId: opts.guildId });
  if (!session || session.status !== "active") return null;

  const raw = randomBytes(32).toString("hex");
  const tokenHash = sha256Hex(raw);
  const expiresAt = new Date(
    Date.now() + (opts.ttlHours ?? DEFAULT_INVITE_TTL_HOURS) * 60 * 60 * 1000,
  );
  const row = await getPrisma().sessionInvite.create({
    data: {
      sessionId: opts.sessionId,
      tokenHash,
      label: opts.label,
      createdBy: opts.createdBy,
      expiresAt,
    },
  });
  return { id: row.id, sessionId: row.sessionId, label: row.label, expiresAt: row.expiresAt, plaintext: raw };
}

export type ConsumeInviteResult =
  | { ok: true; sessionId: string; livekitRoom: string; sessionLabel: string }
  | { ok: false; reason: "invalid_token" | "expired" | "already_used" | "session_ended" };

export async function consumeSessionInvite(opts: {
  rawToken: string;
  userId: string;
}): Promise<ConsumeInviteResult> {
  if (!opts.rawToken) return { ok: false, reason: "invalid_token" };
  const tokenHash = sha256Hex(opts.rawToken);
  const prisma = getPrisma();
  const invite = await prisma.sessionInvite.findUnique({ where: { tokenHash } });
  if (!invite) return { ok: false, reason: "invalid_token" };
  if (invite.usedAt !== null) return { ok: false, reason: "already_used" };
  if (invite.expiresAt.getTime() < Date.now()) return { ok: false, reason: "expired" };

  const session = await prisma.session.findUnique({ where: { id: invite.sessionId } });
  if (!session || session.status === "ended") return { ok: false, reason: "session_ended" };

  await prisma.sessionInvite.update({
    where: { id: invite.id },
    data: { usedAt: new Date(), usedBy: opts.userId },
  });
  return { ok: true, sessionId: session.id, livekitRoom: session.livekitRoom, sessionLabel: session.label };
}

export async function listSessionInvites(opts: {
  sessionId: string;
  guildId: string;
}): Promise<Array<{
  id: string;
  label: string;
  createdBy: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  usedBy: string | null;
}> | null> {
  const session = await getSession(opts);
  if (!session) return null;
  const rows = await getPrisma().sessionInvite.findMany({
    where: { sessionId: opts.sessionId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    usedAt: r.usedAt,
    usedBy: r.usedBy,
  }));
}

export async function revokeSessionInvite(opts: {
  inviteId: string;
  sessionId: string;
  guildId: string;
}): Promise<boolean> {
  const session = await getSession({ sessionId: opts.sessionId, guildId: opts.guildId });
  if (!session) return false;
  const res = await getPrisma().sessionInvite.deleteMany({
    where: { id: opts.inviteId, sessionId: opts.sessionId, usedAt: null },
  });
  return res.count > 0;
}
