-- FR-P1 fleet-needs: CQB personnel pool. A person signs up as a CQB soldier
-- (no role taxonomy); the fleet operator bundles signups into squads
-- (CompositionGroup.kind = 'squad') via CqbSignup.assignedGroupId.

ALTER TABLE "CompositionGroup" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'fleet';

CREATE TABLE "CqbSignup" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "note" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "assignedGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CqbSignup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CqbSignup_operationId_userId_key" ON "CqbSignup"("operationId", "userId");
CREATE INDEX "CqbSignup_userId_idx" ON "CqbSignup"("userId");
CREATE INDEX "CqbSignup_assignedGroupId_idx" ON "CqbSignup"("assignedGroupId");

ALTER TABLE "CqbSignup" ADD CONSTRAINT "CqbSignup_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CqbSignup" ADD CONSTRAINT "CqbSignup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CqbSignup" ADD CONSTRAINT "CqbSignup_assignedGroupId_fkey" FOREIGN KEY ("assignedGroupId") REFERENCES "CompositionGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
