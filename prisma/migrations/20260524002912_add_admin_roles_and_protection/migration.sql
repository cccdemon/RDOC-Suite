-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AdminInviteLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "guildId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'vice_admiral',
    "createdBy" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "usedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_AdminInviteLink" ("createdAt", "createdBy", "expiresAt", "guildId", "id", "label", "tokenHash", "usedAt", "usedBy") SELECT "createdAt", "createdBy", "expiresAt", "guildId", "id", "label", "tokenHash", "usedAt", "usedBy" FROM "AdminInviteLink";
DROP TABLE "AdminInviteLink";
ALTER TABLE "new_AdminInviteLink" RENAME TO "AdminInviteLink";
CREATE UNIQUE INDEX "AdminInviteLink_tokenHash_key" ON "AdminInviteLink"("tokenHash");
CREATE INDEX "AdminInviteLink_guildId_idx" ON "AdminInviteLink"("guildId");
CREATE TABLE "new_AdminUser" (
    "guildId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'vice_admiral',
    "protected" BOOLEAN NOT NULL DEFAULT false,
    "addedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    PRIMARY KEY ("guildId", "userId")
);
INSERT INTO "new_AdminUser" ("addedBy", "createdAt", "guildId", "userId") SELECT "addedBy", "createdAt", "guildId", "userId" FROM "AdminUser";
DROP TABLE "AdminUser";
ALTER TABLE "new_AdminUser" RENAME TO "AdminUser";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- BOOTSTRAP PROMOTION:
-- Promote the OLDEST admin per guild to admiral + protected. Runs
-- exactly once (Prisma tracks applied migrations in _prisma_migrations)
-- so subsequent /cc admin add calls do NOT re-trigger this and
-- accidentally demote / unprotect freshly added admins.
-- "Oldest by rowid" is reliable because rowid is monotonic per-table
-- in SQLite and survives the RedefineTables INSERT above (rows go in
-- in the same order they were SELECTed).
UPDATE "AdminUser"
SET "role" = 'admiral', "protected" = 1
WHERE rowid IN (
  SELECT MIN(rowid) FROM "AdminUser" GROUP BY guildId
);
