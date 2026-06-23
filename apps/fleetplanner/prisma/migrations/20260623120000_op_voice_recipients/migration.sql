-- CreateTable
CREATE TABLE "OperationVoiceRecipient" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationVoiceRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationVoiceRecipient_operationId_userId_key" ON "OperationVoiceRecipient"("operationId", "userId");

-- CreateIndex
CREATE INDEX "OperationVoiceRecipient_operationId_idx" ON "OperationVoiceRecipient"("operationId");

-- CreateIndex
CREATE INDEX "OperationVoiceRecipient_userId_idx" ON "OperationVoiceRecipient"("userId");

-- AddForeignKey
ALTER TABLE "OperationVoiceRecipient" ADD CONSTRAINT "OperationVoiceRecipient_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationVoiceRecipient" ADD CONSTRAINT "OperationVoiceRecipient_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
