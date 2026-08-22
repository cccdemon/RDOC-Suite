// FR-P3 — Mission Resource Links. Operator-curated tutorial/guide links on an
// operation (YouTube guide, RSI Community-Hub one-pager, Google-Doc, image).
// Op-scoped, ordered; visibility follows the operation. `kind` is derived from
// the URL host (operator-overridable from the caller). Authorization is enforced
// by the route layer (fleetoperator/superadmin/leader of the op).
import { prisma } from "../db.js";

export type ResourceLinkKind = "link" | "youtube" | "rsi_hub" | "gdoc" | "image";
const RESOURCE_LINK_KINDS: readonly ResourceLinkKind[] = [
  "link",
  "youtube",
  "rsi_hub",
  "gdoc",
  "image",
];

/** Hard cap on links per op — keeps the briefing card from becoming clutter. */
const MAX_RESOURCE_LINKS = 10;

/**
 * Validate a user-supplied URL. Only absolute http/https URLs are accepted —
 * `javascript:`/`data:` and relative inputs are rejected (XSS / phishing guard).
 * Returns the normalised href, or null when invalid.
 */
export function normalizeUrl(raw: string): string | null {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.href;
}

/** Derive the display `kind` from the URL host/path. */
export function deriveKind(url: string): ResourceLinkKind {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    path = u.pathname.toLowerCase();
  } catch {
    return "link";
  }
  if (host === "youtu.be" || host.endsWith("youtube.com")) return "youtube";
  if (host.endsWith("robertsspaceindustries.com")) return "rsi_hub";
  if (host.endsWith("docs.google.com")) return "gdoc";
  if (/\.(png|jpe?g|gif|webp|avif)$/.test(path)) return "image";
  return "link";
}

/** Best-effort YouTube video id (for the thumbnail) — null when not parseable. */
export function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname === "youtu.be") return u.pathname.slice(1) || null;
    if (u.hostname.endsWith("youtube.com")) {
      const v = u.searchParams.get("v");
      if (v) return v;
      const m = u.pathname.match(/\/(embed|shorts)\/([\w-]+)/);
      if (m) return m[2];
    }
  } catch {
    /* ignore */
  }
  return null;
}

/** Fallback display title when the operator left it blank — the URL host. */
function fallbackTitle(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * Append a link to an op. Returns `null` when the URL is invalid or the op is
 * already at MAX_RESOURCE_LINKS. `kind` defaults to the derived value; pass a
 * value in RESOURCE_LINK_KINDS to override.
 */
export async function addResourceLink(
  operationId: string,
  addedById: string,
  input: { url: string; title?: string | null; kind?: string | null },
) {
  const url = normalizeUrl(input.url);
  if (!url) return null;
  const count = await prisma.operationResourceLink.count({ where: { operationId } });
  if (count >= MAX_RESOURCE_LINKS) return null;
  const title = (input.title ?? "").trim().slice(0, 120) || fallbackTitle(url);
  const kind =
    input.kind && (RESOURCE_LINK_KINDS as readonly string[]).includes(input.kind)
      ? (input.kind as ResourceLinkKind)
      : deriveKind(url);
  const max = await prisma.operationResourceLink.aggregate({
    where: { operationId },
    _max: { sortOrder: true },
  });
  return prisma.operationResourceLink.create({
    data: {
      operationId,
      addedById,
      url,
      title,
      kind,
      sortOrder: (max._max.sortOrder ?? -1) + 1,
    },
  });
}

/** Remove a link (scoped to the op so a stray id can't delete another op's link). */
export async function removeResourceLink(operationId: string, linkId: string): Promise<void> {
  await prisma.operationResourceLink.deleteMany({ where: { id: linkId, operationId } });
}
