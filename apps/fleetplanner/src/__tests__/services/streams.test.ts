import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operationStream: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../db.js";
import { addStream, listStreams, MAX_STREAMS, removeStream, streamOwner } from "../../services/streams.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.operationStream.count.mockResolvedValue(0);
  db.operationStream.create.mockImplementation(async ({ data }: { data: unknown }) => data);
});

describe("addStream — platform/host matching", () => {
  it.each([
    ["twitch", "https://twitch.tv/rdoc"],
    ["twitch", "https://www.twitch.tv/rdoc"],
    ["twitch", "https://m.twitch.tv/rdoc"],
    ["youtube", "https://youtube.com/watch?v=abc"],
    ["youtube", "https://youtu.be/abc"],
    ["vdo_ninja", "https://vdo.ninja/?room=x"],
    ["other", "https://stream.example.org/live"],
  ])("accepts %s → %s", async (platform, url) => {
    const created = await addStream("op1", "u1", { platform, url });
    expect(created).toBeTruthy();
  });

  it.each([
    ["twitch", "https://youtube.com/rdoc"],
    // Suffix trickery: nottwitch.tv must not pass as twitch.tv.
    ["twitch", "https://nottwitch.tv/rdoc"],
    ["youtube", "https://vimeo.com/1"],
    ["vdo_ninja", "https://vdo.ninja.evil.com/"],
  ])("rejects %s → %s", async (platform, url) => {
    expect(await addStream("op1", "u1", { platform, url })).toBeNull();
  });

  it("rejects an unknown platform", async () => {
    expect(await addStream("op1", "u1", { platform: "kick", url: "https://kick.com/x" })).toBeNull();
  });

  it("rejects a non-http(s) URL even for 'other'", async () => {
    expect(await addStream("op1", "u1", { platform: "other", url: "javascript:alert(1)" })).toBeNull();
    expect(await addStream("op1", "u1", { platform: "other", url: "not a url" })).toBeNull();
  });
});

describe("addStream — labels and limits", () => {
  it("falls back to the hostname when no label is given", async () => {
    const created = (await addStream("op1", "u1", { platform: "twitch", url: "https://www.twitch.tv/rdoc" })) as {
      label: string;
    };
    expect(created.label).toBe("twitch.tv");
  });

  it("trims and caps a supplied label at 80 chars", async () => {
    const created = (await addStream("op1", "u1", {
      platform: "twitch",
      url: "https://twitch.tv/rdoc",
      label: `  ${"L".repeat(200)}  `,
    })) as { label: string };
    expect(created.label).toHaveLength(80);
  });

  it("refuses to exceed the per-op cap", async () => {
    db.operationStream.count.mockResolvedValue(MAX_STREAMS);
    expect(await addStream("op1", "u1", { platform: "twitch", url: "https://twitch.tv/rdoc" })).toBeNull();
    expect(db.operationStream.create).not.toHaveBeenCalled();
  });

  it("records the adding user as the owner", async () => {
    const created = (await addStream("op1", "u7", { platform: "twitch", url: "https://twitch.tv/rdoc" })) as {
      userId: string;
      operationId: string;
    };
    expect(created).toMatchObject({ userId: "u7", operationId: "op1" });
  });
});

describe("streamOwner", () => {
  it("distinguishes not-found (undefined) from ownerless (null)", async () => {
    db.operationStream.findFirst.mockResolvedValue(null);
    expect(await streamOwner("op1", "missing")).toBeUndefined();
    db.operationStream.findFirst.mockResolvedValue({ userId: null });
    expect(await streamOwner("op1", "external")).toBeNull();
    db.operationStream.findFirst.mockResolvedValue({ userId: "u1" });
    expect(await streamOwner("op1", "s1")).toBe("u1");
  });
});

describe("removeStream", () => {
  it("scopes the delete to the operation so a stray id cannot cross ops", async () => {
    await removeStream("op1", "s1");
    expect(db.operationStream.deleteMany).toHaveBeenCalledWith({ where: { id: "s1", operationId: "op1" } });
  });
});

describe("listStreams", () => {
  it("returns entries oldest-first with their owner", async () => {
    db.operationStream.findMany.mockResolvedValue([]);
    await listStreams("op1");
    expect(db.operationStream.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { operationId: "op1" }, orderBy: { createdAt: "asc" } }),
    );
  });
});
