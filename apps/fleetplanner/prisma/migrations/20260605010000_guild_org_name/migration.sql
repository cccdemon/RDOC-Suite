-- SC org name per guild, shown in op share embeds (OG) separately from the
-- Discord server name. Optional — falls back to Guild.name in the embed.
ALTER TABLE "Guild" ADD COLUMN "orgName" TEXT;
