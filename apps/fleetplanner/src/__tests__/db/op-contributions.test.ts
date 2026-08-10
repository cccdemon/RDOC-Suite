import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../db.js";
import { createSession } from "../../auth/session.js";

const dbReady = inject("dbReady");

// Second DB-backed suite: squad units, seat claim/release, operator seat
// assignment, leaders and visibility — the contribution flows, over /api/v1.
// A squad unit is used so no ship-catalog rows are needed in a fresh test DB.
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let crewCookie: string;
let crewCsrf: string;
let opId: string;
let otherId: string;
const guildId = "100000000000000888";

describe.skipIf(!dbReady)("operation contributions (real DB)", () => {
  async function api(
    method: "POST" | "PATCH" | "PUT" | "DELETE",
    url: string,
    body?: unknown,
    as: "operator" | "crew" = "operator",
  ) {
    return app.inject({
      method,
      url,
      headers: {
        cookie: as === "crew" ? crewCookie : cookie,
        "x-csrf-token": as === "crew" ? crewCsrf : csrf,
        // Fastify rejects an empty body that claims to be JSON.
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      payload: body === undefined ? undefined : JSON.stringify(body),
    });
  }

  beforeAll(async () => {
    const user = await prisma.user.create({ data: { username: "ContribOp", role: "superadmin" } });
    const other = await prisma.user.create({ data: { username: "ContribCrew", role: "crew" } });
    otherId = other.id;
    await prisma.guild.create({ data: { id: guildId, name: "Contrib Guild" } });
    await prisma.guildMembership.create({ data: { guildId, userId: user.id, role: "fleetoperator" } });
    await prisma.guildMembership.create({ data: { guildId, userId: otherId, role: "crew" } });

    const sess = await createSession(user.id);
    cookie = `fp_sid=${sess.token}`;
    csrf = sess.csrfToken;
    const crewSess = await createSession(otherId);
    crewCookie = `fp_sid=${crewSess.token}`;
    crewCsrf = crewSess.csrfToken;

    app = (await buildApp()) as unknown as FastifyInstance;
    await app.ready();

    const op = await prisma.operation.create({
      data: {
        guildId,
        title: "__CONTRIB_OP__",
        scheduledAt: new Date("2026-09-01T18:00:00Z"),
        status: "open",
        createdById: user.id,
        opType: "combat",
      },
    });
    opId = op.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("registers a squad, accepts it, and creates seats", async () => {
    const res = await api("POST", `/api/v1/operations/${opId}/units`, {
      unitType: "squad",
      squadName: "Alpha",
      squadSize: 4,
    });
    expect(res.statusCode).toBe(200);

    const unit = await prisma.fleetUnit.findFirst({ where: { operationId: opId, unitType: "squad" } });
    expect(unit).not.toBeNull();
    expect(unit?.status).toBe("pending");

    const acc = await api("POST", `/api/v1/operations/${opId}/units/${unit!.id}/accept`, {});
    expect(acc.statusCode).toBe(200);
    expect(await prisma.fleetUnit.findUnique({ where: { id: unit!.id } })).toMatchObject({ status: "accepted" });
    expect(await prisma.seatAssignment.count({ where: { unitId: unit!.id, active: true } })).toBeGreaterThan(0);
  });

  it("refuses a second squad with the same name", async () => {
    const res = await api("POST", `/api/v1/operations/${opId}/units`, {
      unitType: "squad",
      squadName: "Alpha",
      squadSize: 4,
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(await prisma.fleetUnit.count({ where: { operationId: opId, squadName: "Alpha" } })).toBe(1);
  });

  it("a crew member claims and releases a seat", async () => {
    const seat = await prisma.seatAssignment.findFirst({
      where: { fleetUnit: { operationId: opId }, active: true, userId: null },
    });
    expect(seat).not.toBeNull();

    const claim = await api("POST", `/api/v1/operations/${opId}/seats/${seat!.id}/claim`, undefined, "crew");
    expect(claim.statusCode).toBe(200);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBe(otherId);

    const release = await api("DELETE", `/api/v1/operations/${opId}/seats/${seat!.id}/claim`, undefined, "crew");
    expect(release.statusCode).toBe(200);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBeNull();
  });

  it("the operator assigns a seat to somebody else and frees it again", async () => {
    const seat = await prisma.seatAssignment.findFirst({
      where: { fleetUnit: { operationId: opId }, active: true, userId: null },
    });
    const assign = await api("PUT", `/api/v1/operations/${opId}/seats/${seat!.id}/assignment`, { userId: otherId });
    expect(assign.statusCode).toBe(200);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBe(otherId);

    const free = await api("DELETE", `/api/v1/operations/${opId}/seats/${seat!.id}/assignment`);
    expect(free.statusCode).toBe(200);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBeNull();
  });

  it("a seat id from another operation cannot be claimed", async () => {
    const foreign = await prisma.operation.create({
      data: {
        guildId,
        title: "__OTHER_OP__",
        scheduledAt: new Date("2026-09-02T18:00:00Z"),
        status: "open",
        createdById: otherId,
        opType: "combat",
      },
    });
    const seat = await prisma.seatAssignment.findFirst({
      where: { fleetUnit: { operationId: opId }, active: true, userId: null },
    });
    // Same seat, wrong operation in the path — the route scopes by both.
    const res = await api("POST", `/api/v1/operations/${foreign.id}/seats/${seat!.id}/claim`, undefined, "crew");
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBeNull();
    await prisma.operation.delete({ where: { id: foreign.id } });
  });

  it("adds and removes an operation leader", async () => {
    const add = await api("POST", `/api/v1/operations/${opId}/leaders`, { userId: otherId });
    expect(add.statusCode).toBe(200);
    expect(await prisma.operationLeader.count({ where: { operationId: opId, userId: otherId } })).toBe(1);

    const remove = await api("DELETE", `/api/v1/operations/${opId}/leaders/${otherId}`);
    expect(remove.statusCode).toBe(200);
    expect(await prisma.operationLeader.count({ where: { operationId: opId, userId: otherId } })).toBe(0);
  });

  it("a crew member cannot appoint a leader", async () => {
    const res = await api("POST", `/api/v1/operations/${opId}/leaders`, { userId: otherId }, "crew");
    expect(res.statusCode).toBe(403);
    expect(await prisma.operationLeader.count({ where: { operationId: opId } })).toBe(0);
  });

  it("changes visibility", async () => {
    const res = await api("PATCH", `/api/v1/operations/${opId}`, { visibility: "public" });
    expect(res.statusCode).toBe(200);
    expect((await prisma.operation.findUnique({ where: { id: opId } }))?.visibility).toBe("public");
  });

  it("a public operation is readable without a session", async () => {
    const res = await app.inject({ method: "GET", url: `/api/v1/operations/${opId}` });
    expect(res.statusCode).toBe(200);
    // Anonymous readers never see player identities.
    expect(JSON.stringify(res.json())).not.toContain("ContribCrew");
  });
});
