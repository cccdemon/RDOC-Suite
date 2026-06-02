-- Add optional operationId to GuildMembership for cross-guild op participation tracking
ALTER TABLE "GuildMembership" ADD COLUMN IF NOT EXISTS "operationId" TEXT;

CREATE INDEX IF NOT EXISTS "GuildMembership_operationId_idx"
  ON "GuildMembership"("operationId");
