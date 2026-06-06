-- Operation: min/max participants
ALTER TABLE "Operation" ADD COLUMN "minParticipants" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Operation" ADD COLUMN "maxParticipants" INTEGER;

-- AuditLog
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "actorId" TEXT,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "detail" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AuditLog_operationId_idx" ON "AuditLog"("operationId");
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- OpQuestion (Ask the FleetOperator)
CREATE TABLE "OpQuestion" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "askerId" TEXT NOT NULL,
    "asker" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "answer" TEXT,
    "answeredBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),
    CONSTRAINT "OpQuestion_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OpQuestion_operationId_idx" ON "OpQuestion"("operationId");
ALTER TABLE "OpQuestion" ADD CONSTRAINT "OpQuestion_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
