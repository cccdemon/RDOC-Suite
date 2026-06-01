import { REST, Routes } from "discord.js";
import { getEnv } from "../config/env.js";
import { logger } from "../services/logger.js";

export async function registerSlashCommands(): Promise<void> {
  const { DISCORD_RDOCRTC_BOT_TOKEN, DISCORD_RDOCRTC_CLIENT_ID } = getEnv();
  const rest = new REST({ version: "10" }).setToken(DISCORD_RDOCRTC_BOT_TOKEN);

  // The `/cc` slash command was removed — guild config + admin management now
  // live in the bridge admin web UI. PUT an empty body to deregister any
  // previously-registered global commands from Discord.
  const body: unknown[] = [];

  logger.info({ count: body.length }, "deregistering global slash commands");
  await rest.put(Routes.applicationCommands(DISCORD_RDOCRTC_CLIENT_ID), { body });
  logger.info("slash commands deregistered");
}
