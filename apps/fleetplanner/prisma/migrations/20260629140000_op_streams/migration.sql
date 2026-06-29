-- FR-P3 Stream-Event Phase B1: per-streamer links on an operation (self-service).
CREATE TABLE "OperationStream" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT,
    "platform" TEXT NOT NULL DEFAULT 'twitch',
    "url" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OperationStream_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationStream_operationId_idx" ON "OperationStream"("operationId");
CREATE INDEX "OperationStream_userId_idx" ON "OperationStream"("userId");

ALTER TABLE "OperationStream" ADD CONSTRAINT "OperationStream_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationStream" ADD CONSTRAINT "OperationStream_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
