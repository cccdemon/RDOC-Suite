// FR-P4 — Template marketplace. Publish an operation as a shareable blueprint,
// discover templates scoped by visibility (guild / partners / public), and
// instantiate one into a fresh draft. Blueprint (de)serialisation lives in
// services/opBlueprint.ts; this module owns persistence + the visibility scope.
import { prisma } from "../db.js";
import { getActivePartnerGuildIds } from "./partnerships.js";
import {
  instantiateBlueprint,
  parseBlueprint,
  serializeOp,
  type OperationBlueprint,
} from "./opBlueprint.js";

/** Visibility of a published template. The runtime guard lives in the zod
 *  contract now; this type only shapes the service input. */
type TemplateVisibility = "guild" | "partners" | "public";

interface PublishInput {
  op: Parameters<typeof serializeOp>[0] & { opType: string };
  ownerGuildId: string;
  createdById: string;
  name: string;
  summary?: string;
  visibility: TemplateVisibility;
  sourceOpId?: string | null;
}

/** Publish an operation as a marketplace template. */
export async function publishTemplate(input: PublishInput) {
  const blueprint = serializeOp(input.op);
  return prisma.operationTemplate.create({
    data: {
      ownerGuildId: input.ownerGuildId,
      createdById: input.createdById,
      name: input.name.trim().slice(0, 120) || blueprint.settings.title,
      summary: (input.summary ?? "").trim().slice(0, 500),
      opType: input.op.opType,
      visibility: input.visibility,
      blueprintJson: JSON.stringify(blueprint),
      sourceOpId: input.sourceOpId ?? null,
    },
  });
}

/**
 * Templates a member of `guildId` may see, newest/most-used first:
 *   - own guild's templates (any visibility),
 *   - active partner guilds' templates with visibility partners|public,
 *   - any guild's templates with visibility public.
 * Optional opType filter + case-insensitive name/summary search.
 */
export async function listTemplatesForGuild(
  guildId: string,
  opts: { opType?: string; search?: string } = {},
) {
  const partnerIds = await getActivePartnerGuildIds(guildId);
  const where: Record<string, unknown> = {
    published: true,
    OR: [
      { ownerGuildId: guildId },
      { ownerGuildId: { in: partnerIds }, visibility: { in: ["partners", "public"] } },
      { visibility: "public" },
    ],
  };
  if (opts.opType && opts.opType !== "all") where.opType = opts.opType;
  if (opts.search && opts.search.trim()) {
    const q = opts.search.trim();
    where.AND = [
      {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          { summary: { contains: q, mode: "insensitive" } },
        ],
      },
    ];
  }
  return prisma.operationTemplate.findMany({
    where,
    orderBy: [{ usageCount: "desc" }, { createdAt: "desc" }],
    include: { ownerGuild: { select: { id: true, name: true, orgName: true } } },
    take: 100,
  });
}

/** Whether a member of `guildId` is allowed to instantiate this template. */
async function canUseTemplate(
  template: { ownerGuildId: string; visibility: string; published: boolean },
  guildId: string,
): Promise<boolean> {
  if (!template.published) return false;
  if (template.visibility === "public") return true;
  if (template.ownerGuildId === guildId) return true;
  if (template.visibility === "partners") {
    const partnerIds = await getActivePartnerGuildIds(guildId);
    return partnerIds.includes(template.ownerGuildId);
  }
  return false;
}

/**
 * Instantiate a template into a fresh draft op in `ctx.guildId`. Re-checks
 * visibility, bumps usageCount. Returns the new op, or null if not permitted /
 * blueprint unparseable.
 */
export async function applyTemplate(
  templateId: string,
  ctx: { guildId: string; createdById: string; scheduledAt: Date; title?: string },
) {
  const template = await prisma.operationTemplate.findUnique({ where: { id: templateId } });
  if (!template) return null;
  if (!(await canUseTemplate(template, ctx.guildId))) return null;
  const blueprint: OperationBlueprint | null = parseBlueprint(template.blueprintJson);
  if (!blueprint) return null;
  const op = await instantiateBlueprint(blueprint, ctx);
  await prisma.operationTemplate.update({
    where: { id: template.id },
    data: { usageCount: { increment: 1 } },
  });
  return op;
}
