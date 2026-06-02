import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    companionSession: {
      create: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import {
  createMissionVoiceSession,
  loadMissionVoiceSession,
} from "../../auth/companionSession.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => vi.clearAllMocks());

describe("createMissionVoiceSession", () => {
  it("stores a mission-voice token bound to an operation", async () => {
    db.companionSession.create.mockResolvedValue({});

    const token = await createMissionVoiceSession("user-1", "op-1");

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(db.companionSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: token,
        userId: "user-1",
        operationId: "op-1",
        scope: "mission-voice",
      }),
    });
  });
});

describe("loadMissionVoiceSession", () => {
  it("loads an unexpired operation-bound mission token", async () => {
    db.companionSession.findUnique.mockResolvedValue({
      userId: "user-1",
      operationId: "op-1",
      scope: "mission-voice",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(loadMissionVoiceSession("a".repeat(64))).resolves.toEqual({
      userId: "user-1",
      operationId: "op-1",
    });
  });

  it("rejects unbound mission tokens", async () => {
    db.companionSession.findUnique.mockResolvedValue({
      userId: "user-1",
      operationId: null,
      scope: "mission-voice",
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(loadMissionVoiceSession("a".repeat(64))).resolves.toBeNull();
  });

  it("rejects expired or wrong-scope tokens", async () => {
    db.companionSession.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      operationId: "op-1",
      scope: "mission-voice",
      expiresAt: new Date(Date.now() - 60_000),
    });
    await expect(loadMissionVoiceSession("a".repeat(64))).resolves.toBeNull();

    db.companionSession.findUnique.mockResolvedValueOnce({
      userId: "user-1",
      operationId: "op-1",
      scope: "full",
      expiresAt: new Date(Date.now() + 60_000),
    });
    await expect(loadMissionVoiceSession("b".repeat(64))).resolves.toBeNull();
  });
});
