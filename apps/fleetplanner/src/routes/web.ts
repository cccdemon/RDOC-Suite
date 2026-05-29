import type { FastifyInstance } from "fastify";
import { rawHtml } from "../web/pages.js";
import {
  homePage, opDetailPage, opFormPage, shipsPage, adminPage, errorPage,
} from "../web/pages.js";
import { requireRole, optionalAuth } from "../auth/middleware.js";
import { basePath } from "../config/env.js";
import { prisma } from "../db.js";
import {
  createOperation, getOperation, listOperations, updateOperation, deleteOperation,
} from "../services/operations.js";
import { searchShips } from "../services/scwiki.js";
import { deleteScheduledEvent } from "../services/discord.js";
import { getSyncState, runSync, updateSyncConfig } from "../services/shipSync.js";

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

export async function webRoutes(app: FastifyInstance) {

  // ── Home ────────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string; past?: string } }>(
    "/",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      const includePast = !!req.query.past;
      const ops = await listOperations(includePast);
      htmlReply(reply, homePage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        ops,
        includePast,
      }));
    }
  );

  // ── New operation form ───────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/ops/new",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      htmlReply(reply, opFormPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        op: null,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/ops/new",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) {
        return reply.code(403).send("Invalid CSRF token");
      }
      const { title, description, opType, scheduledAt } = req.body;
      const parsedDate = parseUtcDateTimeLocal(scheduledAt);
      if (!title?.trim() || !parsedDate) {
        return reply.redirect(basePath("/ops/new?flash=error:Title+and+date+are+required"), 302);
      }
      try {
        const op = await createOperation(ctx.user.id, {
          title: title.trim(),
          description: description ?? "",
          opType: opType ?? "combat",
          scheduledAt: parsedDate,
        });
        return reply.redirect(basePath(`/ops/${op.id}?flash=ok:Operation+created.`), 302);
      } catch {
        return reply.redirect(basePath("/ops/new?flash=error:Failed+to+create+operation"), 302);
      }
    }
  );

  // ── Operation detail ─────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { flash?: string } }>(
    "/ops/:id",
    async (req, reply) => {
      const ctx = await optionalAuth(req);
      const op = await getOperation(req.params.id);
      if (!op) {
        return htmlReply(reply, errorPage({
          basePath: basePath(), currentUser: ctx?.user ?? null, status: 404, message: "Operation not found",
        }));
      }
      const ships = await prisma.ship.findMany({ take: 20, orderBy: { name: "asc" } });
      htmlReply(reply, opDetailPage({
        basePath: basePath(),
        currentUser: ctx?.user ?? null,
        csrfToken: ctx?.csrfToken,
        flash: req.query.flash,
        op,
        ships,
      }));
    }
  );

  // ── Edit operation ───────────────────────────────────────────────────
  app.get<{ Params: { id: string }; Querystring: { flash?: string } }>(
    "/ops/:id/edit",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      const op = await getOperation(req.params.id);
      if (!op) return reply.code(404).send("Not found");
      htmlReply(reply, opFormPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        op,
      }));
    }
  );

  app.post<{ Params: { id: string }; Body: Record<string, string> }>(
    "/ops/:id/edit",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      const { title, description, opType, scheduledAt } = req.body;
      const parsedDate = scheduledAt ? parseUtcDateTimeLocal(scheduledAt) : null;
      if (scheduledAt && !parsedDate) {
        return reply.redirect(basePath(`/ops/${req.params.id}/edit?flash=error:Invalid+date`), 302);
      }
      try {
        await updateOperation(req.params.id, {
          ...(title && { title: title.trim() }),
          ...(description !== undefined && { description }),
          ...(opType && { opType }),
          ...(parsedDate && { scheduledAt: parsedDate }),
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
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      try {
        const op = await prisma.operation.findUnique({ where: { id: req.params.id } });
        await deleteOperation(req.params.id);
        if (op?.discordEventId) {
          deleteScheduledEvent(op.discordEventId).catch((err) =>
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
      const q = req.query.q?.trim() ?? "";
      const ships = q ? await searchShips(q, 50) : await prisma.ship.findMany({ take: 50, orderBy: { name: "asc" } });
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

  // ── Admin panel ────────────────────────────────────────────────────────
  app.get<{ Querystring: { flash?: string } }>(
    "/admin",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "captain");
      if (!ctx) return;
      const [users, sync] = await Promise.all([
        prisma.user.findMany({ orderBy: { joinedAt: "asc" } }),
        getSyncState(),
      ]);
      htmlReply(reply, adminPage({
        basePath: basePath(),
        currentUser: ctx.user,
        csrfToken: ctx.csrfToken,
        flash: req.query.flash,
        users,
        sync,
      }));
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/ships/sync",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
      if (!ctx) return;
      if (!csrfOk(req.body, ctx.csrfToken)) return reply.code(403).send("Invalid CSRF token");
      runSync("manual").catch((err) => app.log.error(err, "Manual ship catalog sync failed"));
      return reply.redirect(basePath("/admin?flash=ok:Ship+catalog+sync+started."), 302);
    }
  );

  app.post<{ Body: Record<string, string> }>(
    "/admin/ships/config",
    async (req, reply) => {
      const ctx = await requireRole(req, reply, "fleetoperator");
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
