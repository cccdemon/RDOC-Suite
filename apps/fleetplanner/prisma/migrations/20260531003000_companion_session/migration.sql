ALTER TABLE "Guild"
  ADD COLUMN IF NOT EXISTS "globalVoiceRoleId" TEXT;

CREATE TABLE IF NOT EXISTS "CompanionSession" (
  "id"        TEXT        NOT NULL,
  "userId"    TEXT        NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CompanionSession_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "CompanionSession_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "CompanionSession_userId_idx" ON "CompanionSession"("userId");
