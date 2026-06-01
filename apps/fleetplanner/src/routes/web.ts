import type { FastifyInstance } from "fastify";
import { rawHtml } from "../web/pages.js";
import {
  homePage, opDetailPage, opFormPage, profilePage, shipsPage, feedbackPage, adminPage, errorPage,
  loginPage, accountPage, howToPage, licensePage,

} from "../web/pages.js";
import { requireRole, optionalAuth, requireAuth, optionalGuild, requireGuildRole, requireOpRole } from "../auth/middleware.js";
import { discordEnabled, githubEnabled, googleEnabled } from "../auth/providers.js";
import { getMembership, listUserGuilds, effectiveOpRole } from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import {
  createOperation, getOperation, listOperations, listAllUserOperations, updateOperation, deleteOperation,
} from "../services/operations.js";
import { searchLocalShips } from "../services/scwiki.js";
import { deleteScheduledEvent, fetchGuildVoiceChannels, sendDiscordChannelMessage } from "../services/discord.js";
import { hasVoicePermission } from "../services/voiceSession.js";
import { bridgeConfigured } from "../services/bridge.js";
import { buildOpVoiceControl, moveUnitCrewToChannel, moveOpMemberToUnit } from "../services/opVoice.js";
import { parseDateLocalTz, DEFAULT_TIMEZONE } from "../lib/timezone.js";
import { getSyncState, runSync, updateSyncConfig } from "../services/shipSync.js";
import { getLocationSyncState, runLocationSync, searchLocations, updateLocationSyncConfig } from "../services/locations.js";
import { getSetting, setSetting } from "../services/settings.js";

function htmlReply(reply: import("fastify").FastifyReply, page: import("../web/render.js").SafeHtml) {
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

async function resolveMeetingFields(body: Record<string, string>): Promise<{ meetingSystem: string; meetingLocation: string }> {
  const requestedSystem = VALID_MEETING_SYSTEMS.includes(body.meetingSystem) ? body.meetingSystem : "stanton";
  const locationSlug = body.meetingLocationSlug?.trim();
  const rawLocation = body.meetingLocation?.trim().slice(0, 120) ?? "";

  if (locationSlug) {
    const location = await prisma.location.findUnique({ where: { slug: locationSlug } });
    if (location && VALID_MEETING_SYSTEMS.includes(location.systemSlug)) {
      return {
        meetingSystem: location.systemSlug,
        meetingLocation: `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`.slice(0, 120),
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
        meetingLocation: `${location.name}${location.parentName ? ` (${location.parentName})` : ""}`.slice(0, 120),
      };
    }
  }

  return { meetingSystem: requestedSystem, meetingLocation: rawLocation };
}

export async function webRoutes(app: FastifyInstance) {

  // ── Home — shows ops from ALL user's guilds with server marker ──────────
  app.get<{ Querystring: { flash?: string; past?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (!ctx) return reply.redirect(basePath("/login"), 302);
      const memberships = await listUserGuilds(ctx.user.id);
      if (memberships.length === 0) return reply.redirect(basePath("/guilds/none"), 302);
      const includePast = !!req.query.past;
      const guildIds = memberships.map((m) => m.guildId);
      const ops = await listAllUserOperations(guildIds, includePast);
      // Operator guilds for the "New Op" picker
      const operatorGuilds = memberships
        .filter((m) => m.role === "fleetoperator" || ctx.user.role === "superadmin")
        .map((m) => ({ id: m.guildId, name: m.guild.name }));
      htmlReply(reply, homePage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        ops,
        includePast,
        operatorGuilds,
      }));
    }
  );

  // ── New operation form — guild picker when user has multiple servers ─────
  app.get<{ Querystring: { flash?: string; _guild?: string } }>(
    "/ops/new",
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
        : operatorGuilds.length === 1 ? operatorGuilds[0].id : undefined;
      const [guildVoiceChannels, newOpGuildRow] = await Promise.all([
        selectedOperatorGuildId ? fetchGuildVoiceChannels(selectedOperatorGuildId) : Promise.resolve([]),
        selectedOperatorGuildId
          ? prisma.guild.findUnique({ where: { id: selectedOperatorGuildId }, select: { timezone: true } })
          : Promise.resolve(null),
      ]);
      htmlReply(reply, opFormPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        op: null,
        operatorGuilds,
        selectedOperatorGuildId,
        guildVoiceChannels,
        locations: await searchLocations(undefined, "", 2000),
        guildTimezone: (newOpGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/ops/new",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) {
        return reply.code(403).send("Invalid CSRF token");
      }
      // Guild comes from the form picker; validate the user is an operator there.
      const guildIdFromBody = req.body.guildId?.trim();
      const memberships = await listUserGuilds(ctx.user.id);
      const targetMembership = memberships.find(
        (m) => m.guildId === guildIdFromBody &&
          (m.role === "fleetoperator" || ctx.user.role === "superadmin")
      );
      if (!targetMembership) {
        return reply.redirect(basePath("/ops/new?flash=error:Select+a+valid+server+where+you+are+Admiral"), 302);
      }
      const { title, description, opType, scheduledAt, eventVoiceChannelId } = req.body;
      const guildRow = await prisma.guild.findUnique({ where: { id: targetMembership.guildId }, select: { timezone: true } });
      const guildTz = (guildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
      const parsedDate = parseDateLocalTz(scheduledAt, guildTz);
      if (!title?.trim() || !parsedDate) {
        return reply.redirect(basePath("/ops/new?flash=error:Title+and+date+are+required"), 302);
      }
      try {
        const meeting = await resolveMeetingFields(req.body);
        const op = await createOperation(ctx.user.id, {
          guildId: targetMembership.guildId,
          title: title.trim(),
          description: description ?? "",
          opType: opType ?? "combat",
          meetingSystem: meeting.meetingSystem,
          meetingLocation: meeting.meetingLocation,
          scheduledAt: parsedDate,
          eventVoiceChannelId: eventVoiceChannelId?.trim() || undefined,
        });
        return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Operation+created.`), 302);
      } catch {
        return reply.redirect(basePath("/ops/new?flash=error:Failed+to+create+operation"), 302);
      }
    }
  );

  // ── Operation detail ─────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { flash?: string; viewAs?: string } }>(
    "/ops/:id",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      const op = await getOperation(req.params.id);
      if (!op) {
        return htmlReply(reply, errorPage({
          basePath: basePath(), currentUser: ctx?.user ?? null, status: 404, message: "Operation not found",
        }));
      }
      // Tenant isolation: only members of the op's guild may view it.
      if (!ctx) return reply.redirect(basePath("/login"), 302);
      const membership = ctx.user.role === "superadmin"
        ? true
        : !!(await getMembership(ctx.user.id, op.guildId));
      if (!membership) {
        return htmlReply(reply, errorPage({
          basePath: basePath(), currentUser: ctx.user, status: 404, message: "Operation not found",
        }));
      }
      const ownedShips = ctx
        ? (await prisma.userShip.findMany({
            where: { userId: ctx.user.id },
            include: { ship: true },
            orderBy: { ship: { name: "asc" } },
          })).map((owned) => owned.ship)
        : [];
      const opRoleForView = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      const canAssignSeats =
        opRoleForView === "fleetoperator" ||
        op.leaders.some((leader) => leader.user.id === ctx.user.id);
      // Assignable users are scoped to the op's guild (tenant isolation).
      const assignableUsers = canAssignSeats
        ? (await prisma.guildMembership.findMany({
            where: { guildId: op.guildId, user: { active: true } },
            include: { user: true },
            orderBy: { user: { username: "asc" } },
          })).map((m) => ({ id: m.user.id, username: m.user.username, role: m.role }))
        : [];
      const [availableVoiceBotCount, voiceEnabled, opGuildRow] = await Promise.all([
        prisma.guildVoiceBot.count({ where: { guildId: op.guildId, assignedChannelId: null } }),
        hasVoicePermission(op.guildId),
        prisma.guild.findUnique({ where: { id: op.guildId }, select: { timezone: true } }),
      ]);
      const opGuildTz = (opGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
      const opRole = ctx ? await effectiveOpRole(ctx.user.id, ctx.user.role, op.id) : null;
      const globalVoiceRoom = (op as Record<string, unknown>).globalVoiceRoom as string | null ?? null;
      // Generate fleet voice links for fleetoperators when voice session is active
      let fleetVoiceLinks: Array<{ userId: string; username: string; link: string }> | null = null;
      if (opRole === "fleetoperator" && voiceEnabled && globalVoiceRoom && ctx) {
        try {
          const env = getEnv();
          const fleetplannerUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
          const captainIds = new Set<string>(op.units.filter((u) => u.status === "accepted").map((u) => u.captainId));
          const fpMembers = await prisma.guildMembership.findMany({
            where: { guildId: op.guildId, role: "fleetoperator" },
            include: { user: true },
          });
          const allUserIds = new Set<string>([...captainIds, ...fpMembers.map((m) => m.userId)]);
          const captainUsers = await prisma.user.findMany({ where: { id: { in: [...captainIds] } }, select: { id: true, username: true } });
          const usernameMap = new Map(captainUsers.map((u) => [u.id, u.username]));
          for (const m of fpMembers) usernameMap.set(m.userId, m.user.username);
          const { createMissionVoiceSession } = await import("../auth/companionSession.js");
          fleetVoiceLinks = await Promise.all([...allUserIds].map(async (uid) => {
            const token = await createMissionVoiceSession(uid);
            const params = new URLSearchParams({ token, url: fleetplannerUrl });
            return { userId: uid, username: usernameMap.get(uid) ?? uid, link: `dccc://fleet-voice?${params.toString()}` };
          }));
        } catch { /* non-fatal */ }
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
      htmlReply(reply, opDetailPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        op,
        ownedShips,
        assignableUsers,
        availableVoiceBotCount,
        voiceEnabled,
        guildTimezone: opGuildTz,
        missionVoice: { globalVoiceRoom, commanderVoiceRoom: (op as Record<string, unknown>).commanderVoiceRoom as string | null ?? null },
        fleetVoiceLinks,
        voiceControl,
        viewAsRole: req.query.viewAs,
      }));
    }
  );

  // ── Option B: live Discord voice control (move op crew into channels) ──
  app.post<{ Params: { id: string; unitId: string }; Body: Record<string, string> }>(
    "/ops/:id/voice/move-unit/:unitId",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      if (!bridgeConfigured()) return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Bridge+not+configured.`), 302);
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
      try {
        const r = await moveUnitCrewToChannel(op, req.params.unitId);
        return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Moved+${r.moved}+(skipped+${r.skipped}%2C+failed+${r.failed}).`), 302);
      } catch (err) {
        app.log.error(err, "move unit crew failed");
        return reply.redirect(basePath(`/ops/${op.id}?flash=error:Move+failed+(bridge+unreachable%3F).`), 302);
      }
    }
  );

  app.post<{ Params: { id: string; unitId: string; userId: string }; Body: Record<string, string> }>(
    "/ops/:id/voice/move-member/:unitId/:userId",
    async (req, reply) => {
      const ctx = await requireOpRole(req, reply, req.params.id, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      if (!bridgeConfigured()) return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Bridge+not+configured.`), 302);
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/?flash=error:Operation+not+found."), 302);
      try {
        await moveOpMemberToUnit(op, req.params.unitId, req.params.userId);
        return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Member+moved.`), 302);
      } catch (err) {
        app.log.error(err, "move op member failed");
        return reply.redirect(basePath(`/ops/${op.id}?flash=error:Move+failed.`), 302);
      }
    }
  );

  // ── User profile / owned ships ───────────────────────────────────────
  app.get<{ Querystring: { q?: string; flash?: string } }>(
    "/profile",
    async (req, reply) => {
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
      htmlReply(reply, profilePage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        ownedShips,
        searchResults,
        query: q,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/profile/ships",
    async (req, reply) => {
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
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/profile/ships/:id/delete",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "crew");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      await prisma.userShip.deleteMany({ where: { id: req.params.id, userId: ctx.user.id } });
      return reply.redirect(basePath("/profile?flash=ok:Ship+removed."), 302);
    }
  );

  // ── Edit operation ───────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/feedback",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "crew");
      if (!ctx) return;
      htmlReply(reply, feedbackPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/feedback",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "crew");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const subject = req.body.subject?.trim().slice(0, 120) ?? "";
      const message = req.body.message?.trim().slice(0, 1800) ?? "";
      if (!subject || !message) {
        return reply.redirect(basePath("/feedback?flash=error:Subject+and+message+are+required"), 302);
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
    }
  );

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
      htmlReply(reply, opFormPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        op,
        guildVoiceChannels,
        locations: await searchLocations(undefined, "", 2000),
        guildTimezone: (editGuildRow2 as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
      }));
    }
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
        ? await prisma.guild.findUnique({ where: { id: existingOp.guildId }, select: { timezone: true } })
        : null;
      const editGuildTz = (editGuildRow as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE;
      const parsedDate = scheduledAt ? parseDateLocalTz(scheduledAt, editGuildTz) : null;
      if (scheduledAt && !parsedDate) {
        return reply.redirect(basePath(`/ops/${req.params.id}/edit?flash=error:Invalid+date`), 302);
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
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=ok:Saved.`), 302);
      } catch {
        return reply.redirect(basePath(`/ops/${req.params.id}/edit?flash=error:Save+failed`), 302);
      }
    }
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
        await deleteOperation(req.params.id);
        if (op?.discordEventId) {
          deleteScheduledEvent(op.guildId, op.discordEventId).catch((err) =>
            app.log.warn(err, "Discord event deletion failed after operation delete")
          );
        }
        return reply.redirect(basePath("/?flash=ok:Operation+deleted."), 302);
      } catch {
        return reply.redirect(basePath(`/ops/${req.params.id}?flash=error:Delete+failed`), 302);
      }
    }
  );

  // ── Ships browser ─────────────────────────────────────────────────────
  app.get<{ Querystring: { q?: string; flash?: string } }>(
    "/ships",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      const q = req.query.q?.trim().slice(0, 80) ?? "";
      const ships = await searchLocalShips(q, 50);
      htmlReply(reply, shipsPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        ships,
        query: q,
      }));
    }
  );

  // ── Public info pages (no login required) ────────────────────────────
  app.get("/how-to", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(reply, howToPage({ basePath: basePath(), currentUser: ctx?.user ?? null, csrfToken: ctx?.csrfToken }));
  });

  app.get("/license", async (req, reply) => {
    const ctx = await optionalAuth(req);
    htmlReply(reply, licensePage({ basePath: basePath(), currentUser: ctx?.user ?? null, csrfToken: ctx?.csrfToken }));
  });

  // ── Login page ────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/login",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (ctx) return reply.redirect(basePath("/"), 302); // already logged in
      htmlReply(reply, loginPage({
        basePath: basePath(),
        flash: req.query.flash,
        discord: discordEnabled(),
        github: githubEnabled(),
        google: googleEnabled(),
      }));
    }
  );

  // ── Account / linked identities ────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/account",
    async (req, reply) => {
      const ctx = await requireAuth(req, reply);
      if (!ctx) return;
      const identities = await prisma.userIdentity.findMany({
        where: { userId: ctx.user.id },
        orderBy: { createdAt: "asc" },
        select: { provider: true, username: true, email: true, createdAt: true },
      });
      htmlReply(reply, accountPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        identities,
        discord: discordEnabled(),
      }));
    }
  );

  // ── Admin panel ────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/admin",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      const [users, sync, locationSync, feedbackChannelId] = await Promise.all([
        prisma.user.findMany({ orderBy: { joinedAt: "asc" } }),
        getSyncState(),
        getLocationSyncState(),
        getSetting("feedback.discordChannelId"),
      ]);
      htmlReply(reply, adminPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        users,
        sync,
        locationSync,
        feedbackChannelId,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/ships/sync",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      runSync("manual").catch((err) => app.log.error(err, "Manual ship catalog sync failed"));
      return reply.redirect(basePath("/admin?flash=ok:Ship+catalog+sync+started."), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/ships/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const intervalDays = Number.parseInt(req.body.intervalDays ?? "7", 10);
      await updateSyncConfig({
        enabled: req.body.enabled === "1",
        intervalDays,
      });
      return reply.redirect(basePath("/admin?flash=ok:Ship+catalog+settings+saved."), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/locations/sync",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      runLocationSync("manual").catch((err) => app.log.error(err, "Manual location catalog sync failed"));
      return reply.redirect(basePath("/admin?flash=ok:Location+catalog+sync+started."), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/locations/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const intervalDays = Number.parseInt(req.body.intervalDays ?? "7", 10);
      await updateLocationSyncConfig({
        enabled: req.body.enabled === "1",
        intervalDays,
      });
      return reply.redirect(basePath("/admin?flash=ok:Location+catalog+settings+saved."), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/feedback/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const channelId = req.body.channelId?.trim().slice(0, 40) ?? "";
      if (channelId && !/^\d{16,25}$/.test(channelId)) {
        return reply.redirect(basePath("/admin?flash=error:Invalid+Discord+channel+ID"), 302);
      }
      await setSetting("feedback.discordChannelId", channelId);
      return reply.redirect(basePath("/admin?flash=ok:Feedback+settings+saved."), 302);
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/admin/users/:id/role",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "superadmin");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const validRoles = ["superadmin", "fleetoperator", "captain", "crew"];
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
            return reply.redirect(basePath("/admin?flash=error:Cannot+demote+the+last+active+superadmin."), 302);
          }
        }
      }
      await prisma.user.update({ where: { id: req.params.id }, data: { role } });
      return reply.redirect(basePath("/admin?flash=ok:Role+updated."), 302);
    }
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
          return reply.redirect(basePath("/admin?flash=error:Cannot+disable+the+last+active+superadmin."), 302);
        }
      }
      await prisma.user.update({ where: { id: req.params.id }, data: { active: !user.active } });
      return reply.redirect(basePath("/admin?flash=ok:User+status+toggled."), 302);
    }
  );
}
