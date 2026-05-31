import { getPrisma } from "@rdoc-suite/db";
import {
  createGuildVoiceChannel,
  deleteChannel,
  moveGuildMember,
  type DiscordGuildChannel,
} from "../auth/discord.js";
import { getOAuthEnv } from "../config/env.js";
import { bridgeEvents } from "./bridgeEvents.js";
import { getCachedChannels, invalidateChannels } from "./discordMetaCache.js";
import { readGuildConfig } from "./guildConfig.js";
import { logger } from "./logger.js";

// Per-design (2026-05-28 user decision): channels are garbage-collected
// once they've been empty for 15 minutes, polled every 30 seconds.
const IDLE_THRESHOLD_MS = 15 * 60_000;
const TICK_INTERVAL_MS = 30_000;

export type StrategyChannelCreateResult =
  | { ok: true; channelId: string; name: string; moved: string[]; moveFailures: Array<{ userId: string; status: number; message: string }> }
  | { ok: false; reason: "discord_create_failed"; status: number; message: string }
  | { ok: false; reason: "no_oauth" };

/**
 * Create a temporary voice channel and move the selected commanders
 * into it. Parent category is taken from the first entry in
 * `GuildConfig.allowedVoiceChannelIds` (same parent as the squad's
 * regular channels). If that channel can't be looked up, the strategy
 * channel lands top-level — still works, just slightly out of place.
 *
 * Per-user move failures are tolerated (one rate-limited user shouldn't
 * abort the call) and surfaced in `moveFailures`.
 */
export async function createStrategyChannel(opts: {
  guildId: string;
  name: string;
  userIds: string[];
  createdBy: string;
}): Promise<StrategyChannelCreateResult> {
  const oauth = getOAuthEnv();
  if (!oauth) return { ok: false, reason: "no_oauth" };

  const parentId = await resolveParentCategory(opts.guildId, oauth.DISCORD_BOT_TOKEN);

  const created = await createGuildVoiceChannel({
    botToken: oauth.DISCORD_BOT_TOKEN,
    guildId: opts.guildId,
    name: opts.name,
    parentId,
  });
  if (!created.ok) {
    return {
      ok: false,
      reason: "discord_create_failed",
      status: created.error.status,
      message: created.error.message,
    };
  }
  const channel = created.value;

  // Drop the channels cache so the next dashboard repaint shows the
  // new channel (otherwise it'd be invisible for up to 60 s).
  invalidateChannels(opts.guildId);

  // Persist BEFORE moving users — if the move loop crashes we still
  // have a row that the GC can clean up later.
  await getPrisma().ephemeralChannel.create({
    data: {
      guildId: opts.guildId,
      channelId: channel.id,
      name: channel.name,
      createdBy: opts.createdBy,
    },
  });

  // Fan out moves in parallel. Promise.allSettled so a single
  // rate-limit or user-not-in-voice doesn't block the rest.
  const moveResults = await Promise.allSettled(
    opts.userIds.map((userId) =>
      moveGuildMember({
        botToken: oauth.DISCORD_BOT_TOKEN,
        guildId: opts.guildId,
        userId,
        channelId: channel.id,
      }).then((r) => ({ userId, r })),
    ),
  );

  const moved: string[] = [];
  const moveFailures: Array<{ userId: string; status: number; message: string }> = [];
  for (let i = 0; i < moveResults.length; i++) {
    const settled = moveResults[i]!;
    if (settled.status === "fulfilled") {
      const { userId, r } = settled.value;
      if (r.ok) moved.push(userId);
      else
        moveFailures.push({
          userId,
          status: r.error.status,
          message: r.error.message,
        });
    } else {
      moveFailures.push({
        userId: opts.userIds[i]!,
        status: 0,
        message: String(settled.reason),
      });
    }
  }

  bridgeEvents.emitGuildStateChanged(opts.guildId);

  logger.info(
    {
      guildId: opts.guildId,
      channelId: channel.id,
      name: channel.name,
      moved: moved.length,
      failed: moveFailures.length,
    },
    "strategy channel created",
  );

  return {
    ok: true,
    channelId: channel.id,
    name: channel.name,
    moved,
    moveFailures,
  };
}

/**
 * Look up the parent-category of the first allowed voice channel.
 * Returns null when the config has no allowed channels yet, the
 * channel cache is empty, or that channel sits top-level (parent_id
 * = null) — in all those cases the strategy channel lands top-level.
 */
async function resolveParentCategory(
  guildId: string,
  botToken: string,
): Promise<string | null> {
  const cfg = await readGuildConfig(guildId);
  const firstAllowed = cfg?.allowedVoiceChannelIds?.[0];
  if (!firstAllowed) return null;
  let channels: DiscordGuildChannel[];
  try {
    channels = await getCachedChannels(guildId, botToken);
  } catch (err) {
    logger.warn({ err, guildId }, "strategy: getCachedChannels failed, defaulting to top-level");
    return null;
  }
  const match = channels.find((c) => c.id === firstAllowed);
  return match?.parent_id ?? null;
}

let tickTimer: NodeJS.Timeout | null = null;

/**
 * Start the background GC loop. Safe to call once at server boot.
 * Calls `tickGarbageCollect` every TICK_INTERVAL_MS (30 s).
 */
export function startStrategyChannelGc(): void {
  if (tickTimer) return; // idempotent
  tickTimer = setInterval(() => {
    tickGarbageCollect().catch((err) =>
      logger.error({ err }, "strategy-channel gc tick failed"),
    );
  }, TICK_INTERVAL_MS);
  tickTimer.unref?.();
}

export function stopStrategyChannelGc(): void {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

/**
 * One garbage-collect pass: for every EphemeralChannel row, count how
 * many users are currently in that channel via UserVoiceState. If > 0,
 * refresh `lastActiveAt` to now. If 0 AND `lastActiveAt` is older than
 * IDLE_THRESHOLD_MS, delete the channel in Discord and drop the row.
 *
 * Exported for tests; production calls it via the cron loop only.
 */
export async function tickGarbageCollect(): Promise<void> {
  const oauth = getOAuthEnv();
  // Without OAuth we can't delete anything — skip silently. The rows
  // stay in the DB until OAuth is configured again.
  const prisma = getPrisma();
  const rows = await prisma.ephemeralChannel.findMany();
  if (rows.length === 0) return;

  const now = Date.now();
  for (const row of rows) {
    const occupants = await prisma.userVoiceState.count({
      where: { guildId: row.guildId, channelId: row.channelId },
    });
    if (occupants > 0) {
      await prisma.ephemeralChannel.update({
        where: { channelId: row.channelId },
        data: { lastActiveAt: new Date(now) },
      });
      continue;
    }
    // Empty — check the idle window.
    if (now - row.lastActiveAt.getTime() < IDLE_THRESHOLD_MS) continue;

    if (!oauth) {
      logger.warn(
        { channelId: row.channelId, guildId: row.guildId },
        "strategy gc: would delete but oauth not configured — skipping",
      );
      continue;
    }
    const del = await deleteChannel({
      botToken: oauth.DISCORD_BOT_TOKEN,
      channelId: row.channelId,
    });
    if (!del.ok) {
      logger.warn(
        {
          channelId: row.channelId,
          guildId: row.guildId,
          status: del.error.status,
        },
        "strategy gc: discord delete failed; will retry next tick",
      );
      continue;
    }
    await prisma.ephemeralChannel.delete({ where: { channelId: row.channelId } });
    invalidateChannels(row.guildId);
    bridgeEvents.emitGuildStateChanged(row.guildId);
    logger.info(
      {
        channelId: row.channelId,
        guildId: row.guildId,
        name: row.name,
        ageMin: Math.round((now - row.createdAt.getTime()) / 60_000),
      },
      "strategy channel deleted by gc",
    );
  }
}
