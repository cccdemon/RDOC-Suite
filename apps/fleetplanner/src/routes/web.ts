import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// API-only backend: this router serves ONLY data/file endpoints (mission
// images, .ics/.csv exports) and the static public info/legal pages. All app
// UI lives in the fleetplanner-web SPA. Do not add HTML/JS app routes here.
import {
  rawHtml,
  whatIsPage,
  howToPage,
  scToolsPage,
  changelogPage,
  impressumPage,
  datenschutzPage,
  licensePage,
  whyUnsignedPage,
} from "../web/pages.js";
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { basePath, getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { buildOpIcs } from "../lib/calendar.js";
import { getOperation } from "../services/operations.js";
import { getScToolCards } from "../services/scTools.js";
import { getMissionParticipants, participantsToCsv } from "../services/participants.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public");

function htmlReply(
  reply: import("fastify").FastifyReply,
  page: import("../web/render.js").SafeHtml,
) {
  reply.type("text/html; charset=utf-8").send(rawHtml(page));
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

  // ── Calendar download (.ics) — add the op to your calendar after signing up.
  app.get<{ Params: { id: string } }>("/ops/:id/calendar.ics", async (req, reply) => {
    const ctx = await optionalAuth(req);
    const op = await getOperation(req.params.id);
    if (!op) return reply.code(404).send("Operation not found");
    const opVisibility = (op as Record<string, unknown>).visibility as string | undefined;
    // Same access gate as the join page: public is open; otherwise the viewer
    // must be logged in and have a role in the op's guild.
    if (opVisibility !== "public") {
      if (!ctx) return reply.code(401).send("Login required");
      const role = await effectiveOpRole(ctx.user.id, ctx.user.role, op.id);
      if (!role) return reply.code(404).send("Operation not found");
    }
    const publicUrl = `${getEnv().WEB_PUBLIC_URL}${getEnv().PUBLIC_BASE_PATH ?? ""}`;
    const ics = buildOpIcs(op, publicUrl);
    return reply
      .header("Content-Type", "text/calendar; charset=utf-8")
      .header("Content-Disposition", `attachment; filename="op-${op.id}.ics"`)
      .header("Cache-Control", "no-store")
      .send(ics);
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

}
