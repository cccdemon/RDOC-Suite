import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../db.js";
import { createSession } from "../../auth/session.js";

// Skipped automatically when no test Postgres is available.
const dbReady = inject("dbReady");

// Real route integration against a real Postgres: an authenticated fleet
// operator drives an operation through its lifecycle over /api/v1 (the only
// layer that still exists — the backend renders no HTML forms since the
// API-only refactor). Discord is unconfigured here, so the scheduled-event side
// effects are no-ops; e2e/tests/30-* cover them against the simulator.
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let userId: string;
const guildId = "100000000000000777";

async function api(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
) {
  return app.inject({
    method,
    url,
    headers: {
      cookie,
      "x-csrf-token": csrf,
      // Fastify rejects an empty body that claims to be JSON, so the header is
      // only set when there is one.
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
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
    cookie = `fp_sid=${sess.token}`;
    csrf = sess.csrfToken;

    app = (await buildApp()) as unknown as FastifyInstance;
    await app.ready();
  });

  afterAll(async () => {
    await app?.close();
  });

  it("creates an operation", async () => {
    const res = await api("POST", "/api/v1/operations", {
      guildId,
      title: "__HARNESS_OP__",
      scheduledAt: "2026-09-01T18:00:00.000Z",
      opType: "combat",
      visibility: "private",
    });
    expect(res.statusCode).toBe(200);
    opId = res.json().id as string;
    const op = await prisma.operation.findUnique({ where: { id: opId } });
    expect(op).toMatchObject({ title: "__HARNESS_OP__", createdById: userId, status: "draft" });
  });

  it("opens the operation", async () => {
    const res = await api("POST", `/api/v1/operations/${opId}/status`, { status: "open" });
    expect(res.statusCode).toBe(200);
    expect((await prisma.operation.findUnique({ where: { id: opId } }))?.status).toBe("open");
  });

  it("adds ship needs and lists them back", async () => {
    const res = await api("POST", `/api/v1/operations/${opId}/needs/ships`, {
      shipTypes: ["subcapital", "subcapital", "support"],
      name: "Wing",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(3);

    const needs = await prisma.compositionRequirement.findMany({
      where: { group: { operationId: opId } },
    });
    expect(needs).toHaveLength(3);

    const view = await app.inject({ method: "GET", url: `/api/v1/operations/${opId}/needs`, headers: { cookie } });
    expect(view.statusCode).toBe(200);
    expect(JSON.stringify(view.json())).toContain("subcapital");
  });

  it("removes a single ship need without touching the others", async () => {
    const need = await prisma.compositionRequirement.findFirst({ where: { group: { operationId: opId } } });
    const res = await api("DELETE", `/api/v1/operations/${opId}/needs/${need!.id}`);
    expect(res.statusCode).toBe(200);
    expect(await prisma.compositionRequirement.count({ where: { group: { operationId: opId } } })).toBe(2);
  });

  it("signs the operator up as CQB and withdraws", async () => {
    const signup = await api("POST", `/api/v1/operations/${opId}/cqb/signup`, { note: "harness" });
    expect(signup.statusCode).toBe(200);
    expect(await prisma.cqbSignup.count({ where: { operationId: opId, userId, status: { not: "rejected" } } })).toBe(1);

    const withdraw = await api("DELETE", `/api/v1/operations/${opId}/cqb/signup`);
    expect(withdraw.statusCode).toBe(200);
    expect(await prisma.cqbSignup.count({ where: { operationId: opId, userId, status: { not: "rejected" } } })).toBe(0);
  });

  it("serves the operation detail to the authenticated operator", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/operations/${opId}`, headers: { cookie } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.title).toBe("__HARNESS_OP__");
    expect(body.canManage).toBe(true);
  });

  it("hides a private operation from anonymous callers", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/operations/${opId}` });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe("unauthenticated");
  });

  it("rejects an unauthenticated mutation", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/operations/${opId}/status`,
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ status: "locked" }),
    });
    expect(res.statusCode).toBe(401);
    expect((await prisma.operation.findUnique({ where: { id: opId } }))?.status).toBe("open"); // unchanged
  });

  it("rejects a session without the CSRF header", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/v1/operations/${opId}/status`,
      headers: { "content-type": "application/json", cookie },
      payload: JSON.stringify({ status: "locked" }),
    });
    expect(res.statusCode).toBe(403);
    expect((await prisma.operation.findUnique({ where: { id: opId } }))?.status).toBe("open");
  });

  it("publishes only guilds that consented to the public orgs panel", async () => {
    const empty = await app.inject({ method: "GET", url: "/api/v1/public/orgs" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json().orgs).toEqual([]); // the harness guild has not opted in

    // Opt in without an invite → still hidden: a card with no destination is
    // pointless, so the invite is part of the condition, not a nicety.
    await prisma.guild.update({ where: { id: guildId }, data: { landingOptIn: true } });
    expect((await app.inject({ method: "GET", url: "/api/v1/public/orgs" })).json().orgs).toEqual([]);

    await prisma.guild.update({
      where: { id: guildId },
      data: { discordInviteUrl: "https://discord.gg/harness", orgName: "Harness Org" },
    });
    const listed = (await app.inject({ method: "GET", url: "/api/v1/public/orgs" })).json().orgs;
    expect(listed).toEqual([
      { name: "Harness Org", inviteUrl: "https://discord.gg/harness", iconUrl: null },
    ]);

    // Banning a guild takes it off the public page immediately.
    await prisma.guild.update({ where: { id: guildId }, data: { bannedAt: new Date() } });
    expect((await app.inject({ method: "GET", url: "/api/v1/public/orgs" })).json().orgs).toEqual([]);
    await prisma.guild.update({ where: { id: guildId }, data: { bannedAt: null, landingOptIn: false } });
  });

  it("deletes the operation", async () => {
    const res = await api("DELETE", `/api/v1/operations/${opId}`);
    expect(res.statusCode).toBe(200);
    expect(await prisma.operation.findUnique({ where: { id: opId } })).toBeNull();
    // The cascade must take the needs with it — an orphaned requirement would
    // keep showing up in the guild's composition queries.
    expect(await prisma.compositionRequirement.count({ where: { group: { operationId: opId } } })).toBe(0);
  });
});
