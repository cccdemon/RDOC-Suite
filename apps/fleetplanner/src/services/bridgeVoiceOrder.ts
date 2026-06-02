const SNOWFLAKE = /^[0-9]{17,20}$/;

export type ReorderDir = "up" | "down";

/**
 * Compute the new allowed-voice-channel order after moving one channel one
 * step up or down. `orderedCsv` is the current display order (comma-separated
 * channel IDs) as rendered into the reorder form; non-snowflake garbage is
 * dropped. Returns the swapped order, or `null` when the move is impossible
 * (channel not in the list, or already at the boundary in the requested
 * direction) so the caller can surface a flash error without touching Discord.
 */
export function applyChannelReorder(
  orderedCsv: string,
  channelId: string,
  dir: ReorderDir,
): string[] | null {
  const order = orderedCsv
    .split(",")
    .map((s) => s.trim())
    .filter((s) => SNOWFLAKE.test(s));
  const i = order.indexOf(channelId);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= order.length) return null;
  [order[i], order[j]] = [order[j]!, order[i]!];
  return order;
}
