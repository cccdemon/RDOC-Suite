// FR-P1 structured fleet-need editor (Phase 2). The operator no longer writes
// free text: ship needs are picked from a Fleetyards-derived type list (each
// pick = exactly one hull), fighters are requested as N squads (2 pilots each,
// everyone brings their own fighter), CQB as N teams (4..8 soldiers each).
//
// Teams/squads are materialized EAGERLY as CompositionGroups so players see and
// join empty teams. Ship needs stay hull/seat based (existing system).
//
// During the migration phases we also write the legacy category/label/count so
// the old board + matching code keep working until they are removed (Phase 5).

import { prisma } from "../db.js";

/** Selectable ship types (Fleetyards size×career×role classification, minus
 *  fighter — its own need — and the FPS/ground soldier categories). */
export const SHIP_TYPES = [
  { slug: "any", label: "Any ship" },
  { slug: "capital", label: "Capital" },
  { slug: "subcapital", label: "Sub-capital" },
  { slug: "transport", label: "Transport / Cargo" },
  { slug: "support", label: "Support / Medical" },
  { slug: "mining", label: "Mining" },
  { slug: "salvage", label: "Salvage" },
  { slug: "exploration", label: "Exploration" },
] as const;

export const SHIP_TYPE_SLUGS = SHIP_TYPES.map((t) => t.slug);
export function shipTypeLabel(slug: string): string {
  return SHIP_TYPES.find((t) => t.slug === slug)?.label ?? slug;
}

export const CQB_TEAM_DEFAULT = 4;
export const CQB_TEAM_MAX = 8;
export const FIGHTER_SQUAD_SIZE = 2;

const FIGHTER_PREFIX = "Fighter Squad";
const CQB_PREFIX = "CQB Team";

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = typeof v === "number" ? v : parseInt(String(v ?? ""), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

/** The canonical "Fleet Requirements" group for an op (created on demand). */
async function fleetReqGroupId(operationId: string): Promise<string> {
  const existing = await prisma.compositionGroup.findFirst({
    where: { operationId, name: "Fleet Requirements" },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.compositionGroup.create({
    data: { operationId, name: "Fleet Requirements", order: 0 },
    select: { id: true },
  });
  return created.id;
}

/** Operator: add ship hull needs — each picked type = exactly one hull. */
export async function addShipNeeds(
  operationId: string,
  shipTypes: string[],
  details: string | null,
): Promise<number> {
  const valid = shipTypes.filter((s) => SHIP_TYPE_SLUGS.includes(s as (typeof SHIP_TYPE_SLUGS)[number]));
  if (valid.length === 0) return 0;
  const groupId = await fleetReqGroupId(operationId);
  const last = await prisma.compositionRequirement.aggregate({
    where: { groupId },
    _max: { order: true },
  });
  let order = (last._max.order ?? -1) + 1;
  for (const slug of valid) {
    await prisma.compositionRequirement.create({
      data: {
        groupId,
        needType: "ship",
        shipType: slug,
        squadSize: null,
        count: 1,
        // legacy mirror (kept until Phase 5)
        category: slug,
        label: shipTypeLabel(slug),
        note: details?.trim() || null,
        order: order++,
      },
    });
  }
  return valid.length;
}

/** Ensure exactly `count` eager team groups of a kind exist (by name prefix),
 *  creating missing empty ones and removing surplus EMPTY ones (never deletes a
 *  team players already joined). Returns nothing. */
async function reconcileTeams(
  operationId: string,
  kind: string,
  prefix: string,
  count: number,
  size: number,
): Promise<void> {
  const groups = await prisma.compositionGroup.findMany({
    where: { operationId, kind, name: { startsWith: prefix } },
    select: { id: true, name: true, _count: { select: { cqbSignups: true } } },
    orderBy: { order: "asc" },
  });
  const last = await prisma.compositionGroup.aggregate({
    where: { operationId },
    _max: { order: true },
  });
  let order = (last._max.order ?? -1) + 1;
  if (groups.length < count) {
    for (let i = groups.length; i < count; i++) {
      await prisma.compositionGroup.create({
        data: {
          operationId,
          kind,
          name: `${prefix} ${i + 1}`,
          targetSize: size,
          order: order++,
        },
      });
    }
  } else if (groups.length > count) {
    // Remove surplus, but only empty teams, highest-numbered first.
    const surplus = groups.slice(count).filter((g) => g._count.cqbSignups === 0);
    if (surplus.length) {
      await prisma.compositionGroup.deleteMany({ where: { id: { in: surplus.map((g) => g.id) } } });
    }
  }
}

/** Operator: request N fighter squads (each = 2 pilots, own fighter). */
export async function setFighterSquads(operationId: string, count: number): Promise<void> {
  const n = clampInt(count, 0, 50, 0);
  const groupId = await fleetReqGroupId(operationId);
  const req = await prisma.compositionRequirement.findFirst({
    where: { group: { operationId }, needType: "fighter_squad" },
    select: { id: true, order: true },
  });
  if (n === 0) {
    if (req) await prisma.compositionRequirement.delete({ where: { id: req.id } });
  } else if (req) {
    await prisma.compositionRequirement.update({ where: { id: req.id }, data: { count: n } });
  } else {
    const last = await prisma.compositionRequirement.aggregate({
      where: { groupId },
      _max: { order: true },
    });
    await prisma.compositionRequirement.create({
      data: {
        groupId,
        needType: "fighter_squad",
        squadSize: FIGHTER_SQUAD_SIZE,
        count: n,
        category: "fighter",
        label: "Fighter squads",
        order: (last._max.order ?? -1) + 1,
      },
    });
  }
  await reconcileTeams(operationId, "fighter_squad", FIGHTER_PREFIX, n, FIGHTER_SQUAD_SIZE);
}

/** Operator: request N CQB teams of `size` (4..8) soldiers each. */
export async function setCqbTeams(operationId: string, count: number, size: number): Promise<void> {
  const n = clampInt(count, 0, 50, 0);
  const sz = clampInt(size, 1, CQB_TEAM_MAX, CQB_TEAM_DEFAULT);
  const groupId = await fleetReqGroupId(operationId);
  const req = await prisma.compositionRequirement.findFirst({
    where: { group: { operationId }, needType: "cqb_team" },
    select: { id: true },
  });
  if (n === 0) {
    if (req) await prisma.compositionRequirement.delete({ where: { id: req.id } });
  } else if (req) {
    await prisma.compositionRequirement.update({ where: { id: req.id }, data: { count: n, squadSize: sz } });
  } else {
    const last = await prisma.compositionRequirement.aggregate({
      where: { groupId },
      _max: { order: true },
    });
    await prisma.compositionRequirement.create({
      data: {
        groupId,
        needType: "cqb_team",
        squadSize: sz,
        count: n,
        category: "fps",
        label: "CQB teams",
        order: (last._max.order ?? -1) + 1,
      },
    });
  }
  await reconcileTeams(operationId, "squad", CQB_PREFIX, n, sz);
}

/** Operator: delete a single ship need. */
export async function removeShipNeed(operationId: string, reqId: string): Promise<void> {
  await prisma.compositionRequirement.deleteMany({
    where: { id: reqId, needType: "ship", group: { operationId } },
  });
}
