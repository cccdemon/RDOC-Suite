import {
  fetchGuildChannels,
  fetchGuildRoles,
  type DiscordGuildChannel,
  type DiscordGuildRole,
} from "../auth/discord.js";
import { logger } from "./logger.js";

/**
 * In-process TTL cache for Discord guild metadata (channels, roles,
 * members) used by the admin dashboard polling.
 *
 * Why: every `/admin/api/live` request used to fire 3 Discord REST
 * calls (channels + roles + members). With the dashboard polling every
 * 5 seconds and Discord throttling around per-route 5 req/s, that
 * compounds quickly — the UI gets sluggish and a brief Discord hiccup
 * empties the Channel-Mirror card on the screen.
 *
 * Two-tier strategy: a freshness TTL after which we re-fetch in the
 * background, plus an unlimited-lifetime "last known good" slot that
 * we serve back to the caller when a re-fetch fails. The net effect
 * is that the admin UI never goes blank just because Discord had a
 * 5-second wobble — it might show slightly stale data, but stale is
 * always preferable to "everything disappeared".
 */

const FRESH_TTL_MS = 60_000; // re-fetch in background after this
const STALE_TTL_MS = 30 * 60_000; // hard purge after this (e.g. bot left guild)

type CacheEntry<T> = {
  value: T;
  fetchedAt: number;
  /** Set while a re-fetch is in flight to dedupe concurrent callers. */
  inflight?: Promise<T | null>;
};

const channelsCache = new Map<string, CacheEntry<DiscordGuildChannel[]>>();
const rolesCache = new Map<string, CacheEntry<DiscordGuildRole[]>>();

async function getOrFetch<T>(
  cache: Map<string, CacheEntry<T>>,
  guildId: string,
  fetcher: () => Promise<T | null>,
  label: string,
): Promise<T | null> {
  const now = Date.now();
  const entry = cache.get(guildId);
  if (entry && now - entry.fetchedAt < FRESH_TTL_MS) {
    return entry.value;
  }
  // Single-flight: if a re-fetch is already in flight, ride it.
  if (entry?.inflight) {
    return entry.inflight;
  }
  if (entry && now - entry.fetchedAt < STALE_TTL_MS) {
    // Stale but usable. Kick off a background refresh, serve current.
    const inflight = fetcher()
      .then((fresh) => {
        if (fresh) {
          cache.set(guildId, { value: fresh, fetchedAt: Date.now() });
        } else {
          // Fetcher failed — keep the stale value, mark it as
          // attempted so we don't hammer the API every poll.
          cache.set(guildId, {
            value: entry.value,
            fetchedAt: Date.now() - FRESH_TTL_MS + 5_000,
          });
          logger.warn({ guildId, label }, "discord meta refresh failed, keeping stale");
        }
        return cache.get(guildId)?.value ?? null;
      })
      .catch((err) => {
        logger.warn({ err, guildId, label }, "discord meta refresh threw, keeping stale");
        return entry.value;
      });
    cache.set(guildId, { ...entry, inflight });
    // Don't await — return stale immediately.
    return entry.value;
  }
  // No cache at all (or hard-expired). Block on the first fetch only.
  const inflight = fetcher()
    .then((fresh) => {
      if (fresh) {
        cache.set(guildId, { value: fresh, fetchedAt: Date.now() });
        return fresh;
      }
      // First fetch failed and we have nothing → caller has to cope.
      cache.delete(guildId);
      return null;
    })
    .catch((err) => {
      logger.warn({ err, guildId, label }, "discord meta initial fetch threw");
      cache.delete(guildId);
      return null;
    });
  // Mark in-flight so concurrent calls don't double-fetch.
  cache.set(guildId, {
    value: ([] as unknown) as T,
    fetchedAt: 0,
    inflight,
  });
  return inflight;
}

export async function getCachedChannels(
  guildId: string,
  botToken: string,
): Promise<DiscordGuildChannel[]> {
  const v = await getOrFetch(
    channelsCache,
    guildId,
    async () => {
      const res = await fetchGuildChannels({ botToken, guildId });
      return res.ok ? res.value : null;
    },
    "channels",
  );
  return v ?? [];
}

export async function getCachedRoles(
  guildId: string,
  botToken: string,
): Promise<DiscordGuildRole[]> {
  const v = await getOrFetch(
    rolesCache,
    guildId,
    async () => {
      const res = await fetchGuildRoles({ botToken, guildId });
      return res.ok ? res.value : null;
    },
    "roles",
  );
  return v ?? [];
}

/**
 * Invalidate the cached channels for a guild — call from mutation
 * endpoints (e.g. after a successful rename) so the next polling tick
 * surfaces the new name immediately instead of waiting up to 60s.
 */
export function invalidateChannels(guildId: string): void {
  channelsCache.delete(guildId);
}

export function invalidateRoles(guildId: string): void {
  rolesCache.delete(guildId);
}
