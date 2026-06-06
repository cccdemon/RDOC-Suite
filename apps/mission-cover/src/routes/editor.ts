import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { getEnv } from "../config/env.js";
import { signToken, verifyToken } from "../services/token.js";
import { buildEditorHtml } from "../services/editor.js";
import { buildEngineConfig, type EngineConfig } from "../services/prefill.js";
import { renderEngineConfig } from "../services/render.js";
import { newId, saveCover } from "../services/store.js";
import { coverDataSchema, coverFormatSchema, presetSchema, type CoverMeta } from "../schema.js";

// Token minted by the fleetplanner to open the editor for an op.
const startTokenSchema = z.object({
  opId: z.string().min(1).max(64),
  returnUrl: z.string().url(),
  format: coverFormatSchema,
  preset: presetSchema,
  data: coverDataSchema,
  exp: z.number(),
});

const saveBodySchema = z.object({
  token: z.string().min(1),
  config: z.string().min(2), // engine config JSON (from localStorage)
  bg: z.string().nullable().optional(),
});

function pngUrl(id: string): string {
  return `${getEnv().MISSIONCOVER_PUBLIC_URL.replace(/\/$/, "")}/covers/${id}.png`;
}

function errorHtml(msg: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Mission Cover</title></head>
<body style="font-family:system-ui,sans-serif;background:#020814;color:#e2e8f0;padding:40px">
<h1>Mission Cover Editor</h1><p>${msg}</p></body></html>`;
}

export function registerEditorRoutes(app: FastifyInstance): void {
  // ── Serve the prefilled editor (public path, token-gated) ───────────────────
  app.get<{ Querystring: { token?: string } }>("/edit", async (req, reply) => {
    const secret = getEnv().MISSIONCOVER_SERVICE_SECRET;
    const payload = req.query.token ? verifyToken(req.query.token, secret) : null;
    const parsed = payload ? startTokenSchema.safeParse(payload) : null;
    if (!parsed || !parsed.success) {
      reply.code(403).header("content-type", "text/html; charset=utf-8");
      return reply.send(errorHtml("Invalid or expired editor link."));
    }
    const t = parsed.data;
    const config: EngineConfig = buildEngineConfig({
      opId: t.opId,
      format: t.format,
      preset: t.preset,
      data: t.data,
    });
    const html = await buildEditorHtml({
      config,
      bg: t.data.backgroundImage ?? null,
      saveUrl: `${getEnv().MISSIONCOVER_PUBLIC_URL.replace(/\/$/, "")}/edit/save`,
      token: req.query.token as string,
      returnUrl: t.returnUrl,
      opTitle: t.data.title,
    });
    reply.header("content-type", "text/html; charset=utf-8");
    reply.header("cache-control", "no-store");
    return reply.send(html);
  });

  // ── Save: render the edited config, store, hand a result token back ──────────
  app.post("/edit/save", async (req, reply) => {
    const secret = getEnv().MISSIONCOVER_SERVICE_SECRET;
    const body = saveBodySchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ error: "invalid_request" });

    const payload = verifyToken(body.data.token, secret);
    const parsed = payload ? startTokenSchema.safeParse(payload) : null;
    if (!parsed || !parsed.success) return reply.code(403).send({ error: "invalid_token" });
    const t = parsed.data;

    let config: EngineConfig;
    try {
      config = JSON.parse(body.data.config) as EngineConfig;
    } catch {
      return reply.code(400).send({ error: "invalid_config" });
    }

    try {
      const { png, width, height } = await renderEngineConfig(config, body.data.bg ?? null);
      const format = (typeof config.coverFormat === "string" ? config.coverFormat : t.format) as
        typeof t.format;
      const meta: CoverMeta = {
        id: newId(),
        opId: t.opId,
        width,
        height,
        preset: t.preset,
        format,
        createdAt: new Date().toISOString(),
      };
      await saveCover(meta, png);

      // Result token the fleetplanner verifies to persist the OpCover row.
      const ct = signToken(
        { opId: t.opId, coverId: meta.id, url: pngUrl(meta.id), width, height, preset: meta.preset, format },
        secret,
        600,
      );
      const redirect = `${t.returnUrl}?ct=${encodeURIComponent(ct)}`;
      return reply.send({ redirect });
    } catch (err) {
      req.log.error({ err, opId: t.opId }, "editor save render failed");
      return reply.code(500).send({ error: "render_failed" });
    }
  });
}
