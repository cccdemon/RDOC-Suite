// FR-P1 Event Distribution — Phase 1 (schema + auto-share fan-out).
//
// A host guild's op is offered to every ACTIVE partner guild. For each
// target guild we read its directional PartnerSharePolicy for the host:
//   - autoShare true  → create the partner Discord event now (status "auto")
//   - autoShare false → record a "pending" row, no Discord post (Phase 2 adds
//                       the approval flow: web inbox + DM buttons)
//
// Edits/cancels fan out to every distribution that actually has a posted
// discordEventId. Everything here is best-effort and non-fatal — the host
// event and op lifecycle never depend on partner distribution succeeding.

import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import { getActivePartnerGuildIds } from "./partnerships.js";
import {
  createPartnerScheduledEvent,
  updatePartnerScheduledEvent,
  deleteScheduledEvent,
  sendDiscordDmComponents,
  type DiscordEmbed,
} from "./discord.js";

/**
 * Directional auto-share state for a guild: which PARTNER guilds' events
 * auto-post into ownerGuildId's Discord. Returns a partnerGuildId→autoShare map.
 */
export async function getAutoShareMap(ownerGuildId: string): Promise<Map<string, boolean>> {
  const rows = await prisma.partnerSharePolicy.findMany({
    where: { ownerGuildId },
    select: { partnerGuildId: true, autoShare: true },
  });
  return new Map(rows.map((r) => [r.partnerGuildId, r.autoShare]));
}

/** Set whether partnerGuildId's events auto-post into ownerGuildId's Discord. */
export async function setAutoShare(
  ownerGuildId: string,
  partnerGuildId: string,
  autoShare: boolean,
): Promise<void> {
  await prisma.partnerSharePolicy.upsert({
    where: { ownerGuildId_partnerGuildId: { ownerGuildId, partnerGuildId } },
    create: { ownerGuildId, partnerGuildId, autoShare },
    update: { autoShare },
  });
}

type DistributableOp = {
  id: string;
  guildId: string;
  title: string;
  description: string;
  scheduledAt: Date;
  opType?: string | null;
  cover?: { url: string } | null;
};

/**
 * Offer an op to all active partner guilds. Idempotent per
 * (operationId, targetGuildId): re-running only fills in missing rows /
 * posts events that aren't posted yet. Returns counts for flash/logging.
 */
export async function distributeOperation(
  op: DistributableOp,
): Promise<{ auto: number; pending: number; failed: number }> {
  const targets = await getActivePartnerGuildIds(op.guildId);
  let auto = 0;
  let pending = 0;
  let failed = 0;

  for (const targetGuildId of targets) {
    // Directional policy: the TARGET guild decides whether the HOST's events
    // auto-post into it (owner = target, partner = host).
    const policy = await prisma.partnerSharePolicy.findUnique({
      where: {
        ownerGuildId_partnerGuildId: {
          ownerGuildId: targetGuildId,
          partnerGuildId: op.guildId,
        },
      },
    });
    const autoShare = policy?.autoShare ?? false;
    const contactUserId = policy?.defaultContactUserId ?? null;

    const existing = await prisma.eventDistribution.findUnique({
      where: { operationId_targetGuildId: { operationId: op.id, targetGuildId } },
    });
    // Already posted — nothing to do.
    if (existing?.discordEventId) continue;

    if (autoShare) {
      try {
        const event = await createPartnerScheduledEvent(targetGuildId, op);
        await prisma.eventDistribution.upsert({
          where: { operationId_targetGuildId: { operationId: op.id, targetGuildId } },
          create: {
            operationId: op.id,
            sourceGuildId: op.guildId,
            targetGuildId,
            status: "auto",
            contactUserId,
            discordEventId: event?.id ?? null,
          },
          update: { status: "auto", discordEventId: event?.id ?? null },
        });
        auto++;
      } catch {
        failed++;
      }
    } else {
      const row = await prisma.eventDistribution.upsert({
        where: { operationId_targetGuildId: { operationId: op.id, targetGuildId } },
        create: {
          operationId: op.id,
          sourceGuildId: op.guildId,
          targetGuildId,
          status: "pending",
          contactUserId,
        },
        update: {}, // keep an existing decision untouched
      });
      pending++;
      // Notify only on a freshly-created pending row — never re-DM on re-distribute/edit.
      if (!existing) {
        notifyTargetFleetoperators(row.id).catch(() => {
          /* non-fatal — web inbox is the source of truth */
        });
      }
    }
  }

  return { auto, pending, failed };
}

// ── Approval (Phase 2) ─────────────────────────────────────────────
// Recipients = ALL fleetoperators of the target guild (per-guild role), not a
// single named contact. Any of them may approve or decline.

/** Fleetplanner userIds of every fleetoperator of a guild. */
export async function getTargetFleetoperators(guildId: string): Promise<string[]> {
  const rows = await prisma.guildMembership.findMany({
    where: { guildId, role: "fleetoperator" },
    select: { userId: true },
  });
  return rows.map((r) => r.userId);
}

/** True when userId is a fleetoperator of guildId. */
export async function isTargetFleetoperator(userId: string, guildId: string): Promise<boolean> {
  const m = await prisma.guildMembership.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { role: true },
  });
  return m?.role === "fleetoperator";
}

type IncomingDistribution = {
  id: string;
  status: string;
  opId: string;
  opTitle: string;
  scheduledAt: Date;
  meetingSystem: string;
  meetingLocation: string;
  hostGuildName: string;
  hostOrgName: string | null;
};

/** Pending distributions addressed to guildId (for the web approval inbox). */
export async function listIncomingDistributions(
  guildId: string,
): Promise<IncomingDistribution[]> {
  const rows = await prisma.eventDistribution.findMany({
    where: { targetGuildId: guildId, status: "pending" },
    include: { operation: { include: { guild: { select: { name: true, orgName: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    opId: r.operation.id,
    opTitle: r.operation.title,
    scheduledAt: r.operation.scheduledAt,
    meetingSystem: r.operation.meetingSystem,
    meetingLocation: r.operation.meetingLocation,
    hostGuildName: r.operation.guild.name,
    hostOrgName: r.operation.guild.orgName,
  }));
}

export type DecisionResult =
  | { ok: true }
  | { ok: false; reason: "not_found" | "not_pending" | "forbidden" | "post_failed" };

/** Approve a pending distribution → post the partner event. Idempotent on status. */
export async function approveDistribution(
  distId: string,
  byUserId: string,
): Promise<DecisionResult> {
  const dist = await prisma.eventDistribution.findUnique({
    where: { id: distId },
    include: { operation: { include: { cover: true } } },
  });
  if (!dist) return { ok: false, reason: "not_found" };
  if (dist.status !== "pending") return { ok: false, reason: "not_pending" };
  if (!(await isTargetFleetoperator(byUserId, dist.targetGuildId))) {
    return { ok: false, reason: "forbidden" };
  }
  try {
    const event = await createPartnerScheduledEvent(dist.targetGuildId, {
      id: dist.operation.id,
      title: dist.operation.title,
      description: dist.operation.description,
      scheduledAt: dist.operation.scheduledAt,
      opType: dist.operation.opType,
      cover: dist.operation.cover ? { url: dist.operation.cover.url } : null,
    });
    await prisma.eventDistribution.update({
      where: { id: distId },
      data: {
        status: "approved",
        discordEventId: event?.id ?? null,
        decidedByUserId: byUserId,
        decidedAt: new Date(),
      },
    });
    return { ok: true };
  } catch {
    return { ok: false, reason: "post_failed" };
  }
}

/** Decline a pending distribution (per-event only — never mutes future events). */
export async function declineDistribution(
  distId: string,
  byUserId: string,
): Promise<DecisionResult> {
  const dist = await prisma.eventDistribution.findUnique({ where: { id: distId } });
  if (!dist) return { ok: false, reason: "not_found" };
  if (dist.status !== "pending") return { ok: false, reason: "not_pending" };
  if (!(await isTargetFleetoperator(byUserId, dist.targetGuildId))) {
    return { ok: false, reason: "forbidden" };
  }
  await prisma.eventDistribution.update({
    where: { id: distId },
    data: { status: "declined", decidedByUserId: byUserId, decidedAt: new Date() },
  });
  return { ok: true };
}

/** Count of pending distributions addressed to a guild (nav badge). */
export async function countIncomingDistributions(guildId: string): Promise<number> {
  return prisma.eventDistribution.count({
    where: { targetGuildId: guildId, status: "pending" },
  });
}

/** DM every target-guild fleetoperator the approval prompt (embed + buttons). */
async function notifyTargetFleetoperators(distId: string): Promise<void> {
  const dist = await prisma.eventDistribution.findUnique({
    where: { id: distId },
    include: { operation: { include: { guild: { select: { name: true, orgName: true } } } } },
  });
  if (!dist || dist.status !== "pending") return;
  const recipients = await getTargetFleetoperators(dist.targetGuildId);
  if (recipients.length === 0) return;

  const env = getEnv();
  const op = dist.operation;
  const opUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${op.id}`;
  const host = op.guild.orgName ? `${op.guild.orgName} (${op.guild.name})` : op.guild.name;
  const embed: DiscordEmbed = {
    title: op.title,
    url: opUrl,
    description: "A partner Discord wants to share this operation with your server.",
    color: 0xe0a100,
    fields: [
      { name: "From", value: host, inline: true },
      { name: "When", value: `<t:${Math.floor(op.scheduledAt.getTime() / 1000)}:F>`, inline: true },
      {
        name: "Where",
        value: `${op.meetingSystem}${op.meetingLocation ? ` · ${op.meetingLocation}` : ""}`,
        inline: false,
      },
    ],
  };
  const components = [
    {
      type: 1 as const,
      components: [
        { type: 2 as const, style: 3, label: "Teilen", custom_id: `evt-share:${dist.id}` },
        { type: 2 as const, style: 4, label: "Ablehnen", custom_id: `evt-decline:${dist.id}` },
      ],
    },
  ];

  for (const userId of recipients) {
    await sendDiscordDmComponents(userId, { embeds: [embed], components }).catch(() => {
      /* one operator's closed DMs must not block the rest */
    });
  }
}

/** Fan an op edit out to every distribution that has a posted partner event. */
export async function updateDistributedEvents(op: DistributableOp): Promise<void> {
  const rows = await prisma.eventDistribution.findMany({
    where: { operationId: op.id, discordEventId: { not: null } },
  });
  for (const row of rows) {
    if (!row.discordEventId) continue;
    await updatePartnerScheduledEvent(row.targetGuildId, row.discordEventId, op).catch(() => {
      /* non-fatal — one partner failing must not block the others */
    });
  }
}

/** Delete all posted partner events for an op (cancel/delete). Marks rows revoked. */
export async function deleteDistributedEvents(operationId: string): Promise<void> {
  const rows = await prisma.eventDistribution.findMany({
    where: { operationId, discordEventId: { not: null } },
  });
  for (const row of rows) {
    if (!row.discordEventId) continue;
    await deleteScheduledEvent(row.targetGuildId, row.discordEventId).catch(() => {
      /* non-fatal */
    });
    await prisma.eventDistribution.update({
      where: { id: row.id },
      data: { discordEventId: null, status: "revoked" },
    });
  }
}
