// FR-P3 Polls/Umfragen — standalone polls scoped like operations.
//
// Audience model mirrors Operation.visibility:
//   private  → members of the host guild
//   partners → host guild members + members of an active GuildPartnership partner
//   public   → any signed-in user (anonymous may view, not vote)
// superadmin sees/manages everything. Drafts are visible only to their creator.
//
// Results are gated per viewer by resultsVisibility (always | after_vote |
// after_close); a poll manager always sees them. The total vote count is never
// hidden — only the per-option breakdown is.
import { prisma } from "../db.js";
import { getActivePartnerGuildIds } from "./partnerships.js";
import type {
  PollSummary,
  PollDetail,
  CreatePollRequest,
} from "@rdoc-suite/fleetplanner-contracts";

export type PollViewer = { id: string; role: string } | null;

type Access = { canView: boolean; canVote: boolean; canManage: boolean };

// Prisma row shapes (kept loose so the file compiles before `prisma generate`
// runs server-side; the generated client narrows these at build time).
type SummaryRow = {
  id: string;
  guildId: string;
  title: string;
  description: string | null;
  visibility: string;
  mode: string;
  maxChoices: number | null;
  status: string;
  anonymous: boolean;
  resultsVisibility: string;
  closesAt: Date | null;
  createdAt: Date;
  creatorUserId: string;
  creator: { id: string; username: string };
  guild: { id: string; name: string };
  _count: { options: number; votes: number };
};

function toSummary(p: SummaryRow, viewerHasVoted: boolean): PollSummary {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    visibility: p.visibility as PollSummary["visibility"],
    mode: p.mode as PollSummary["mode"],
    maxChoices: p.maxChoices,
    status: p.status as PollSummary["status"],
    anonymous: p.anonymous,
    resultsVisibility: p.resultsVisibility as PollSummary["resultsVisibility"],
    closesAt: p.closesAt ? p.closesAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    createdBy: { id: p.creator.id, username: p.creator.username },
    guild: { id: p.guild.id, name: p.guild.name },
    optionCount: p._count.options,
    totalVotes: p._count.votes,
    viewerHasVoted,
  };
}

/** Membership role of a viewer in one guild, or null. */
async function roleIn(userId: string, guildId: string): Promise<string | null> {
  const m = await prisma.guildMembership.findUnique({
    where: { guildId_userId: { guildId, userId } },
    select: { role: true },
  });
  return m?.role ?? null;
}

async function resolveAccess(
  poll: { guildId: string; visibility: string; creatorUserId: string },
  viewer: PollViewer,
): Promise<Access> {
  if (!viewer) {
    return { canView: poll.visibility === "public", canVote: false, canManage: false };
  }
  if (viewer.role === "superadmin") return { canView: true, canVote: true, canManage: true };

  const role = await roleIn(viewer.id, poll.guildId);
  const isMember = role !== null;
  let inAudience = isMember || poll.visibility === "public";
  if (!inAudience && poll.visibility === "partners") {
    const partners = await getActivePartnerGuildIds(poll.guildId);
    if (partners.length) {
      const cnt = await prisma.guildMembership.count({
        where: { userId: viewer.id, guildId: { in: partners } },
      });
      inAudience = cnt > 0;
    }
  }
  const canManage = poll.creatorUserId === viewer.id || role === "fleetoperator";
  return { canView: inAudience, canVote: inAudience, canManage };
}

function computeShowResults(
  poll: { resultsVisibility: string; status: string },
  hasVoted: boolean,
  canManage: boolean,
): boolean {
  if (canManage) return true;
  switch (poll.resultsVisibility) {
    case "after_vote":
      return hasVoted;
    case "after_close":
      return poll.status === "closed";
    default:
      return true; // "always"
  }
}

async function assertManage(
  viewer: NonNullable<PollViewer>,
  poll: { creatorUserId: string; guildId: string },
): Promise<void> {
  if (viewer.role === "superadmin" || poll.creatorUserId === viewer.id) return;
  if ((await roleIn(viewer.id, poll.guildId)) !== "fleetoperator")
    throw new Error("forbidden: you cannot manage this poll");
}

// ── reads ─────────────────────────────────────────────────────────────
export async function listPollsForViewer(viewer: PollViewer): Promise<PollSummary[]> {
  const myGuildIds = viewer
    ? (
        await prisma.guildMembership.findMany({
          where: { userId: viewer.id, guild: { active: true } },
          select: { guildId: true },
        })
      ).map((g) => g.guildId)
    : [];

  let partnerGuildIds: string[] = [];
  if (myGuildIds.length) {
    const lists = await Promise.all(myGuildIds.map((g) => getActivePartnerGuildIds(g)));
    partnerGuildIds = [...new Set(lists.flat())];
  }

  const or: Array<Record<string, unknown>> = [{ visibility: "public" }];
  if (myGuildIds.length) or.push({ guildId: { in: myGuildIds } });
  if (partnerGuildIds.length) or.push({ visibility: "partners", guildId: { in: partnerGuildIds } });

  const polls = (await prisma.poll.findMany({
    where: { OR: or, guild: { active: true } },
    include: {
      creator: { select: { id: true, username: true } },
      guild: { select: { id: true, name: true } },
      _count: { select: { options: true, votes: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  })) as unknown as Array<SummaryRow & { creatorUserId: string }>;

  // Drafts are visible only to their creator.
  const visible = polls.filter(
    (p) => p.status !== "draft" || (viewer != null && p.creatorUserId === viewer.id),
  );

  const votedPollIds = viewer
    ? new Set(
        (
          await prisma.pollVote.findMany({
            where: { userId: viewer.id, pollId: { in: visible.map((p) => p.id) } },
            select: { pollId: true },
          })
        ).map((v) => v.pollId),
      )
    : new Set<string>();

  return visible.map((p) => toSummary(p, votedPollIds.has(p.id)));
}

export async function getPollForViewer(
  pollId: string,
  viewer: PollViewer,
): Promise<PollDetail | null> {
  const poll = (await prisma.poll.findUnique({
    where: { id: pollId },
    include: {
      creator: { select: { id: true, username: true } },
      guild: { select: { id: true, name: true, active: true } },
      options: { orderBy: { order: "asc" }, select: { id: true, label: true } },
      _count: { select: { options: true, votes: true } },
    },
  })) as unknown as
    | (SummaryRow & {
        allowAddOptions: boolean;
        guild: { id: string; name: string; active: boolean };
        options: Array<{ id: string; label: string }>;
      })
    | null;

  if (!poll || !poll.guild.active) return null;
  const access = await resolveAccess(poll, viewer);
  if (!access.canView) return null;
  if (poll.status === "draft" && !(viewer != null && viewer.id === poll.creatorUserId)) return null;

  const myVotes = viewer
    ? await prisma.pollVote.findMany({
        where: { pollId, userId: viewer.id },
        select: { optionId: true },
      })
    : [];
  const yourOptionIds = myVotes.map((v) => v.optionId);
  const hasVoted = yourOptionIds.length > 0;
  const showResults = computeShowResults(poll, hasVoted, access.canManage);

  const grouped = await prisma.pollVote.groupBy({
    by: ["optionId"],
    where: { pollId },
    _count: { optionId: true },
  });
  const counts = new Map<string, number>(grouped.map((g) => [g.optionId, g._count.optionId]));
  const total = grouped.reduce((s, g) => s + g._count.optionId, 0);

  const summary = toSummary(poll, hasVoted);
  summary.totalVotes = total; // exact (the _count include also yields total, kept consistent)

  return {
    ...summary,
    allowAddOptions: poll.allowAddOptions,
    options: poll.options.map((o) => ({
      id: o.id,
      label: o.label,
      votes: showResults ? (counts.get(o.id) ?? 0) : 0,
    })),
    showResults,
    yourOptionIds,
    canVote: access.canVote && poll.status === "open",
    canManage: access.canManage,
  };
}

// ── mutations ───────────────────────────────────────────────────────────
export async function createPoll(
  viewer: NonNullable<PollViewer>,
  input: CreatePollRequest,
): Promise<string> {
  const isSuper = viewer.role === "superadmin";
  const role = await roleIn(viewer.id, input.guildId);
  if (role === null && !isSuper) throw new Error("not found"); // not a member → no leak
  if (
    (input.visibility === "partners" || input.visibility === "public") &&
    !isSuper &&
    role !== "fleetoperator"
  )
    throw new Error("forbidden: only fleet operators can create partner or public polls");

  const mode = input.mode;
  const maxChoices = mode === "multiple" ? (input.maxChoices ?? null) : null;
  const options = input.options.map((label) => label.trim()).filter((l) => l.length > 0);
  if (options.length < 2) throw new Error("conflict: a poll needs at least two options");

  const created = await prisma.poll.create({
    data: {
      guildId: input.guildId,
      creatorUserId: viewer.id,
      title: input.title.trim(),
      description: input.description?.trim() || null,
      visibility: input.visibility,
      mode,
      maxChoices,
      status: input.status,
      anonymous: input.anonymous,
      resultsVisibility: input.resultsVisibility,
      allowAddOptions: input.allowAddOptions,
      closesAt: input.closesAt ? new Date(input.closesAt) : null,
      options: { create: options.map((label, i) => ({ label, order: i })) },
    },
    select: { id: true },
  });
  return created.id;
}

export async function votePoll(
  viewer: NonNullable<PollViewer>,
  pollId: string,
  optionIds: string[],
): Promise<void> {
  const poll = (await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { select: { id: true } }, guild: { select: { active: true } } },
  })) as unknown as
    | {
        id: string;
        guildId: string;
        visibility: string;
        creatorUserId: string;
        mode: string;
        maxChoices: number | null;
        status: string;
        closesAt: Date | null;
        options: Array<{ id: string }>;
        guild: { active: boolean };
      }
    | null;
  if (!poll || !poll.guild.active) throw new Error("not found");

  // Lazy auto-close once the deadline has passed.
  if (poll.status === "open" && poll.closesAt && poll.closesAt.getTime() <= Date.now()) {
    await prisma.poll.update({ where: { id: pollId }, data: { status: "closed" } });
    throw new Error("conflict: this poll has closed");
  }
  if (poll.status !== "open") throw new Error("conflict: this poll is not open");

  const access = await resolveAccess(poll, viewer);
  if (!access.canVote) throw new Error("forbidden: you cannot vote in this poll");

  const valid = new Set(poll.options.map((o) => o.id));
  const chosen = [...new Set(optionIds)].filter((id) => valid.has(id));
  if (chosen.length === 0) throw new Error("conflict: no valid options selected");
  if (poll.mode === "single" && chosen.length !== 1)
    throw new Error("conflict: this poll allows exactly one choice");
  if (poll.mode === "multiple" && poll.maxChoices && chosen.length > poll.maxChoices)
    throw new Error(`conflict: at most ${poll.maxChoices} choices allowed`);

  // Replace the viewer's previous votes atomically.
  await prisma.$transaction([
    prisma.pollVote.deleteMany({ where: { pollId, userId: viewer.id } }),
    prisma.pollVote.createMany({
      data: chosen.map((optionId) => ({ pollId, optionId, userId: viewer.id })),
    }),
  ]);
}

export async function withdrawVote(
  viewer: NonNullable<PollViewer>,
  pollId: string,
): Promise<void> {
  const poll = await prisma.poll.findUnique({ where: { id: pollId }, select: { status: true } });
  if (!poll) throw new Error("not found");
  if (poll.status !== "open") throw new Error("conflict: this poll is not open");
  await prisma.pollVote.deleteMany({ where: { pollId, userId: viewer.id } });
}

export async function addPollOption(
  viewer: NonNullable<PollViewer>,
  pollId: string,
  label: string,
): Promise<string> {
  const poll = (await prisma.poll.findUnique({
    where: { id: pollId },
    include: { options: { select: { order: true } } },
  })) as unknown as
    | {
        guildId: string;
        visibility: string;
        creatorUserId: string;
        allowAddOptions: boolean;
        status: string;
        options: Array<{ order: number }>;
      }
    | null;
  if (!poll) throw new Error("not found");
  if (!poll.allowAddOptions) throw new Error("forbidden: this poll does not allow adding options");
  if (poll.status !== "open") throw new Error("conflict: this poll is not open");
  const access = await resolveAccess(poll, viewer);
  if (!access.canVote) throw new Error("forbidden: you cannot add options to this poll");

  const maxOrder = poll.options.reduce((m, o) => Math.max(m, o.order), -1);
  const opt = await prisma.pollOption.create({
    data: { pollId, label: label.trim(), order: maxOrder + 1, addedByUserId: viewer.id },
    select: { id: true },
  });
  return opt.id;
}

export async function closePoll(
  viewer: NonNullable<PollViewer>,
  pollId: string,
): Promise<void> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { creatorUserId: true, guildId: true },
  });
  if (!poll) throw new Error("not found");
  await assertManage(viewer, poll);
  await prisma.poll.update({ where: { id: pollId }, data: { status: "closed" } });
}

export async function deletePoll(
  viewer: NonNullable<PollViewer>,
  pollId: string,
): Promise<void> {
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: { creatorUserId: true, guildId: true },
  });
  if (!poll) throw new Error("not found");
  await assertManage(viewer, poll);
  await prisma.poll.delete({ where: { id: pollId } });
}
