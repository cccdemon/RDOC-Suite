-- SuperAdmin ban marker. null = not banned. A banned guild is forced
-- inactive and cannot be (re)installed until unbanned.
ALTER TABLE "Guild" ADD COLUMN "bannedAt" TIMESTAMP(3);
