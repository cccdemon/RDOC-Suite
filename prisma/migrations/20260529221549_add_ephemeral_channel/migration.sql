-- CreateTable
CREATE TABLE "EphemeralChannel" (
    "guildId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActiveAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "EphemeralChannel_guildId_idx" ON "EphemeralChannel"("guildId");
