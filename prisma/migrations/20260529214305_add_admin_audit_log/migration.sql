-- CreateTable
CREATE TABLE "AdminAuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT,
    "actorUserId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "metadata" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "AdminAuditLog_guildId_createdAt_idx" ON "AdminAuditLog"("guildId", "createdAt");
