// FR-P4 — Operation blueprint engine. Serialises an operation into an
// instance-free, shareable blueprint (settings + composition needs + resource
// links) and instantiates a blueprint back into a fresh draft operation.
//
// Scrubbed on serialize: all ids, the creator, scheduledAt/status, every
// Discord/LiveKit/voice reference, accepted FleetUnits + seats + captains, and
// participant data (signups, interests, hangar shares). What survives is the
// *plan*: how the operator wants the op set up. This powers the template
// marketplace (see services/operationTemplates.ts) and is intentionally richer
// than the flat OperationRecurrence.templateJson seed.
import { prisma } from "../db.js";
import { createOperation } from "./operations.js";
import { deriveKind, normalizeUrl } from "./resourceLinks.js";

export const BLUEPRINT_VERSION = 1;

export interface BlueprintRequirement {
  category: string;
  label: string;
  count: number;
  note: string | null;
  order: number;
  needType: string | null;
  shipType: string | null;
  squadSize: number | null;
}

export interface BlueprintGroup {
  name: string;
  kind: string;
  order: number;
  targetSize: number | null;
  requirements: BlueprintRequirement[];
}

export interface BlueprintResourceLink {
  url: string;
  title: string;
  kind: string;
  sortOrder: number;
}

export interface OperationBlueprint {
  v: number;
  settings: {
    title: string;
    description: string;
    opType: string;
    meetingSystem: string;
    meetingLocation: string;
    minParticipants: number;
    maxParticipants: number | null;
  };
  groups: BlueprintGroup[];
  resourceLinks: BlueprintResourceLink[];
}

// The subset of a getOperation()-shaped row that serialize needs. Kept loose so
// it accepts the full include without coupling to its exact generated type.
interface SerializableOp {
  title: string;
  description: string;
  opType: string;
  meetingSystem: string | null;
  meetingLocation: string | null;
  minParticipants: number;
  maxParticipants: number | null;
  groups: Array<{
    name: string;
    kind: string;
    order: number;
    targetSize: number | null;
    requirements: Array<{
      category: string;
      label: string;
      count: number;
      note: string | null;
      order: number;
      needType: string | null;
      shipType: string | null;
      squadSize: number | null;
    }>;
  }>;
  resourceLinks?: Array<{ url: string; title: string; kind: string; sortOrder: number }>;
}

/** Build an instance-free blueprint from a loaded operation. */
export function serializeOp(op: SerializableOp): OperationBlueprint {
  return {
    v: BLUEPRINT_VERSION,
    settings: {
      title: op.title,
      description: op.description ?? "",
      opType: op.opType ?? "combat",
      meetingSystem: op.meetingSystem ?? "stanton",
      meetingLocation: op.meetingLocation ?? "",
      minParticipants: op.minParticipants ?? 0,
      maxParticipants: op.maxParticipants ?? null,
    },
    groups: (op.groups ?? []).map((g) => ({
      name: g.name,
      kind: g.kind,
      order: g.order,
      targetSize: g.targetSize ?? null,
      requirements: (g.requirements ?? []).map((r) => ({
        category: r.category,
        label: r.label,
        count: r.count,
        note: r.note ?? null,
        order: r.order,
        needType: r.needType ?? null,
        shipType: r.shipType ?? null,
        squadSize: r.squadSize ?? null,
      })),
    })),
    resourceLinks: (op.resourceLinks ?? []).map((l) => ({
      url: l.url,
      title: l.title,
      kind: l.kind,
      sortOrder: l.sortOrder,
    })),
  };
}

/** Parse + lightly validate a stored blueprint JSON string. Returns null on garbage. */
export function parseBlueprint(json: string): OperationBlueprint | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<OperationBlueprint>;
  if (!b.settings || typeof b.settings.title !== "string") return null;
  return {
    v: typeof b.v === "number" ? b.v : BLUEPRINT_VERSION,
    settings: {
      title: b.settings.title,
      description: typeof b.settings.description === "string" ? b.settings.description : "",
      opType: typeof b.settings.opType === "string" ? b.settings.opType : "combat",
      meetingSystem:
        typeof b.settings.meetingSystem === "string" ? b.settings.meetingSystem : "stanton",
      meetingLocation:
        typeof b.settings.meetingLocation === "string" ? b.settings.meetingLocation : "",
      minParticipants:
        typeof b.settings.minParticipants === "number" ? b.settings.minParticipants : 0,
      maxParticipants:
        typeof b.settings.maxParticipants === "number" ? b.settings.maxParticipants : null,
    },
    groups: Array.isArray(b.groups) ? (b.groups as BlueprintGroup[]) : [],
    resourceLinks: Array.isArray(b.resourceLinks)
      ? (b.resourceLinks as BlueprintResourceLink[])
      : [],
  };
}

/**
 * Instantiate a blueprint into a fresh DRAFT operation in the target guild.
 * Recreates composition groups + requirements and resource links. Never
 * auto-opens, never creates a Discord event — the operator finishes setup.
 */
export async function instantiateBlueprint(
  blueprint: OperationBlueprint,
  ctx: { guildId: string; createdById: string; scheduledAt: Date; title?: string },
) {
  const s = blueprint.settings;
  const op = await createOperation(ctx.createdById, {
    guildId: ctx.guildId,
    title: (ctx.title ?? s.title).slice(0, 120) || s.title,
    description: s.description,
    opType: s.opType,
    visibility: "private", // never inherit visibility from a shared template
    meetingSystem: s.meetingSystem,
    meetingLocation: s.meetingLocation,
    minParticipants: s.minParticipants,
    maxParticipants: s.maxParticipants,
    scheduledAt: ctx.scheduledAt,
  });

  for (const g of blueprint.groups ?? []) {
    const group = await prisma.compositionGroup.create({
      data: {
        operationId: op.id,
        name: g.name,
        kind: g.kind,
        order: g.order,
        targetSize: g.targetSize ?? null,
      },
    });
    for (const r of g.requirements ?? []) {
      await prisma.compositionRequirement.create({
        data: {
          groupId: group.id,
          category: r.category,
          label: r.label,
          count: r.count,
          note: r.note ?? null,
          order: r.order,
          needType: r.needType ?? null,
          shipType: r.shipType ?? null,
          squadSize: r.squadSize ?? null,
        },
      });
    }
  }

  // Re-validate URLs on apply — a template may be old or from another org.
  const links = (blueprint.resourceLinks ?? [])
    .map((l) => {
      const url = normalizeUrl(l.url);
      return url ? { url, title: l.title, kind: l.kind || deriveKind(url), sortOrder: l.sortOrder } : null;
    })
    .filter((l): l is BlueprintResourceLink => l !== null);
  if (links.length > 0) {
    await prisma.operationResourceLink.createMany({
      data: links.map((l) => ({
        operationId: op.id,
        addedById: ctx.createdById,
        url: l.url,
        title: l.title,
        kind: l.kind,
        sortOrder: l.sortOrder,
      })),
    });
  }

  return op;
}
