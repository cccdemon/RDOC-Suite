import { getEnv } from "../config/env.js";
import { logger } from "./logger.js";

/** Asset entry from the GitHub Releases API. We only model the fields
 *  the bridge actually uses for the companion download flow. */
export type GitHubReleaseAsset = {
  id: number;
  name: string;
  size: number;
  /** API URL of the asset — works for private repos when called with
   *  `Authorization: Bearer <token>` and `Accept: application/octet-stream`.
   *  Different from `browser_download_url` which only works for public
   *  repos / signed redirects. */
  apiUrl: string;
};

export type GitHubReleaseInfo = {
  tagName: string;
  name: string | null;
  publishedAt: string | null;
  body: string | null;
  /** Portable EXE asset (matched by COMPANION_ASSET_PATTERN). Used by
   *  both the admin-mintable download link AND the auto-update flow
   *  (which mints a single-use token and opens the regular landing
   *  page in the user's browser). */
  asset: GitHubReleaseAsset | null;
};

/**
 * Fetch the latest release from the configured GitHub repo and pick
 * the asset whose name contains COMPANION_ASSET_PATTERN (default
 * ".exe"). Returns null when the bridge isn't configured for downloads
 * (no GITHUB_REPO) or when the API call fails — callers decide how
 * to surface that.
 */
export async function fetchLatestCompanionRelease(): Promise<GitHubReleaseInfo | null> {
  const env = getEnv();
  if (!env.GITHUB_REPO) {
    return null;
  }
  const url = `https://api.github.com/repos/${env.GITHUB_REPO}/releases/latest`;
  const headers: Record<string, string> = {
    accept: "application/vnd.github+json",
    "user-agent": "dccc-bridge",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(url, { headers });
  } catch (err) {
    logger.warn({ err, repo: env.GITHUB_REPO }, "github releases fetch threw");
    return null;
  }
  if (!res.ok) {
    logger.warn(
      { repo: env.GITHUB_REPO, status: res.status },
      "github releases fetch returned non-ok",
    );
    return null;
  }
  const raw: unknown = await res.json();
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as {
    tag_name?: string;
    name?: string | null;
    published_at?: string | null;
    body?: string | null;
    assets?: unknown;
  };
  if (typeof obj.tag_name !== "string") return null;
  const pattern = env.COMPANION_ASSET_PATTERN.toLowerCase();
  const assets = Array.isArray(obj.assets) ? obj.assets : [];

  // Parse all assets first so we can find the primary one plus its
  // sibling .sig file used by the Tauri auto-updater.
  const parsed: GitHubReleaseAsset[] = [];
  for (const a of assets) {
    if (!a || typeof a !== "object") continue;
    const x = a as { id?: unknown; name?: unknown; size?: unknown; url?: unknown };
    if (
      typeof x.id !== "number" ||
      typeof x.name !== "string" ||
      typeof x.size !== "number" ||
      typeof x.url !== "string"
    ) {
      continue;
    }
    parsed.push({ id: x.id, name: x.name, size: x.size, apiUrl: x.url });
  }

  // Primary asset = first one matching the pattern (and not a .sig
  // sibling, in case some build pipeline produces one).
  const asset =
    parsed.find(
      (x) => x.name.toLowerCase().includes(pattern) && !x.name.toLowerCase().endsWith(".sig"),
    ) ?? null;

  return {
    tagName: obj.tag_name,
    name: obj.name ?? null,
    publishedAt: obj.published_at ?? null,
    body: obj.body ?? null,
    asset,
  };
}

/**
 * Fetch an asset's bytes from GitHub into memory and return as a
 * Node Buffer. Companion EXEs are < 10 MB; buffering in RAM is fine
 * and dodges the Fastify ↔ Web-ReadableStream interop bug that
 * silently produced 0-byte downloads.
 *
 * Returns null on error so the caller can 502.
 */
export async function fetchCompanionAssetBody(
  asset: GitHubReleaseAsset,
): Promise<{ body: Buffer; size: number } | null> {
  const env = getEnv();
  const headers: Record<string, string> = {
    accept: "application/octet-stream",
    "user-agent": "dccc-bridge",
    "x-github-api-version": "2022-11-28",
  };
  if (env.GITHUB_TOKEN) headers.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  let res: Response;
  try {
    res = await fetch(asset.apiUrl, { headers, redirect: "follow" });
  } catch (err) {
    logger.warn({ err, assetId: asset.id }, "github asset fetch threw");
    return null;
  }
  if (!res.ok) {
    logger.warn(
      { assetId: asset.id, status: res.status },
      "github asset fetch returned non-ok",
    );
    return null;
  }
  const ab = await res.arrayBuffer();
  const body = Buffer.from(ab);
  logger.info(
    { assetId: asset.id, expectedSize: asset.size, actualSize: body.byteLength },
    "github asset fetched into memory",
  );
  return { body, size: body.byteLength };
}
