ALTER TABLE "Guild"
  ADD COLUMN IF NOT EXISTS "voiceChannelCategoryId" TEXT;

CREATE TABLE IF NOT EXISTS "GuildVoiceBot" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "botUserId" TEXT NOT NULL,
  "tokenCiphertext" TEXT NOT NULL,
  "tokenIv" TEXT NOT NULL,
  "tokenSalt" TEXT NOT NULL,
  "tokenTag" TEXT NOT NULL,
  "assignedChannelId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "GuildVoiceBot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GuildVoiceBot_guildId_botUserId_key"
  ON "GuildVoiceBot"("guildId", "botUserId");
CREATE INDEX IF NOT EXISTS "GuildVoiceBot_guildId_idx"
  ON "GuildVoiceBot"("guildId");
CREATE INDEX IF NOT EXISTS "GuildVoiceBot_assignedChannelId_idx"
  ON "GuildVoiceBot"("assignedChannelId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GuildVoiceBot_guildId_fkey'
  ) THEN
    ALTER TABLE "GuildVoiceBot"
      ADD CONSTRAINT "GuildVoiceBot_guildId_fkey"
      FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "FleetVoiceChannel" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "unitId" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "channelId" TEXT NOT NULL,
  "voiceBotId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "FleetVoiceChannel_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "FleetVoiceChannel_operationId_unitId_key"
  ON "FleetVoiceChannel"("operationId", "unitId");
CREATE UNIQUE INDEX IF NOT EXISTS "FleetVoiceChannel_unitId_key"
  ON "FleetVoiceChannel"("unitId");
CREATE INDEX IF NOT EXISTS "FleetVoiceChannel_guildId_idx"
  ON "FleetVoiceChannel"("guildId");
CREATE INDEX IF NOT EXISTS "FleetVoiceChannel_channelId_idx"
  ON "FleetVoiceChannel"("channelId");
CREATE INDEX IF NOT EXISTS "FleetVoiceChannel_voiceBotId_idx"
  ON "FleetVoiceChannel"("voiceBotId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FleetVoiceChannel_operationId_fkey'
  ) THEN
    ALTER TABLE "FleetVoiceChannel"
      ADD CONSTRAINT "FleetVoiceChannel_operationId_fkey"
      FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FleetVoiceChannel_unitId_fkey'
  ) THEN
    ALTER TABLE "FleetVoiceChannel"
      ADD CONSTRAINT "FleetVoiceChannel_unitId_fkey"
      FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FleetVoiceChannel_guildId_fkey'
  ) THEN
    ALTER TABLE "FleetVoiceChannel"
      ADD CONSTRAINT "FleetVoiceChannel_guildId_fkey"
      FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FleetVoiceChannel_voiceBotId_fkey'
  ) THEN
    ALTER TABLE "FleetVoiceChannel"
      ADD CONSTRAINT "FleetVoiceChannel_voiceBotId_fkey"
      FOREIGN KEY ("voiceBotId") REFERENCES "GuildVoiceBot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
