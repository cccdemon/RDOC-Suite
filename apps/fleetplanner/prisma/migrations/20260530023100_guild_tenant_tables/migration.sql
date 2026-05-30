CREATE TABLE IF NOT EXISTS "Guild" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Guild_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "GuildMembership" (
    "id" TEXT NOT NULL,
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'crew',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuildMembership_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Guild" ("id", "name")
VALUES ('default', 'RDOC')
ON CONFLICT ("id") DO NOTHING;

ALTER TABLE "Operation" ADD COLUMN IF NOT EXISTS "guildId" TEXT;
UPDATE "Operation" SET "guildId" = 'default' WHERE "guildId" IS NULL;
ALTER TABLE "Operation" ALTER COLUMN "guildId" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "GuildMembership_guildId_userId_key" ON "GuildMembership"("guildId", "userId");
CREATE INDEX IF NOT EXISTS "GuildMembership_userId_idx" ON "GuildMembership"("userId");
CREATE INDEX IF NOT EXISTS "Operation_guildId_idx" ON "Operation"("guildId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Guild_ownerUserId_fkey'
  ) THEN
    ALTER TABLE "Guild"
      ADD CONSTRAINT "Guild_ownerUserId_fkey"
      FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GuildMembership_guildId_fkey'
  ) THEN
    ALTER TABLE "GuildMembership"
      ADD CONSTRAINT "GuildMembership_guildId_fkey"
      FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'GuildMembership_userId_fkey'
  ) THEN
    ALTER TABLE "GuildMembership"
      ADD CONSTRAINT "GuildMembership_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Operation_guildId_fkey'
  ) THEN
    ALTER TABLE "Operation"
      ADD CONSTRAINT "Operation_guildId_fkey"
      FOREIGN KEY ("guildId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
