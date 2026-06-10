import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { rawHtml } from "../web/pages.js";
import {
  homePage,
  opDetailPageV2,
  opFormPage,
  opWizardPage,
  opJoinPage,
  profilePage,
  roadmapPage,
  shipsPage,
  feedbackPage,
  adminPage,
  errorPage,
  loginRequiredPage,
  loginPage,
  accountPage,
  howToPage,
  whatIsPage,
  scToolsPage,
  changelogPage,
  impressumPage,
  datenschutzPage,
  licensePage,
  whyUnsignedPage,
} from "../web/pages.js";
import {
  requireRole,
  optionalAuth,
  requireAuth,
  optionalGuild,
  requireGuildRole,
  requireOpRole,
} from "../auth/middleware.js";
import { discordEnabled, githubEnabled, googleEnabled } from "../auth/providers.js";
import {
  getMembership,
  listUserGuilds,
  effectiveOpRole,
  listAllGuildsForAdmin,
  banGuild,
  unbanGuild,
} from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { localeSchema, setLocale, getLocale } from "../i18n/index.js";
import { isMaintenanceOn, isMaintenanceForcedByEnv, setMaintenance } from "../services/maintenance.js";
import {
  createOperation,
  logAudit,
  getOperation,
  listOperations,
  listPublicOperations,
  listPartnerOperations,
  listAllUserOperations,
  updateOperation,
  deleteOperation,
  setOperationVisibility,
  isOpVisibility,
} from "../services/operations.js";
import { searchLocalShips } from "../services/scwiki.js";
import { silhouettesFor } from "../services/fleetyards.js";
import { importUserFleet } from "../services/fleetImport.js";
import { createSeriesForOp } from "../services/recurrence.js";
import { addShipNeeds, setFighterSquads, setCqbTeams, ensureTeamsMaterialized } from "../services/needs.js";
import { getScToolCards } from "../services/scTools.js";
import {
  deleteScheduledEvent,
  fetchGuildVoiceChannels,
  fetchGuildTextChannels,
  sendDiscordChannelMessage,
  updateScheduledEvent,
  type DiscordAttachment,
} from "../services/discord.js";
import {
  distributeOperation,
  updateDistributedEvents,
  deleteDistributedEvents,
} from "../services/eventDistribution.js";
import { closeMissionVoiceSession, hasVoicePermission } from "../services/voiceSession.js";
import { listMissionCommanders } from "../services/missionCommanders.js";
import { getMissionParticipants, participantsToCsv } from "../services/participants.js";
import { getMultiPositionAssignments } from "../services/primaryUnits.js";
import { getActivePartnerGuildIds } from "../services/partnerships.js";
import { bridgeConfigured } from "../services/bridge.js";
import { cleanupOperationVoiceChannels } from "../services/voiceBots.js";
import {
  buildOpVoiceControl,
  moveUnitCrewToChannel,
  moveOpMemberToUnit,
} from "../services/opVoice.js";
import { parseDateLocalTz, DEFAULT_TIMEZONE } from "../lib/timezone.js";
import { getSyncState, runSync, updateSyncConfig } from "../services/shipSync.js";
import {
  getLocationSyncState,
  runLocationSync,
  searchLocations,
  updateLocationSyncConfig,
} from "../services/locations.js";
import { getSetting, setSetting } from "../services/settings.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public");

function htmlReply(
  reply: import("fastify").FastifyReply,
  page: import("../web/render.js").SafeHtml,
) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
}

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

function parseUtcDateTimeLocal(raw: string | undefined): Date | null {
  if (!raw) return null;
  const value = new Date(`${raw}Z`);
  return Number.isNaN(value.getTime()) ? null : value;
}

const VALID_MEETING_SYSTEMS = ["stanton", "pyro", "nyx"];

async function resolveMeetingFields(
  body: Record<string, string>,
): Promise<{ meetingSystem: string; meetingLocation: string }> {
  const requestedSystem = VALID_MEETING_SYSTEMS.includes(body.meetingSystem)
    ? body.meetingSystem
    : "stanton";
  const locationSlug = body.meetingLocationSlug?.trim();
  const rawLocation = body.meetingLocation?.trim().slice(0, 120) ?? "";

  if (locationSlug) {
    const location = await prisma.location.findUnique({ where: { slug: locationSlug } });
    if (location && VALID_MEETING_SYSTEMS.includes(location.systemSlug)) {
      return {
        meetingSystem: location.systemSlug,
        meetingLocation:
          `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`.slice(0, 120),
      };
    }
  }

  if (rawLocation) {
    const plainName = rawLocation.replace(/\s+\(.+\)$/, "");
    const location = await prisma.location.findFirst({
      where: {
        OR: [
          { name: { equals: rawLocation, mode: "insensitive" } },
          { name: { equals: plainName, mode: "insensitive" } },
        ],
      },
    });
    if (location && VALID_MEETING_SYSTEMS.includes(location.systemSlug)) {
      return {
        meetingSystem: location.systemSlug,
        meetingLocation:
          `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`.slice(0, 120),
      };
    }
  }

  return { meetingSystem: requestedSystem, meetingLocation: rawLocation };
}

export async function webRoutes(app: FastifyInstance) {
  app.get<{ Params: { file: string } }>("/assets/mission-images/:file", async (req, reply) => {
    const file = req.params.file;
    if (!/^[a-z0-9-]+\.png$/.test(file)) {
      return reply.code(404).send("Not found");
    }
    const fullPath = join(PUBLIC_DIR, "mission-images", file);
    try {
      await stat(fullPath);
      return reply.type("image/png").send(createReadStream(fullPath));
    } catch {
      return reply.code(404).send("Not found");
    }
  });

  // ── Home — shows ops from ALL user's guilds with server marker ──────────
  app.get<{ Querystring: { flash?: string; past?: string } }>("/", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const includePast = !!req.query.past;
    if (!ctx) {
      const ops = await listPublicOperations(includePast);
      htmlReply(
        reply,
        homePage({
          basePath: basePath(),
          currentUser: null,
          flash: req.query.flash,
          ops,
          includePast,
          operatorGuilds: [],
        }),
      );
      return;
    }
    const memberships = await listUserGuilds(ctx.user.id);
    if (memberships.length === 0) return reply.redirect(basePath("/guilds/none"), 302);
    const guildIds = memberships.map((m) => m.guildId);
    // Own-guild ops + partner-guild ops (visibility partners/public) +
    // any public op across the instance. Dedupe by id, member-guild ops win.
    const [ownOps, partnerOpLists, publicOps] = await Promise.all([
      listAllUserOperations(guildIds, includePast),
      Promise.all(guildIds.map((gid) => listPartnerOperations(gid, includePast))),
      listPublicOperations(includePast),
    ]);
    const opById = new Map<string, (typeof ownOps)[number]>();
    for (const op of [...partnerOpLists.flat(), ...publicOps]) opById.set(op.id, op);
    // Own ops overwrite partner/public entries so the user keeps full context.
    for (const op of ownOps) opById.set(op.id, op);
    const ops = [...opById.values()].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
    );
    // Per-op signup state for the current user, for the overview "joined /
    // waitlist" card badge. A claimed seat = joined (wins); a crew request = waitlist.
    const [signedSeats, signedReqs, cqbSignups, pendingShips] = await Promise.all([
      prisma.seatAssignment.findMany({
        where: { userId: ctx.user.id, active: true },
        select: { fleetUnit: { select: { operationId: true } } },
      }),
      prisma.crewAssignmentRequest.findMany({
        where: { userId: ctx.user.id },
        select: { operationId: true },
      }),
      // CQB signups = a committed personnel signup → counts as "joined".
      prisma.cqbSignup.findMany({
        where: { userId: ctx.user.id, status: { not: "rejected" } },
        select: { operationId: true },
      }),
      // Own ship offers still awaiting the operator's decision → "waitlist".
      prisma.fleetUnit.findMany({
        where: { captainId: ctx.user.id, status: "pending" },
        select: { operationId: true },
      }),
    ]);
    // Waitlist first, then "joined" overwrites — a committed signup (seat/CQB)
    // always wins over a pending request/offer for the same op.
    const signupState = new Map<string, "joined" | "waitlist">();
    for (const r of signedReqs) signupState.set(r.operationId, "waitlist");
    for (const u of pendingShips) signupState.set(u.operationId, "waitlist");
    for (const s of signedSeats)
      if (s.fleetUnit?.operationId) signupState.set(s.fleetUnit.operationId, "joined");
    for (const c of cqbSignups) signupState.set(c.operationId, "joined");
    // Operator guilds for the "New Op" picker
    const operatorGuilds = memberships
      .filter((m) => m.role === "fleetoperator" || ctx.user.role === "superadmin")
      .map((m) => ({ id: m.guildId, name: m.guild.name }));
    htmlReply(
      reply,
      homePage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        ops,
        includePast,
        operatorGuilds,
        signupState,
      }),
    );
  });

  // ── New operation — the guided wizard is the only create UI ──────────────
  app.get<{ Querystring: { flash?: string; _guild?: string } }>("/ops/new", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    return reply.redirect(
      basePath("/ops/new/wizard") +
        (req.query._guild ? `?_guild=${encodeURIComponent(req.query._guild)}` : ""),
      302,
    );
  });

  // Guided admin wizard — same data + POST target as /ops/new, stepped UI.
  app.get<{ Querystring: { flash?: string; _guild?: string } }>(
    "/ops/new/wizard",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      const memberships = await listUserGuilds(ctx.user.id);
      const operatorGuilds = memberships
        .filter((m) => m.role === "fleetoperator" || ctx.user.role === "superadmin")
        .map((m) => ({ id: m.guildId, name: m.guild.name }));
      if (operatorGuilds.length === 0) return reply.code(403).send({ error: "forbidden" });
      const selectedOperatorGuildId = operatorGuilds.some((g) => g.id === req.query._guild)
        ? req.query._guild
        : operatorGuilds.length === 1
          ? operatorGuilds[0].id
          : undefined;
      const [guildVoiceChannels, guildTextChannels, wizGuildRow] = await Promise.all([
        selectedOperatorGuildId
          ? fetchGuildVoiceChannels(selectedOperatorGuildId)
          : Promise.resolve([]),
        selectedOperatorGuildId
          ? fetchGuildTextChannels(selectedOperatorGuildId)
          : Promise.resolve([]),
        selectedOperatorGuildId
          ? prisma.guild.findUnique({
              where: { id: selectedOperatorGuildId },
              select: { timezone: true },
            })
          : Promise.resolve(null),
      ]);
      htmlReply(
        reply,
        opWizardPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          flash: req.query.flash,
          operatorGuilds,
          selectedOperatorGuildId,
          guildVoiceChannels,
          guildTextChannels,
          locations: await searchLocations(undefined, "", 0, true),
          guildTimezone:
            (wizGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
        }),
      );
    },
  );

  app.post<{ Body: Record<string, string> }>("/ops/new", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) {
      return reply.code(403).send("Invalid CSRF token");
    }
    // Guild comes from the form picker; validate the user is an operator there.
    const guildIdFromBody = req.body.guildId?.trim();
    const memberships = await listUserGuilds(ctx.user.id);
    const targetMembership = memberships.find(
      (m) =>
        m.guildId === guildIdFromBody &&
        (m.role === "fleetoperator" || ctx.user.role === "superadmin"),
    );
    if (!targetMembership) {
      return reply.redirect(
        basePath("/ops/new?flash=error:Select+a+valid+server+where+you+are+Admiral"),
        302,
      );
    }
    const { title, description, opType, scheduledAt, eventVoiceChannelId } = req.body;
    const guildRow = await prisma.guild.findUnique({
      where: { id: targetMembership.guildId },
      select: { timezone: true },
    });
    const guildTz = (guildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
    const parsedDate = parseDateLocalTz(scheduledAt, guildTz);
    if (!title?.trim() || !parsedDate) {
      return reply.redirect(basePath("/ops/new?flash=error:Title+and+date+are+required"), 302);
    }
    try {
      const meeting = await resolveMeetingFields(req.body);
      const visibility =
        req.body.visibility && isOpVisibility(req.body.visibility)
          ? req.body.visibility
          : "private";
      const op = await createOperation(ctx.user.id, {
        guildId: targetMembership.guildId,
        title: title.trim(),
        description: description ?? "",
        opType: opType ?? "combat",
        visibility,
        meetingSystem: meeting.meetingSystem,
        meetingLocation: meeting.meetingLocation,
        scheduledAt: parsedDate,
        eventVoiceChannelId: eventVoiceChannelId?.trim() || undefined,
        minParticipants: Math.max(0, parseInt(req.body.minParticipants ?? "", 10) || 0),
        maxParticipants:
          req.body.maxParticipants && parseInt(req.body.maxParticipants, 10) > 0
            ? parseInt(req.body.maxParticipants, 10)
            : null,
      });
      await logAudit(op.id, ctx.user.id, ctx.user.username, "created", "");
      // FR-P3: optional recurring series. Pattern is derived from the chosen
      // date; the operator only picks a frequency (+ optional end).
      const RECUR_FREQS = new Set(["weekly", "biweekly", "monthly_nth", "yearly"]);
      if (RECUR_FREQS.has(req.body.recurFreq)) {
        try {
          const seriesCount =
            req.body.recurCount && parseInt(req.body.recurCount, 10) > 0
              ? Math.min(365, parseInt(req.body.recurCount, 10))
              : null;
          const seriesEnd = req.body.recurUntil
            ? parseDateLocalTz(`${req.body.recurUntil}T23:59`, guildTz)
            : null;
          await createSeriesForOp({
            op: {
              id: op.id,
              guildId: op.guildId,
              createdById: ctx.user.id,
              scheduledAt: parsedDate,
              title: op.title,
              description: op.description,
              opType: op.opType,
              visibility: op.visibility,
              meetingSystem: op.meetingSystem,
              meetingLocation: op.meetingLocation,
              minParticipants: op.minParticipants,
              maxParticipants: op.maxParticipants,
            },
            freq: req.body.recurFreq as "weekly" | "biweekly" | "monthly_nth" | "yearly",
            timezone: guildTz,
            seriesEnd,
            seriesCount,
          });
        } catch {
          /* recurrence is optional — never fail op creation on it */
        }
      }
      // Wizard composition (FR-P1 structured): the wizard still posts the legacy
      // {category,label,count} rows, but we now funnel them through the SAME
      // structured-need service as the manage editor — so wizard-created ops get
      // proper needType + eagerly materialized fighter/CQB teams (joinable).
      // Bad input is ignored so op creation never fails on it.
      if (req.body.compositionJson) {
        try {
          const VALID = new Set([
            "fps", "capital", "subcapital", "fighter", "support", "ground",
            "transport", "mining", "salvage", "exploration", "any",
          ]);
          const rows = (JSON.parse(req.body.compositionJson) as unknown[])
            .filter(
              (r): r is { category: string; count?: number } =>
                !!r &&
                typeof r === "object" &&
                VALID.has((r as { category?: unknown }).category as string),
            )
            .slice(0, 30);
          const shipSlugs: string[] = [];
          let fighterTotal = 0;
          let cqbTotal = 0;
          for (const r of rows) {
            const count = Math.min(99, Math.max(1, Math.round(Number(r.count) || 1)));
            if (r.category === "fighter") fighterTotal += count;
            else if (r.category === "fps" || r.category === "ground") cqbTotal += count;
            else for (let i = 0; i < count; i++) shipSlugs.push(r.category); // ship hull
          }
          if (shipSlugs.length) await addShipNeeds(op.id, shipSlugs, null);
          if (fighterTotal > 0) await setFighterSquads(op.id, fighterTotal);
          if (cqbTotal > 0) await setCqbTeams(op.id, cqbTotal, 4);
        } catch {
          /* ignore malformed composition */
        }
      }
      // Optional wizard last step: post an announcement to a Discord channel.
      const shareChannelId = (req.body.shareChannelId ?? "").trim();
      if (shareChannelId) {
        try {
          const link = `${getEnv().WEB_PUBLIC_URL}${getEnv().PUBLIC_BASE_PATH ?? ""}/ops/${op.id}`;
          const when = op.scheduledAt
            ? `<t:${Math.floor(new Date(op.scheduledAt).getTime() / 1000)}:F>`
            : "";
          const lines = [
            `📣 **New Operation: ${op.title}**`,
            when ? `🕒 ${when}` : "",
            op.meetingLocation ? `📍 ${op.meetingLocation}` : "",
            `🔗 ${link}`,
          ].filter(Boolean);
          await sendDiscordChannelMessage(shareChannelId, lines.join("\n"));
        } catch (err) {
          app.log.warn(err, "wizard share-to-channel failed");
        }
      }
      // Optional wizard step: jump straight to the Mission Cover page when the
      // creator ticked "open cover after creating". Otherwise land in the
      // management shell (add leaders, launch voice, etc.).
      const openCover = req.body.openCover === "1" || req.body.openCover === "on";
      if (openCover) {
        return reply.redirect(
          basePath(`/ops/${op.id}/cover?flash=ok:Operation+created.+Add+a+mission+cover.`),
          302,
        );
      }
      return reply.redirect(
        basePath(`/ops/${op.id}/manage?flash=ok:Operation+created.+Open+it+when+ready.`),
        302,
      );
    } catch {
      return reply.redirect(basePath("/ops/new?flash=error:Failed+to+create+operation"), 302);
    }
  });

  // ── Participant join view (focused sign-up page) ─────────────────────
  // Legacy alias — the canonical player route is /ops/:id. Redirect so old
  // links (and the former ?view=player preview) land on the single player page.
  app.get<{ Params: { id: string }; Querystring: { flash?: string; view?: string } }>(
    "/ops/:id/join",
    async (req, reply) => {
      const qs = req.query.flash ? `?flash=${encodeURIComponent(req.query.flash)}` : "";
      return reply.redirect(basePath(`/ops/${req.params.id}${qs}`), 302);
    },
  );

  // ── Ask the Fleet Operator: post a question ──────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/questions",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const op = await getOperation(req.params.id);
      if (!op) return reply.code(404).send({ error: "not found" });
      if (!(await effectiveOpRole(ctx.user.id, ctx.user.role, op.id)))
        return reply.code(404).send({ error: "not found" });
      const body = (req.body.body ?? "").trim().slice(0, 1000);
      if (body) {
        await prisma.opQuestion.create({
          data: { operationId: op.id, askerId: ctx.user.id, asker: ctx.user.username, body },
        });
        await logAudit(op.id, ctx.user.id, ctx.user.username, "question", "");
      }
      return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Question+sent.`), 302);
    },
  );

  // ── Answer a question (operator) ─────────────────────────────────────
  app.post<{ Params: { id: string; qid: string }; Body: Record<string, string> }>(
    "/ops/:id/questions/:qid/answer",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const answer = (req.body.answer ?? "").trim().slice(0, 1000);
      if (answer) {
        await prisma.opQuestion.update({
          where: { id: req.params.qid },
          data: { answer, answeredBy: ctx.user.username, answeredAt: new Date() },
        });
        await logAudit(req.params.id, ctx.user.id, ctx.user.username, "answer", "");
      }
      return reply.redirect(
        basePath(`/ops/${req.params.id}/manage?tab=admin&flash=ok:Antwort+gespeichert.`),
        302,
      );
    },
  );

  // ── Player-facing operation page ────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { flash?: string };
  }>("/ops/:id", async (req, reply) => {
    const ctx = await optionalAuth(req);
    // Option B: lazily open the fighter/CQB teams a need asks for, so players
    // always see joinable teams (covers ops created before eager materialization).
    await ensureTeamsMaterialized(req.params.id).catch(() => {});
    const op = await getOperation(req.params.id);
    if (!op) {
      return htmlReply(
        reply,
        errorPage({
          basePath: basePath(),
          currentUser: ctx?.user ?? null,
          status: 404,
          message: "Operation not found",
        }),
      );
    }

    const opVisibility = (op as Record<string, unknown>).visibility as string | undefined;
    if (!ctx && opVisibility !== "public") {
      reply.code(401);
      return htmlReply(reply, loginRequiredPage({ basePath: basePath() }));
    }

    let canManage = false;
    if (ctx) {
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role) {
        return htmlReply(
          reply,
          errorPage({
            basePath: basePath(),
            currentUser: ctx.user,
            status: 404,
            message: "Operation not found",
          }),
        );
      }
      canManage = role === "fleetoperator" || op.leaders.some((l) => l.user.id === ctx.user.id);
    }

    const [voiceChannels, guildRow, ownedShips] = await Promise.all([
      fetchGuildVoiceChannels(op.guildId).catch(() => []),
      prisma.guild.findUnique({
        where: { id: op.guildId },
        select: { timezone: true, discordInviteUrl: true },
      }),
      ctx
        ? prisma.userShip
            .findMany({
              where: { userId: ctx.user.id },
              include: { ship: true },
              orderBy: { ship: { name: "asc" } },
            })
            .then((rows) => rows.map((owned) => owned.ship))
        : Promise.resolve([]),
    ]);
    const voiceChannelName =
      voiceChannels.find((c) => c.id === op.eventVoiceChannelId)?.name ?? null;
    // FR-P1 step 6: Fleetyards silhouettes for the units' ships (join seat step).
    const joinShipNames = op.units
      .map((u) => u.ship?.name)
      .filter((n): n is string => Boolean(n));
    const shipSilhouettes = Object.fromEntries(await silhouettesFor(joinShipNames));
    reply.header("Cache-Control", "no-store");
    return htmlReply(
      reply,
      opJoinPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        op,
        guildTimezone: (guildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
        voiceChannelName,
        ownedShips,
        shipSilhouettes,
        canManage,
        publicUrl: `${getEnv().WEB_PUBLIC_URL}${getEnv().PUBLIC_BASE_PATH ?? ""}`,
        discordInvite:
          (guildRow as { discordInviteUrl?: string | null } | null)?.discordInviteUrl ?? null,
      }),
    );
  });

  // ── Operation detail ─────────────────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { flash?: string; tab?: string };
  }>("/ops/:id/manage", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const op = await getOperation(req.params.id);
    if (!op) {
      return htmlReply(
        reply,
        errorPage({
          basePath: basePath(),
          currentUser: ctx?.user ?? null,
          status: 404,
          message: "Operation not found",
        }),
      );
    }
    const opVisibility = (op as Record<string, unknown>).visibility as string | undefined;
    // Unauthenticated: PUBLIC ops are fully viewable WITHOUT login — but member
    // usernames are redacted and all claim/manage controls are hidden (they are
    // gated on the logged-in user, which is null here). Login is only needed to
    // actually claim a seat or join as crew. Private/partner ops 404 to guests.
    if (!ctx) {
      if (opVisibility !== "public") {
        // Logged-out guest opening a private/partner op link (e.g. the accepted-
        // captain Discord link). Don't 404 — that looks like a broken URL
        // (user feedback). Show a "login required" note instead.
        reply.code(401);
        return htmlReply(
          reply,
          loginRequiredPage({ basePath: basePath() }),
        );
      }
      // The management shell is operator-only. Send guests to the player page.
      return reply.redirect(basePath(`/ops/${op.id}`), 302);
    }
    // Authenticated: access if member of the op's guild OR the op is
    // public OR partner-visible to a guild the user belongs to. This is
    // exactly what effectiveOpRole encodes (null = no access).
    const opRoleForView = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    if (!opRoleForView) {
      return htmlReply(
        reply,
        errorPage({
          basePath: basePath(),
          currentUser: ctx.user,
          status: 404,
          message: "Operation not found",
        }),
      );
    }
    const ownedShips = ctx
      ? (
          await prisma.userShip.findMany({
            where: { userId: ctx.user.id },
            include: { ship: true },
            orderBy: { ship: { name: "asc" } },
          })
        ).map((owned) => owned.ship)
      : [];
    const canAssignSeats =
      opRoleForView === "fleetoperator" ||
      op.leaders.some((leader) => leader.user.id === ctx.user.id);
    if (!canAssignSeats && !req.query.tab) {
      const qs = req.query.flash ? `?flash=${encodeURIComponent(req.query.flash)}` : "";
      return reply.redirect(basePath(`/ops/${op.id}${qs}`), 302);
    }
    // Only op leaders (fleetoperator in the op's guild or a listed
    // OperationLeader) may change visibility — captains/crew cannot.
    const canEditVisibility = canAssignSeats;
    // Assignable users: the op's host guild, plus active partner guilds when the
    // op is shared (partners/public) so cross-org guests can be manually assigned.
    // Private ops stay host-only (tenant isolation).
    const assignGuildIds = [op.guildId];
    if (canAssignSeats && (opVisibility === "partners" || opVisibility === "public")) {
      assignGuildIds.push(...(await getActivePartnerGuildIds(op.guildId)));
    }
    const assignableUsers = canAssignSeats
      ? Array.from(
          (
            await prisma.guildMembership.findMany({
              where: { guildId: { in: assignGuildIds }, user: { active: true } },
              include: { user: true },
              orderBy: { user: { username: "asc" } },
            })
          )
            // A user may belong to both the host and a partner guild → dedupe by user id.
            .reduce(
              (acc, m) => {
                if (!acc.has(m.user.id))
                  acc.set(m.user.id, { id: m.user.id, username: m.user.username, role: m.role });
                return acc;
              },
              new Map<string, { id: string; username: string; role: string }>(),
            )
            .values(),
        )
      : [];
    const [availableVoiceBotCount, voiceEnabled, opGuildRow, guildVoiceChannels] =
      await Promise.all([
        prisma.guildVoiceBot.count({ where: { guildId: op.guildId, assignedChannelId: null } }),
        hasVoicePermission(op.guildId),
        (prisma.guild.findUnique as any)({ where: { id: op.guildId }, select: { name: true, orgName: true, timezone: true, discordInviteUrl: true } }),
        fetchGuildVoiceChannels(op.guildId).catch(() => []),
      ]);
    const opGuildTz = (opGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
    const opGuildName = (opGuildRow as { name?: string } | null)?.name;
    const opGuildOrgName = (opGuildRow as { orgName?: string | null } | null)?.orgName ?? null;
    // Guests who aren't members of the op's host guild get a Discord invite
    // banner so they can join the event Discord (required for voice moves).
    const isHostMember = ctx
      ? !!(await prisma.guildMembership.findFirst({
          where: { userId: ctx.user.id, guildId: op.guildId },
          select: { userId: true },
        }))
      : false;
    const opGuildInvite =
      (opGuildRow as { discordInviteUrl?: string | null } | null)?.discordInviteUrl ?? null;
    const joinInviteUrl = !isHostMember ? opGuildInvite : null;
    const opRole = ctx ? await effectiveOpRole(ctx.user.id, ctx.user.role, op.id) : null;
    const globalVoiceRoom =
      ((op as Record<string, unknown>).globalVoiceRoom as string | null) ?? null;
    // Generate mission commander links when voice session is active.
    let fleetVoiceLinks: Array<{ userId: string; username: string; link: string }> | null = null;
    if (opRole === "fleetoperator" && voiceEnabled && globalVoiceRoom && ctx) {
      try {
        const env = getEnv();
        const commanders = await listMissionCommanders(op.id);
        const { createMissionVoiceSession } = await import("../auth/companionSession.js");
        fleetVoiceLinks = await Promise.all(
          commanders.map(async (commander) => {
            const token = await createMissionVoiceSession(commander.userId, op.id);
            const params = new URLSearchParams({ token });
            return {
              userId: commander.userId,
              username: commander.username,
              link: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/companion/mission?${params.toString()}`,
            };
          }),
        );
      } catch {
        /* non-fatal */
      }
    }
    // Commander roster for the Commanders tab: accepted-unit captains and
    // manually-added participants only. Guild fleetoperators are not
    // auto-listed and do not get mission voice by admin role alone. A
    // fleetoperator who should join the Command Net is added explicitly.
    // Mission deep-links are generated per person when a voice session is
    // live (globalVoiceRoom set).
    type CommanderEntry = {
      userId: string;
      username: string;
      kind: "squadleader" | "leader" | "participant";
      globalVoice: boolean;
      link: string | null;
    };
    let commanderRoster: { entries: CommanderEntry[]; voiceActive: boolean } | null = null;
    if (opRole === "fleetoperator" && voiceEnabled && ctx) {
      try {
        const env = getEnv();
        const entries: CommanderEntry[] = (await listMissionCommanders(op.id)).map((commander) => ({
          ...commander,
          link: null,
        }));
        const voiceActive = Boolean(globalVoiceRoom) && Boolean(env.LIVEKIT_URL);
        if (voiceActive) {
          const { createMissionVoiceSession } = await import("../auth/companionSession.js");
          for (const e of entries) {
            const token = await createMissionVoiceSession(e.userId, op.id);
            const params = new URLSearchParams({ token });
            e.link = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/companion/mission?${params.toString()}`;
          }
        }
        commanderRoster = { entries, voiceActive };
      } catch {
        /* non-fatal */
      }
    }
    // Option B: live Discord voice control, per unit. Gated to
    // fleetoperator + voice-enabled + bridge configured + op live +
    // units actually have Discord voice channels.
    let voiceControl: Awaited<ReturnType<typeof buildOpVoiceControl>> | null = null;
    if (
      opRole === "fleetoperator" &&
      voiceEnabled &&
      bridgeConfigured() &&
      (op.status === "open" || op.status === "in_progress") &&
      op.voiceChannels.length > 0
    ) {
      voiceControl = await buildOpVoiceControl(op).catch(() => null);
    }
    // Participant roster — only surfaced once the op is completed.
    const participants = op.status === "completed" ? await getMissionParticipants(op.id) : null;
    // Multi-position users (2+ units) + their primary-channel choice.
    const primaryAssignments = await getMultiPositionAssignments(op.id);
    reply.header("Cache-Control", "no-store");
    htmlReply(
      reply,
      opDetailPageV2({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        op,
        ownedShips,
        assignableUsers,
        guildVoiceChannels,
        availableVoiceBotCount,
        voiceEnabled,
        guildTimezone: opGuildTz,
        guildName: opGuildName,
        orgName: opGuildOrgName,
        missionVoice: {
          globalVoiceRoom,
          commanderVoiceRoom:
            ((op as Record<string, unknown>).commanderVoiceRoom as string | null) ?? null,
        },
        fleetVoiceLinks,
        commanderRoster,
        voiceControl,
        tab: req.query.tab,
        visibility: opVisibility ?? "private",
        canEditVisibility,
        joinInviteUrl,
        guildDiscordInviteUrl: opGuildInvite,
        participants,
        primaryAssignments,
        canManagePrimary: canAssignSeats,
      }),
    );
  });

  // ── Mission participant export (CSV) ──────────────────────────────────
  // Any op member (effectiveOpRole != null) may download the roster of who
  // took part. Available regardless of status, but the UI only links it once
  // the op is completed.
  app.get<{ Params: { id: string } }>("/ops/:id/participants.csv", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return reply.code(404).send("Not found");
    const op = await prisma.operation.findUnique({
      where: { id: req.params.id },
      select: { id: true, title: true },
    });
    if (!op) return reply.code(404).send("Not found");
    const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    if (!role) return reply.code(404).send("Not found");

    const participants = await getMissionParticipants(op.id);
    const csv = participantsToCsv(participants);
    const slug = op.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "mission";
    reply.header("Content-Type", "text/csv; charset=utf-8");
    reply.header("Content-Disposition", `attachment; filename="${slug}-participants.csv"`);
    reply.header("Cache-Control", "no-store");
    return reply.send(csv);
  });

  // ── Change operation visibility (op leaders only) ─────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/visibility",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
      // Authorize: fleetoperator in the op's guild OR a listed OperationLeader.
      const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      const isLeader = op.leaders.some((l) => l.user.id === ctx.user.id);
      if (opRole !== "fleetoperator" && !isLeader) {
        return reply.code(403).send({ error: "forbidden" });
      }
      const visibility = req.body.visibility;
      if (!visibility || !isOpVisibility(visibility)) {
        return reply.redirect(basePath(`/ops/${op.id}?flash=error:Invalid+visibility.`), 302);
      }
      await setOperationVisibility(op.id, visibility);
      return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Visibility+updated.`), 302);
    },
  );

  // ── Option B: live Discord voice control (move op crew into channels) ──
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/ops/:id/voice/move-unit/:unitId",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      if (!bridgeConfigured())
        return reply.redirect(
          basePath(`/ops/${req.params.id}/manage?tab=voice&flash=error:Bridge+not+configured.`),
          302,
        );
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
      try {
        const r = await moveUnitCrewToChannel(op, req.params.unitId);
        return reply.redirect(
          basePath(
            `/ops/${op.id}/manage?tab=voice&flash=ok:Moved+${r.moved}+(skipped+${r.skipped}%2C+failed+${r.failed}).`,
          ),
          302,
        );
      } catch (err) {
        app.log.error(err, "move unit crew failed");
        return reply.redirect(
          basePath(`/ops/${op.id}/manage?tab=voice&flash=error:Move+failed+(bridge+unreachable%3F).`),
          302,
        );
      }
    },
  );

  app.post<{
    Params: { id: string; unitId: string; userId: string };
    Body: Record<string, string>;
  }>("/ops/:id/voice/move-member/:unitId/:userId", async (req, reply) => {
    const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    if (!bridgeConfigured())
      return reply.redirect(
        basePath(`/ops/${req.params.id}/manage?tab=voice&flash=error:Bridge+not+configured.`),
        302,
      );
    const op = await getOperation(req.params.id);
    if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
    try {
      await moveOpMemberToUnit(op, req.params.unitId, req.params.userId);
      return reply.redirect(basePath(`/ops/${op.id}/manage?tab=voice&flash=ok:Member+moved.`), 302);
    } catch (err) {
      app.log.error(err, "move op member failed");
      return reply.redirect(basePath(`/ops/${op.id}/manage?tab=voice&flash=error:Move+failed.`), 302);
    }
  });

  // ── User profile / owned ships ───────────────────────────────────────
  app.get<{ Querystring: { q?: string; flash?: string; unmatched?: string } }>(
    "/profile",
    async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    const q = req.query.q?.trim().slice(0, 80) ?? "";
    const unmatched = (req.query.unmatched ?? "")
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 50);
    const [ownedShips, searchResults] = await Promise.all([
      prisma.userShip.findMany({
        where: { userId: ctx.user.id },
        include: { ship: true },
        orderBy: { ship: { name: "asc" } },
      }),
      q ? searchLocalShips(q, 50) : Promise.resolve([]),
    ]);
    htmlReply(
      reply,
      profilePage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        ownedShips,
        searchResults,
        query: q,
        unmatched,
        currentLocale: getLocale(),
      }),
    );
  },
  );

  // Set the user's UI language (single source of truth: User.locale).
  app.post<{ Body: Record<string, string> }>("/profile/locale", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const parsed = localeSchema.safeParse(req.body.locale);
    if (!parsed.success) return reply.redirect(basePath("/profile?flash=error:Invalid+language"), 302);
    await prisma.user.update({ where: { id: ctx.user.id }, data: { locale: parsed.data } });
    setLocale(parsed.data); // apply immediately for the redirect target's render
    return reply.redirect(basePath("/profile?flash=ok:Language+updated."), 302);
  });

  app.post<{ Body: Record<string, string> }>("/profile/ships", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const shipId = req.body.shipId;
    if (!shipId) return reply.redirect(basePath("/profile?flash=error:Ship+required"), 302);
    const ship = await prisma.ship.findUnique({ where: { id: shipId }, select: { id: true } });
    if (!ship) return reply.redirect(basePath("/profile?flash=error:Ship+not+found"), 302);
    await prisma.userShip.upsert({
      where: { userId_shipId: { userId: ctx.user.id, shipId } },
      create: { userId: ctx.user.id, shipId },
      update: {},
    });
    return reply.redirect(basePath("/profile?flash=ok:Ship+added."), 302);
  });

  // Bulk-import owned ships from a CCU-Game JSON export.
  app.post<{ Body: Record<string, string> }>("/profile/fleet-import", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const raw = (req.body.fleetJson ?? "").slice(0, 200000);
    try {
      const r = await importUserFleet(ctx.user.id, raw);
      const parts = [`Imported ${r.added} new`, `${r.already} already owned`];
      if (r.unmatched.length) parts.push(`${r.unmatched.length} need manual assignment`);
      // Carry the unmatched names so the profile can offer a manual-assign /
      // skip resolver for each.
      const um = r.unmatched.length
        ? `&unmatched=${encodeURIComponent(r.unmatched.join("\n").slice(0, 4000))}`
        : "";
      return reply.redirect(
        basePath(`/profile?flash=ok:${encodeURIComponent(parts.join(" · "))}${um}`),
        302,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Import failed";
      return reply.redirect(basePath(`/profile?flash=error:${encodeURIComponent(msg)}`), 302);
    }
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/profile/ships/:id/delete",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "crew");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      await prisma.userShip.deleteMany({ where: { id: req.params.id, userId: ctx.user.id } });
      return reply.redirect(basePath("/profile?flash=ok:Ship+removed."), 302);
    },
  );

  // ── Edit operation ───────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>("/feedback", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    htmlReply(
      reply,
      feedbackPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
      }),
    );
  });

  app.post("/feedback", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;

    const feedbackErr = (msg: string) =>
      reply.redirect(basePath(`/feedback?flash=error:${encodeURIComponent(msg)}`), 302);

    // The form posts multipart/form-data (screenshot uploads). Collect text
    // fields and image parts in a single pass over the stream.
    const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    const fields: Record<string, string> = {};
    const attachments: DiscordAttachment[] = [];
    try {
      if (req.isMultipart()) {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "screenshots") {
              part.file.resume(); // drain unknown file parts
              continue;
            }
            const buf = await part.toBuffer(); // throws if over the plugin fileSize limit
            if (buf.length === 0) continue; // empty file input
            if (!ALLOWED_IMAGE.has(part.mimetype)) {
              return feedbackErr("Only PNG, JPG, GIF or WebP images are allowed.");
            }
            const safeName = (part.filename || `screenshot-${attachments.length + 1}`)
              .replace(/[^A-Za-z0-9._-]/g, "_")
              .slice(0, 80);
            attachments.push({ filename: safeName, contentType: part.mimetype, data: buf });
          } else {
            fields[part.fieldname] = typeof part.value === "string" ? part.value : "";
          }
        }
      } else {
        Object.assign(fields, (req.body as Record<string, string>) ?? {});
      }
    } catch {
      return feedbackErr("An image was too large (max 8 MB each).");
    }

    if (!csrfOk(fields, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const subject = fields.subject?.trim().slice(0, 120) ?? "";
    const message = fields.message?.trim().slice(0, 1800) ?? "";
    if (!subject || !message) {
      return reply.redirect(
        basePath("/feedback?flash=error:Subject+and+message+are+required"),
        302,
      );
    }
    const channelId = await getSetting("feedback.discordChannelId");
    const content = [
      "**Fleetplanner Feedback**",
      `From: ${ctx.user.username} (${ctx.user.id})`,
      `Subject: ${subject}`,
      "",
      message,
    ].join("\n");
    try {
      await sendDiscordChannelMessage(channelId, content, attachments);
      return reply.redirect(basePath("/feedback?flash=ok:Feedback+sent."), 302);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Feedback could not be sent";
      return feedbackErr(msg);
    }
  });

  app.get<{ Params: { id: string }; Querystring: { flash?: string } }>(
    "/ops/:id/edit",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      const op = await getOperation(req.params.id);
      if (!op) return reply.code(404).send("Not found");
      const [guildVoiceChannels, editGuildRow2] = await Promise.all([
        fetchGuildVoiceChannels(op.guildId),
        prisma.guild.findUnique({ where: { id: op.guildId }, select: { timezone: true } }),
      ]);
      htmlReply(
        reply,
        opFormPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          flash: req.query.flash,
          op,
          guildVoiceChannels,
          locations: await searchLocations(undefined, "", 0, true),
          guildTimezone:
            (editGuildRow2 as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
        }),
      );
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/edit",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { title, description, opType, scheduledAt, eventVoiceChannelId } = req.body;
      const existingOp = await getOperation(req.params.id);
      const editGuildRow = existingOp
        ? await prisma.guild.findUnique({
            where: { id: existingOp.guildId },
            select: { timezone: true },
          })
        : null;
      const editGuildTz =
        (editGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
      const parsedDate = scheduledAt ? parseDateLocalTz(scheduledAt, editGuildTz) : null;
      if (scheduledAt && !parsedDate) {
        const target =
          req.body.ui === "new"
            ? `/ops/${req.params.id}/manage?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=error:Invalid+date`
            : `/ops/${req.params.id}/edit?flash=error:Invalid+date`;
        return reply.redirect(basePath(target), 302);
      }
      try {
        const meeting = await resolveMeetingFields(req.body);
        await updateOperation(req.params.id, {
          ...(title && { title: title.trim() }),
          ...(description !== undefined && { description }),
          ...(opType && { opType }),
          meetingSystem: meeting.meetingSystem,
          meetingLocation: meeting.meetingLocation,
          ...(parsedDate && { scheduledAt: parsedDate }),
          eventVoiceChannelId: eventVoiceChannelId?.trim() || undefined,
        });

        const updatedOp = await getOperation(req.params.id);
        if (updatedOp?.discordEventId && updatedOp.status === "open") {
          updateScheduledEvent({
            id: updatedOp.id,
            guildId: updatedOp.guildId,
            title: updatedOp.title,
            description: updatedOp.description,
            scheduledAt: updatedOp.scheduledAt,
            eventVoiceChannelId: updatedOp.eventVoiceChannelId,
            discordEventId: updatedOp.discordEventId,
            opType: updatedOp.opType,
          }).catch((err) =>
            app.log.warn(err, "Discord event update failed after operation edit"),
          );
        }

        // FR-P1: keep distributed partner events in sync, and pick up any
        // newly-eligible partners (e.g. visibility raised to partners/public).
        if (updatedOp?.status === "open") {
          if (updatedOp.visibility === "partners" || updatedOp.visibility === "public") {
            distributeOperation(updatedOp).catch((err) =>
              app.log.warn(err, "Event distribution failed after operation edit"),
            );
          }
          updateDistributedEvents(updatedOp).catch((err) =>
            app.log.warn(err, "Partner event sync failed after operation edit"),
          );
        }

        const target =
          req.body.ui === "new"
            ? `/ops/${req.params.id}/manage?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=ok:Saved.`
            : `/ops/${req.params.id}/manage?flash=ok:Saved.`;
        return reply.redirect(basePath(target), 302);
      } catch {
        const target =
          req.body.ui === "new"
            ? `/ops/${req.params.id}/manage?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=error:Save+failed`
            : `/ops/${req.params.id}/edit?flash=error:Save+failed`;
        return reply.redirect(basePath(target), 302);
      }
    },
  );

  // ── Delete operation ─────────────────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/delete",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      try {
        const op = await prisma.operation.findUnique({ where: { id: req.params.id } });
        await closeMissionVoiceSession(req.params.id).catch((err) =>
          app.log.warn(err, "Mission voice session close failed before operation delete"),
        );
        await cleanupOperationVoiceChannels(req.params.id).catch((err) =>
          app.log.warn(err, "Voice channel cleanup failed before operation delete"),
        );
        // FR-P1: tear down distributed partner events BEFORE deleteOperation —
        // the EventDistribution rows cascade-delete with the op, which would
        // otherwise orphan the partner-guild Discord events.
        await deleteDistributedEvents(req.params.id).catch((err) =>
          app.log.warn(err, "Partner event teardown failed before operation delete"),
        );
        await deleteOperation(req.params.id);
        if (op?.discordEventId) {
          deleteScheduledEvent(op.guildId, op.discordEventId).catch((err) =>
            app.log.warn(err, "Discord event deletion failed after operation delete"),
          );
        }
        return reply.redirect(basePath("/?flash=ok:Operation+deleted."), 302);
      } catch {
        return reply.redirect(basePath(`/ops/${req.params.id}/manage?tab=admin&flash=error:Delete+failed`), 302);
      }
    },
  );

  // ── Stop a recurring series (FR-P3) ─────────────────────────────────
  // Deactivates the series so no further occurrences spawn. Already-spawned
  // operations stay. The native Discord recurring event is left in place.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/recurrence/stop",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const op = await prisma.operation.findUnique({
        where: { id: req.params.id },
        select: { recurrenceId: true },
      });
      if (op?.recurrenceId) {
        await prisma.operationRecurrence.update({
          where: { id: op.recurrenceId },
          data: { active: false },
        });
        await logAudit(req.params.id, ctx.user.id, ctx.user.username, "recurrence_stopped", "");
      }
      return reply.redirect(
        basePath(`/ops/${req.params.id}/manage?tab=admin&flash=ok:Recurring+series+stopped.`),
        302,
      );
    },
  );

  // ── Ships browser ─────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string; flash?: string } }>("/ships", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const q = req.query.q?.trim().slice(0, 80) ?? "";
    const ships = await searchLocalShips(q, 50);
    htmlReply(
      reply,
      shipsPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        ships,
        query: q,
      }),
    );
  });

  // ── Public info pages (no login required) ────────────────────────────
  app.get("/was-ist", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      whatIsPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        lang: "de",
      }),
    );
  });

  app.get("/what-is", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      whatIsPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        lang: "en",
      }),
    );
  });

  app.get("/how-to", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      howToPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        superadminContact: getEnv().SUPERADMIN_CONTACT,
      }),
    );
  });

  app.get("/sc-tools", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const tools = await getScToolCards();
    htmlReply(
      reply,
      scToolsPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        tools,
      }),
    );
  });

  app.get("/changelog", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      changelogPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  app.get("/roadmap", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      roadmapPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  app.get("/impressum", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      impressumPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  app.get("/privacy", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      datenschutzPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  app.get("/license", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      licensePage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  app.get("/why-unsigned", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(
      reply,
      whyUnsignedPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
      }),
    );
  });

  // ── Login page ────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>("/login", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (ctx) return reply.redirect(basePath("/"), 302); // already logged in
    htmlReply(
      reply,
      loginPage({
        basePath: basePath(),
        flash: req.query.flash,
        discord: discordEnabled(),
        github: githubEnabled(),
        google: googleEnabled(),
      }),
    );
  });

  // ── Account / linked identities ────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>("/account", async (req, reply) => {
    const ctx = await requireAuth(req, reply);
    if (!ctx) return;
    const identities = await prisma.userIdentity.findMany({
      where: { userId: ctx.user.id },
      orderBy: { createdAt: "asc" },
      select: { provider: true, username: true, email: true, createdAt: true },
    });
    htmlReply(
      reply,
      accountPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        identities,
        discord: discordEnabled(),
      }),
    );
  });

  // ── Admin panel ────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>("/admin", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    const [users, sync, locationSync, feedbackChannelId, guilds] = await Promise.all([
      prisma.user.findMany({
        orderBy: { joinedAt: "asc" },
        include: {
          identities: {
            select: { provider: true, providerId: true, username: true },
            orderBy: { createdAt: "asc" },
          },
          guildMemberships: {
            select: {
              guildId: true,
              role: true,
              guild: { select: { name: true } },
            },
            orderBy: { createdAt: "asc" },
          },
        },
      }),
      getSyncState(),
      getLocationSyncState(),
      getSetting("feedback.discordChannelId"),
      listAllGuildsForAdmin(),
    ]);
    htmlReply(
      reply,
      adminPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        users,
        sync,
        locationSync,
        feedbackChannelId,
        guilds,
        maintenanceOn: isMaintenanceOn(),
        maintenanceForcedByEnv: isMaintenanceForcedByEnv(),
      }),
    );
  });

  // ── SuperAdmin: toggle maintenance mode ────────────────────────────
  app.post<{ Body: Record<string, string> }>("/admin/maintenance", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    await setMaintenance(req.body.enabled === "1");
    const msg = req.body.enabled === "1" ? "Maintenance+mode+ON." : "Maintenance+mode+OFF.";
    return reply.redirect(basePath(`/admin?flash=ok:${msg}`), 302);
  });

  // ── SuperAdmin: ban / unban a Discord server ───────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/admin/guilds/:id/ban",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      if (!/^\d{16,25}$/.test(req.params.id)) {
        return reply.redirect(basePath("/admin?flash=error:Invalid+guild+id"), 302);
      }
      await banGuild(req.params.id);
      return reply.redirect(basePath("/admin?flash=ok:Server+banned."), 302);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/admin/guilds/:id/unban",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      if (!/^\d{16,25}$/.test(req.params.id)) {
        return reply.redirect(basePath("/admin?flash=error:Invalid+guild+id"), 302);
      }
      await unbanGuild(req.params.id);
      return reply.redirect(basePath("/admin?flash=ok:Server+unbanned+(still+inactive+until+re-added)."), 302);
    },
  );

  app.post<{ Body: Record<string, string> }>("/admin/ships/sync", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    runSync("manual").catch((err) => app.log.error(err, "Manual ship catalog sync failed"));
    return reply.redirect(basePath("/admin?flash=ok:Ship+catalog+sync+started."), 302);
  });

  app.post<{ Body: Record<string, string> }>("/admin/ships/config", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const intervalDays = Number.parseInt(req.body.intervalDays ?? "7", 10);
    await updateSyncConfig({
      enabled: req.body.enabled === "1",
      intervalDays,
    });
    return reply.redirect(basePath("/admin?flash=ok:Ship+catalog+settings+saved."), 302);
  });

  app.post<{ Body: Record<string, string> }>("/admin/locations/sync", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    runLocationSync("manual").catch((err) =>
      app.log.error(err, "Manual location catalog sync failed"),
    );
    return reply.redirect(basePath("/admin?flash=ok:Location+catalog+sync+started."), 302);
  });

  app.post<{ Body: Record<string, string> }>("/admin/locations/config", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const intervalDays = Number.parseInt(req.body.intervalDays ?? "7", 10);
    await updateLocationSyncConfig({
      enabled: req.body.enabled === "1",
      intervalDays,
    });
    return reply.redirect(basePath("/admin?flash=ok:Location+catalog+settings+saved."), 302);
  });

  app.post<{ Body: Record<string, string> }>("/admin/feedback/config", async (req, reply) => {
    const ctx = await requireRole(req, reply, "superadmin");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const channelId = req.body.channelId?.trim().slice(0, 40) ?? "";
    if (channelId && !/^\d{16,25}$/.test(channelId)) {
      return reply.redirect(basePath("/admin?flash=error:Invalid+Discord+channel+ID"), 302);
    }
    await setSetting("feedback.discordChannelId", channelId);
    return reply.redirect(basePath("/admin?flash=ok:Feedback+settings+saved."), 302);
  });

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/admin/users/:id/role",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const validRoles = ["superadmin", "fleetoperator", "crew"];
      const role = req.body.role;
      if (!validRoles.includes(role)) return reply.code(400).send("Invalid role");
      if (req.params.id === ctx.user.id && role !== "superadmin") {
        return reply.redirect(basePath("/admin?flash=error:You+cannot+demote+yourself."), 302);
      }
      if (role !== "superadmin") {
        const target = await prisma.user.findUnique({ where: { id: req.params.id } });
        if (target?.role === "superadmin") {
          const superadminCount = await prisma.user.count({
            where: { role: "superadmin", active: true },
          });
          if (superadminCount <= 1) {
            return reply.redirect(
              basePath("/admin?flash=error:Cannot+demote+the+last+active+superadmin."),
              302,
            );
          }
        }
      }
      await prisma.user.update({ where: { id: req.params.id }, data: { role } });
      return reply.redirect(basePath("/admin?flash=ok:Role+updated."), 302);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/admin/users/:id/active",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const user = await prisma.user.findUnique({ where: { id: req.params.id } });
      if (!user) return reply.code(404).send("Not found");
      if (user.id === ctx.user.id && user.active) {
        return reply.redirect(basePath("/admin?flash=error:You+cannot+disable+yourself."), 302);
      }
      if (user.role === "superadmin" && user.active) {
        const superadminCount = await prisma.user.count({
          where: { role: "superadmin", active: true },
        });
        if (superadminCount <= 1) {
          return reply.redirect(
            basePath("/admin?flash=error:Cannot+disable+the+last+active+superadmin."),
            302,
          );
        }
      }
      await prisma.user.update({ where: { id: req.params.id }, data: { active: !user.active } });
      return reply.redirect(basePath("/admin?flash=ok:User+status+toggled."), 302);
    },
  );
}
