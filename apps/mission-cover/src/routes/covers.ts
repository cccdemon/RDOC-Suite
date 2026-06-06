import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { getEnv } from "../config/env.js";
import { coverRequestSchema, AUTHOR_CREDIT, type CoverMeta, type CoverResponse } from "../schema.js";
import { renderEngineConfig } from "../services/render.js";
import { buildEngineConfig } from "../services/prefill.js";
import {
  deleteCover,
  getConfig,
  getMeta,
  getPng,
  isValidId,
  newId,
  saveConfig,
  saveCover,
} from "../services/store.js";

function publicPngUrl(id: string): string {
  return `${getEnv().MISSIONCOVER_PUBLIC_URL.replace(/\/$/, "")}/covers/${id}.png`;
}

function toResponse(meta: CoverMeta): CoverResponse {
  return { ...meta, urls: { png: publicPngUrl(meta.id) }, author: AUTHOR_CREDIT };
}

// Bearer guard for the M2M /v1 API. Constant-time compare.
function requireServiceAuth(req: FastifyRequest, reply: FastifyReply): boolean {
  const expected = getEnv().MISSIONCOVER_SERVICE_SECRET;
  const header = req.headers.authorization ?? "";
  const got = header.startsWith("Bearer ") ? header.slice(7) : "";
  const ok = got.length === expected.length && timingSafeEqual(got, expected);
  if (!ok) {
    reply.code(401).send({ error: "unauthorized" });
    return false;
  }
  return true;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function registerCoverRoutes(app: FastifyInstance): void {
  // ── M2M: render + store a cover ────────────────────────────────────────────
  app.post("/v1/covers", async (req, reply) => {
    if (!requireServiceAuth(req, reply)) return;

    const parsed = coverRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_request", detail: parsed.error.flatten() });
    }

    try {
      const config = buildEngineConfig(parsed.data);
      const bg = parsed.data.data.backgroundImage ?? null;
      const { png, width, height } = await renderEngineConfig(config, bg);
      const meta: CoverMeta = {
        id: newId(),
        opId: parsed.data.opId,
        width,
        height,
        preset: parsed.data.preset,
        format: parsed.data.format,
        createdAt: new Date().toISOString(),
      };
      await saveCover(meta, png);
      // Persist the engine config so the editor can reopen this cover.
      await saveConfig(meta.id, { config, bg });
      return reply.code(201).send(toResponse(meta));
    } catch (err) {
      req.log.error({ err, opId: parsed.data.opId }, "cover render failed");
      return reply.code(500).send({ error: "render_failed" });
    }
  });

  // ── M2M: saved engine config (editor reopen) ───────────────────────────────
  app.get<{ Params: { id: string } }>("/v1/covers/:id/config", async (req, reply) => {
    if (!requireServiceAuth(req, reply)) return;
    const { id } = req.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid_id" });
    const cfg = await getConfig(id);
    if (!cfg) return reply.code(404).send({ error: "not_found" });
    return reply.send(cfg);
  });

  // ── M2M: cover metadata ────────────────────────────────────────────────────
  app.get<{ Params: { id: string } }>("/v1/covers/:id", async (req, reply) => {
    if (!requireServiceAuth(req, reply)) return;
    const { id } = req.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid_id" });
    const meta = await getMeta(id);
    if (!meta) return reply.code(404).send({ error: "not_found" });
    return reply.send(toResponse(meta));
  });

  // ── M2M: delete a stored cover (cleanup) ───────────────────────────────────
  app.delete<{ Params: { id: string } }>("/v1/covers/:id", async (req, reply) => {
    if (!requireServiceAuth(req, reply)) return;
    const { id } = req.params;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid_id" });
    await deleteCover(id);
    return reply.code(204).send();
  });

  // ── Public: the rendered image (read-only, unguessable id) ──────────────────
  app.get<{ Params: { id: string } }>("/covers/:id.png", async (req, reply) => {
    const id = req.params.id;
    if (!isValidId(id)) return reply.code(400).send({ error: "invalid_id" });
    const png = await getPng(id);
    if (!png) return reply.code(404).send({ error: "not_found" });
    reply.header("content-type", "image/png");
    reply.header("cache-control", "public, max-age=300");
    return reply.send(png);
  });
}
