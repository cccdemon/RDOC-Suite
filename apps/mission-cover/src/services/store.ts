import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEnv } from "../config/env.js";
import type { CoverMeta } from "../schema.js";

// Flat artifact store on a mounted volume:
//   <DATA_DIR>/<id>.png        the rendered cover
//   <DATA_DIR>/<id>.json       its CoverMeta
//   <DATA_DIR>/op-index.json   { [opId]: id }  newest cover per op
//
// Low volume → a single JSON index is plenty; no DB dependency keeps the
// microservice self-contained.

const OP_INDEX = "op-index.json";

function dir(): string {
  return getEnv().DATA_DIR;
}

export async function ensureStore(): Promise<void> {
  await fs.mkdir(dir(), { recursive: true });
}

export function newId(): string {
  return `cov_${crypto.randomBytes(12).toString("hex")}`;
}

function pngPath(id: string): string {
  return path.join(dir(), `${id}.png`);
}
function metaPath(id: string): string {
  return path.join(dir(), `${id}.json`);
}
function indexPath(): string {
  return path.join(dir(), OP_INDEX);
}

async function readIndex(): Promise<Record<string, string>> {
  try {
    return JSON.parse(await fs.readFile(indexPath(), "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

async function writeIndex(idx: Record<string, string>): Promise<void> {
  const tmp = `${indexPath()}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(idx), "utf8");
  await fs.rename(tmp, indexPath());
}

export async function saveCover(meta: CoverMeta, png: Buffer): Promise<void> {
  await ensureStore();
  await fs.writeFile(pngPath(meta.id), png);
  await fs.writeFile(metaPath(meta.id), JSON.stringify(meta), "utf8");
  const idx = await readIndex();
  // Drop the previous cover for this op to avoid orphan files.
  const prev = idx[meta.opId];
  if (prev && prev !== meta.id) {
    await fs.rm(pngPath(prev), { force: true });
    await fs.rm(metaPath(prev), { force: true });
  }
  idx[meta.opId] = meta.id;
  await writeIndex(idx);
}

export async function getMeta(id: string): Promise<CoverMeta | null> {
  try {
    return JSON.parse(await fs.readFile(metaPath(id), "utf8")) as CoverMeta;
  } catch {
    return null;
  }
}

export async function getPng(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(pngPath(id));
  } catch {
    return null;
  }
}

export async function getCoverByOp(opId: string): Promise<CoverMeta | null> {
  const idx = await readIndex();
  const id = idx[opId];
  return id ? getMeta(id) : null;
}

// Validate an id shape before touching the filesystem (path-traversal guard).
export function isValidId(id: string): boolean {
  return /^cov_[0-9a-f]{24}$/.test(id);
}
