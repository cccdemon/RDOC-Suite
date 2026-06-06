-- FR-P3: recurring-operation series + per-instance back-reference.
CREATE TABLE "OperationRecurrence" (
  "id" TEXT NOT NULL,
  "guildId" TEXT NOT NULL,
  "createdById" TEXT NOT NULL,
  "freq" TEXT NOT NULL,
  "byWeekday" INTEGER,
  "nthWeek" INTEGER,
  "byMonth" INTEGER,
  "byMonthDay" INTEGER,
  "timeOfDay" TEXT NOT NULL,
  "timezone" TEXT NOT NULL DEFAULT 'Europe/Berlin',
  "anchorAt" TIMESTAMP(3) NOT NULL,
  "seriesEnd" TIMESTAMP(3),
  "seriesCount" INTEGER,
  "spawnedCount" INTEGER NOT NULL DEFAULT 0,
  "leadTimeHours" INTEGER NOT NULL DEFAULT 168,
  "nextRunAt" TIMESTAMP(3) NOT NULL,
  "lastSpawnedAt" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "templateJson" TEXT NOT NULL,
  "discordRecurringEventId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "OperationRecurrence_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationRecurrence_guildId_idx" ON "OperationRecurrence"("guildId");
CREATE INDEX "OperationRecurrence_active_nextRunAt_idx" ON "OperationRecurrence"("active", "nextRunAt");

ALTER TABLE "OperationRecurrence"
  ADD CONSTRAINT "OperationRecurrence_guildId_fkey"
  FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Operation" ADD COLUMN "recurrenceId" TEXT;
ALTER TABLE "Operation" ADD COLUMN "occurrenceAt" TIMESTAMP(3);

CREATE INDEX "Operation_recurrenceId_idx" ON "Operation"("recurrenceId");

ALTER TABLE "Operation"
  ADD CONSTRAINT "Operation_recurrenceId_fkey"
  FOREIGN KEY ("recurrenceId") REFERENCES "OperationRecurrence"("id") ON DELETE SET NULL ON UPDATE CASCADE;
