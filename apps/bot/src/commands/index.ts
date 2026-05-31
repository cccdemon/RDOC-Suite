import { REST, Routes } from "discord.js";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";
import { ccCommandData } from "./cc.js";

export async function registerSlashCommands(): Promise<void> {
  const { DISCORD_RDOCRTC_BOT_TOKEN, DISCORD_RDOCRTC_CLIENT_ID } = getEnv();
  const rest = new REST({ version: "10" }).setToken(DISCORD_RDOCRTC_BOT_TOKEN);

  const body = [ccCommandData.toJSON()];

  logger.info({ count: body.length }, "registering global slash commands");
  await rest.put(Routes.applicationCommands(DISCORD_RDOCRTC_CLIENT_ID), { body });
  logger.info("slash commands registered");
}
