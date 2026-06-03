-- Per-(operation,user) primary voice unit for multi-position users. Lets a user
-- (or a mission leader) pick which of their 2+ assigned units is the main Discord
-- voice channel they get moved into. Absent row = system default.
CREATE TABLE "OpPrimaryUnit" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "setByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpPrimaryUnit_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OpPrimaryUnit_operationId_userId_key" ON "OpPrimaryUnit"("operationId", "userId");
CREATE INDEX "OpPrimaryUnit_operationId_idx" ON "OpPrimaryUnit"("operationId");
CREATE INDEX "OpPrimaryUnit_unitId_idx" ON "OpPrimaryUnit"("unitId");

ALTER TABLE "OpPrimaryUnit" ADD CONSTRAINT "OpPrimaryUnit_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpPrimaryUnit" ADD CONSTRAINT "OpPrimaryUnit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OpPrimaryUnit" ADD CONSTRAINT "OpPrimaryUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "FleetUnit"("id") ON DELETE CASCADE ON UPDATE CASCADE;
