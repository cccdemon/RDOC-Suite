import { Client, Events, GatewayIntentBits, Interaction } from "discord.js";
import { getEnv } from "./config/env.js";
import { logger } from "./services/logger.js";
import { registerSlashCommands } from "./commands/index.js";
import { handleCc } from "./commands/cc.js";
import { registerVoiceStateEvents } from "./events/voiceState.js";
import { disconnectPrisma } from "@dccc/db";

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

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== "cc") return;
    await handleCc(interaction);
  });

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

  await client.login(env.DISCORD_BOT_TOKEN);
}

main().catch((err) => {
  logger.error({ err }, "fatal error in bot main");
  process.exit(1);
});
