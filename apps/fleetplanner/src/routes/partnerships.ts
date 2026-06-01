import type { FastifyInstance, FastifyReply } from "fastify";
import { basePath, getEnv } from "../config/env.js";
import { requireGuildRole } from "../auth/middleware.js";
import {
  listPartnerships,
  mintPartnerToken,
  acceptPartnerToken,
  revokePartnership,
} from "../services/partnerships.js";
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
            partnerGuildName: p.partnerGuildName,
            isInitiator: p.isInitiator,
            activatedAt: p.activatedAt,
            createdAt: p.createdAt,
          })),
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
