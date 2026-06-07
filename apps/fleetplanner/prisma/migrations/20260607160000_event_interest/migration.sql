-- FR-P2: Discord scheduled-event "Interested" → auto needs-assignment.
-- One row per (operation, Discord user). userId is null for a shadow interest
-- (no Fleetplanner account yet), claimed on first Discord login.

CREATE TABLE "EventInterest" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "discordUserId" TEXT NOT NULL,
    "userId" TEXT,
    "displayName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'interested',
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EventInterest_operationId_discordUserId_key" ON "EventInterest"("operationId", "discordUserId");
CREATE INDEX "EventInterest_userId_idx" ON "EventInterest"("userId");
CREATE INDEX "EventInterest_discordUserId_idx" ON "EventInterest"("discordUserId");

ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EventInterest" ADD CONSTRAINT "EventInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
