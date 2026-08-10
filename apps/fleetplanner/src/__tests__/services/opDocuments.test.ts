import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../db.js", () => ({
  prisma: {
    operationDocument: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  writeFile: vi.fn(async () => undefined),
  unlink: vi.fn(async () => undefined),
}));

vi.mock("node:fs", () => ({
  createReadStream: vi.fn(() => ({ path: "stream" })),
}));

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { prisma } from "../../db.js";
import {
  addOpDocument,
  getOpDocument,
  listOpDocuments,
  MAX_OP_DOCUMENTS,
  MAX_PDF_BYTES,
  OP_DOCS_DIR,
  removeOpDocument,
} from "../../services/opDocuments.js";

/* eslint-disable @typescript-eslint/no-explicit-any */
const db = prisma as any;
const fsWrite = writeFile as any;
const fsUnlink = unlink as any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeEach(() => {
  vi.clearAllMocks();
  db.operationDocument.count.mockResolvedValue(0);
  db.operationDocument.create.mockImplementation(async ({ data }: { data: { filename: string } }) => ({
    id: "d1",
    filename: data.filename,
    size: 1,
    createdAt: new Date(),
  }));
});

describe("addOpDocument — validation", () => {
  it("rejects an empty file", async () => {
    expect(await addOpDocument("op1", "u1", "x.pdf", Buffer.alloc(0))).toEqual({ ok: false, reason: "empty" });
    expect(fsWrite).not.toHaveBeenCalled();
  });

  it("rejects a file over the size cap", async () => {
    const tooBig = Buffer.alloc(MAX_PDF_BYTES + 1);
    expect(await addOpDocument("op1", "u1", "x.pdf", tooBig)).toEqual({ ok: false, reason: "too_large" });
    expect(fsWrite).not.toHaveBeenCalled();
  });

  it("rejects once the per-op limit is reached", async () => {
    db.operationDocument.count.mockResolvedValue(MAX_OP_DOCUMENTS);
    expect(await addOpDocument("op1", "u1", "x.pdf", Buffer.from("pdf"))).toEqual({ ok: false, reason: "limit" });
    expect(fsWrite).not.toHaveBeenCalled();
  });
});

describe("addOpDocument — filename handling", () => {
  async function nameFor(raw: string): Promise<string> {
    const result = await addOpDocument("op1", "u1", raw, Buffer.from("pdf"));
    if (!result.ok) throw new Error("expected success");
    return result.doc.filename;
  }

  it("strips path traversal and unsafe characters", async () => {
    // A client-supplied name must never influence where the file lands.
    expect(await nameFor("../../etc/passwd.pdf")).toBe(".._.._etc_passwd.pdf");
    expect(await nameFor("brief ops;rm -rf.pdf")).toBe("brief_ops_rm_-rf.pdf");
  });

  it("appends .pdf when the client name has no extension", async () => {
    expect(await nameFor("briefing")).toBe("briefing.pdf");
  });

  it("keeps an existing .pdf regardless of case", async () => {
    expect(await nameFor("Briefing.PDF")).toBe("Briefing.PDF");
  });

  it("falls back to a default name for an empty one", async () => {
    expect(await nameFor("")).toBe("dokument.pdf");
  });

  it("bounds the display name", async () => {
    expect((await nameFor(`${"a".repeat(300)}.pdf`)).length).toBeLessThanOrEqual(104);
  });

  it("stores under a random uuid, never under the client name", async () => {
    await addOpDocument("op1", "u1", "../evil.pdf", Buffer.from("pdf"));
    const storedName = db.operationDocument.create.mock.calls[0][0].data.storedName as string;
    expect(storedName).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    expect(mkdir).toHaveBeenCalledWith(OP_DOCS_DIR, { recursive: true });
    expect(String(fsWrite.mock.calls[0][0])).toContain(storedName);
  });
});

describe("reads and deletes are scoped to the operation", () => {
  it("lists an op's documents oldest-first without the stored name", async () => {
    db.operationDocument.findMany.mockResolvedValue([]);
    await listOpDocuments("op1");
    const args = db.operationDocument.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ operationId: "op1" });
    expect(args.orderBy).toEqual({ createdAt: "asc" });
    // storedName is the on-disk path component — it must not leak to clients.
    expect(args.select.storedName).toBeUndefined();
  });

  it("looks a document up by id AND operation", async () => {
    db.operationDocument.findFirst.mockResolvedValue(null);
    await getOpDocument("op1", "d1");
    expect(db.operationDocument.findFirst.mock.calls[0][0].where).toEqual({ id: "d1", operationId: "op1" });
  });

  it("deletes the row and the file", async () => {
    db.operationDocument.findFirst.mockResolvedValue({ storedName: "abc.pdf" });
    await removeOpDocument("op1", "d1");
    expect(db.operationDocument.deleteMany).toHaveBeenCalledWith({ where: { id: "d1", operationId: "op1" } });
    expect(String(fsUnlink.mock.calls[0][0])).toContain("abc.pdf");
  });

  it("does nothing when the document belongs to another op", async () => {
    db.operationDocument.findFirst.mockResolvedValue(null);
    await removeOpDocument("op1", "foreign");
    expect(db.operationDocument.deleteMany).not.toHaveBeenCalled();
    expect(fsUnlink).not.toHaveBeenCalled();
  });

  it("still removes the row when the file is already gone", async () => {
    db.operationDocument.findFirst.mockResolvedValue({ storedName: "gone.pdf" });
    fsUnlink.mockRejectedValueOnce(new Error("ENOENT"));
    await expect(removeOpDocument("op1", "d1")).resolves.toBeUndefined();
    expect(db.operationDocument.deleteMany).toHaveBeenCalled();
  });
});
