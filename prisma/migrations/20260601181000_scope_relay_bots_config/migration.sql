PRAGMA foreign_keys=OFF;

CREATE TABLE "new_RelayBotsConfig" (
    "guildId" TEXT NOT NULL PRIMARY KEY,
    "livekitUrl" TEXT NOT NULL DEFAULT '',
    "livekitApiKey" TEXT NOT NULL DEFAULT '',
    "livekitApiSecret" TEXT NOT NULL DEFAULT '',
    "roomName" TEXT NOT NULL DEFAULT 'voice-relay',
    "botsJson" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT
);

INSERT INTO "new_RelayBotsConfig" (
    "guildId",
    "livekitUrl",
    "livekitApiKey",
    "livekitApiSecret",
    "roomName",
    "botsJson",
    "updatedAt",
    "updatedById"
)
SELECT
    CASE WHEN "guildId" = '' THEN 'legacy' ELSE "guildId" END,
    "livekitUrl",
    "livekitApiKey",
    "livekitApiSecret",
    "roomName",
    "botsJson",
    "updatedAt",
    "updatedById"
FROM "RelayBotsConfig";

DROP TABLE "RelayBotsConfig";
ALTER TABLE "new_RelayBotsConfig" RENAME TO "RelayBotsConfig";

PRAGMA foreign_keys=ON;
