// Operator-attached PDF documents on an operation. The file bytes live on disk
// under OP_DOCS_DIR (a mounted volume in prod); the OperationDocument row is the
// metadata. Mirrors the ship-image storage pattern (web.ts SHIP_IMG_DIR). Reads
// (download) are gated by the route layer to the op's own visibility.
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { prisma } from "../db.js";

/** On-disk directory for op documents. Prod mounts a volume here. */
export const OP_DOCS_DIR = process.env.OP_DOCS_DIR ?? "/app/data/op-docs";

/** Max documents per op — keeps the briefing card tidy. */
export const MAX_OP_DOCUMENTS = 5;
/** Max PDF size. The multipart plugin also enforces an 8 MB hard limit. */
export const MAX_PDF_BYTES = 8 * 1024 * 1024;

export type AddDocResult =
  | { ok: true; doc: { id: string; filename: string; size: number; createdAt: Date } }
  | { ok: false; reason: "too_large" | "empty" | "limit" };

/** Sanitize a client filename to a safe, bounded display name ending in .pdf. */
function safePdfName(raw: string): string {
  const base = (raw || "dokument.pdf").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 100);
  return base.toLowerCase().endsWith(".pdf") ? base : `${base}.pdf`;
}

export async function addOpDocument(
  operationId: string,
  addedById: string,
  filename: string,
  buf: Buffer,
): Promise<AddDocResult> {
  if (buf.length === 0) return { ok: false, reason: "empty" };
  if (buf.length > MAX_PDF_BYTES) return { ok: false, reason: "too_large" };
  const count = await prisma.operationDocument.count({ where: { operationId } });
  if (count >= MAX_OP_DOCUMENTS) return { ok: false, reason: "limit" };

  const storedName = `${randomUUID()}.pdf`;
  await mkdir(OP_DOCS_DIR, { recursive: true });
  await writeFile(join(OP_DOCS_DIR, storedName), buf);

  const doc = await prisma.operationDocument.create({
    data: { operationId, addedById, filename: safePdfName(filename), storedName, size: buf.length },
    select: { id: true, filename: true, size: true, createdAt: true },
  });
  return { ok: true, doc };
}

export async function listOpDocuments(operationId: string) {
  return prisma.operationDocument.findMany({
    where: { operationId },
    orderBy: { createdAt: "asc" },
    select: { id: true, filename: true, size: true, createdAt: true },
  });
}

/** Fetch one document row (scoped to the op) for the download route. */
export async function getOpDocument(operationId: string, docId: string) {
  return prisma.operationDocument.findFirst({
    where: { id: docId, operationId },
    select: { id: true, filename: true, storedName: true, size: true },
  });
}

/** Open a read stream for a stored document. */
export function openOpDocument(storedName: string) {
  return createReadStream(join(OP_DOCS_DIR, storedName));
}

/** Remove a document (row + file). Scoped to the op so a stray id can't cross ops. */
export async function removeOpDocument(operationId: string, docId: string): Promise<void> {
  const doc = await prisma.operationDocument.findFirst({
    where: { id: docId, operationId },
    select: { storedName: true },
  });
  if (!doc) return;
  await prisma.operationDocument.deleteMany({ where: { id: docId, operationId } });
  await unlink(join(OP_DOCS_DIR, doc.storedName)).catch(() => {
    /* file already gone — the row is what mattered */
  });
}
