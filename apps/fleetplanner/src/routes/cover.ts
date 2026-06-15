import type { FastifyInstance } from "fastify";
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { getOperation } from "../services/operations.js";
import { basePath, getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { verifyCoverToken } from "../services/coverToken.js";
import { updateScheduledEventImage } from "../services/discord.js";

// API-only backend: the cover management UI and its actions live in the SPA
// (cover panel) and /api/v1 (status/generate/delete/edit-link). This router
// keeps ONLY the editor save callback: the external mission-cover editor
// redirects the operator's browser here with a signed result token; we verify
// it, persist the cover pointer, then redirect back to the SPA. It renders no
// HTML (redirect-only), so it belongs to the API-only backend.

type ResultToken = {
  opId: string;
  coverId: string;
  url: string;
  width: number;
  height: number;
  preset: string;
  format: string;
};

// Cover image URLs may only be https (in prod) and on an allowlisted host —
// the mission-cover public host or the app's own public host.
function coverUrlOk(u: unknown): boolean {
  if (typeof u !== "string") return false;
  try {
    const url = new URL(u);
    const env = getEnv();
    const prod = env.NODE_ENV === "production";
    if (prod && url.protocol !== "https:") return false;
    if (!prod && url.protocol !== "https:" && url.protocol !== "http:") return false;
    const allowed = new Set([new URL(env.MISSIONCOVER_PUBLIC_URL).host, new URL(env.WEB_PUBLIC_URL).host]);
    return allowed.has(url.host);
  } catch {
    return false;
  }
}
function dimsOk(w: unknown, h: unknown): boolean {
  return [w, h].every((n) => Number.isInteger(n) && (n as number) > 0 && (n as number) <= 5000);
}
function formatOk(f: unknown): boolean {
  return typeof f === "string" && ["png", "jpg", "jpeg", "webp"].includes(f.toLowerCase());
}

export async function coverRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { id: string }; Querystring: { ct?: string } }>(
    "/ops/:id/cover/saved",
    async (req, reply) => {
      const back = (flash: string) => basePath(`/ops/${req.params.id}/manage?tab=cover&flash=${flash}`);
      const ctx = await optionalAuth(req);
      if (!ctx) return reply.redirect(basePath("/login"), 302);
      const op = await getOperation(req.params.id);
      if (!op) return reply.redirect(basePath("/"), 302);
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      const canManage = role === "fleetoperator" || op.leaders.some((l) => l.user.id === ctx.user.id);
      if (!canManage) return reply.redirect(basePath(`/ops/${op.id}`), 302);

      const secret = getEnv().MISSIONCOVER_SERVICE_SECRET;
      const payload = secret && req.query.ct ? verifyCoverToken<ResultToken>(req.query.ct, secret) : null;
      if (!payload || payload.opId !== op.id) {
        return reply.redirect(back("error:Invalid+save+token."), 302);
      }

      // Defense-in-depth: even though the token is HMAC-signed by the cover
      // service, validate the URL (https + allowlisted host) and shape before we
      // persist it / hand it to Discord as an event image.
      if (!coverUrlOk(payload.url) || !dimsOk(payload.width, payload.height) || !formatOk(payload.format)) {
        req.log.warn({ url: payload.url }, "cover save rejected: invalid url/shape");
        return reply.redirect(back("error:Invalid+cover+result."), 302);
      }

      const data = {
        coverId: payload.coverId,
        url: payload.url,
        width: payload.width,
        height: payload.height,
        preset: payload.preset,
        format: payload.format,
      };
      await prisma.opCover.upsert({
        where: { opId: op.id },
        create: { opId: op.id, ...data },
        update: data,
      });
      if (op.discordEventId) {
        updateScheduledEventImage(op.guildId, op.discordEventId, payload.url).catch((err) =>
          req.log.warn(err, "discord event cover image update failed (non-fatal)"),
        );
      }
      return reply.redirect(back("ok:Cover+gespeichert."), 302);
    },
  );
}
