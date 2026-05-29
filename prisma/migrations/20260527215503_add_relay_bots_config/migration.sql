-- CreateTable
CREATE TABLE "RelayBotsConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "livekitUrl" TEXT NOT NULL DEFAULT '',
    "livekitApiKey" TEXT NOT NULL DEFAULT '',
    "livekitApiSecret" TEXT NOT NULL DEFAULT '',
    "roomName" TEXT NOT NULL DEFAULT 'voice-relay',
    "guildId" TEXT NOT NULL DEFAULT '',
    "botsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT
);
