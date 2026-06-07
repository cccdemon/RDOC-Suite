import type { FastifyInstance, FastifyReply } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import { requireGuildRole } from "../auth/middleware.js";
import {
  listPartnerships,
  mintPartnerToken,
  acceptPartnerToken,
  revokePartnership,
} from "../services/partnerships.js";
import {
  getAutoShareMap,
  setAutoShare,
  listIncomingDistributions,
  approveDistribution,
  declineDistribution,
} from "../services/eventDistribution.js";
import { rawHtml, partnershipsPage } from "../web/pages.js";

function htmlReply(reply: FastifyReply, page: import("../web/render.js").SafeHtml) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
}

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

export async function partnershipRoutes(app: FastifyInstance) {
  // ── Partnerships page (fleetoperator of the active guild) ──────────
  app.get<{ Querystring: { flash?: string; invite?: string; fresh?: string } }>(
    "/guilds/partnerships",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      const rows = await listPartnerships(gctx.guildId);
      const autoShare = await getAutoShareMap(gctx.guildId);
      const incoming = await listIncomingDistributions(gctx.guildId);
      const env = getEnv();
      const origin = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
      htmlReply(
        reply,
        partnershipsPage({
          basePath: basePath(),
          currentUser: gctx.user,
          csrfToken: gctx.csrfToken,
          flash: req.query.flash,
          activeGuildId: gctx.guildId,
          activeGuildName: gctx.guildName,
          partnerships: rows.map((p) => ({
            id: p.id,
            label: p.label,
            status: p.status,
            partnerGuildId: p.partnerGuildId,
            partnerGuildName: p.partnerGuildName,
            isInitiator: p.isInitiator,
            activatedAt: p.activatedAt,
            createdAt: p.createdAt,
            autoShare: p.partnerGuildId ? (autoShare.get(p.partnerGuildId) ?? false) : false,
          })),
          incoming,
          freshInviteUrl: req.query.fresh
            ? `${origin}/guilds/partnerships?invite=${encodeURIComponent(req.query.fresh)}`
            : undefined,
          prefillToken: req.query.invite,
        }),
      );
    },
  );

  // ── Mint a partner invite token ────────────────────────────────────
  app.post<{ Body: Record<string, string> }>(
    "/guilds/partnerships/invite",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const label = req.body.label?.trim().slice(0, 80) ?? "";
      if (!label) {
        return reply.redirect(basePath("/guilds/partnerships?flash=error:Label+required."), 302);
      }
      const minted = await mintPartnerToken(gctx.guildId, label, gctx.user.id);
      return reply.redirect(
        basePath(`/guilds/partnerships?fresh=${encodeURIComponent(minted.plaintext)}`),
        302,
      );
    },
  );

  // ── Accept a partner invite token ──────────────────────────────────
  app.post<{ Body: Record<string, string> }>(
    "/guilds/partnerships/accept",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const token = req.body.token?.trim() ?? "";
      if (!token) {
        return reply.redirect(basePath("/guilds/partnerships?flash=error:Token+required."), 302);
      }
      const result = await acceptPartnerToken(token, gctx.guildId);
      if (!result.ok) {
        const msg =
          result.reason === "self_partner"
            ? "Cannot+partner+with+your+own+Discord."
            : result.reason === "already_partners"
              ? "Already+partnered+with+that+Discord."
              : result.reason === "already_used"
                ? "This+token+was+already+used."
                : result.reason === "revoked"
                  ? "This+token+was+revoked."
                  : "Invalid+token.";
        return reply.redirect(basePath(`/guilds/partnerships?flash=error:${msg}`), 302);
      }
      return reply.redirect(
        basePath(`/guilds/partnerships?flash=ok:${encodeURIComponent(`Partnered with ${result.label}.`)}`),
        302,
      );
    },
  );

  // ── Toggle auto-share for a partner's events (FR-P1) ───────────────
  // Directional: ownerGuildId = the viewing guild, partnerGuildId = the other
  // side. When on, the partner's ops auto-post into our Discord with no
  // per-event approval. Only valid for an active partner of this guild.
  app.post<{ Params: { partnerGuildId: string }; Body: Record<string, string> }>(
    "/guilds/partnerships/:partnerGuildId/auto-share",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const partners = await listPartnerships(gctx.guildId);
      const isActivePartner = partners.some(
        (p) => p.status === "active" && p.partnerGuildId === req.params.partnerGuildId,
      );
      if (!isActivePartner) {
        return reply.redirect(
          basePath("/guilds/partnerships?flash=error:Not+an+active+partner."),
          302,
        );
      }
      const autoShare = req.body.autoShare === "1";
      await setAutoShare(gctx.guildId, req.params.partnerGuildId, autoShare);
      return reply.redirect(
        basePath(
          `/guilds/partnerships?flash=ok:${autoShare ? "Auto-share+enabled." : "Auto-share+disabled."}`,
        ),
        302,
      );
    },
  );

  // ── Approve / decline an incoming shared event (FR-P1 Phase 2) ──────
  // Web inbox = source of truth. Any fleetoperator of the target guild may
  // decide; approveDistribution re-checks the role against the distribution's
  // own targetGuildId, so the active-guild context can't be used to decide for
  // another guild.
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/guilds/partnerships/event/:id/approve",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const result = await approveDistribution(req.params.id, gctx.user.id);
      const flash = result.ok
        ? "ok:Event+shared+to+your+Discord."
        : result.reason === "forbidden"
          ? "error:You+are+not+a+fleetoperator+of+the+target+Discord."
          : result.reason === "not_pending"
            ? "error:This+event+was+already+decided."
            : result.reason === "post_failed"
              ? "error:Approved,+but+the+Discord+event+post+failed."
              : "error:Event+not+found.";
      return reply.redirect(basePath(`/guilds/partnerships?flash=${flash}`), 302);
    },
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/guilds/partnerships/event/:id/decline",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const result = await declineDistribution(req.params.id, gctx.user.id);
      const flash = result.ok
        ? "ok:Event+declined."
        : result.reason === "forbidden"
          ? "error:You+are+not+a+fleetoperator+of+the+target+Discord."
          : result.reason === "not_pending"
            ? "error:This+event+was+already+decided."
            : "error:Event+not+found.";
      return reply.redirect(basePath(`/guilds/partnerships?flash=${flash}`), 302);
    },
  );

  // ── Revoke / withdraw a partnership ────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/guilds/partnerships/:id/revoke",
    async (req, reply) => {
      const gctx = await requireGuildRole(req, reply, "fleetoperator");
      if (!gctx) return;
      if (!csrfOk(req.body, gctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const ok = await revokePartnership(req.params.id, gctx.guildId);
      const flash = ok ? "ok:Partnership+revoked." : "error:Partnership+not+found.";
      return reply.redirect(basePath(`/guilds/partnerships?flash=${flash}`), 302);
    },
  );
}
