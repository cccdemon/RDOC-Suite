import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../db.js";
import { createSession } from "../../auth/session.js";

// Skipped automatically when Docker (and thus the test Postgres) is unavailable.
const dbReady = inject("dbReady");

// Real route integration against the Docker test Postgres: an authenticated
// fleet operator drives an operation through its lifecycle via .inject().
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let userId: string;
const guildId = "100000000000000777";

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}
async function post(url: string, fields: Record<string, string>) {
  return app.inject({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded", cookie },
    payload: form({ _csrf: csrf, ...fields }),
  });
}

describe.skipIf(!dbReady)("operation lifecycle (real DB)", () => {
  let opId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: "HarnessTester", role: "superadmin" },
    });
    userId = user.id;
    await prisma.guild.create({ data: { id: guildId, name: "Harness Guild" } });
    await prisma.guildMembership.create({
      data: { guildId, userId, role: "fleetoperator" },
    });
    const sess = await createSession(userId);
    cookie = `fp_sid=${sess.id}`;
    csrf = sess.csrfToken;

    app = (await buildApp()) as unknown as FastifyInstance;
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("creates an operation", async () => {
    const res = await post("/ops/new", {
      guildId,
      title: "__HARNESS_OP__",
      scheduledAt: "2026-09-01T18:00",
      opType: "combat",
      visibility: "private",
    });
    expect(res.statusCode).toBe(302);
    const op = await prisma.operation.findFirst({
      where: { title: "__HARNESS_OP__", createdById: userId },
    });
    expect(op).not.toBeNull();
    opId = op!.id;
  });

  it("opens the operation", async () => {
    const res = await post(`/api/ops/${opId}/status`, { status: "open" });
    expect(res.statusCode).toBe(302);
    const op = await prisma.operation.findUnique({ where: { id: opId } });
    expect(op?.status).toBe("open");
  });

  it("adds a composition group + requirement", async () => {
    await post(`/api/ops/${opId}/groups`, { name: "Wing" });
    const group = await prisma.compositionGroup.findFirst({
      where: { operationId: opId, name: "Wing" },
    });
    expect(group).not.toBeNull();
    const res = await post(`/api/ops/${opId}/groups/${group!.id}/requirements`, {
      label: "Fighters",
      category: "fighter",
      count: "4",
    });
    expect(res.statusCode).toBe(302);
    const req = await prisma.compositionRequirement.findFirst({ where: { groupId: group!.id } });
    expect(req?.count).toBe(4);
  });

  it("signs the operator up as CQB and withdraws", async () => {
    await post(`/api/ops/${opId}/cqb-signups`, { note: "harness" });
    expect(await prisma.cqbSignup.count({ where: { operationId: opId, userId } })).toBe(1);
    await post(`/api/ops/${opId}/cqb-signups/withdraw`, {});
    expect(await prisma.cqbSignup.count({ where: { operationId: opId, userId } })).toBe(0);
  });

  it("renders the op page for the authed operator", async () => {
    const res = await app.inject({ method: "GET", url: `/ops/${opId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("__HARNESS_OP__");
  });

  it("rejects an unauthenticated mutation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/ops/${opId}/status`,
      headers: { "content-type": "application/x-www-form-urlencoded" },
      payload: form({ status: "locked" }),
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(300); // redirect-to-login or 4xx, never 2xx
    const op = await prisma.operation.findUnique({ where: { id: opId } });
    expect(op?.status).toBe("open"); // unchanged
  });

  it("deletes the operation", async () => {
    const res = await post(`/ops/${opId}/delete`, {});
    expect(res.statusCode).toBe(302);
    expect(await prisma.operation.findUnique({ where: { id: opId } })).toBeNull();
  });
});
