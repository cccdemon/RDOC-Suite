ALTER TABLE "CompanionDownloadToken" ADD COLUMN "guildId" TEXT NOT NULL DEFAULT 'legacy';

CREATE INDEX "CompanionDownloadToken_guildId_idx" ON "CompanionDownloadToken"("guildId");
CREATE INDEX "CompanionDownloadToken_guildId_createdAt_idx" ON "CompanionDownloadToken"("guildId", "createdAt");
