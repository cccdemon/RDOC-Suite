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
  profilePage,
  shipsPage,
  feedbackPage,
  adminPage,
  errorPage,
  loginPage,
  accountPage,
  howToPage,
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
import {
  createOperation,
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
import {
  deleteScheduledEvent,
  fetchGuildVoiceChannels,
  sendDiscordChannelMessage,
  updateScheduledEvent,
} from "../services/discord.js";
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
      }),
    );
  });

  // ── New operation form — guild picker when user has multiple servers ─────
  app.get<{ Querystring: { flash?: string; _guild?: string } }>("/ops/new", async (req, reply) => {
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
    const [guildVoiceChannels, newOpGuildRow] = await Promise.all([
      selectedOperatorGuildId
        ? fetchGuildVoiceChannels(selectedOperatorGuildId)
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
      opFormPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        op: null,
        operatorGuilds,
        selectedOperatorGuildId,
        guildVoiceChannels,
        locations: await searchLocations(undefined, "", 0, true),
        guildTimezone:
          (newOpGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
      }),
    );
  });

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
      });
      return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Operation+created.`), 302);
    } catch {
      return reply.redirect(basePath("/ops/new?flash=error:Failed+to+create+operation"), 302);
    }
  });

  // ── Operation detail ─────────────────────────────────────────────────
  app.get<{
    Params: { id: string };
    Querystring: { flash?: string; viewAs?: string; tab?: string };
  }>("/ops/:id", async (req, reply) => {
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
        return htmlReply(
          reply,
          errorPage({
            basePath: basePath(),
            currentUser: null,
            status: 404,
            message: "Operation not found",
          }),
        );
      }
      reply.header("Cache-Control", "no-store");
      const guestGuildRow = (await (prisma.guild.findUnique as any)({
        where: { id: op.guildId },
        select: { name: true, orgName: true, timezone: true, discordInviteUrl: true },
      })) as { name?: string; orgName?: string | null; timezone?: string; discordInviteUrl?: string | null } | null;
      return htmlReply(
        reply,
        opDetailPageV2({
          basePath: basePath(),
          currentUser: null,
          op,
          ownedShips: [],
          assignableUsers: [],
          guildVoiceChannels: [],
          availableVoiceBotCount: 0,
          voiceEnabled: false,
          guildTimezone: guestGuildRow?.timezone ?? DEFAULT_TIMEZONE,
          guildName: guestGuildRow?.name,
          orgName: guestGuildRow?.orgName ?? null,
          visibility: "public",
          canEditVisibility: false,
          joinInviteUrl: null,
          guildDiscordInviteUrl: guestGuildRow?.discordInviteUrl ?? null,
          participants: null,
          primaryAssignments: [],
          canManagePrimary: false,
          redactNames: true,
          tab: req.query.tab,
        }),
      );
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
        viewAsRole: req.query.viewAs,
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
          basePath(`/ops/${req.params.id}?flash=error:Bridge+not+configured.`),
          302,
        );
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
      try {
        const r = await moveUnitCrewToChannel(op, req.params.unitId);
        return reply.redirect(
          basePath(
            `/ops/${op.id}?flash=ok:Moved+${r.moved}+(skipped+${r.skipped}%2C+failed+${r.failed}).`,
          ),
          302,
        );
      } catch (err) {
        app.log.error(err, "move unit crew failed");
        return reply.redirect(
          basePath(`/ops/${op.id}?flash=error:Move+failed+(bridge+unreachable%3F).`),
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
        basePath(`/ops/${req.params.id}?flash=error:Bridge+not+configured.`),
        302,
      );
    const op = await getOperation(req.params.id);
    if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
    try {
      await moveOpMemberToUnit(op, req.params.unitId, req.params.userId);
      return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Member+moved.`), 302);
    } catch (err) {
      app.log.error(err, "move op member failed");
      return reply.redirect(basePath(`/ops/${op.id}?flash=error:Move+failed.`), 302);
    }
  });

  // ── User profile / owned ships ───────────────────────────────────────
  app.get<{ Querystring: { q?: string; flash?: string } }>("/profile", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    const q = req.query.q?.trim().slice(0, 80) ?? "";
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
      }),
    );
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

  app.post<{ Body: Record<string, string> }>("/feedback", async (req, reply) => {
    const ctx = await requireRole(req, reply, "crew");
    if (!ctx) return;
    if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
    const subject = req.body.subject?.trim().slice(0, 120) ?? "";
    const message = req.body.message?.trim().slice(0, 1800) ?? "";
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
      await sendDiscordChannelMessage(channelId, content);
      return reply.redirect(basePath("/feedback?flash=ok:Feedback+sent."), 302);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Feedback could not be sent";
      return reply.redirect(basePath(`/feedback?flash=error:${encodeURIComponent(msg)}`), 302);
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
            ? `/ops/${req.params.id}?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=error:Invalid+date`
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

        const target =
          req.body.ui === "new"
            ? `/ops/${req.params.id}?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=ok:Saved.`
            : `/ops/${req.params.id}?flash=ok:Saved.`;
        return reply.redirect(basePath(target), 302);
      } catch {
        const target =
          req.body.ui === "new"
            ? `/ops/${req.params.id}?tab=${encodeURIComponent(req.body.tab || "overview")}&flash=error:Save+failed`
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
        await deleteOperation(req.params.id);
        if (op?.discordEventId) {
          deleteScheduledEvent(op.guildId, op.discordEventId).catch((err) =>
            app.log.warn(err, "Discord event deletion failed after operation delete"),
          );
        }
        return reply.redirect(basePath("/?flash=ok:Operation+deleted."), 302);
      } catch {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Delete+failed`), 302);
      }
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
      }),
    );
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
