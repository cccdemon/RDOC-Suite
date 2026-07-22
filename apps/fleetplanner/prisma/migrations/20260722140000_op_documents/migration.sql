-- Operator-attached PDF documents on an operation. File on disk (op-docs volume);
-- this table holds the metadata. Cascade-deletes with the operation.
CREATE TABLE "OperationDocument" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "storedName" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "addedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationDocument_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OperationDocument_operationId_idx" ON "OperationDocument"("operationId");
CREATE INDEX "OperationDocument_addedById_idx" ON "OperationDocument"("addedById");

ALTER TABLE "OperationDocument" ADD CONSTRAINT "OperationDocument_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OperationDocument" ADD CONSTRAINT "OperationDocument_addedById_fkey" FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
