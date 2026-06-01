-- Operation visibility (independent of status). Default private so no
-- existing operation becomes visible to other tenants automatically.
ALTER TABLE "Operation" ADD COLUMN "visibility" TEXT NOT NULL DEFAULT 'private';

-- Guild partnerships (tenant federation via single-use token).
CREATE TABLE "GuildPartnership" (
    "id"          TEXT NOT NULL,
    "guildAId"    TEXT NOT NULL,
    "guildBId"    TEXT,
    "tokenHash"   TEXT NOT NULL,
    "label"       TEXT NOT NULL,
    "status"      TEXT NOT NULL DEFAULT 'pending',
    "createdBy"   TEXT NOT NULL,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "GuildPartnership_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GuildPartnership_tokenHash_key" ON "GuildPartnership"("tokenHash");
CREATE UNIQUE INDEX "GuildPartnership_guildAId_guildBId_key" ON "GuildPartnership"("guildAId", "guildBId");
CREATE INDEX "GuildPartnership_guildAId_idx" ON "GuildPartnership"("guildAId");
CREATE INDEX "GuildPartnership_guildBId_idx" ON "GuildPartnership"("guildBId");
CREATE INDEX "GuildPartnership_status_idx" ON "GuildPartnership"("status");

ALTER TABLE "GuildPartnership" ADD CONSTRAINT "GuildPartnership_guildAId_fkey"
    FOREIGN KEY ("guildAId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "GuildPartnership" ADD CONSTRAINT "GuildPartnership_guildBId_fkey"
    FOREIGN KEY ("guildBId") REFERENCES "Guild"("id") ON DELETE CASCADE ON UPDATE CASCADE;
