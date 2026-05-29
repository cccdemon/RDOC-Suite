-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "livekitRoom" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME
);

-- CreateTable
CREATE TABLE "SessionInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "usedBy" TEXT,
    "usedAt" DATETIME,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionInvite_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "Session_livekitRoom_key" ON "Session"("livekitRoom");

-- CreateIndex
CREATE INDEX "Session_guildId_status_idx" ON "Session"("guildId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SessionInvite_tokenHash_key" ON "SessionInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "SessionInvite_sessionId_idx" ON "SessionInvite"("sessionId");
