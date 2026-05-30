ALTER TABLE "Operation" ADD COLUMN "meetingLocation" TEXT NOT NULL DEFAULT '';

CREATE TABLE "CrewAssignmentRequest" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrewAssignmentRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CrewAssignmentRequest_operationId_userId_key" ON "CrewAssignmentRequest"("operationId", "userId");
CREATE INDEX "CrewAssignmentRequest_operationId_idx" ON "CrewAssignmentRequest"("operationId");
CREATE INDEX "CrewAssignmentRequest_userId_idx" ON "CrewAssignmentRequest"("userId");

ALTER TABLE "CrewAssignmentRequest" ADD CONSTRAINT "CrewAssignmentRequest_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrewAssignmentRequest" ADD CONSTRAINT "CrewAssignmentRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
