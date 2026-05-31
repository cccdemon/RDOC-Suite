import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    userSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import { createSession, destroySession, loadSession } from "../../auth/session.js";
import type { FastifyRequest } from "fastify";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

function mockRequest(cookies: Record<string, string | undefined> = {}): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

// ── createSession ─────────────────────────────────────────────────────────────

describe("createSession", () => {
  it("creates a session row and returns id, csrfToken, expiresAt", async () => {
    db.userSession.create.mockImplementation(({ data }: { data: { userId: string; csrfToken: string; expiresAt: Date } }) =>
      Promise.resolve({ id: "sess-1", csrfToken: data.csrfToken, expiresAt: data.expiresAt }),
    );

    const result = await createSession("user-1");

    expect(db.userSession.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "user-1" }),
      }),
    );
    expect(result).toHaveProperty("id");
    expect(result).toHaveProperty("csrfToken");
    expect(result).toHaveProperty("expiresAt");
  });

  it("expiresAt is approximately 30 days in the future", async () => {
    const now = Date.now();
    db.userSession.create.mockImplementation(({ data }: { data: { csrfToken: string; expiresAt: Date } }) =>
      Promise.resolve({ id: "sess-1", csrfToken: data.csrfToken, expiresAt: data.expiresAt }),
    );

    const result = await createSession("user-1");

    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    const diff = result.expiresAt.getTime() - now;
    expect(diff).toBeGreaterThan(thirtyDaysMs - 500);
    expect(diff).toBeLessThan(thirtyDaysMs + 1000);
  });

  it("csrfToken is a UUID (uuid v4 format)", async () => {
    db.userSession.create.mockImplementation(({ data }: { data: { csrfToken: string; expiresAt: Date } }) =>
      Promise.resolve({ id: "sess-1", csrfToken: data.csrfToken, expiresAt: data.expiresAt }),
    );

    const result = await createSession("user-1");
    expect(result.csrfToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  it("generates unique csrfTokens across calls", async () => {
    db.userSession.create.mockImplementation(({ data }: { data: { csrfToken: string; expiresAt: Date } }) =>
      Promise.resolve({ id: "sess-x", csrfToken: data.csrfToken, expiresAt: data.expiresAt }),
    );

    const a = await createSession("user-1");
    const b = await createSession("user-1");
    expect(a.csrfToken).not.toBe(b.csrfToken);
  });
});

// ── loadSession ───────────────────────────────────────────────────────────────

describe("loadSession", () => {
  it("returns null when no session cookie is present", async () => {
    const result = await loadSession(mockRequest({}));
    expect(result).toBeNull();
    expect(db.userSession.findUnique).not.toHaveBeenCalled();
  });

  it("returns null when session row not found in DB", async () => {
    db.userSession.findUnique.mockResolvedValue(null);
    const result = await loadSession(mockRequest({ fp_sid: "missing-session" }));
    expect(result).toBeNull();
  });

  it("returns null when session has expired", async () => {
    const pastDate = new Date(Date.now() - 1000);
    db.userSession.findUnique.mockResolvedValue({
      id: "sess-1",
      csrfToken: "csrf-abc",
      expiresAt: pastDate,
      user: { id: "user-1", active: true },
    });
    const result = await loadSession(mockRequest({ fp_sid: "sess-1" }));
    expect(result).toBeNull();
  });

  it("returns null when user is inactive", async () => {
    db.userSession.findUnique.mockResolvedValue({
      id: "sess-1",
      csrfToken: "csrf-abc",
      expiresAt: new Date(Date.now() + 60_000),
      user: { id: "user-1", active: false },
    });
    const result = await loadSession(mockRequest({ fp_sid: "sess-1" }));
    expect(result).toBeNull();
  });

  it("returns user, sessionId, csrfToken for a valid session", async () => {
    const user = { id: "user-1", active: true, username: "streamer" };
    db.userSession.findUnique.mockResolvedValue({
      id: "sess-1",
      csrfToken: "csrf-abc",
      expiresAt: new Date(Date.now() + 60_000),
      user,
    });
    const result = await loadSession(mockRequest({ fp_sid: "sess-1" }));
    expect(result).toMatchObject({
      sessionId: "sess-1",
      csrfToken: "csrf-abc",
      user,
    });
  });
});

// ── destroySession ────────────────────────────────────────────────────────────

describe("destroySession", () => {
  it("deletes the session row by id", async () => {
    db.userSession.delete.mockResolvedValue({});
    await destroySession("sess-1");
    expect(db.userSession.delete).toHaveBeenCalledWith({ where: { id: "sess-1" } });
  });

  it("silently ignores not-found errors (already deleted)", async () => {
    db.userSession.delete.mockRejectedValue(new Error("Record not found"));
    await expect(destroySession("sess-never-existed")).resolves.not.toThrow();
  });
});
