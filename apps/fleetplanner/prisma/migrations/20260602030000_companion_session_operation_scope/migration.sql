ALTER TABLE "CompanionSession"
  ADD COLUMN IF NOT EXISTS "operationId" TEXT;

CREATE INDEX IF NOT EXISTS "CompanionSession_operationId_idx"
  ON "CompanionSession"("operationId");
