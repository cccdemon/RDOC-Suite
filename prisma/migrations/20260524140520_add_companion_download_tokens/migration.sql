-- CreateTable
CREATE TABLE "CompanionDownloadToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedFrom" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "CompanionDownloadToken_tokenHash_key" ON "CompanionDownloadToken"("tokenHash");

-- CreateIndex
CREATE INDEX "CompanionDownloadToken_createdBy_idx" ON "CompanionDownloadToken"("createdBy");
