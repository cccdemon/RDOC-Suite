-- Remove Guild.eventChannelId — per-op eventVoiceChannelId replaces the guild-level default
ALTER TABLE "Guild" DROP COLUMN "eventChannelId";
