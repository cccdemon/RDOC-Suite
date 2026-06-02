-- Remove Guild.captainRoleId — the captain GuildRole gated no route guards;
-- Discord role assignment is handled by commanderVoiceRoleId via the voice session system.
ALTER TABLE "Guild" DROP COLUMN "captainRoleId";
