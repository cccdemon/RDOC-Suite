import { describe, it, expect, beforeAll, afterAll, inject } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../db.js";
import { createSession } from "../../auth/session.js";

const dbReady = inject("dbReady");

// Second DB-backed suite: squad units, seat claim/release, crew-requests,
// leaders and visibility — the operator-side contribution flows. Uses a squad
// unit so no ship catalog rows are needed in the fresh test DB.
let app: FastifyInstance;
let cookie: string;
let csrf: string;
let opId: string;
let otherId: string;
const guildId = "100000000000000888";

function form(fields: Record<string, string>): string {
  return Object.entries(fields)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

describe.skipIf(!dbReady)("operation contributions (real DB)", () => {
  async function post(url: string, fields: Record<string, string>) {
    return app.inject({
      method: "POST",
      url,
      headers: { "content-type": "application/x-www-form-urlencoded", cookie },
      payload: form({ _csrf: csrf, ...fields }),
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

    app = (await buildApp()) as unknown as FastifyInstance;
    await app.ready();

    const op = await prisma.operation.create({
      data: { guildId, title: "__CONTRIB_OP__", scheduledAt: new Date("2026-09-01T18:00:00Z"), status: "open", createdById: user.id, opType: "combat" },
    });
    opId = op.id;
  });

  afterAll(async () => {
    await app?.close();
  });

  it("registers a squad, accepts it, and creates seats", async () => {
    const res = await post(`/api/ops/${opId}/units`, {
      unitType: "squad",
      squadName: "Alpha",
      squadSize: "4",
    });
    expect(res.statusCode).toBe(302);
    const unit = await prisma.fleetUnit.findFirst({ where: { operationId: opId, unitType: "squad" } });
    expect(unit).not.toBeNull();
    const acc = await post(`/api/ops/${opId}/units/${unit!.id}/accept`, {});
    expect(acc.statusCode).toBe(302);
    expect(await prisma.fleetUnit.findUnique({ where: { id: unit!.id } })).toMatchObject({ status: "accepted" });
    expect(await prisma.seatAssignment.count({ where: { unitId: unit!.id, active: true } })).toBeGreaterThan(0);
  });

  it("claims and releases a seat", async () => {
    const seat = await prisma.seatAssignment.findFirst({
      where: { fleetUnit: { operationId: opId }, active: true, userId: null },
    });
    expect(seat).not.toBeNull();
    const claim = await post(`/api/seats/${seat!.id}/claim`, {});
    expect(claim.statusCode).toBe(302);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).not.toBeNull();
    const release = await post(`/api/seats/${seat!.id}/unclaim`, {});
    expect(release.statusCode).toBe(302);
    expect((await prisma.seatAssignment.findUnique({ where: { id: seat!.id } }))?.userId).toBeNull();
  });

  it("adds and removes a crew request", async () => {
    await post(`/api/ops/${opId}/crew-requests`, { note: "place me" });
    expect(await prisma.crewAssignmentRequest.count({ where: { operationId: opId } })).toBe(1);
    await post(`/api/ops/${opId}/crew-requests/remove`, {});
    expect(await prisma.crewAssignmentRequest.count({ where: { operationId: opId } })).toBe(0);
  });

  it("adds and removes an operation leader", async () => {
    await post(`/api/ops/${opId}/leaders`, { userId: otherId });
    expect(await prisma.operationLeader.count({ where: { operationId: opId, userId: otherId } })).toBe(1);
    await post(`/api/ops/${opId}/leaders/remove`, { userId: otherId });
    expect(await prisma.operationLeader.count({ where: { operationId: opId, userId: otherId } })).toBe(0);
  });

  it("changes visibility", async () => {
    const res = await post(`/ops/${opId}/visibility`, { visibility: "public" });
    expect(res.statusCode).toBe(302);
    expect((await prisma.operation.findUnique({ where: { id: opId } }))?.visibility).toBe("public");
  });
});
