-- Security #2: distributed dccc://fleet-voice links must not mint full companion
-- sessions. Add a scope column; existing rows default to "full" (companion app
-- logins). New fleet-voice links are minted with scope = "mission-voice".
ALTER TABLE "CompanionSession" ADD COLUMN "scope" TEXT NOT NULL DEFAULT 'full';
