import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { getOperation } from "../services/operations.js";
import { basePath, getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { rawHtml } from "../web/render.js";
import { coverPage } from "../web/coverPage.js";
import { errorPage, loginRequiredPage } from "../web/pages.js";
import {
  requestCover,
  coverServiceConfigured,
  type CoverData,
  type CoverFormat,
  type CoverPreset,
} from "../services/coverService.js";
import { signCoverToken, verifyCoverToken } from "../services/coverToken.js";
import { updateScheduledEventImage } from "../services/discord.js";

type Op = NonNullable<Awaited<ReturnType<typeof getOperation>>>;
type AuthCtx = NonNullable<Awaited<ReturnType<typeof optionalAuth>>>;

const FORMATS: CoverFormat[] = ["16:9", "1:1", "9:16", "4:3"];
const PRESETS: CoverPreset[] = ["fleet-ops", "black-ops", "exploration", "outlaw"];

function htmlReply(reply: FastifyReply, page: import("../web/render.js").SafeHtml) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
}

function csrfOk(body: Record<string, unknown>, csrfToken: string): boolean {
  return typeof body._csrf === "string" && body._csrf === csrfToken;
}

function parseFlash(raw?: string): { kind: "ok" | "warn" | "error"; text: string } | null {
  if (!raw) return null;
  const i = raw.indexOf(":");
  const kind = i >= 0 ? raw.slice(0, i) : "ok";
  const text = decodeURIComponent((i >= 0 ? raw.slice(i + 1) : raw).replace(/\+/g, " "));
  return { kind: kind === "warn" || kind === "error" ? kind : "ok", text };
}

function pickFormat(raw: unknown): CoverFormat {
  return FORMATS.includes(raw as CoverFormat) ? (raw as CoverFormat) : "16:9";
}
function pickPreset(raw: unknown): CoverPreset {
  return PRESETS.includes(raw as CoverPreset) ? (raw as CoverPreset) : "fleet-ops";
}

function canManageOp(op: Op, ctx: AuthCtx, role: string | null): boolean {
  return role === "fleetoperator" || op.leaders.some((l) => l.user.id === ctx.user.id);
}

// Op fields → cover payload for the render service.
function opToCoverData(op: Op): CoverData {
  const env = getEnv();
  const sys = op.meetingSystem ? `SYSTEM: ${op.meetingSystem.toUpperCase()}` : "";
  const loc = op.meetingLocation ? (sys ? `${sys} // ${op.meetingLocation}` : op.meetingLocation) : sys;
  const assets = (op.units ?? [])
    .filter((u) => u.status !== "rejected")
    .slice(0, 24)
    .map((u) => ({
      name: u.ship?.name ?? "Unit",
      role: u.captain?.username ?? undefined,
    }));
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

export async function coverRoutes(app: FastifyInstance): Promise<void> {
  // ── Cover management page (operator-only) ──────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { flash?: string; format?: string; preset?: string } }>(
    "/ops/:id/cover",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (!ctx) {
        reply.code(401);
        return htmlReply(reply, loginRequiredPage({ basePath: basePath() }));
      }
      const op = await getOperation(req.params.id);
      if (!op) {
        return htmlReply(
          reply,
          errorPage({ basePath: basePath(), currentUser: ctx.user, status: 404, message: "Operation not found" }),
        );
      }
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role || !canManageOp(op, ctx, role)) {
        return reply.redirect(basePath(`/ops/${op.id}`), 302);
      }
      const cover = await prisma.opCover.findUnique({ where: { opId: op.id } });
      reply.header("Cache-Control", "no-store");
      return htmlReply(
        reply,
        coverPage({
          basePath: basePath(),
          currentUser: ctx.user,
          csrfToken: ctx.csrfToken,
          flash: parseFlash(req.query.flash),
          op: { id: op.id, title: op.title },
          cover,
          serviceConfigured: coverServiceConfigured(),
          format: pickFormat(req.query.format),
          preset: pickPreset(req.query.preset),
        }),
      );
    },
  );

  // ── Generate from op data (operator-only) ──────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cover",
    async (req, reply) => {
      const ctx = await guardManage(req, reply);
      if (!ctx) return;
      const { op } = ctx;
      if (!csrfOk(req.body, ctx.auth.csrfToken)) return reply.code(403).send({ error: "csrf" });
      if (!coverServiceConfigured()) {
        return reply.redirect(coverUrl(op.id, "error:Cover-Service+nicht+konfiguriert."), 302);
      }
      const format = pickFormat(req.body.format);
      const preset = pickPreset(req.body.preset);
      try {
        const res = await requestCover({ opId: op.id, format, preset, data: opToCoverData(op) });
        await upsertCover(op.id, res);
        syncDiscordEventImage(op.guildId, op.discordEventId, res.url, req);
        return reply.redirect(coverUrl(op.id, "ok:Cover+erstellt."), 302);
      } catch (err) {
        req.log.error(err, "cover generate failed");
        return reply.redirect(coverUrl(op.id, "error:Cover-Render+fehlgeschlagen."), 302);
      }
    },
  );

  // ── Remove the cover (operator-only) ───────────────────────────────────────
  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/api/ops/:id/cover/delete",
    async (req, reply) => {
      const ctx = await guardManage(req, reply);
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.auth.csrfToken)) return reply.code(403).send({ error: "csrf" });
      await prisma.opCover.deleteMany({ where: { opId: ctx.op.id } });
      return reply.redirect(coverUrl(ctx.op.id, "ok:Cover+entfernt."), 302);
    },
  );

  // ── Open the editor: mint a token, redirect to the service ─────────────────
  app.get<{ Params: { id: string }; Querystring: { format?: string; preset?: string } }>(
    "/ops/:id/cover/edit",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (!ctx) {
        reply.code(401);
        return htmlReply(reply, loginRequiredPage({ basePath: basePath() }));
      }
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/"), 302);
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role || !canManageOp(op, ctx, role)) return reply.redirect(basePath(`/ops/${op.id}`), 302);

      const env = getEnv();
      const secret = env.MISSIONCOVER_SERVICE_SECRET;
      if (!secret) return reply.redirect(coverUrl(op.id, "error:Cover-Service+nicht+konfiguriert."), 302);

      const returnUrl = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}/ops/${op.id}/cover/saved`;
      const token = signCoverToken(
        {
          opId: op.id,
          returnUrl,
          format: pickFormat(req.query.format),
          preset: pickPreset(req.query.preset),
          data: opToCoverData(op),
        },
        secret,
        1800,
      );
      const editorBase = env.MISSIONCOVER_PUBLIC_URL.replace(/\/$/, "");
      return reply.redirect(`${editorBase}/edit?token=${encodeURIComponent(token)}`, 302);
    },
  );

  // ── Editor save callback: verify result token, persist OpCover ─────────────
  app.get<{ Params: { id: string }; Querystring: { ct?: string } }>(
    "/ops/:id/cover/saved",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      if (!ctx) {
        reply.code(401);
        return htmlReply(reply, loginRequiredPage({ basePath: basePath() }));
      }
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/"), 302);
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role || !canManageOp(op, ctx, role)) return reply.redirect(basePath(`/ops/${op.id}`), 302);

      const secret = getEnv().MISSIONCOVER_SERVICE_SECRET;
      const payload = secret && req.query.ct ? verifyCoverToken<ResultToken>(req.query.ct, secret) : null;
      if (!payload || payload.opId !== op.id) {
        return reply.redirect(coverUrl(op.id, "error:Ungültiger+Speicher-Token."), 302);
      }
      await upsertCover(op.id, {
        id: payload.coverId,
        url: payload.url,
        width: payload.width,
        height: payload.height,
        preset: payload.preset,
        format: payload.format,
      });
      syncDiscordEventImage(op.guildId, op.discordEventId, payload.url, req);
      return reply.redirect(coverUrl(op.id, "ok:Cover+gespeichert."), 302);
    },
  );

  // Shared guard for the POST actions: auth + op-manage role.
  async function guardManage(
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply,
  ): Promise<{ auth: AuthCtx; op: Op } | null> {
    const ctx = await optionalAuth(req);
    if (!ctx) {
      reply.code(401).send({ error: "unauthorized" });
      return null;
    }
    const op = await getOperation(req.params.id);
    if (!op) {
      reply.code(404).send({ error: "not_found" });
      return null;
    }
    const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
    if (!role || !canManageOp(op, ctx, role)) {
      reply.code(403).send({ error: "forbidden" });
      return null;
    }
    return { auth: ctx, op };
  }
}

type ResultToken = {
  opId: string;
  coverId: string;
  url: string;
  width: number;
  height: number;
  preset: string;
  format: string;
};

function coverUrl(opId: string, flash: string): string {
  return basePath(`/ops/${opId}/cover?flash=${flash}`);
}

// Fire-and-forget: update the Discord scheduled event's cover image when one exists.
function syncDiscordEventImage(
  guildId: string,
  discordEventId: string | null | undefined,
  url: string,
  req: FastifyRequest,
): void {
  if (!discordEventId) return;
  updateScheduledEventImage(guildId, discordEventId, url).catch((err) =>
    req.log.warn(err, "discord event cover image update failed (non-fatal)"),
  );
}

async function upsertCover(
  opId: string,
  res: { id: string; url: string; width: number; height: number; preset: string; format: string },
): Promise<void> {
  const data = {
    coverId: res.id,
    url: res.url,
    width: res.width,
    height: res.height,
    preset: res.preset,
    format: res.format,
  };
  await prisma.opCover.upsert({
    where: { opId },
    create: { opId, ...data },
    update: data,
  });
}
