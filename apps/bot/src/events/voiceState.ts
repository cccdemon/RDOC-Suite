import type { Client, VoiceState } from "discord.js";
import { Events } from "discord.js";
import { getPrisma } from "@dccc/db";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";

/**
 * Persists every voice-state transition (`voiceStateUpdate`) into the
 * `UserVoiceState` table, so the bridge can enforce
 * `GuildConfig.allowedVoiceChannelIds` without needing its own gateway
 * connection. The bot is the only Discord-Gateway consumer in this
 * project; the bridge reads via SQLite.
 */
async function upsertVoiceState(state: VoiceState): Promise<void> {
  if (!state.guild) return;
  if (!state.id) return;
  await getPrisma().userVoiceState.upsert({
    where: { guildId_userId: { guildId: state.guild.id, userId: state.id } },
    create: {
      guildId: state.guild.id,
      userId: state.id,
      channelId: state.channelId,
    },
    update: { channelId: state.channelId },
  });
}

/**
 * Fire-and-forget HTTP push to the bridge so it can immediately push
 * audio:enable / audio:disable to any open companion socket. Errors are
 * logged but never thrown — the bridge's 60s recheck loop is the
 * fallback path, so a missed push only delays the kick, never breaks
 * correctness.
 */
async function notifyBridge(guildId: string, userId: string): Promise<void> {
  const env = getEnv();
  if (!env.BRIDGE_INTERNAL_URL || !env.INTERNAL_BRIDGE_SECRET) return;
  const url = `${env.BRIDGE_INTERNAL_URL.replace(/\/$/, "")}/internal/voice-state-changed`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-internal-auth": env.INTERNAL_BRIDGE_SECRET,
      },
      body: JSON.stringify({ guildId, userId }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      logger.warn(
        { status: res.status, body: text.slice(0, 200), guildId, userId },
        "bridge push: non-2xx",
      );
    }
  } catch (err) {
    logger.warn({ err, guildId, userId }, "bridge push: fetch failed");
  }
}

/**
 * On bot ready: sync every cached voice state across every guild.
 * Without this, anyone who was already sitting in a voice channel
 * before the bot started has no row in the table, and the bridge
 * would reject them with `not_in_voice`.
 */
async function syncAllGuildsOnReady(client: Client<true>): Promise<void> {
  let total = 0;
  for (const guild of client.guilds.cache.values()) {
    const states = guild.voiceStates.cache;
    if (states.size === 0) continue;
    try {
      for (const state of states.values()) {
        await upsertVoiceState(state);
        total += 1;
      }
    } catch (err) {
      logger.error(
        { err, guildId: guild.id },
        "initial voice-state sync failed for guild",
      );
    }
  }
  logger.info({ rows: total }, "initial voice-state sync complete");
}

export function registerVoiceStateEvents(client: Client): void {
  client.on(Events.VoiceStateUpdate, (_oldState, newState) => {
    upsertVoiceState(newState)
      .then(() => {
        if (newState.guild && newState.id) {
          void notifyBridge(newState.guild.id, newState.id);
        }
      })
      .catch((err) => {
        logger.error(
          { err, guildId: newState.guild?.id, userId: newState.id },
          "voiceStateUpdate upsert failed",
        );
      });
  });

  client.once(Events.ClientReady, (readyClient) => {
    syncAllGuildsOnReady(readyClient).catch((err) => {
      logger.error({ err }, "initial voice-state sync threw");
    });
  });
}
