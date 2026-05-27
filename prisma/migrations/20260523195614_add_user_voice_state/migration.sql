-- CreateTable
CREATE TABLE "UserVoiceState" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channelId" TEXT,
    "updatedAt" DATETIME NOT NULL,

    PRIMARY KEY ("guildId", "userId")
);

-- CreateIndex
CREATE INDEX "UserVoiceState_guildId_channelId_idx" ON "UserVoiceState"("guildId", "channelId");
