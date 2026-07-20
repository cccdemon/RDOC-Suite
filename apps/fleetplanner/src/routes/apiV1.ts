// FR-P2 Phase 2 — /api/v1: JSON-only read slice.
//
// Rules (FR-P2 §Architekturregeln + §API-Sicherheit):
// - JSON only; never HTML, never a redirect to a login page (401 JSON instead).
// - No imports from web/* — presenters live in src/api/presenters.ts.
// - Object-level authorization on every id param; private ops 401/404 without leaks.
// - Stable error envelope { error: { code, message, requestId } }.
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { getEnv } from "../config/env.js";
import { optionalAuth, type AuthContext } from "../auth/middleware.js";
import {
  banGuild,
  E2E_GUILD_IDS,
  effectiveOpRole,
  getGuildSettingsData,
  getMembership,
  listAllGuildsForAdmin,
  listUserGuilds,
  setMembershipRole,
  sweepGuildPresence,
  unbanGuild,
  updateGuildSettings,
} from "../services/guilds.js";
import { isValidTimezone, DEFAULT_TIMEZONE } from "../lib/timezone.js";
import { createOperation } from "../services/operations.js";
import { applyTemplate, listTemplatesForGuild, publishTemplate } from "../services/operationTemplates.js";
import { sendDiscordChannelMessage, type DiscordAttachment } from "../services/discord.js";
import { getSetting, setSetting } from "../services/settings.js";
import { isMaintenanceForcedByEnv, isMaintenanceOn, setMaintenance } from "../services/maintenance.js";
import { getSyncState, runSync, updateSyncConfig } from "../services/shipSync.js";
import { getLocationSyncState, runLocationSync, updateLocationSyncConfig, searchLocations } from "../services/locations.js";
import { getSystemHealth } from "../services/systemHealth.js";
import { listSystemEvents, SYSTEM_EVENT_RETENTION_DAYS, type EventLevel } from "../services/systemEvents.js";
import { ROADMAP } from "../lib/roadmap.js";
import {
  addLeader,
  deleteOperation,
  getOperation,
  listAllUserOperations,
  listPartnerOperations,
  listPublicOperations,
  logAudit,
  removeLeader,
  setOperationVisibility,
  setStatus,
  updateOperation,
} from "../services/operations.js";
import { createScheduledEvent, deleteScheduledEvent, fetchGuildTextChannels, updateScheduledEvent, updateScheduledEventImage } from "../services/discord.js";
import {
  requestCover,
  deleteCover,
  coverServiceConfigured,
  type CoverData,
  type CoverFormat,
  type CoverPreset,
} from "../services/coverService.js";
import { signCoverToken } from "../services/coverToken.js";
import {
  buildCommandNetLink,
  squadLinkConfigured,
  squadLinkStoreUrl,
} from "../services/squadLink.js";
import {
  approveDistribution,
  declineDistribution,
  deleteDistributedEvents,
  distributeOperation,
  getAutoShareMap,
  listIncomingDistributions,
  setAutoShare,
  updateDistributedEvents,
} from "../services/eventDistribution.js";
import {
  acceptPartnerToken,
  listPartnerships,
  mintPartnerToken,
  revokePartnership,
} from "../services/partnerships.js";
import { createSeriesForOp } from "../services/recurrence.js";
import { runDiscordInstallDiagnostics } from "../services/discordDiagnostics.js";
import { assignSeat, claimSeat, deleteUnit, registerUnit, setUnitStatus, unclaimSeat } from "../services/units.js";
import {
  addShipNeeds,
  getOperationNeeds,
  removeShipNeed,
  renameShipNeed,
  setCqbTeams,
  setFighterSquads,
} from "../services/needs.js";
import { listSharedHangars } from "../services/hangarShare.js";
import { importUserFleet } from "../services/fleetImport.js";
import { sendSeatAssignmentDm } from "../services/discord.js";
import { createSignup as createCqbSignup, placeInSquad as placeCqbMember, renameSquad as renameCqbSquad, withdrawSignup as withdrawCqbSignup } from "../services/cqb.js";
import { cqbOwner, seatOwner, setCqbLateEta, setSeatLateEta, setUnitLateEta, unitOwner } from "../services/lateArrival.js";
import { assignUnitToFormation, autoFillAllFighters, createFormation, deleteFormation, renameFormation, setGroupParent, setMemberSlot } from "../services/formations.js";
import { effectiveShipClass } from "../services/composition.js";
import { assignablePeople } from "../services/people.js";
import { setHangarShare } from "../services/hangarShare.js";
import { addResourceLink, removeResourceLink } from "../services/resourceLinks.js";
import { addStream, removeStream, streamOwner } from "../services/streams.js";
import { sendDiscordDm } from "../services/discord.js";
import { searchLocalShips } from "../services/scwiki.js";
import { assertRequirementFitsUnit, assertUniqueSquadName, canApproveUnits } from "./api.js";
import {
  AnswerQuestionRequestSchema,
  ApplyTemplateRequestSchema,
  AssignSeatRequestSchema,
  AnnounceRequestSchema,
  AssignCarrierRequestSchema,
  AddCqbMemberRequestSchema,
  AssignCqbRequestSchema,
  SetLateArrivalRequestSchema,
  SetGroupParentRequestSchema,
  SetMemberSlotRequestSchema,
  AssignFormationRequestSchema,
  CqbSignupRequestSchema,
  FormationRequestSchema,
  CreateOperationRequestSchema,
  AddShipNeedsRequestSchema,
  AcceptTokenRequestSchema,
  MintInviteRequestSchema,
  PublishTemplateRequestSchema,
  SetAutoShareRequestSchema,
  SetRecurrenceRequestSchema,
  EditOperationRequestSchema,
  FeedbackRequestSchema,
  FleetImportRequestSchema,
  GuildIdParamSchema,
  GuildMemberParamSchema,
  NeedParamSchema,
  RenameNeedRequestSchema,
  SetCqbTeamsRequestSchema,
  SetFighterSquadsRequestSchema,
  SetStatusRequestSchema,
  SetUserRoleRequestSchema,
  MaintenanceRequestSchema,
  FeedbackChannelRequestSchema,
  CatalogConfigRequestSchema,
  HangarShareRequestSchema,
  HangarShipParamSchema,
  HangarShipRequestSchema,
  IdParamSchema,
  CreatePollRequestSchema,
  UpdatePollRequestSchema,
  VotePollRequestSchema,
  AddPollOptionRequestSchema,
  SetMemberRoleRequestSchema,
  UpdateGuildSettingsRequestSchema,
  LeaderParamSchema,
  LinkParamSchema,
  OperationListQuerySchema,
  PatchUnitRequestSchema,
  QuestionParamSchema,
  AddStreamRequestSchema,
  RegisterUnitRequestSchema,
  ResourceLinkRequestSchema,
  SeatParamSchema,
  ShipSearchQuerySchema,
  UnitDecisionRequestSchema,
  UnitParamSchema,
  type ApiError,
  type OperatorView,
} from "../api/contracts/index.js";
import {
  presentGuild,
  presentGuildSettings,
  presentGuildSettingsMember,
  presentOperationDetail,
  presentOperationSummary,
  presentOrgFleet,
  presentSession,
  presentShip,
} from "../api/presenters.js";
import { getOrgFleetRows } from "../services/orgFleet.js";
import {
  addPollOption,
  updatePoll,
  createPoll,
  deletePoll,
  getPollForViewer,
  listPollsForViewer,
  votePoll,
  withdrawVote,
} from "../services/polls.js";
import { openApiDocument } from "../api/openapi.js";
import { getDocContent } from "../api/docContent.js";
import { mutationLimiter, searchLimiter } from "../api/rateLimit.js";

const VERSION = process.env.npm_package_version ?? "0.0.0";

function sendError(
  reply: FastifyReply,
  req: FastifyRequest,
  status: number,
  code: ApiError["error"]["code"],
  message: string,
) {
  const body: ApiError = { error: { code, message, requestId: req.id } };
  return reply.code(status).type("application/json").send(body);
}

/** Per-op signup state of one user — same rule as the SSR home page:
 *  committed seat/CQB signup wins over pending crew request / ship offer. */
async function signupStateFor(
  userId: string,
  operationId: string,
): Promise<"joined" | "waitlist" | null> {
  const [seat, cqb, req, pendingShip] = await Promise.all([
    prisma.seatAssignment.findFirst({
      where: { userId, active: true, fleetUnit: { operationId } },
      select: { id: true },
    }),
    prisma.cqbSignup.findFirst({
      where: { userId, operationId, status: { not: "rejected" } },
      select: { id: true },
    }),
    prisma.crewAssignmentRequest.findFirst({
      where: { userId, operationId },
      select: { id: true },
    }),
    prisma.fleetUnit.findFirst({
      where: { captainId: userId, operationId, status: "pending" },
      select: { id: true },
    }),
  ]);
  if (seat || cqb) return "joined";
  if (req || pendingShip) return "waitlist";
  return null;
}

export async function apiV1Routes(app: FastifyInstance) {
  // ── rate limits (FR-P2 §Abuse-Schutz) ───────────────────────────────
  // Plugin-scoped: applies to every /api/v1 route, SSR untouched. Key is the
  // session cookie when present (no DB hit needed for bucketing), else the
  // client IP (trustProxy is on; Caddy fronts the app).
  app.addHook("preHandler", async (req, reply) => {
    const isSearch = req.method === "GET" && req.url.includes("/ships/search");
    const isMutation = req.method !== "GET" && req.method !== "HEAD";
    if (!isSearch && !isMutation) return;
    const key =
      ((req.cookies as Record<string, string | undefined>)?.fp_sid ?? req.ip) +
      (isMutation ? ":m" : ":s");
    const retry = (isMutation ? mutationLimiter : searchLimiter).hit(key);
    if (retry !== null) {
      const body: ApiError = {
        error: { code: "rate_limited", message: "Too many requests.", requestId: req.id },
      };
      return reply.code(429).header("retry-after", String(retry)).type("application/json").send(body);
    }
  });

  // ── meta ────────────────────────────────────────────────────────────
  app.get("/api/v1/health", async (_req, reply) => {
    return reply.type("application/json").send({
      status: "ok" as const,
      service: "fleetplanner-api" as const,
      version: VERSION,
      time: new Date().toISOString(),
    });
  });

  app.get("/api/v1/openapi.json", async (_req, reply) => {
    return reply.type("application/json").send(openApiDocument);
  });

  // Static info/legal page content as data — the SPA renders it (DocPage). The
  // backend serves content, never a rendered HTML page.
  app.get<{ Params: { slug: string }; Querystring: { lang?: string } }>(
    "/api/v1/content/:slug",
    async (req, reply) => {
      const lang = req.query.lang === "en" ? "en" : "de";
      const content = await getDocContent(req.params.slug, lang);
      if (!content) return sendError(reply, req, 404, "not_found", "Unknown content page.");
      return reply.type("application/json").send(content);
    },
  );

  // Public, static player-facing roadmap.
  app.get("/api/v1/roadmap", async (_req, reply) => {
    return reply.type("application/json").send({ items: ROADMAP });
  });

  // Interactive API docs (Swagger UI) live in the fleetplanner-web SPA at
  // /api-docs — it renders this openapi.json directly. The backend is API-only
  // and serves no HTML/JS, so there is no /api/v1/docs route here.

  // ── session ─────────────────────────────────────────────────────────
  app.get("/api/v1/session", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const memberships = ctx ? await listUserGuilds(ctx.user.id) : [];
    return reply.type("application/json").send(presentSession(ctx, memberships));
  });

  // ── operations ──────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>("/api/v1/operations", async (req, reply) => {
    const q = OperationListQuerySchema.safeParse(req.query);
    if (!q.success) return sendError(reply, req, 400, "bad_request", "Invalid query.");
    const includePast = q.data.past;

    const ctx = await optionalAuth(req);
    if (!ctx) {
      const ops = await listPublicOperations(includePast);
      return reply
        .type("application/json")
        .send({ operations: ops.map((op: Parameters<typeof presentOperationSummary>[0]) => presentOperationSummary(op)) });
    }

    const memberships = await listUserGuilds(ctx.user.id);
    const guildIds = memberships.map((m) => m.guildId);
    const [ownOps, partnerOpLists, publicOps] = await Promise.all([
      guildIds.length ? listAllUserOperations(guildIds, includePast) : Promise.resolve([]),
      Promise.all(guildIds.map((gid) => listPartnerOperations(gid, includePast))),
      listPublicOperations(includePast),
    ]);
    type Row = Parameters<typeof presentOperationSummary>[0] & { scheduledAt: Date };
    const opById = new Map<string, Row>();
    for (const op of [...partnerOpLists.flat(), ...publicOps] as Row[]) opById.set(op.id, op);
    for (const op of ownOps as Row[]) opById.set(op.id, op);
    const ops = [...opById.values()].sort(
      (a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime(),
    );

    // Same signup-state rule as the SSR home page (joined wins over waitlist).
    const [signedSeats, signedReqs, cqbSignups, pendingShips] = await Promise.all([
      prisma.seatAssignment.findMany({
        where: { userId: ctx.user.id, active: true },
        select: { fleetUnit: { select: { operationId: true } } },
      }),
      prisma.crewAssignmentRequest.findMany({
        where: { userId: ctx.user.id },
        select: { operationId: true },
      }),
      prisma.cqbSignup.findMany({
        where: { userId: ctx.user.id, status: { not: "rejected" } },
        select: { operationId: true },
      }),
      prisma.fleetUnit.findMany({
        where: { captainId: ctx.user.id, status: "pending" },
        select: { operationId: true },
      }),
    ]);
    const state = new Map<string, "joined" | "waitlist">();
    for (const r of signedReqs) state.set(r.operationId, "waitlist");
    for (const u of pendingShips) state.set(u.operationId, "waitlist");
    for (const s of signedSeats)
      if (s.fleetUnit?.operationId) state.set(s.fleetUnit.operationId, "joined");
    for (const c of cqbSignups) state.set(c.operationId, "joined");

    return reply.type("application/json").send({
      operations: ops.map((op) => presentOperationSummary(op, state.get(op.id) ?? null)),
    });
  });

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");

    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");

    const ctx = await optionalAuth(req);
    const visibility = (op as { visibility?: string }).visibility;

    // Object-level AuthZ — mirror the SSR /ops/:id gate:
    // anonymous only for public ops; authenticated users need an effective role.
    let viewerRole: string | null = null;
    let canManage = false;
    if (!ctx) {
      if (visibility !== "public")
        return sendError(reply, req, 401, "unauthenticated", "Sign in to view this operation.");
    } else {
      viewerRole = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      // Same as SSR: no role → pretend the op does not exist (no leak).
      if (!viewerRole) return sendError(reply, req, 404, "not_found", "Operation not found.");
      canManage =
        viewerRole === "fleetoperator" ||
        (op as { createdById?: string }).createdById === ctx.user.id ||
        op.leaders.some((l: { user: { id: string } }) => l.user.id === ctx.user.id);
    }

    // getOperation() doesn't include the guild relation (SSR loads it
    // separately) — fetch the public guild fields here.
    const guild = await prisma.guild.findUnique({
      where: { id: (op as { guildId: string }).guildId },
      select: { id: true, name: true, iconHash: true, timezone: true, discordInviteUrl: true },
    });
    if (!guild) return sendError(reply, req, 404, "not_found", "Operation not found.");

    const signupState = ctx ? await signupStateFor(ctx.user.id, op.id) : null;
    // Viewer flags for the SPA's "Mitmachen" controls — both relations are
    // already loaded by getOperation(), so this is a pure in-memory check.
    const myId = ctx?.user.id;
    const cqbSignedUp =
      !!myId &&
      ((op as { cqbSignups?: Array<{ userId: string }> }).cqbSignups ?? []).some((s) => s.userId === myId);
    const hangarShared =
      !!myId &&
      ((op as { hangarShares?: Array<{ userId: string }> }).hangarShares ?? []).some((h) => h.userId === myId);
    const row = { ...op, guild } as unknown as Parameters<typeof presentOperationDetail>[0];
    return reply.type("application/json").send(
      presentOperationDetail(row, { role: viewerRole, canManage, signupState, cqbSignedUp, hangarShared }),
    );
  });

  // ── guilds ──────────────────────────────────────────────────────────
  app.get("/api/v1/guilds", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const memberships = await listUserGuilds(ctx.user.id);
    return reply.type("application/json").send({ guilds: memberships.map(presentGuild) });
  });

  // ── account: linked OAuth logins ────────────────────────────────────
  app.get("/api/v1/account", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const rows = await prisma.userIdentity.findMany({
      where: { userId: ctx.user.id },
      select: { provider: true, username: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    return reply.type("application/json").send({
      identities: rows.map((i) => ({ provider: i.provider, username: i.username, since: i.createdAt.toISOString() })),
    });
  });

  // FR-B8: user preferences. Currently the UI language (de|en); persisted on the
  // user so it follows the account across devices (session reflects it).
  app.patch<{ Body: { locale?: string; shareHangarWithOrg?: boolean } }>("/api/v1/profile", async (req, reply) => {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    const data: { locale?: string; shareHangarWithOrg?: boolean } = {};
    const locale = req.body?.locale;
    if (locale !== undefined) {
      if (locale !== "de" && locale !== "en") return sendError(reply, req, 400, "bad_request", "Invalid locale.");
      data.locale = locale;
    }
    // FR-P3: opt-in to the guild Org-Flotte roster.
    if (typeof req.body?.shareHangarWithOrg === "boolean") data.shareHangarWithOrg = req.body.shareHangarWithOrg;
    if (Object.keys(data).length === 0) return sendError(reply, req, 400, "bad_request", "No valid fields.");
    await prisma.user.update({ where: { id: ctx.user.id }, data });
    return reply.type("application/json").send({ ok: true as const });
  });

  // Guild-scoped operator gate: member with fleetoperator role in THIS guild.
  // A superadmin is NOT auto-granted — outside the admin console they need a
  // real fleetoperator membership in the guild they act on.
  async function requireGuildOperator(
    req: FastifyRequest,
    reply: FastifyReply,
    guildId: string,
  ): Promise<AuthContext | null> {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return null;
    const m = await getMembership(ctx.user.id, guildId);
    if (m?.role !== "fleetoperator") {
      await sendError(reply, req, 403, "forbidden", "Fleet operator role in that guild required.");
      return null;
    }
    return ctx;
  }

  // ── guild settings (admiral console) ─────────────────────────────────
  // GET is a read → cookie session only (no CSRF header, mirrors /operator).
  app.get<{ Params: { id: string } }>("/api/v1/guilds/:id/settings", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    {
      const m = await getMembership(ctx.user.id, p.data.id);
      if (m?.role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Fleet operator role in that guild required.");
    }
    const data = await getGuildSettingsData(p.data.id);
    if (!data) return sendError(reply, req, 404, "not_found", "Server not found.");
    const canRemove = data.guild.ownerUserId === ctx.user.id;
    return reply.type("application/json").send({
      guild: presentGuildSettings({ ...data.guild, canRemove }),
      members: data.members.map(presentGuildSettingsMember),
    });
  });

  // FR-P3: Org Fleet — guild ship roster. Restricted to "Orgamember": only members
  // with the configured Discord role (admiralRoleId → fleetoperator) may view it,
  // and the roster lists only their ships. superadmin ok. (Overrides the original
  // "all members" decision per user 2026-06-15.)
  app.get<{ Params: { id: string } }>("/api/v1/guilds/:id/fleet", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    {
      const m = await getMembership(ctx.user.id, p.data.id);
      if (m?.role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Orgamember role in that guild required.");
    }
    const rows = await getOrgFleetRows(p.data.id);
    return reply.type("application/json").send(presentOrgFleet(rows));
  });

  // FR-C2: guild text/announcement channels for the wizard "share" picker.
  app.get<{ Params: { id: string } }>("/api/v1/guilds/:id/channels", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const ctx = await requireGuildOperator(req, reply, p.data.id);
    if (!ctx) return;
    const channels = await fetchGuildTextChannels(p.data.id);
    return reply.type("application/json").send({ channels });
  });

  app.patch<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/guilds/:id/settings",
    async (req, reply) => {
      const p = GuildIdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
      const body = UpdateGuildSettingsRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireGuildOperator(req, reply, p.data.id);
      if (!ctx) return;
      const exists = await getMembership(ctx.user.id, p.data.id);
      if (!exists)
        return sendError(reply, req, 404, "not_found", "Server not found.");

      // Validate every field exactly like the SSR POST /guilds/settings handler.
      const snowflake = (v: string | null): string | null =>
        v && /^\d{16,25}$/.test(v.trim()) ? v.trim() : null;
      const inviteUrl = (v: string | null): string | null => {
        const t = (v ?? "").trim();
        if (!t) return null;
        return /^https:\/\/(discord\.gg|(www\.)?discord(app)?\.com\/invite)\/[A-Za-z0-9-]+$/.test(t)
          ? t
          : null;
      };
      const data: {
        orgName?: string | null;
        timezone?: string;
        discordInviteUrl?: string | null;
        admiralRoleId?: string | null;
      } = {};
      if (body.data.orgName !== undefined)
        data.orgName = body.data.orgName ? body.data.orgName.trim().slice(0, 80) || null : null;
      if (body.data.timezone !== undefined)
        data.timezone = isValidTimezone(body.data.timezone) ? body.data.timezone : DEFAULT_TIMEZONE;
      if (body.data.discordInviteUrl !== undefined)
        data.discordInviteUrl = inviteUrl(body.data.discordInviteUrl);
      if (body.data.admiralRoleId !== undefined)
        data.admiralRoleId = snowflake(body.data.admiralRoleId);

      await updateGuildSettings(p.data.id, data);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.put<{ Params: { id: string; userId: string }; Body: unknown }>(
    "/api/v1/guilds/:id/members/:userId/role",
    async (req, reply) => {
      const p = GuildMemberParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetMemberRoleRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid role.");
      const ctx = await requireGuildOperator(req, reply, p.data.id);
      if (!ctx) return;
      const res = await setMembershipRole(p.data.id, p.data.userId, body.data.role);
      if (res.ownerProtected)
        return sendError(reply, req, 409, "conflict", "The server owner stays a fleet operator.");
      if (!res.ok) return sendError(reply, req, 404, "not_found", "Member not found.");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── discord install diagnostics (fleet operator of that guild) ──────
  app.get<{ Params: { id: string } }>("/api/v1/guilds/:id/diagnostics", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    {
      const m = await getMembership(ctx.user.id, p.data.id);
      if (m?.role !== "fleetoperator") return sendError(reply, req, 403, "forbidden", "Fleet operator role required.");
    }
    try {
      const d = await runDiscordInstallDiagnostics(p.data.id);
      return reply.type("application/json").send({
        guild: d.guild,
        canInspectPermissions: d.canInspectPermissions,
        summary: d.summary,
        bots: d.bots.map((b) => ({
          key: b.key, name: b.name, severity: b.severity, configured: b.configured, installed: b.installed,
          username: b.username, note: b.note, inviteUrl: b.inviteUrl,
          requiredPermissions: b.requiredPermissions.map((x) => ({ key: x.key, label: x.label })),
          missingPermissions: b.missingPermissions.map((x) => ({ key: x.key, label: x.label })),
        })),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Diagnostics failed.";
      if (/not found/i.test(msg)) return sendError(reply, req, 404, "not_found", "Server not found.");
      return sendError(reply, req, 502, "internal", "Discord diagnostics unavailable.");
    }
  });

  // ── superadmin: instance guild management ────────────────────────────
  // SSR twins: web.ts /admin (+ /admin/guilds/:id/{ban,unban}). Instance
  // superadmin only — these act across all guilds, not the active one.
  async function requireSuperadmin(req: FastifyRequest, reply: FastifyReply): Promise<AuthContext | null> {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return null;
    if (ctx.user.role !== "superadmin") {
      await sendError(reply, req, 403, "forbidden", "Superadmin only.");
      return null;
    }
    return ctx;
  }

  app.get("/api/v1/admin/guilds", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (ctx.user.role !== "superadmin") return sendError(reply, req, 403, "forbidden", "Superadmin only.");
    await sweepGuildPresence().catch(() => {}); // best-effort: drop guilds whose bot was removed
    const rows = await listAllGuildsForAdmin();
    return reply.type("application/json").send({
      guilds: rows.map((g) => ({
        id: g.id,
        name: g.name,
        active: g.active,
        bannedAt: g.bannedAt ? g.bannedAt.toISOString() : null,
        ownerUserId: g.ownerUserId,
        memberCount: g.memberCount,
        eventCount: g.eventCount,
      })),
    });
  });

  for (const action of ["ban", "unban"] as const) {
    app.post<{ Params: { id: string } }>(`/api/v1/admin/guilds/:id/${action}`, async (req, reply) => {
      if (!/^\d{16,25}$/.test(req.params.id)) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
      const ctx = await requireSuperadmin(req, reply);
      if (!ctx) return;
      if (action === "ban") await banGuild(req.params.id);
      else await unbanGuild(req.params.id);
      return reply.type("application/json").send({ ok: true as const });
    });
  }

  app.get("/api/v1/admin/users", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (ctx.user.role !== "superadmin") return sendError(reply, req, 403, "forbidden", "Superadmin only.");
    const rows = await prisma.user.findMany({
      // Hide synthetic E2E test players (e2e-* usernames) from the superadmin list.
      where: { username: { not: { startsWith: "e2e-" } } },
      orderBy: { joinedAt: "asc" },
      select: {
        id: true, username: true, role: true, active: true, lastSeenAt: true,
        identities: {
          where: { provider: "discord" },
          select: { providerId: true, username: true },
          take: 1,
        },
        guildMemberships: {
          select: { role: true, guild: { select: { name: true } } },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    return reply.type("application/json").send({
      users: rows.map((u) => {
        const discord = u.identities[0] ?? null;
        return {
          id: u.id,
          username: u.username,
          role: (["superadmin", "fleetoperator", "crew"].includes(u.role) ? u.role : "crew") as "superadmin" | "fleetoperator" | "crew",
          active: u.active,
          discordId: discord?.providerId ?? null,
          discordName: discord?.username ?? null,
          guilds: u.guildMemberships.map((m) => ({ name: m.guild.name, role: m.role })),
          lastSeen: u.lastSeenAt.toISOString(),
        };
      }),
    });
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/admin/users/:id/role", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid user id.");
    const body = SetUserRoleRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid role.");
    const ctx = await requireSuperadmin(req, reply);
    if (!ctx) return;
    const role = body.data.role;
    // Guards mirror SSR /admin/users/:id/role: no self-demote, never demote the
    // last active superadmin.
    if (p.data.id === ctx.user.id && role !== "superadmin")
      return sendError(reply, req, 409, "conflict", "You cannot demote yourself.");
    if (role !== "superadmin") {
      const target = await prisma.user.findUnique({ where: { id: p.data.id }, select: { role: true } });
      if (!target) return sendError(reply, req, 404, "not_found", "User not found.");
      if (target.role === "superadmin") {
        const count = await prisma.user.count({ where: { role: "superadmin", active: true } });
        if (count <= 1) return sendError(reply, req, 409, "conflict", "Cannot demote the last active superadmin.");
      }
    }
    await prisma.user.update({ where: { id: p.data.id }, data: { role } });
    return reply.type("application/json").send({ ok: true as const });
  });

  app.post<{ Params: { id: string } }>("/api/v1/admin/users/:id/active", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid user id.");
    const ctx = await requireSuperadmin(req, reply);
    if (!ctx) return;
    const user = await prisma.user.findUnique({ where: { id: p.data.id }, select: { id: true, role: true, active: true } });
    if (!user) return sendError(reply, req, 404, "not_found", "User not found.");
    if (user.id === ctx.user.id && user.active)
      return sendError(reply, req, 409, "conflict", "You cannot disable yourself.");
    if (user.role === "superadmin" && user.active) {
      const count = await prisma.user.count({ where: { role: "superadmin", active: true } });
      if (count <= 1) return sendError(reply, req, 409, "conflict", "Cannot disable the last active superadmin.");
    }
    await prisma.user.update({ where: { id: p.data.id }, data: { active: !user.active } });
    return reply.type("application/json").send({ ok: true as const, active: !user.active });
  });

  // ── superadmin: instance settings (maintenance / feedback / catalog sync)
  // SSR twins: web.ts /admin/maintenance, /admin/feedback/config, /admin/{ships,locations}/sync.
  app.get("/api/v1/admin/settings", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (ctx.user.role !== "superadmin") return sendError(reply, req, 403, "forbidden", "Superadmin only.");
    const realOps = { guildId: { notIn: E2E_GUILD_IDS } };
    const [feedbackChannelId, ship, loc, operationCount, opsByVis] = await Promise.all([
      getSetting("feedback.discordChannelId"),
      getSyncState(),
      getLocationSyncState(),
      prisma.operation.count({ where: realOps }),
      prisma.operation.groupBy({ by: ["visibility"], where: realOps, _count: { _all: true } }),
    ]);
    const visMap = new Map(opsByVis.map((g) => [g.visibility, g._count._all]));
    return reply.type("application/json").send({
      maintenanceOn: isMaintenanceOn(),
      maintenanceForcedByEnv: isMaintenanceForcedByEnv(),
      feedbackChannelId,
      shipCatalog: {
        count: ship.shipCount,
        lastRun: ship.lastRunAt ? ship.lastRunAt.toISOString() : null,
        intervalDays: ship.intervalDays,
        running: ship.running,
      },
      locationCatalog: {
        count: loc.locationCount,
        lastRun: loc.lastRunAt ? loc.lastRunAt.toISOString() : null,
        intervalDays: loc.intervalDays,
        running: loc.running,
      },
      operationCount,
      operations: {
        total: operationCount,
        private: visMap.get("private") ?? 0,
        partners: visMap.get("partners") ?? 0,
        public: visMap.get("public") ?? 0,
      },
    });
  });

  app.post<{ Body: unknown }>("/api/v1/admin/maintenance", async (req, reply) => {
    const body = MaintenanceRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireSuperadmin(req, reply);
    if (!ctx) return;
    await setMaintenance(body.data.enabled);
    return reply.type("application/json").send({ ok: true as const, maintenanceOn: body.data.enabled });
  });

  app.put<{ Body: unknown }>("/api/v1/admin/settings/feedback", async (req, reply) => {
    const body = FeedbackChannelRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireSuperadmin(req, reply);
    if (!ctx) return;
    const channelId = body.data.channelId.trim();
    if (channelId && !/^\d{16,25}$/.test(channelId))
      return sendError(reply, req, 400, "bad_request", "Invalid Discord channel ID.");
    await setSetting("feedback.discordChannelId", channelId);
    return reply.type("application/json").send({ ok: true as const });
  });

  for (const kind of ["ships", "locations"] as const) {
    app.post(`/api/v1/admin/${kind}/sync`, async (req, reply) => {
      const ctx = await requireSuperadmin(req, reply);
      if (!ctx) return;
      const run = kind === "ships" ? runSync("manual") : runLocationSync("manual");
      run.catch((err: unknown) => req.log.error(err, `Manual ${kind} catalog sync failed (v1)`));
      return reply.type("application/json").send({ ok: true as const });
    });

    app.put<{ Body: unknown }>(`/api/v1/admin/${kind}/config`, async (req, reply) => {
      const body = CatalogConfigRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid interval.");
      const ctx = await requireSuperadmin(req, reply);
      if (!ctx) return;
      const cfg = { enabled: body.data.enabled ?? true, intervalDays: body.data.intervalDays };
      if (kind === "ships") await updateSyncConfig(cfg);
      else await updateLocationSyncConfig(cfg);
      return reply.type("application/json").send({ ok: true as const });
    });
  }

  // ── superadmin: system health + event log ("System & Logs" panel) ────
  // GET routes use optionalAuth + role check (no CSRF) — like /admin/settings.
  app.get("/api/v1/admin/system/health", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (ctx.user.role !== "superadmin") return sendError(reply, req, 403, "forbidden", "Superadmin only.");
    const health = await getSystemHealth();
    return reply.type("application/json").send(health);
  });

  app.get<{ Querystring: { level?: string; category?: string; since?: string; limit?: string } }>(
    "/api/v1/admin/system/events",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
      if (ctx.user.role !== "superadmin") return sendError(reply, req, 403, "forbidden", "Superadmin only.");
      const lvl = req.query.level;
      const level: EventLevel | undefined = lvl === "info" || lvl === "warn" || lvl === "error" ? lvl : undefined;
      const category = req.query.category ? String(req.query.category).slice(0, 60) : undefined;
      const since = req.query.since ? new Date(req.query.since) : undefined;
      const limitNum = req.query.limit ? Number(req.query.limit) : undefined;
      const events = await listSystemEvents({
        level,
        category,
        since: since && !Number.isNaN(since.getTime()) ? since : undefined,
        limit: limitNum && Number.isFinite(limitNum) ? limitNum : undefined,
      });
      return reply.type("application/json").send({ events, retentionDays: SYSTEM_EVENT_RETENTION_DAYS });
    },
  );

  // ── guild partnerships (admiral console) ─────────────────────────────
  // SSR twins: routes/partnerships.ts. Guild-scoped via :id; approve/decline
  // re-check the operator role against the distribution's own target guild.
  const snowflakeRe = /^\d{16,25}$/;
  const cuidRe = /^[a-z0-9]{20,32}$/i;

  app.get<{ Params: { id: string } }>("/api/v1/guilds/:id/partnerships", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (ctx.user.role !== "superadmin") {
      const m = await getMembership(ctx.user.id, p.data.id);
      if (m?.role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Fleet operator role required.");
    }
    const [rows, autoShare, incoming] = await Promise.all([
      listPartnerships(p.data.id),
      getAutoShareMap(p.data.id),
      listIncomingDistributions(p.data.id),
    ]);
    return reply.type("application/json").send({
      partnerships: rows.map((r) => ({
        id: r.id,
        label: r.label,
        status: r.status,
        partnerGuildId: r.partnerGuildId,
        partnerGuildName: r.partnerGuildName,
        isInitiator: r.isInitiator,
        activatedAt: r.activatedAt ? r.activatedAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
        autoShare: r.partnerGuildId ? (autoShare.get(r.partnerGuildId) ?? false) : false,
      })),
      incoming: incoming.map((d) => ({
        id: d.id,
        opId: d.opId,
        opTitle: d.opTitle,
        scheduledAt: d.scheduledAt.toISOString(),
        meetingSystem: d.meetingSystem,
        meetingLocation: d.meetingLocation,
        hostGuildName: d.hostGuildName,
        hostOrgName: d.hostOrgName,
      })),
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/guilds/:id/partnerships/invite", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const body = MintInviteRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Label required.");
    const ctx = await requireGuildOperator(req, reply, p.data.id);
    if (!ctx) return;
    const minted = await mintPartnerToken(p.data.id, body.data.label.trim(), ctx.user.id);
    return reply.type("application/json").send({ ok: true as const, token: minted.plaintext, label: minted.label });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/guilds/:id/partnerships/accept", async (req, reply) => {
    const p = GuildIdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid guild id.");
    const body = AcceptTokenRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Token required.");
    const ctx = await requireGuildOperator(req, reply, p.data.id);
    if (!ctx) return;
    const result = await acceptPartnerToken(body.data.token.trim(), p.data.id);
    if (!result.ok) {
      const msg =
        result.reason === "self_partner" ? "Cannot partner with your own Discord."
          : result.reason === "already_partners" ? "Already partnered with that Discord."
            : result.reason === "already_used" ? "This token was already used."
              : result.reason === "revoked" ? "This token was revoked."
                : "Invalid token.";
      return sendError(reply, req, 409, "conflict", msg);
    }
    return reply.type("application/json").send({ ok: true as const, label: result.label });
  });

  app.put<{ Params: { id: string; partnerGuildId: string }; Body: unknown }>(
    "/api/v1/guilds/:id/partnerships/:partnerGuildId/auto-share",
    async (req, reply) => {
      const p = GuildIdParamSchema.safeParse(req.params);
      if (!p.success || !snowflakeRe.test(req.params.partnerGuildId))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetAutoShareRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireGuildOperator(req, reply, p.data.id);
      if (!ctx) return;
      const partners = await listPartnerships(p.data.id);
      const active = partners.some((x) => x.status === "active" && x.partnerGuildId === req.params.partnerGuildId);
      if (!active) return sendError(reply, req, 404, "not_found", "Not an active partner.");
      await setAutoShare(p.data.id, req.params.partnerGuildId, body.data.autoShare);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.post<{ Params: { id: string; partnershipId: string } }>(
    "/api/v1/guilds/:id/partnerships/:partnershipId/revoke",
    async (req, reply) => {
      const p = GuildIdParamSchema.safeParse(req.params);
      if (!p.success || !cuidRe.test(req.params.partnershipId))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireGuildOperator(req, reply, p.data.id);
      if (!ctx) return;
      const ok = await revokePartnership(req.params.partnershipId, p.data.id);
      if (!ok) return sendError(reply, req, 404, "not_found", "Partnership not found.");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  for (const decision of ["approve", "decline"] as const) {
    app.post<{ Params: { id: string; eventId: string } }>(
      `/api/v1/guilds/:id/partnerships/events/:eventId/${decision}`,
      async (req, reply) => {
        const p = GuildIdParamSchema.safeParse(req.params);
        if (!p.success || !cuidRe.test(req.params.eventId))
          return sendError(reply, req, 400, "bad_request", "Invalid id.");
        const ctx = await requireGuildOperator(req, reply, p.data.id);
        if (!ctx) return;
        const result =
          decision === "approve"
            ? await approveDistribution(req.params.eventId, ctx.user.id)
            : await declineDistribution(req.params.eventId, ctx.user.id);
        if (!result.ok) {
          if (result.reason === "forbidden") return sendError(reply, req, 403, "forbidden", "Not a fleet operator of the target Discord.");
          if (result.reason === "not_pending") return sendError(reply, req, 409, "conflict", "This event was already decided.");
          if (result.reason === "post_failed") return reply.type("application/json").send({ ok: true as const, warning: "post_failed" });
          return sendError(reply, req, 404, "not_found", "Event not found.");
        }
        return reply.type("application/json").send({ ok: true as const });
      },
    );
  }

  // ── create operation ────────────────────────────────────────────────
  // Fleet operators create draft ops in a guild they manage. A superadmin is
  // NOT auto-granted — they need a real fleetoperator membership in that guild.
  app.post<{ Body: unknown }>("/api/v1/operations", async (req, reply) => {
    const body = CreateOperationRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;

    const membership = await getMembership(ctx.user.id, body.data.guildId);
    if (membership?.role !== "fleetoperator")
      return sendError(reply, req, 403, "forbidden", "Fleet operator role in that guild required.");

    const op = await createOperation(ctx.user.id, {
      guildId: body.data.guildId,
      title: body.data.title.trim(),
      opType: body.data.opType,
      description: body.data.description?.trim() || "",
      meetingSystem: body.data.meetingSystem?.trim() || "stanton",
      meetingLocation: body.data.meetingLocation?.trim() || "",
      scheduledAt: new Date(body.data.scheduledAt),
      minParticipants: body.data.minParticipants,
      // OpVisibility's TS type predates "guild"; the column/UI accept it.
      visibility: body.data.visibility as "private" | "partners" | "public",
      isStreamEvent: body.data.isStreamEvent,
    });
    await logAudit(op.id, ctx.user.id, ctx.user.username, "created", "");
    return reply.type("application/json").send({ ok: true as const, id: op.id });
  });

  // ── operation editor: lifecycle (edit / status / delete) ─────────────
  // SSR twins: web.ts /ops/:id/edit + /ops/:id/visibility, api.ts /api/ops/:id/status,
  // web.ts /ops/:id/delete. The best-effort Discord/partner side-effects are mirrored
  // here so the SPA operator never has to fall back to the SSR manage shell.

  app.patch<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = EditOperationRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;

    const d = body.data;
    await updateOperation(p.data.id, {
      ...(d.title !== undefined && { title: d.title.trim() }),
      ...(d.description !== undefined && { description: d.description }),
      ...(d.opType !== undefined && { opType: d.opType }),
      ...(d.meetingSystem !== undefined && { meetingSystem: d.meetingSystem.trim() }),
      ...(d.meetingLocation !== undefined && { meetingLocation: d.meetingLocation.trim() }),
      ...(d.scheduledAt !== undefined && { scheduledAt: new Date(d.scheduledAt) }),
      ...(d.maxParticipants !== undefined && { maxParticipants: d.maxParticipants }),
      ...(d.squadLinkVoiceEnabled !== undefined && { squadLinkVoiceEnabled: d.squadLinkVoiceEnabled }),
      ...(d.isStreamEvent !== undefined && { isStreamEvent: d.isStreamEvent }),
    });
    if (d.visibility !== undefined) {
      // OpVisibility's TS type predates "guild"; the column/UI accept it.
      await setOperationVisibility(p.data.id, d.visibility as "private" | "partners" | "public");
    }
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "edited", "");

    // Keep an already-published op's Discord + partner events in sync (best-effort).
    const updated = await getOperation(p.data.id);
    if (updated?.status === "open") {
      if (updated.discordEventId) {
        updateScheduledEvent({
          id: updated.id,
          guildId: updated.guildId,
          title: updated.title,
          description: updated.description,
          scheduledAt: updated.scheduledAt,
          eventVoiceChannelId: updated.eventVoiceChannelId,
          discordEventId: updated.discordEventId,
          opType: updated.opType,
          isStreamEvent: updated.isStreamEvent,
        }).catch((err) => req.log.warn(err, "Discord event update failed after op edit (v1)"));
      }
      if (updated.visibility === "partners" || updated.visibility === "public") {
        distributeOperation(updated).catch((err) => req.log.warn(err, "Event distribution failed after op edit (v1)"));
      }
      updateDistributedEvents(updated).catch((err) => req.log.warn(err, "Partner event sync failed after op edit (v1)"));
    }
    return reply.type("application/json").send({ ok: true as const });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/status", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = SetStatusRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid status.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;

    const previous = await prisma.operation.findUnique({ where: { id: p.data.id }, select: { status: true } });
    const newStatus = body.data.status;
    const updated = await setStatus(p.data.id, newStatus);
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, `status:${newStatus}`, previous?.status ? `von ${previous.status}` : "");

    // open → create the Discord scheduled event (once) + distribute to partners.
    if (newStatus === "open" && !updated.discordEventId) {
      const op = await getOperation(p.data.id);
      if (op) {
        try {
          const event = await createScheduledEvent(op);
          if (event?.id) await prisma.operation.update({ where: { id: p.data.id }, data: { discordEventId: event.id } });
        } catch (err) {
          req.log.warn(err, "Discord event creation failed on status open (v1, non-fatal)");
        }
        if (op.visibility === "partners" || op.visibility === "public") {
          distributeOperation(op).catch((err) => req.log.warn(err, "Event distribution failed on status open (v1)"));
        }
      }
    }
    // cancelled → tear the Discord event + distributed partner events down.
    if (newStatus === "cancelled" && updated.discordEventId) {
      deleteScheduledEvent(updated.guildId, updated.discordEventId)
        .then(() => prisma.operation.update({ where: { id: p.data.id }, data: { discordEventId: null } }))
        .catch((err) => req.log.warn(err, "Discord event deletion failed on cancel (v1)"));
    }
    if (newStatus === "cancelled") {
      deleteDistributedEvents(p.data.id).catch((err) => req.log.warn(err, "Partner event teardown failed on cancel (v1)"));
    }
    return reply.type("application/json").send({ ok: true as const, status: newStatus });
  });

  app.delete<{ Params: { id: string } }>("/api/v1/operations/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;

    const op = await prisma.operation.findUnique({ where: { id: p.data.id }, select: { guildId: true, discordEventId: true } });
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    // Tear down distributed partner events BEFORE the cascade delete (SSR twin).
    await deleteDistributedEvents(p.data.id).catch((err) => req.log.warn(err, "Partner event teardown failed before delete (v1)"));
    await deleteOperation(p.data.id);
    if (op.discordEventId) {
      deleteScheduledEvent(op.guildId, op.discordEventId).catch((err) => req.log.warn(err, "Discord event deletion failed after delete (v1)"));
    }
    return reply.type("application/json").send({ ok: true as const });
  });

  // ── operation cover (mission-cover microservice) ─────────────────────
  // The backend renders no cover HTML. The SPA cover panel calls these JSON
  // endpoints; the external editor round-trip lands on GET /ops/:id/cover/saved
  // (redirect-only, routes/cover.ts). Access = fleetoperator OR op leader.
  const COVER_FORMATS = ["16:9", "1:1", "9:16", "4:3"] as const;
  const COVER_PRESETS = ["fleet-ops", "black-ops", "exploration", "outlaw"] as const;
  const pickCoverFormat = (v: unknown): CoverFormat =>
    (COVER_FORMATS as readonly string[]).includes(v as string) ? (v as CoverFormat) : "16:9";
  const pickCoverPreset = (v: unknown): CoverPreset =>
    (COVER_PRESETS as readonly string[]).includes(v as string) ? (v as CoverPreset) : "fleet-ops";

  type CoverOp = NonNullable<Awaited<ReturnType<typeof getOperation>>>;

  function opToCoverData(op: CoverOp): CoverData {
    const env = getEnv();
    const sys = op.meetingSystem ? `SYSTEM: ${op.meetingSystem.toUpperCase()}` : "";
    const loc = op.meetingLocation ? (sys ? `${sys} // ${op.meetingLocation}` : op.meetingLocation) : sys;
    const assets = (op.units ?? [])
      .filter((u) => u.status !== "rejected")
      .slice(0, 24)
      .map((u) => ({ name: u.ship?.name ?? "Unit", role: u.captain?.username ?? undefined }));
    const when = op.scheduledAt
      ? `${new Date(op.scheduledAt).toISOString().slice(0, 16).replace("T", " ")} UTC`
      : undefined;
    return {
      title: op.title,
      objectiveText: op.description || undefined,
      location: loc || undefined,
      dateTime: when,
      assets: assets.length ? assets : undefined,
      briefingUrl: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/ops/${op.id}`,
    };
  }

  function syncCoverEventImage(guildId: string, discordEventId: string | null | undefined, url: string, req: FastifyRequest): void {
    if (!discordEventId) return;
    updateScheduledEventImage(guildId, discordEventId, url).catch((err) =>
      req.log.warn(err, "discord event cover image update failed (non-fatal, v1)"),
    );
  }

  function presentCover(c: { url: string; width: number; height: number; preset: string; format: string; updatedAt: Date } | null) {
    return c
      ? { url: c.url, width: c.width, height: c.height, preset: c.preset, format: c.format, updatedAt: c.updatedAt.toISOString() }
      : null;
  }

  // Cover-manage gate: auth (+CSRF for writes), fleetoperator OR op leader.
  async function requireCoverManager(
    req: FastifyRequest,
    reply: FastifyReply,
    opId: string,
    write: boolean,
  ): Promise<{ ctx: AuthContext; op: CoverOp } | null> {
    const ctx = write ? await requireSessionJson(req, reply) : await optionalAuth(req);
    if (!ctx) {
      if (!write) await sendError(reply, req, 401, "unauthenticated", "Sign in required.");
      return null;
    }
    const op = await getOperation(opId);
    if (!op) {
      await sendError(reply, req, 404, "not_found", "Operation not found.");
      return null;
    }
    const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    const canManage = role === "fleetoperator" || op.leaders.some((l) => l.user.id === ctx.user.id);
    if (!canManage) {
      await sendError(reply, req, 403, "forbidden", "Fleet operator role required.");
      return null;
    }
    return { ctx, op };
  }

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/cover", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const g = await requireCoverManager(req, reply, p.data.id, false);
    if (!g) return;
    const cover = await prisma.opCover.findUnique({ where: { opId: g.op.id } });
    return reply.type("application/json").send({
      serviceConfigured: coverServiceConfigured(),
      cover: presentCover(cover),
    });
  });

  app.post<{ Params: { id: string }; Body: { format?: string; preset?: string } }>(
    "/api/v1/operations/:id/cover/generate",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const g = await requireCoverManager(req, reply, p.data.id, true);
      if (!g) return;
      if (!coverServiceConfigured()) return sendError(reply, req, 503, "internal", "Cover service not configured.");
      const format = pickCoverFormat(req.body?.format);
      const preset = pickCoverPreset(req.body?.preset);
      try {
        const res = await requestCover({ opId: g.op.id, format, preset, data: opToCoverData(g.op) });
        const url = res.urls.png;
        await prisma.opCover.upsert({
          where: { opId: g.op.id },
          create: { opId: g.op.id, coverId: res.id, url, width: res.width, height: res.height, preset: res.preset, format: res.format },
          update: { coverId: res.id, url, width: res.width, height: res.height, preset: res.preset, format: res.format },
        });
        syncCoverEventImage(g.op.guildId, g.op.discordEventId, url, req);
        const cover = await prisma.opCover.findUnique({ where: { opId: g.op.id } });
        return reply.type("application/json").send({ ok: true as const, cover: presentCover(cover) });
      } catch (err) {
        req.log.error(err, "cover generate failed (v1)");
        return sendError(reply, req, 502, "internal", "Cover render failed.");
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/operations/:id/cover", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const g = await requireCoverManager(req, reply, p.data.id, true);
    if (!g) return;
    const existing = await prisma.opCover.findUnique({ where: { opId: g.op.id } });
    if (existing) {
      await deleteCover(existing.coverId).catch((err) => req.log.warn(err, "mission-cover delete failed (non-fatal, v1)"));
      await prisma.opCover.delete({ where: { opId: g.op.id } });
    }
    return reply.type("application/json").send({ ok: true as const });
  });

  // Mint a capability token + return the external editor URL; the SPA navigates
  // there. The editor redirects back to GET /ops/:id/cover/saved on save.
  app.post<{ Params: { id: string }; Body: { format?: string; preset?: string } }>(
    "/api/v1/operations/:id/cover/edit-link",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const g = await requireCoverManager(req, reply, p.data.id, true);
      if (!g) return;
      const env = getEnv();
      const secret = env.MISSIONCOVER_SERVICE_SECRET;
      if (!secret) return sendError(reply, req, 503, "internal", "Cover service not configured.");
      const baseUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
      const existing = await prisma.opCover.findUnique({ where: { opId: g.op.id } });
      const token = signCoverToken(
        {
          opId: g.op.id,
          returnUrl: `${baseUrl}/ops/${g.op.id}/cover/saved`,
          cancelUrl: `${baseUrl}/ops/${g.op.id}/manage`,
          format: pickCoverFormat(req.body?.format),
          preset: pickCoverPreset(req.body?.preset),
          data: opToCoverData(g.op),
          ...(existing ? { coverId: existing.coverId } : {}),
        },
        secret,
        1800,
      );
      const editorBase = env.MISSIONCOVER_PUBLIC_URL.replace(/\/$/, "");
      return reply.type("application/json").send({ editorUrl: `${editorBase}/edit?token=${encodeURIComponent(token)}` });
    },
  );

  // ── SquadLink Lite CommandNet deep-link ──────────────────────────────
  // Operation commanders (fleetoperator OR op leader) fetch a personalised
  // `squadlink://connect` link that joins the op's CommandNet voice room without
  // PIN/code. The link is only produced once the op has started and the feature
  // is both per-op enabled and server-configured (shared room-auth secret). Same
  // gate as the cover panel (requireCoverManager = fleetoperator | op leader).
  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/squadlink", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    // Eligible = op manager (fleetoperator | op leader) OR a user the operator
    // granted the link to (OperationVoiceRecipient). The room token is shared per
    // op, so this is purely a distribution grant, not a per-user credential.
    const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    const isManager = role === "fleetoperator" || op.leaders.some((l) => l.user.id === ctx.user.id);
    const isRecipient =
      !isManager &&
      (await prisma.operationVoiceRecipient.findUnique({
        where: { operationId_userId: { operationId: op.id, userId: ctx.user.id } },
      })) != null;
    if (!isManager && !isRecipient) return sendError(reply, req, 403, "forbidden", "Kein Zugriff auf den Sprachraum-Link.");
    const enabled = op.squadLinkVoiceEnabled === true;
    const configured = squadLinkConfigured();
    const started = op.status === "starting" || op.status === "in_progress";
    const name = ctx.user.username;
    const link =
      enabled && configured && started ? buildCommandNetLink(op.id, name, name) : null;
    return reply.type("application/json").send({
      enabled,
      configured,
      started,
      link,
      // Install link offered alongside the join link when the op enables voice.
      storeUrl: enabled ? (squadLinkStoreUrl() ?? null) : null,
    });
  });

  // ── SquadLink recipients (operator-curated grant list) ───────────────
  // The operator picks which assigned participants receive the CommandNet link.
  // Stored as a userId set per op; the link itself stays shared (one room token).
  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/voice/recipients", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const g = await requireCoverManager(req, reply, p.data.id, false);
    if (!g) return;
    const rows = await prisma.operationVoiceRecipient.findMany({ where: { operationId: g.op.id }, select: { userId: true } });
    return reply.type("application/json").send({ userIds: rows.map((r) => r.userId) });
  });

  app.put<{ Params: { id: string }; Body: { userIds?: unknown } }>(
    "/api/v1/operations/:id/voice/recipients",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const g = await requireCoverManager(req, reply, p.data.id, true);
      if (!g) return;
      const raw = Array.isArray(req.body?.userIds) ? (req.body!.userIds as unknown[]) : null;
      if (!raw) return sendError(reply, req, 400, "bad_request", "userIds[] erforderlich.");
      const ids = [...new Set(raw.filter((x): x is string => typeof x === "string" && x.length > 0 && x.length <= 64))].slice(0, 200);
      try {
        // Replace the whole set: drop anyone not in the new list, upsert the rest.
        await prisma.$transaction([
          prisma.operationVoiceRecipient.deleteMany({ where: { operationId: g.op.id, userId: { notIn: ids.length ? ids : ["__none__"] } } }),
          ...ids.map((uid) =>
            prisma.operationVoiceRecipient.upsert({
              where: { operationId_userId: { operationId: g.op.id, userId: uid } },
              create: { operationId: g.op.id, userId: uid },
              update: {},
            }),
          ),
        ]);
      } catch (err) {
        req.log.warn(err, "voice recipients update failed");
        return sendError(reply, req, 400, "bad_request", "Empfänger konnten nicht gespeichert werden.");
      }
      return reply.type("application/json").send({ ok: true as const, userIds: ids });
    },
  );

  // ── operation editor: Bedarfe / needs ────────────────────────────────
  // SSR twins: api.ts /api/ops/:id/needs/{ships,fighters,cqb} + needs/:reqId/{rename,delete}.

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/needs", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    // Any viewer with access to the op may READ what it needs (crew planning) —
    // editing the needs stays fleetoperator-only (PUT/POST routes below).
    if (!(await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id)))
      return sendError(reply, req, 403, "forbidden", "No access to this operation.");
    const needs = await getOperationNeeds(p.data.id);
    return reply.type("application/json").send(needs);
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/needs/ships", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = AddShipNeedsRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    const added = await addShipNeeds(p.data.id, body.data.shipTypes, body.data.note ?? null, body.data.name ?? null);
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "needs:ships", `+${added}`);
    return reply.type("application/json").send({ ok: true as const, added });
  });

  app.patch<{ Params: { id: string; reqId: string }; Body: unknown }>(
    "/api/v1/operations/:id/needs/:reqId",
    async (req, reply) => {
      const p = NeedParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = RenameNeedRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireFleetOperator(req, reply, p.data.id);
      if (!ctx) return;
      await renameShipNeed(p.data.id, p.data.reqId, body.data.name);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.delete<{ Params: { id: string; reqId: string } }>(
    "/api/v1/operations/:id/needs/:reqId",
    async (req, reply) => {
      const p = NeedParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireFleetOperator(req, reply, p.data.id);
      if (!ctx) return;
      await removeShipNeed(p.data.id, p.data.reqId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "needs:ship-removed", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/needs/fighters", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = SetFighterSquadsRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    await setFighterSquads(p.data.id, body.data.count);
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "needs:fighters", `${body.data.count}`);
    return reply.type("application/json").send({ ok: true as const });
  });

  app.put<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/needs/cqb", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = SetCqbTeamsRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    await setCqbTeams(p.data.id, body.data.count, body.data.size);
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "needs:cqb", `${body.data.count}x${body.data.size}`);
    return reply.type("application/json").send({ ok: true as const });
  });

  // ── operation editor: publish-as-template + stop recurrence ──────────
  // SSR twins: api.ts /api/ops/:id/publish-template, web.ts /ops/:id/recurrence/stop.

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/publish-template", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = PublishTemplateRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    const tpl = await publishTemplate({
      op,
      ownerGuildId: op.guildId,
      createdById: ctx.user.id,
      name: body.data.name?.trim() || op.title,
      summary: body.data.summary ?? "",
      visibility: body.data.visibility,
      sourceOpId: op.id,
    });
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "template_published", "");
    return reply.type("application/json").send({ ok: true as const, id: (tpl as { id: string }).id });
  });

  app.post<{ Params: { id: string }; Body: unknown }>("/api/v1/operations/:id/recurrence", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const body = SetRecurrenceRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid recurrence.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    if (op.recurrenceId) return sendError(reply, req, 409, "conflict", "Operation already has a recurring series.");
    const guild = await prisma.guild.findUnique({ where: { id: op.guildId }, select: { timezone: true } });
    await createSeriesForOp({
      op: {
        id: op.id,
        guildId: op.guildId,
        createdById: op.createdById,
        scheduledAt: op.scheduledAt,
        title: op.title,
        description: op.description,
        opType: op.opType,
        visibility: op.visibility,
        meetingSystem: op.meetingSystem,
        meetingLocation: op.meetingLocation,
        minParticipants: op.minParticipants,
        maxParticipants: op.maxParticipants,
      },
      freq: body.data.freq,
      timezone: (guild as { timezone?: string } | null)?.timezone ?? DEFAULT_TIMEZONE,
      seriesEnd: body.data.seriesEnd ? new Date(body.data.seriesEnd) : null,
      seriesCount: body.data.seriesCount ?? null,
    });
    await logAudit(p.data.id, ctx.user.id, ctx.user.username, "recurrence_created", body.data.freq);
    return reply.type("application/json").send({ ok: true as const });
  });

  app.post<{ Params: { id: string } }>("/api/v1/operations/:id/recurrence/stop", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await requireFleetOperator(req, reply, p.data.id);
    if (!ctx) return;
    const op = await prisma.operation.findUnique({ where: { id: p.data.id }, select: { recurrenceId: true } });
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    let stopped = false;
    if (op.recurrenceId) {
      await prisma.operationRecurrence.update({ where: { id: op.recurrenceId }, data: { active: false } });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "recurrence_stopped", "");
      stopped = true;
    }
    return reply.type("application/json").send({ ok: true as const, stopped });
  });

  // ── templates marketplace ───────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>("/api/v1/templates", async (req, reply) => {
    // FR-F1: this is a GET — require a session but NOT a CSRF token. The marketplace
    // list call carries no x-csrf-token header, so requireSessionJson rejected every
    // read with 403 "Invalid CSRF token." (surfaced as the marketplace error).
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const guildId = (req.query.guildId ?? "").trim();
    if (!guildId) return sendError(reply, req, 400, "bad_request", "guildId required.");
    // Must be a member of the guild whose marketplace scope is requested.
    if (!(await getMembership(ctx.user.id, guildId)))
      return sendError(reply, req, 403, "forbidden", "Not a member of that guild.");
    const rows = await listTemplatesForGuild(guildId, {
      opType: req.query.opType,
      search: req.query.q,
    });
    return reply.type("application/json").send({
      templates: rows.map((t: { id: string; name: string; summary: string | null; opType: string; visibility: string; usageCount: number; ownerGuild: { name: string; orgName: string | null } }) => ({
        id: t.id,
        name: t.name,
        summary: t.summary ?? "",
        opType: t.opType,
        visibility: t.visibility,
        usageCount: t.usageCount,
        ownerGuildName: t.ownerGuild.orgName || t.ownerGuild.name,
      })),
    });
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/templates/:id/apply",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid template id.");
      const body = ApplyTemplateRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const membership = await getMembership(ctx.user.id, body.data.guildId);
      if (membership?.role !== "fleetoperator")
        return sendError(reply, req, 403, "forbidden", "Fleet operator role in that guild required.");

      const op = await applyTemplate(p.data.id, {
        guildId: body.data.guildId,
        createdById: ctx.user.id,
        scheduledAt: new Date(body.data.scheduledAt),
        title: body.data.title?.trim() || undefined,
      });
      if (!op) return sendError(reply, req, 404, "not_found", "Template not found or not usable here.");
      await logAudit((op as { id: string }).id, ctx.user.id, ctx.user.username, "created", "from template");
      return reply.type("application/json").send({ ok: true as const, id: (op as { id: string }).id });
    },
  );

  // ── mutations (Phase 5, slice 1) ────────────────────────────────────
  // JSON-only: cookie session (401 envelope) + x-csrf-token header checked
  // against the session token (403). Curated service error messages map to
  // 404/409 — never internals. SSR form-POST routes stay untouched.

  async function requireSessionJson(
    req: FastifyRequest,
    reply: FastifyReply,
  ): Promise<AuthContext | null> {
    const ctx = await optionalAuth(req);
    if (!ctx) {
      await sendError(reply, req, 401, "unauthenticated", "Sign in required.");
      return null;
    }
    const token = req.headers["x-csrf-token"];
    if (typeof token !== "string" || token !== ctx.csrfToken) {
      await sendError(reply, req, 403, "forbidden", "Invalid CSRF token.");
      return null;
    }
    return ctx;
  }

  /** Map curated service errors to the envelope: "not found" → 404, rest 409. */
  function mutationError(reply: FastifyReply, req: FastifyRequest, err: unknown) {
    const msg = err instanceof Error ? err.message : "Conflict.";
    if (/not found/i.test(msg)) return sendError(reply, req, 404, "not_found", msg);
    if (/forbidden/i.test(msg)) return sendError(reply, req, 403, "forbidden", msg);
    return sendError(reply, req, 409, "conflict", msg);
  }

  app.post<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/claim",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      // Object-level: the seat must belong to THIS operation.
      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      // Tenant gate — same rule as the SSR claim route.
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");

      try {
        const result = await claimSeat(p.data.seatId, ctx.user.id);
        if (result.vacatedCaptainSeat) {
          await logAudit(p.data.id, ctx.user.id, ctx.user.username, "captain_left_pilot_seat", result.unitName);
          try {
            const leaders = await prisma.operationLeader.findMany({
              where: { operationId: p.data.id },
              select: { userId: true },
            });
            const msg = `⚠️ ${ctx.user.username} left the captain (pilot) seat of "${result.unitName}" — this ship may need a new captain.`;
            await Promise.all(leaders.map((l) => sendDiscordDm(l.userId, msg).catch(() => {})));
          } catch {
            /* best-effort */
          }
        }
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:claim", "");
        return reply.type("application/json").send({ ok: true as const, seatId: p.data.seatId });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/claim",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      try {
        await unclaimSeat(p.data.seatId, ctx.user.id, opRole ?? "");
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:unclaim", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb/signup",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = CqbSignupRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const op = await prisma.operation.findUnique({
        where: { id: p.data.id },
        select: { id: true, status: true },
      });
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");
      // Registration stays open while the op is live (started) — late ground
      // troops can still take a CQB seat. Only locked/completed/cancelled close it.
      if (!["open", "draft", "starting", "in_progress"].includes(op.status))
        return sendError(reply, req, 409, "conflict", "Operation is not open for registration.");

      // Direct squad join (self-service slot): validate the team belongs to the op
      // and still has an open slot (unless the caller is already in it).
      const groupId = body.data.groupId ?? null;
      if (groupId) {
        const team = await prisma.compositionGroup.findFirst({
          where: { id: groupId, operationId: p.data.id, kind: "squad" },
          select: { id: true, targetSize: true, cqbSignups: { where: { status: { not: "rejected" } }, select: { userId: true } } },
        });
        if (!team) return sendError(reply, req, 404, "not_found", "CQB squad not found.");
        const already = team.cqbSignups.some((s) => s.userId === ctx.user.id);
        if (!already && team.targetSize != null && team.cqbSignups.length >= team.targetSize)
          return sendError(reply, req, 409, "conflict", "Dieses Squad ist voll.");
      }

      await createCqbSignup(p.data.id, ctx.user.id, body.data.note?.trim() || null, groupId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb:signup", groupId ?? "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/v1/operations/:id/cqb/signup",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      await withdrawCqbSignup(p.data.id, ctx.user.id);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb:withdraw", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B5: operator places/moves a CQB soldier into a team (squad group). groupId
  // null unassigns. Object-level checks: signup + group both belong to this op.
  app.post<{ Params: { id: string; signupId: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb/:signupId/assign",
    async (req, reply) => {
      const pid = IdParamSchema.safeParse({ id: req.params.id });
      const sid = req.params.signupId;
      if (!pid.success || !/^[a-z0-9]{20,32}$/i.test(sid))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignCqbRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, pid.data.id);
      if (!ctx) return;

      const signup = await prisma.cqbSignup.findFirst({
        where: { id: sid, operationId: pid.data.id },
        select: { id: true },
      });
      if (!signup) return sendError(reply, req, 404, "not_found", "CQB signup not found.");
      if (body.data.groupId) {
        const group = await prisma.compositionGroup.findFirst({
          where: { id: body.data.groupId, operationId: pid.data.id, kind: { in: ["squad", "fighter_squad", "formation"] } },
          select: { id: true },
        });
        if (!group) return sendError(reply, req, 404, "not_found", "Team not found.");
      }
      await prisma.cqbSignup.update({
        where: { id: sid },
        data: { assignedGroupId: body.data.groupId, status: "accepted" },
      });
      await logAudit(pid.data.id, ctx.user.id, ctx.user.username, "cqb:assign", body.data.groupId ?? "unassigned");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // #5: operator adds ANY person (guild member or ship-seat occupant) to a CQB
  // team — creates their CQB signup if none exists. No capacity gate; a person
  // can be both a ship's crew AND a member of the team that ship carries.
  app.post<{ Params: { id: string; groupId: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb-teams/:groupId/members",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(req.params.groupId))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AddCqbMemberRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const group = await prisma.compositionGroup.findFirst({
        where: { id: req.params.groupId, operationId: p.data.id, kind: { in: ["squad", "fighter_squad", "formation"] } },
        select: { id: true },
      });
      if (!group) return sendError(reply, req, 404, "not_found", "Team not found.");
      const user = await prisma.user.findUnique({ where: { id: body.data.userId }, select: { id: true } });
      if (!user) return sendError(reply, req, 404, "not_found", "User not found.");
      await placeCqbMember(p.data.id, body.data.userId, req.params.groupId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb:add-member", req.params.groupId);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // #1 Late-arrival ("nachkommen"): set/clear an ETA on a unit, a seat, or a CQB/
  // pilot signup. Editable by the person themselves OR an operator. eta=null clears.
  app.patch<{ Params: { id: string; unitId: string }; Body: unknown }>(
    "/api/v1/operations/:id/units/:unitId/late-arrival",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetLateArrivalRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid time (HH:MM).");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const owner = await unitOwner(p.data.id, p.data.unitId);
      if (owner === null) return sendError(reply, req, 404, "not_found", "Unit not found.");
      const isOp = await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id);
      if (owner !== ctx.user.id && !isOp) return sendError(reply, req, 403, "forbidden", "Nur der Captain oder ein Operator.");
      await setUnitLateEta(p.data.unitId, body.data.eta);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "late:unit", body.data.eta ?? "clear");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.patch<{ Params: { id: string; seatId: string }; Body: unknown }>(
    "/api/v1/operations/:id/seats/:seatId/late-arrival",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetLateArrivalRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid time (HH:MM).");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const owner = await seatOwner(p.data.id, p.data.seatId);
      if (owner === undefined) return sendError(reply, req, 404, "not_found", "Seat not found.");
      const isOp = await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id);
      if (owner !== ctx.user.id && !isOp) return sendError(reply, req, 403, "forbidden", "Nur der Sitz-Inhaber oder ein Operator.");
      await setSeatLateEta(p.data.seatId, body.data.eta);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "late:seat", body.data.eta ?? "clear");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.patch<{ Params: { id: string; signupId: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb/:signupId/late-arrival",
    async (req, reply) => {
      const pid = IdParamSchema.safeParse({ id: req.params.id });
      if (!pid.success || !/^[a-z0-9]{20,32}$/i.test(req.params.signupId))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetLateArrivalRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid time (HH:MM).");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const owner = await cqbOwner(pid.data.id, req.params.signupId);
      if (owner === null) return sendError(reply, req, 404, "not_found", "Signup not found.");
      const isOp = await canApproveUnits(ctx.user.id, ctx.user.role, pid.data.id);
      if (owner !== ctx.user.id && !isOp) return sendError(reply, req, 403, "forbidden", "Nur die Person selbst oder ein Operator.");
      await setCqbLateEta(req.params.signupId, body.data.eta);
      await logAudit(pid.data.id, ctx.user.id, ctx.user.username, "late:cqb", body.data.eta ?? "clear");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B6: rename a CQB squad ("CQB Team 1" → "Alpha Squad").
  app.patch<{ Params: { id: string; groupId: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb-teams/:groupId",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(req.params.groupId))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = FormationRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      await renameCqbSquad(p.data.id, req.params.groupId, body.data.name);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb_team:rename", body.data.name);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B3: embed a CQB team (squad group) into a carrier ship — "rides in <ship>".
  // carrierUnitId null = standalone. Carrier must be a ship in this op.
  app.put<{ Params: { id: string; groupId: string }; Body: unknown }>(
    "/api/v1/operations/:id/cqb-teams/:groupId/carrier",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      const gid = req.params.groupId;
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(gid))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignCarrierRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const team = await prisma.compositionGroup.findFirst({
        where: { id: gid, operationId: p.data.id, kind: "squad" },
        select: { id: true },
      });
      if (!team) return sendError(reply, req, 404, "not_found", "CQB team not found.");
      if (body.data.carrierUnitId) {
        const carrier = await prisma.fleetUnit.findFirst({
          where: { id: body.data.carrierUnitId, operationId: p.data.id, unitType: "ship" },
          select: { id: true },
        });
        if (!carrier) return sendError(reply, req, 404, "not_found", "Carrier ship not found.");
      }
      await prisma.compositionGroup.update({
        where: { id: gid },
        data: { carrierUnitId: body.data.carrierUnitId },
      });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "cqb_team:carrier", body.data.carrierUnitId ?? "detach");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B2: operator formations (Verbände). Operator-gated. The service enforces
  // ship-only membership and op ownership.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/formations",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = FormationRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const f = await createFormation(p.data.id, body.data.name);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "formation:create", body.data.name);
      return reply.type("application/json").send({ ok: true as const, id: f.id });
    },
  );

  app.patch<{ Params: { id: string; fid: string }; Body: unknown }>(
    "/api/v1/operations/:id/formations/:fid",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(req.params.fid))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = FormationRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      await renameFormation(p.data.id, req.params.fid, body.data.name);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "formation:rename", body.data.name);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.delete<{ Params: { id: string; fid: string } }>(
    "/api/v1/operations/:id/formations/:fid",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(req.params.fid))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      await deleteFormation(p.data.id, req.params.fid);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "formation:delete", req.params.fid);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // Roster-Fundament: hang a Staffel/Trupp under a Verband (parentId null =
  // detach). One level deep — the service rejects nesting a Verband that already
  // has children or a parent.
  app.put<{ Params: { id: string; gid: string }; Body: unknown }>(
    "/api/v1/operations/:id/groups/:gid/parent",
    async (req, reply) => {
      const p = IdParamSchema.safeParse({ id: req.params.id });
      if (!p.success || !/^[a-z0-9]{20,32}$/i.test(req.params.gid))
        return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = SetGroupParentRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const r = await setGroupParent(p.data.id, req.params.gid, body.data.parentId);
      if (!r.ok) {
        const status = r.reason === "too_deep" || r.reason === "self" ? 409 : 404;
        return sendError(reply, req, status, status === 409 ? "conflict" : "not_found", r.reason ?? "Failed.");
      }
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "group:parent", body.data.parentId ?? "detach");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // Roster-Fundament: move a member to an explicit slot inside its group.
  // Slot 0 is the Captain, so this is also "make X the Staffel-/Trupp-Captain".
  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/member-slot",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = SetMemberSlotRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const r = await setMemberSlot(
        p.data.id,
        { kind: body.data.memberKind, id: body.data.memberId },
        body.data.slot,
      );
      if (!r.ok) return sendError(reply, req, 404, "not_found", r.reason ?? "Member not found.");
      await logAudit(
        p.data.id,
        ctx.user.id,
        ctx.user.username,
        body.data.slot === 0 ? "group:captain" : "group:slot",
        `${body.data.memberKind}:${body.data.memberId} → Slot ${body.data.slot}`,
      );
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.put<{ Params: { id: string; unitId: string }; Body: unknown }>(
    "/api/v1/operations/:id/units/:unitId/formation",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignFormationRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const res = await assignUnitToFormation(p.data.id, p.data.unitId, body.data.formationId);
      if (!res.ok) {
        if (res.reason === "only_ships") return sendError(reply, req, 409, "conflict", "Only ships can join a formation.");
        return sendError(reply, req, 404, "not_found", "Unit or formation not found.");
      }
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "formation:assign", body.data.formationId ?? "detach");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // Operator backfill: distribute all already-accepted, squad-less fighters into
  // the first squad with a free slot (same rule as accept-time auto-fill).
  app.post<{ Params: { id: string } }>(
    "/api/v1/operations/:id/fighter-squads/auto-fill",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const placed = await autoFillAllFighters(p.data.id);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "fighter:auto-fill", String(placed));
      return reply.type("application/json").send({ ok: true as const, placed });
    },
  );

  // FR-B4: load a ground vehicle OR a Jäger into a carrier ship (carrierUnitId
  // null = detach). The carried unit inherits the carrier's accept/reject status.
  // A real cargo-bay/hangar fit-check needs Fleetyards bay data we don't model yet
  // → this validates the structural rules only: the carried unit is a vehicle or a
  // fighter, the carrier is a non-fighter ship in this op, and nothing carries itself.
  app.put<{ Params: { id: string; unitId: string }; Body: unknown }>(
    "/api/v1/operations/:id/units/:unitId/carrier",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignCarrierRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: p.data.unitId, operationId: p.data.id, unitType: { in: ["vehicle", "ship"] } },
        select: { id: true, unitType: true, roleOverride: true, ship: { select: { size: true, career: true, role: true } } },
      });
      if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");
      if (body.data.carrierUnitId === p.data.unitId)
        return sendError(reply, req, 409, "conflict", "A unit can't carry itself.");
      // Only vehicles and Jäger are loadable. Without this a capital ship could be
      // stuffed into another ship — registerUnit already forbids that at creation.
      if (unit.unitType === "ship" && effectiveShipClass(unit) !== "Fighter")
        return sendError(reply, req, 409, "conflict", "Only vehicles and fighters can be loaded into a ship.");

      if (body.data.carrierUnitId) {
        const carrier = await prisma.fleetUnit.findFirst({
          where: { id: body.data.carrierUnitId, operationId: p.data.id, unitType: "ship" },
          select: { status: true, unitType: true, roleOverride: true, ship: { select: { size: true, career: true, role: true } } },
        });
        if (!carrier) return sendError(reply, req, 404, "not_found", "Carrier ship not found.");
        if (effectiveShipClass(carrier) === "Fighter")
          return sendError(reply, req, 409, "conflict", "A fighter can't carry anything.");
        await prisma.fleetUnit.update({
          where: { id: p.data.unitId },
          data: { carrierUnitId: body.data.carrierUnitId, status: carrier.status },
        });
      } else {
        await prisma.fleetUnit.update({ where: { id: p.data.unitId }, data: { carrierUnitId: null } });
      }
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "carrier:assign", body.data.carrierUnitId ?? "detach");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-C2: post an op announcement (title, time, link) to a Discord text channel.
  // One-shot share chosen at create time; operator-gated on the op.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/announce",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = AnnounceRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid channel id.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;
      const op = await getOperation(p.data.id);
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const o = op as { title: string; scheduledAt: Date; meetingSystem: string; meetingLocation: string };
      // Channel must belong to this op's guild (operator could otherwise target any id).
      const channels = await fetchGuildTextChannels((op as { guildId: string }).guildId);
      if (!channels.some((c) => c.id === body.data.channelId))
        return sendError(reply, req, 404, "not_found", "Channel not found in this server.");
      const env = getEnv();
      const url = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${p.data.id}`;
      const when = o.scheduledAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
      const where = [o.meetingSystem, o.meetingLocation].filter(Boolean).join(" · ");
      const content = `📡 **${o.title}**\n🕒 ${when}${where ? `\n📍 ${where}` : ""}\n🔗 ${url}`;
      try {
        await sendDiscordChannelMessage(body.data.channelId, content);
      } catch {
        return sendError(reply, req, 502, "internal", "Discord post failed.");
      }
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "announce", body.data.channelId);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.put<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/hangar-share",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = HangarShareRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");

      await setHangarShare(p.data.id, ctx.user.id, {
        allow: body.data.allow,
        note: body.data.note ?? null,
      });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "hangar:share", body.data.allow ? "allow" : "deny");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── mutations (Phase 5, slice 2): units + resource-links ───────────

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/units",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = RegisterUnitRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const op = await prisma.operation.findUnique({
        where: { id: p.data.id },
        select: { id: true, status: true },
      });
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");
      if (op.status !== "open" && op.status !== "draft")
        return sendError(reply, req, 409, "conflict", "Operation is not open for registration.");

      const d = body.data;
      try {
        // Same validation chain as the SSR /api/ops/:id/units route.
        const isShipLike = d.unitType === "ship" || d.unitType === "vehicle";
        const selectedShipId = isShipLike ? (d.shipId ?? d.ownedShipId) : undefined;
        if (isShipLike && !selectedShipId)
          throw new Error(d.unitType === "vehicle" ? "Select a vehicle" : "Select or search a ship");
        if (d.unitType === "vehicle" && !d.carrierUnitId)
          throw new Error("A vehicle must be carried by a ship");
        if (d.unitType === "squad") {
          if (!d.squadSize) throw new Error("Squad size must be between 2 and 8");
          if (!d.squadName) throw new Error("Squad name required");
          await assertUniqueSquadName(p.data.id, d.squadName);
        }
        await assertRequirementFitsUnit(p.data.id, d.requirementId, d.unitType, selectedShipId);
        if (isShipLike && selectedShipId && d.storeOwnedShip) {
          await prisma.userShip.upsert({
            where: { userId_shipId: { userId: ctx.user.id, shipId: selectedShipId } },
            create: { userId: ctx.user.id, shipId: selectedShipId },
            update: {},
          });
        }
        const unit = await registerUnit(p.data.id, ctx.user.id, {
          unitType: d.unitType,
          shipId: selectedShipId,
          squadName: d.squadName,
          squadSize: d.squadSize,
          requirementId: d.requirementId,
          captainNote: d.captainNote,
          carrierUnitId: d.unitType === "vehicle" ? d.carrierUnitId : undefined,
          roleOverride: d.roleOverride,
        });
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:register", d.unitType);
        return reply
          .type("application/json")
          .send({ ok: true as const, unitId: (unit as { id: string }).id });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.patch<{ Params: { id: string; unitId: string }; Body: unknown }>(
    "/api/v1/operations/:id/units/:unitId",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = PatchUnitRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: p.data.unitId, operationId: p.data.id },
        include: { operation: { select: { status: true, leaders: { select: { userId: true } } } } },
      });
      if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");
      if (unit.operation.status === "completed" || unit.operation.status === "cancelled")
        return sendError(reply, req, 409, "conflict", "Closed operations cannot be edited.");

      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      const canEdit =
        unit.captainId === ctx.user.id ||
        role === "fleetoperator" ||
        unit.operation.leaders.some((l) => l.userId === ctx.user.id);
      if (!canEdit) return sendError(reply, req, 403, "forbidden", "Forbidden.");

      try {
        if (body.data.squadName !== undefined && body.data.squadName !== unit.squadName) {
          if (unit.unitType !== "squad")
            return sendError(reply, req, 409, "conflict", "Only squads can be renamed here.");
          await assertUniqueSquadName(p.data.id, body.data.squadName);
        }
        // Rebind to a different Fleet Requirement (Bedarf). null detaches. The
        // category↔unit fit is a hint (assert only blocks wrong-op / full slots).
        if (body.data.requirementId) {
          await assertRequirementFitsUnit(p.data.id, body.data.requirementId, unit.unitType, unit.shipId ?? undefined, unit.id);
        }
        await prisma.fleetUnit.update({
          where: { id: p.data.unitId },
          data: {
            ...(body.data.captainNote !== undefined
              ? { captainNote: body.data.captainNote?.trim() || null }
              : {}),
            ...(body.data.squadName !== undefined ? { squadName: body.data.squadName } : {}),
            ...(body.data.requirementId !== undefined ? { requirementId: body.data.requirementId } : {}),
            ...(body.data.roleOverride !== undefined ? { roleOverride: body.data.roleOverride } : {}),
          },
        });
        // A role change moves the unit between board lanes and changes what it can
        // do (squadron slot, carrier), so it gets its own audit line.
        if (body.data.roleOverride !== undefined && body.data.roleOverride !== unit.roleOverride) {
          await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:role", body.data.roleOverride ?? "Katalog-Vorgabe");
        }
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:edit", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; unitId: string } }>(
    "/api/v1/operations/:id/units/:unitId",
    async (req, reply) => {
      const p = UnitParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      const unit = await prisma.fleetUnit.findFirst({
        where: { id: p.data.unitId, operationId: p.data.id },
        select: { id: true },
      });
      if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");

      // Effective guild role for THIS op (not the global instance role): a guild
      // fleetoperator can force-delete; a superadmin only if operator of this guild.
      const opRole = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      try {
        await deleteUnit(p.data.unitId, ctx.user.id, opRole ?? "");
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "unit:delete", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/resource-links",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = ResourceLinkRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;

      // Any op manager (operator/creator/leader) may curate links.
      if (!(await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id)))
        return sendError(reply, req, 403, "forbidden", "Operator, creator or commander role required.");

      const link = await addResourceLink(p.data.id, ctx.user.id, {
        url: body.data.url,
        title: body.data.title ?? null,
        kind: body.data.kind ?? null,
      });
      if (!link)
        return sendError(reply, req, 409, "conflict", "Invalid URL or link limit reached.");
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "resource_link:add", link.url);
      return reply.type("application/json").send({
        ok: true as const,
        link: { id: link.id, title: link.title, url: link.url, kind: link.kind, sortOrder: link.sortOrder },
      });
    },
  );

  app.delete<{ Params: { id: string; linkId: string } }>(
    "/api/v1/operations/:id/resource-links/:linkId",
    async (req, reply) => {
      const p = LinkParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      if (!(await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id)))
        return sendError(reply, req, 403, "forbidden", "Operator, creator or commander role required.");
      await removeResourceLink(p.data.id, p.data.linkId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "resource_link:remove", p.data.linkId);
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── FR-P3 Phase B: streamer links (self-service) ───────────────────
  // Add: any user with op access (member / partner / public viewer). The entry is
  // attributed to them. Remove: the entry owner OR an op manager (moderation).
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/streams",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = AddStreamRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      // Any viewer with access to the op may add their own stream.
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, p.data.id);
      if (!role) return sendError(reply, req, 403, "forbidden", "No access to this operation.");

      const stream = await addStream(p.data.id, ctx.user.id, {
        platform: body.data.platform,
        url: body.data.url,
        label: body.data.label ?? null,
      });
      if (!stream)
        return sendError(reply, req, 409, "conflict", "Invalid URL for the platform or stream limit reached.");
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "stream:add", stream.url);
      return reply.type("application/json").send({
        ok: true as const,
        stream: {
          id: stream.id,
          platform: stream.platform as "twitch" | "youtube" | "vdo_ninja" | "other",
          url: stream.url,
          label: stream.label,
          userId: stream.userId,
          username: stream.user?.username ?? null,
        },
      });
    },
  );

  app.delete<{ Params: { id: string; streamId: string } }>(
    "/api/v1/operations/:id/streams/:streamId",
    async (req, reply) => {
      const id = req.params.id;
      const streamId = req.params.streamId;
      if (!id || !streamId) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const owner = await streamOwner(id, streamId);
      if (owner === undefined) return reply.type("application/json").send({ ok: true as const }); // already gone
      const isOwner = owner !== null && owner === ctx.user.id;
      const canModerate = await canApproveUnits(ctx.user.id, ctx.user.role, id);
      if (!isOwner && !canModerate)
        return sendError(reply, req, 403, "forbidden", "Only the owner or an operator can remove this stream.");
      await removeStream(id, streamId);
      await logAudit(id, ctx.user.id, ctx.user.username, "stream:remove", streamId);
      return reply.type("application/json").send({ ok: true as const });
    },
  );


  // ── operator (read model + mutations; canManage-gated) ─────────────

  async function requireOperator(
    req: FastifyRequest,
    reply: FastifyReply,
    opId: string,
  ): Promise<AuthContext | null> {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return null;
    if (!(await canApproveUnits(ctx.user.id, ctx.user.role, opId))) {
      await sendError(reply, req, 403, "forbidden", "Operator role required.");
      return null;
    }
    return ctx;
  }

  app.get<{ Params: { id: string } }>("/api/v1/operations/:id/operator", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    if (!(await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id)))
      return sendError(reply, req, 403, "forbidden", "Operator role required.");

    const op = await getOperation(p.data.id);
    if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
    const shares = await listSharedHangars(p.data.id);
    // Fleet requirements (Bedarfe) for the accept-bind dropdown + rebind control.
    const reqRows = await prisma.compositionRequirement.findMany({
      where: { group: { operationId: p.data.id } },
      select: {
        id: true, label: true, needType: true, category: true, count: true,
        fleetUnits: { select: { status: true } },
      },
      orderBy: { order: "asc" },
    });
    const o = op as {
      crewRequests: Array<{ user: { id: string; username: string }; note: string | null; createdAt: Date }>;
      questions: Array<{ id: string; asker: string; body: string; answer: string | null; answeredBy: string | null; createdAt: Date }>;
      auditLogs: Array<{ actor: string; action: string; detail: string; createdAt: Date }>;
      eventInterests: Array<{ id: string; displayName: string; userId: string | null }>;
      units: Array<{ seats: Array<{ userId: string | null }> }>;
      groups: Array<{ id: string; name: string; kind: string; targetSize: number | null; carrierUnitId: string | null; parentId: string | null }>;
      cqbSignups: Array<{ id: string; userId: string; status: string; note: string | null; assignedGroupId: string | null; slotIndex: number | null; lateEta: string | null; user: { username: string } }>;
    };
    // userIds already holding a seat in this op → mark interested users "seated".
    const seatedUserIds = new Set(
      o.units.flatMap((u) => u.seats.map((s) => s.userId).filter((x): x is string => !!x)),
    );
    const view: OperatorView = {
      crewRequests: o.crewRequests.map((r) => ({
        userId: r.user.id,
        username: r.user.username,
        note: r.note,
        createdAt: r.createdAt.toISOString(),
      })),
      questions: o.questions.map((q) => ({
        id: q.id,
        asker: q.asker,
        body: q.body,
        answer: q.answer,
        answeredBy: q.answeredBy,
        createdAt: q.createdAt.toISOString(),
      })),
      hangarShares: shares.map((s) => ({
        userId: s.userId,
        username: s.username,
        note: s.note,
        ships: s.ships,
      })),
      auditLogs: o.auditLogs.map((a) => ({
        actor: a.actor,
        action: a.action,
        detail: a.detail,
        createdAt: a.createdAt.toISOString(),
      })),
      requirements: reqRows.map((r) => ({
        id: r.id,
        label: r.label,
        needType: r.needType ?? "ship",
        category: r.category,
        count: r.count,
        filled: r.fleetUnits.filter((u) => u.status !== "rejected").length,
      })),
      eventInterests: o.eventInterests.map((e) => ({
        id: e.id,
        displayName: e.displayName,
        userId: e.userId,
        seated: e.userId ? seatedUserIds.has(e.userId) : false,
      })),
      cqbTeams: o.groups
        .filter((g) => g.kind === "squad")
        .map((g) => ({ id: g.id, name: g.name, targetSize: g.targetSize, carrierUnitId: g.carrierUnitId, parentId: g.parentId })),
      cqbSoldiers: o.cqbSignups
        .filter((s) => s.status !== "rejected")
        .map((s) => ({
          id: s.id,
          username: s.user.username,
          assignedGroupId: s.assignedGroupId,
          slotIndex: s.slotIndex,
          note: s.note,
          lateEta: s.lateEta,
        })),
      formations: o.groups
        .filter((g) => g.kind === "formation")
        .map((g) => ({ id: g.id, name: g.name })),
      fighterSquads: o.groups
        .filter((g) => g.kind === "fighter_squad")
        .map((g) => ({ id: g.id, name: g.name, targetSize: g.targetSize, parentId: g.parentId })),
      assignablePeople: await assignablePeople(p.data.id),
    };
    return reply.type("application/json").send(view);
  });

  for (const decision of ["accept", "reject"] as const) {
    app.post<{ Params: { id: string; unitId: string }; Body: unknown }>(
      `/api/v1/operations/:id/units/:unitId/${decision}`,
      async (req, reply) => {
        const p = UnitParamSchema.safeParse(req.params);
        if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
        const body = UnitDecisionRequestSchema.safeParse(req.body ?? {});
        if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
        const ctx = await requireOperator(req, reply, p.data.id);
        if (!ctx) return;

        const unit = await prisma.fleetUnit.findFirst({
          where: { id: p.data.unitId, operationId: p.data.id },
          select: { id: true, unitType: true, shipId: true },
        });
        if (!unit) return sendError(reply, req, 404, "not_found", "Unit not found.");

        try {
          await setUnitStatus(p.data.unitId, decision === "accept" ? "accepted" : "rejected", body.data.note);
          // Accept-into-slot parity with the SSR route: a full/mismatched slot
          // is skipped, the unit stays accepted but unslotted.
          if (decision === "accept" && body.data.requirementId) {
            try {
              await assertRequirementFitsUnit(p.data.id, body.data.requirementId, unit.unitType, unit.shipId ?? undefined, unit.id);
              await prisma.fleetUnit.update({
                where: { id: unit.id },
                data: { requirementId: body.data.requirementId },
              });
            } catch {
              /* accept unslotted */
            }
          }
          await logAudit(p.data.id, ctx.user.id, ctx.user.username, `unit:${decision}`, "");
          return reply.type("application/json").send({ ok: true as const });
        } catch (err) {
          return mutationError(reply, req, err);
        }
      },
    );
  }

  app.put<{ Params: { id: string; seatId: string }; Body: unknown }>(
    "/api/v1/operations/:id/seats/:seatId/assignment",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AssignSeatRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");

      try {
        await assignSeat(p.data.seatId, body.data.userId);
        // Parity with the SSR assign route: clear the flexible request and
        // notify the player via DM (best-effort).
        await prisma.crewAssignmentRequest.deleteMany({
          where: { operationId: p.data.id, userId: body.data.userId },
        });
        const assigned = await prisma.seatAssignment.findUnique({
          where: { id: p.data.seatId },
          include: { fleetUnit: { include: { ship: true, captain: true, operation: { select: { id: true, title: true } } } } },
        });
        if (assigned) {
          const env = getEnv();
          const unitName =
            assigned.fleetUnit.unitType === "ship"
              ? (assigned.fleetUnit.ship?.name ?? "Unknown Ship")
              : (assigned.fleetUnit.squadName ?? "Squad");
          sendSeatAssignmentDm(body.data.userId, {
            operationTitle: assigned.fleetUnit.operation.title,
            operationUrl: `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH}/ops/${assigned.fleetUnit.operation.id}`,
            unitName,
            captainName: assigned.fleetUnit.captain.username,
            seatLabel: assigned.label,
          }).catch((err) => req.log.warn(err, "Seat assignment DM failed"));
        }
        await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:assign", "");
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string; seatId: string } }>(
    "/api/v1/operations/:id/seats/:seatId/assignment",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { order: true, fleetUnit: { select: { operationId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id)
        return sendError(reply, req, 404, "not_found", "Seat not found.");
      // The captain seat (order 0) can't be vacated — that would orphan the unit.
      if (seat.order === 0)
        return sendError(reply, req, 409, "conflict", "Cannot free the captain seat.");

      await prisma.seatAssignment.update({ where: { id: p.data.seatId }, data: { userId: null } });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:unassign", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B1: operator edits a seat — activate/deactivate (e.g. "only fill 6 of 9")
  // and/or rename (custom label). Schema already carries active + label.
  app.patch<{ Params: { id: string; seatId: string }; Body: { active?: boolean; label?: string } }>(
    "/api/v1/operations/:id/seats/:seatId",
    async (req, reply) => {
      const p = SeatParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const seat = await prisma.seatAssignment.findUnique({
        where: { id: p.data.seatId },
        select: { id: true, fleetUnit: { select: { operationId: true, captainId: true } } },
      });
      if (!seat || seat.fleetUnit.operationId !== p.data.id) return sendError(reply, req, 404, "not_found", "Seat not found.");
      // Operators/leaders OR the unit's own captain (the player who offered the
      // ship) may rename/activate/deactivate its seats.
      const isCaptain = seat.fleetUnit.captainId === ctx.user.id;
      if (!isCaptain && !(await canApproveUnits(ctx.user.id, ctx.user.role, p.data.id)))
        return sendError(reply, req, 403, "forbidden", "Operator role or unit captain required.");
      const data: { active?: boolean; label?: string } = {};
      if (typeof req.body?.active === "boolean") data.active = req.body.active;
      if (typeof req.body?.label === "string") {
        const l = req.body.label.trim().slice(0, 80);
        if (l) data.label = l;
      }
      if (Object.keys(data).length === 0) return sendError(reply, req, 400, "bad_request", "Nichts zu ändern.");
      await prisma.seatAssignment.update({ where: { id: p.data.seatId }, data });
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "seat:edit", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // FR-B7: a participant/viewer asks a question (the answer side already exists).
  app.post<{ Params: { id: string }; Body: { body?: string } }>(
    "/api/v1/operations/:id/questions",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const text = String(req.body?.body ?? "").trim();
      if (!text || text.length > 1000) return sendError(reply, req, 400, "bad_request", "Frage erforderlich (max. 1000 Zeichen).");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      const op = await getOperation(p.data.id);
      if (!op) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      const visible = role !== null || (op as { visibility?: string }).visibility === "public";
      if (!visible) return sendError(reply, req, 404, "not_found", "Operation not found.");
      const q = await prisma.opQuestion.create({
        data: { operationId: op.id, askerId: ctx.user.id, asker: ctx.user.username, body: text },
      });
      await logAudit(op.id, ctx.user.id, ctx.user.username, "question:ask", "");
      return reply.type("application/json").send({ ok: true as const, id: q.id });
    },
  );

  app.post<{ Params: { id: string; qid: string }; Body: unknown }>(
    "/api/v1/operations/:id/questions/:qid/answer",
    async (req, reply) => {
      const p = QuestionParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const body = AnswerQuestionRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireOperator(req, reply, p.data.id);
      if (!ctx) return;

      const result = await prisma.opQuestion.updateMany({
        where: { id: p.data.qid, operationId: p.data.id },
        data: { answer: body.data.answer.trim(), answeredBy: ctx.user.username, answeredAt: new Date() },
      });
      if (result.count === 0) return sendError(reply, req, 404, "not_found", "Question not found.");
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "answer", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // Leadership — stricter than the other operator mutations: only the
  // fleetoperator may appoint/remove leaders (leaders can't self-appoint).
  // Parity with the SSR requireOpRole("fleetoperator") gate.
  // Op management gate. Per the role model all op-level roles share the same
  // rights — operator/superadmin, the op creator (Event Manager) and appointed
  // leaders (Raid Leiter / Wing Commander) — so this mirrors requireOperator.
  async function requireFleetOperator(req: FastifyRequest, reply: FastifyReply, opId: string): Promise<AuthContext | null> {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return null;
    if (!(await canApproveUnits(ctx.user.id, ctx.user.role, opId))) {
      await sendError(reply, req, 403, "forbidden", "Operator, creator or commander role required.");
      return null;
    }
    return ctx;
  }

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/operations/:id/leaders",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid operation id.");
      const body = AssignSeatRequestSchema.safeParse(req.body); // { userId }
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireFleetOperator(req, reply, p.data.id);
      if (!ctx) return;

      const user = await prisma.user.findUnique({ where: { id: body.data.userId }, select: { id: true, active: true } });
      if (!user || !user.active) return sendError(reply, req, 404, "not_found", "User not found or inactive.");
      await addLeader(p.data.id, body.data.userId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "leader:add", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  app.delete<{ Params: { id: string; userId: string } }>(
    "/api/v1/operations/:id/leaders/:userId",
    async (req, reply) => {
      const p = LeaderParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid id.");
      const ctx = await requireFleetOperator(req, reply, p.data.id);
      if (!ctx) return;
      await removeLeader(p.data.id, p.data.userId);
      await logAudit(p.data.id, ctx.user.id, ctx.user.username, "leader:remove", "");
      return reply.type("application/json").send({ ok: true as const });
    },
  );

  // ── hangar ──────────────────────────────────────────────────────────
  // The caller's own ships (UserShip → Ship), for the "offer own ship" flow.
  app.get("/api/v1/hangar", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const rows = await prisma.userShip.findMany({
      where: { userId: ctx.user.id },
      include: { ship: true },
      orderBy: { ship: { name: "asc" } },
    });
    return reply
      .type("application/json")
      .send({ ships: rows.map((r) => ({ ...presentShip(r.ship), nickname: r.nickname })) });
  });

  app.post<{ Body: unknown }>("/api/v1/hangar", async (req, reply) => {
    const body = HangarShipRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid ship id.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    const ship = await prisma.ship.findUnique({ where: { id: body.data.shipId }, select: { id: true } });
    if (!ship) return sendError(reply, req, 404, "not_found", "Ship not found.");
    await prisma.userShip.upsert({
      where: { userId_shipId: { userId: ctx.user.id, shipId: body.data.shipId } },
      create: { userId: ctx.user.id, shipId: body.data.shipId },
      update: {},
    });
    return reply.type("application/json").send({ ok: true as const });
  });

  app.delete<{ Params: { shipId: string } }>("/api/v1/hangar/:shipId", async (req, reply) => {
    const p = HangarShipParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid ship id.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    await prisma.userShip.deleteMany({ where: { userId: ctx.user.id, shipId: p.data.shipId } });
    return reply.type("application/json").send({ ok: true as const });
  });

  // Bulk-import owned ships from a CCU-Game JSON export (SSR twin:
  // web.ts /profile/fleet-import). Unmatched names are returned for manual
  // resolution; no image/attachment handling.
  app.post<{ Body: unknown }>("/api/v1/hangar/import", async (req, reply) => {
    const body = FleetImportRequestSchema.safeParse(req.body);
    if (!body.success) return sendError(reply, req, 400, "bad_request", "fleetJson required.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    try {
      const r = await importUserFleet(ctx.user.id, body.data.fleetJson.slice(0, 200000));
      return reply.type("application/json").send({
        ok: true as const,
        total: r.total,
        added: r.added,
        already: r.already,
        unmatched: r.unmatched,
      });
    } catch (err) {
      return sendError(reply, req, 400, "bad_request", err instanceof Error ? err.message : "Import failed.");
    }
  });

  // ── feedback ────────────────────────────────────────────────────────
  // Signed-in users send a subject + message (plus optional image screenshots)
  // to the configured Discord feedback channel. Accepts either JSON (no files)
  // or multipart/form-data with `screenshots` file parts. CSRF is the
  // x-csrf-token header (requireSessionJson), so it works for both encodings.
  app.post<{ Body: unknown }>("/api/v1/feedback", async (req, reply) => {
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;

    const ALLOWED_IMAGE = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
    let subject = "";
    let message = "";
    const attachments: DiscordAttachment[] = [];

    if (req.isMultipart()) {
      try {
        for await (const part of req.parts()) {
          if (part.type === "file") {
            if (part.fieldname !== "screenshots") {
              part.file.resume(); // drain unknown file parts
              continue;
            }
            const buf = await part.toBuffer(); // throws if over the plugin fileSize limit
            if (buf.length === 0) continue; // empty file input
            if (!ALLOWED_IMAGE.has(part.mimetype))
              return sendError(reply, req, 400, "bad_request", "Only PNG, JPG, GIF or WebP images are allowed.");
            const safeName = (part.filename || `screenshot-${attachments.length + 1}`)
              .replace(/[^A-Za-z0-9._-]/g, "_")
              .slice(0, 80);
            attachments.push({ filename: safeName, contentType: part.mimetype, data: buf });
          } else if (part.fieldname === "subject") {
            subject = typeof part.value === "string" ? part.value : "";
          } else if (part.fieldname === "message") {
            message = typeof part.value === "string" ? part.value : "";
          }
        }
      } catch {
        return sendError(reply, req, 400, "bad_request", "An image was too large (max 8 MB each).");
      }
    } else {
      const body = FeedbackRequestSchema.safeParse(req.body);
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Subject and message required.");
      subject = body.data.subject;
      message = body.data.message;
    }

    subject = subject.trim().slice(0, 120);
    message = message.trim().slice(0, 1800);
    if (!subject || !message) return sendError(reply, req, 400, "bad_request", "Subject and message required.");

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
      return reply.type("application/json").send({ ok: true as const });
    } catch (err) {
      return sendError(reply, req, 409, "conflict", err instanceof Error ? err.message : "Feedback could not be sent.");
    }
  });

  // ── ships ───────────────────────────────────────────────────────────
  app.get<{ Querystring: Record<string, string> }>("/api/v1/ships/search", async (req, reply) => {
    const q = ShipSearchQuerySchema.safeParse(req.query);
    if (!q.success) return sendError(reply, req, 400, "bad_request", "Invalid query.");
    const ships = await searchLocalShips(q.data.q, q.data.limit);
    return reply.type("application/json").send({ ships: ships.map(presentShip) });
  });

  // Rendezvous autocomplete: manmade locations from the synced catalog, optionally
  // scoped to a system. Used by the op editor's "Ort / Rendezvous" field.
  app.get<{ Querystring: { q?: string; system?: string } }>("/api/v1/locations/search", async (req, reply) => {
    const ctx = await optionalAuth(req);
    if (!ctx) return sendError(reply, req, 401, "unauthenticated", "Sign in required.");
    const q = String(req.query.q ?? "").slice(0, 80);
    const sys = req.query.system
      ? String(req.query.system).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : undefined;
    const rows = await searchLocations(sys, q, 30, true);
    return reply.type("application/json").send({ locations: rows.map((l) => ({ name: l.name, system: l.system })) });
  });

  // ── polls / Umfragen (FR-P3) ──────────────────────────────────────────
  // Reads use optionalAuth (public polls visible to anyone; private/partners
  // gated in the service). Mutations require a CSRF session.
  app.get("/api/v1/polls", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const polls = await listPollsForViewer(ctx ? { id: ctx.user.id, role: ctx.user.role } : null);
    return reply.type("application/json").send({ polls });
  });

  app.get<{ Params: { id: string } }>("/api/v1/polls/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
    const ctx = await optionalAuth(req);
    const viewer = ctx ? { id: ctx.user.id, role: ctx.user.role } : null;
    if (!ctx) {
      // Anonymous may only view public polls — let the service decide; a null
      // result with no auth means "sign in".
      const poll = await getPollForViewer(p.data.id, null);
      if (!poll) return sendError(reply, req, 401, "unauthenticated", "Sign in to view this poll.");
      return reply.type("application/json").send(poll);
    }
    const poll = await getPollForViewer(p.data.id, viewer);
    if (!poll) return sendError(reply, req, 404, "not_found", "Poll not found.");
    return reply.type("application/json").send(poll);
  });

  app.post<{ Body: unknown }>("/api/v1/polls", async (req, reply) => {
    const body = CreatePollRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    try {
      const id = await createPoll({ id: ctx.user.id, role: ctx.user.role }, body.data);
      return reply.code(201).type("application/json").send({ ok: true as const, id });
    } catch (err) {
      return mutationError(reply, req, err);
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/polls/:id/vote",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
      const body = VotePollRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      try {
        await votePoll({ id: ctx.user.id, role: ctx.user.role }, p.data.id, body.data.optionIds);
        return reply.type("application/json").send({ ok: true as const });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  app.delete<{ Params: { id: string } }>("/api/v1/polls/:id/vote", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    try {
      await withdrawVote({ id: ctx.user.id, role: ctx.user.role }, p.data.id);
      return reply.type("application/json").send({ ok: true as const });
    } catch (err) {
      return mutationError(reply, req, err);
    }
  });

  app.post<{ Params: { id: string }; Body: unknown }>(
    "/api/v1/polls/:id/options",
    async (req, reply) => {
      const p = IdParamSchema.safeParse(req.params);
      if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
      const body = AddPollOptionRequestSchema.safeParse(req.body ?? {});
      if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
      const ctx = await requireSessionJson(req, reply);
      if (!ctx) return;
      try {
        const id = await addPollOption({ id: ctx.user.id, role: ctx.user.role }, p.data.id, body.data.label);
        return reply.code(201).type("application/json").send({ ok: true as const, id });
      } catch (err) {
        return mutationError(reply, req, err);
      }
    },
  );

  // Edit a poll (title/description/status/closesAt/options/…) — creator / fleet
  // operator. Closing is just `{ status: "closed" }`; option edits are rejected
  // once voting has started (service guard).
  app.patch<{ Params: { id: string }; Body: unknown }>("/api/v1/polls/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
    const body = UpdatePollRequestSchema.safeParse(req.body ?? {});
    if (!body.success) return sendError(reply, req, 400, "bad_request", "Invalid body.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    try {
      await updatePoll({ id: ctx.user.id, role: ctx.user.role }, p.data.id, body.data);
      return reply.type("application/json").send({ ok: true as const });
    } catch (err) {
      return mutationError(reply, req, err);
    }
  });

  app.delete<{ Params: { id: string } }>("/api/v1/polls/:id", async (req, reply) => {
    const p = IdParamSchema.safeParse(req.params);
    if (!p.success) return sendError(reply, req, 400, "bad_request", "Invalid poll id.");
    const ctx = await requireSessionJson(req, reply);
    if (!ctx) return;
    try {
      await deletePoll({ id: ctx.user.id, role: ctx.user.role }, p.data.id);
      return reply.type("application/json").send({ ok: true as const });
    } catch (err) {
      return mutationError(reply, req, err);
    }
  });

  // ── JSON error envelope for unhandled errors inside /api/v1 ────────
  // Plugin-scoped: applies only to routes registered in this plugin, the SSR
  // error pages elsewhere stay untouched. No stack traces / prisma details
  // ever reach the client (FR-P2 §Fehler).
  app.setErrorHandler((err, req, reply) => {
    req.log.error({ err, requestId: req.id }, "api v1 error");
    // Framework 4xx (body parse, payload too large, …) keep their status as a
    // bad_request envelope; everything else is an opaque 500.
    const sc = (err as { statusCode?: unknown }).statusCode;
    const status = typeof sc === "number" && sc >= 400 && sc < 500 ? sc : 500;
    const body: ApiError = {
      error: {
        code: status === 500 ? "internal" : "bad_request",
        message: status === 500 ? "Internal error." : "Invalid request.",
        requestId: req.id,
      },
    };
    reply.code(status).type("application/json").send(body);
  });
}
