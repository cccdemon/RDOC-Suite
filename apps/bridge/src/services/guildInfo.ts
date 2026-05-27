import { getOAuthEnv } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Tiny in-memory cache of Discord guild metadata (name, icon hash) so
 * the admin UI can show "Dashboard // <Server Name>" instead of bare
 * snowflakes. The cache TTL is generous (1h) because guild names rarely
 * change and we don't want to hammer Discord on every dashboard tick.
 */

export type DiscordGuildInfo = {
  id: string;
  name: string;
  icon: string | null;
};

// Positive hits are stable (guild name rarely changes) → cache for 1h.
// Negative misses (bot not in guild, name-fetch failed) get a much
// shorter TTL so that freshly-invited bots show up in the UI within
// ~30s instead of being stuck at "(Bot fehlt)" for an hour.
const POSITIVE_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 30 * 1000;

type CacheEntry = { value: DiscordGuildInfo | null; fetchedAt: number };
const cache = new Map<string, CacheEntry>();

async function fetchGuildFromDiscord(guildId: string): Promise<DiscordGuildInfo | null> {
  const oauth = getOAuthEnv();
  if (!oauth) return null;
  try {
    const res = await fetch(`https://discord.com/api/v10/guilds/${guildId}`, {
      headers: { authorization: `Bot ${oauth.DISCORD_BOT_TOKEN}` },
    });
    if (!res.ok) {
      logger.warn(
        { guildId, status: res.status },
        "discord guild fetch failed",
      );
      return null;
    }
    const raw: unknown = await res.json();
    if (
      raw &&
      typeof raw === "object" &&
      "id" in raw &&
      "name" in raw &&
      typeof (raw as { id: unknown }).id === "string" &&
      typeof (raw as { name: unknown }).name === "string"
    ) {
      const obj = raw as { id: string; name: string; icon?: string | null };
      return { id: obj.id, name: obj.name, icon: obj.icon ?? null };
    }
    return null;
  } catch (err) {
    logger.warn({ err, guildId }, "discord guild fetch threw");
    return null;
  }
}

export async function getGuildInfo(guildId: string): Promise<DiscordGuildInfo | null> {
  const cached = cache.get(guildId);
  if (cached) {
    const ttl = cached.value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    if (Date.now() - cached.fetchedAt < ttl) {
      return cached.value;
    }
  }
  const value = await fetchGuildFromDiscord(guildId);
  cache.set(guildId, { value, fetchedAt: Date.now() });
  return value;
}

/** Resolve names for many guilds in parallel. */
export async function getGuildInfos(
  guildIds: string[],
): Promise<Map<string, DiscordGuildInfo | null>> {
  const entries = await Promise.all(
    guildIds.map(async (id) => [id, await getGuildInfo(id)] as const),
  );
  return new Map(entries);
}

/** Test-only: drop the cache between tests. */
export function _clearGuildInfoCache(): void {
  cache.clear();
}
