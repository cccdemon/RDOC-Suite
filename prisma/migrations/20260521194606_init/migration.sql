-- CreateTable
CREATE TABLE "GuildConfig" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "commanderRoleIds" TEXT NOT NULL DEFAULT '[]',
    "allowedVoiceChannelIds" TEXT NOT NULL DEFAULT '[]',
    "bridgeMode" TEXT NOT NULL DEFAULT 'external_voice',
    "logChannelId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CommanderSession" (
    "sessionId" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "voiceChannelId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateIndex
CREATE INDEX "CommanderSession_guildId_userId_idx" ON "CommanderSession"("guildId", "userId");

-- CreateIndex
CREATE INDEX "CommanderSession_active_idx" ON "CommanderSession"("active");
