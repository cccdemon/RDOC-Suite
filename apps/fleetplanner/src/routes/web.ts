import type { FastifyInstance } from "fastify";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// API-only backend: this router serves ONLY data/file endpoints — mission
// images and per-op .ics/.csv exports. All UI (incl. info/legal pages) lives in
// the fleetplanner-web SPA. Do not add HTML/JS routes here.
import { optionalAuth } from "../auth/middleware.js";
import { effectiveOpRole } from "../services/guilds.js";
import { getEnv } from "../config/env.js";
import { prisma } from "../db.js";
import { buildOpIcs } from "../lib/calendar.js";
import { getOperation } from "../services/operations.js";
import { getMissionParticipants, participantsToCsv } from "../services/participants.js";

const PUBLIC_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../public");

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

  // ── Link unfurl (OpenGraph) — crawler-only meta document. ──────────────
  // Deliberate exception to the "backend = API-only" rule: link-preview bots
  // (Discord/Twitter/Slack…) don't run JS, so the SPA can't provide per-op OG.
  // nginx routes ONLY bot user-agents here; humans get the SPA. No interactive
  // UI — just <meta> tags + an immediate redirect to the app for any human that
  // lands here. Private ops emit a generic card (no detail leak).
  app.get<{ Params: { id: string } }>("/ops/:id", async (req, reply) => {
    const esc = (s: unknown) =>
      String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] as string));
    const env = getEnv();
    const base = `${env.WEB_PUBLIC_URL}${env.PUBLIC_BASE_PATH ?? ""}`;
    const appUrl = `${base}/ops/${encodeURIComponent(req.params.id)}`;
    const defaultImg = `${base}/assets/operation-hero.png`;

    const op = /^[a-z0-9]{20,32}$/i.test(req.params.id) ? await getOperation(req.params.id) : null;
    let title = "RDOC Fleetplanner";
    let description = "Star-Citizen-Operationen planen.";
    let image = defaultImg;
    if (op) {
      const o = op as { title: string; visibility: string; description: string | null; scheduledAt: Date; meetingSystem: string; meetingLocation: string; cover?: { url: string } | null };
      if (o.visibility === "public") {
        const when = o.scheduledAt.toISOString().replace("T", " ").slice(0, 16) + " UTC";
        const where = [o.meetingSystem, o.meetingLocation].filter(Boolean).join(" · ");
        title = o.title;
        description = `🕒 ${when}${where ? ` · 📍 ${where}` : ""}`;
        image = o.cover?.url || defaultImg;
      } else {
        title = "Private Operation — RDOC Fleetplanner";
        description = "Anmeldung erforderlich.";
      }
    }
    const html = `<!doctype html><html lang="de"><head><meta charset="utf-8">`
      + `<title>${esc(title)} — RDOC Fleetplanner</title>`
      + `<meta property="og:type" content="website">`
      + `<meta property="og:site_name" content="RDOC Fleetplanner">`
      + `<meta property="og:title" content="${esc(title)}">`
      + `<meta property="og:description" content="${esc(description)}">`
      + `<meta property="og:image" content="${esc(image)}">`
      + `<meta property="og:url" content="${esc(appUrl)}">`
      + `<meta name="twitter:card" content="summary_large_image">`
      + `<meta http-equiv="refresh" content="0; url=${esc(appUrl)}">`
      + `</head><body><a href="${esc(appUrl)}">${esc(title)}</a></body></html>`;
    return reply.header("Cache-Control", "public, max-age=300").type("text/html; charset=utf-8").send(html);
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

}
