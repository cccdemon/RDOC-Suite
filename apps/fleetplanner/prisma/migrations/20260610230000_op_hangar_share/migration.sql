-- CreateTable
CREATE TABLE "OperationHangarShare" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "allowOperatorHangarView" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperationHangarShare_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationHangarShare_operationId_userId_key" ON "OperationHangarShare"("operationId", "userId");

-- CreateIndex
CREATE INDEX "OperationHangarShare_operationId_idx" ON "OperationHangarShare"("operationId");

-- CreateIndex
CREATE INDEX "OperationHangarShare_userId_idx" ON "OperationHangarShare"("userId");

-- AddForeignKey
ALTER TABLE "OperationHangarShare" ADD CONSTRAINT "OperationHangarShare_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationHangarShare" ADD CONSTRAINT "OperationHangarShare_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
