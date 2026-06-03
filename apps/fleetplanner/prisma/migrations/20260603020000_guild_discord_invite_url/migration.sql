-- Permanent Discord invite link per guild, shown to non-member guests so they
-- can join the event/host Discord (required for voice channel moves).
ALTER TABLE "Guild" ADD COLUMN "discordInviteUrl" TEXT;
