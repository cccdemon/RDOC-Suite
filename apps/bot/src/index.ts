import { Client, Events, GatewayIntentBits } from "discord.js";
import { getEnv } from "./config/env.js";
import { logger } from "./services/logger.js";
import { registerSlashCommands } from "./commands/index.js";
import { registerVoiceStateEvents } from "./events/voiceState.js";
import { disconnectPrisma } from "@rdoc-suite/db";

async function main(): Promise<void> {
  const env = getEnv();

  await registerSlashCommands();

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      // GuildVoiceStates is non-privileged — no Discord Portal toggle
      // needed. Without it, voiceStateUpdate never fires and the
      // bridge cannot enforce GuildConfig.allowedVoiceChannelIds.
      GatewayIntentBits.GuildVoiceStates,
    ],
  });

  registerVoiceStateEvents(client);

  client.on(Events.ClientReady, (c) => {
    logger.info({ user: c.user.tag, guilds: c.guilds.cache.size }, "bot ready");
  });

  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.warn({ shardId, code: event.code }, "shard disconnected");
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    logger.info({ shardId }, "shard reconnecting");
  });

  client.on(Events.ShardResume, (shardId, replayed) => {
    logger.info({ shardId, replayed }, "shard resumed");
  });

  client.on(Events.ShardError, (err, shardId) => {
    logger.error({ err, shardId }, "shard error");
  });

  client.on(Events.Error, (err) => {
    logger.error({ err }, "discord client error");
  });

  // No slash-command handlers — `/cc` removed; bot is gateway/voice-state only.

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "shutting down");
    try {
      await client.destroy();
      await disconnectPrisma();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await client.login(env.DISCORD_RDOCRTC_BOT_TOKEN);
}

main().catch((err) => {
  logger.error({ err }, "fatal error in bot main");
  process.exit(1);
});
