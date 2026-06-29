// FR-P3 Stream-Event Phase B1 — per-streamer links on an operation (self-service).
// Any participant with op access adds their own stream; the entry owner or a
// fleetoperator can remove it. Adding the first stream marks the op as a stream
// event. Platform is validated; the URL must match the platform host (twitch/
// youtube/vdo.ninja) or, for "other", be any absolute http(s) URL.
import { prisma } from "../db.js";
import { normalizeUrl } from "./resourceLinks.js";

export type StreamPlatform = "twitch" | "youtube" | "vdo_ninja" | "other";
export const STREAM_PLATFORMS: readonly StreamPlatform[] = ["twitch", "youtube", "vdo_ninja", "other"];

/** Hard cap per op — keeps the streams list from becoming clutter. */
export const MAX_STREAMS = 20;

/** Host allow-list per platform. "other" accepts any http(s) host. */
function hostOkForPlatform(url: string, platform: StreamPlatform): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return false;
  }
  switch (platform) {
    case "twitch":
      return host === "twitch.tv" || host.endsWith(".twitch.tv");
    case "youtube":
      return host === "youtube.com" || host.endsWith(".youtube.com") || host === "youtu.be";
    case "vdo_ninja":
      return host === "vdo.ninja" || host.endsWith(".vdo.ninja");
    case "other":
      return true;
  }
}

function fallbackLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export async function listStreams(operationId: string) {
  return prisma.operationStream.findMany({
    where: { operationId },
    include: { user: { select: { id: true, username: true } } },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Add a streamer link. Returns null when the URL is invalid for the platform or
 * the op is at MAX_STREAMS. The first stream on an op flips isStreamEvent on.
 */
export async function addStream(
  operationId: string,
  userId: string,
  input: { platform: string; url: string; label?: string | null },
) {
  const platform = (STREAM_PLATFORMS as readonly string[]).includes(input.platform)
    ? (input.platform as StreamPlatform)
    : null;
  if (!platform) return null;
  const url = normalizeUrl(input.url);
  if (!url || !hostOkForPlatform(url, platform)) return null;
  const count = await prisma.operationStream.count({ where: { operationId } });
  if (count >= MAX_STREAMS) return null;
  const label = (input.label ?? "").trim().slice(0, 80) || fallbackLabel(url);

  // The isStreamEvent flag is set manually via the wizard / operator console —
  // adding a stream link does NOT auto-flag the op (kept fully optional).
  return prisma.operationStream.create({
    data: { operationId, userId, platform, url, label },
    include: { user: { select: { id: true, username: true } } },
  });
}

/** The user id that owns a stream entry (for the self-delete check), or null. */
export async function streamOwner(operationId: string, streamId: string): Promise<string | null | undefined> {
  const s = await prisma.operationStream.findFirst({
    where: { id: streamId, operationId },
    select: { userId: true },
  });
  return s ? s.userId : undefined; // undefined = not found; null = external (no owner)
}

/** Remove a stream (scoped to the op so a stray id can't touch another op). */
export async function removeStream(operationId: string, streamId: string): Promise<void> {
  await prisma.operationStream.deleteMany({ where: { id: streamId, operationId } });
}
