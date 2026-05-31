-- AlterTable Guild: voice session feature flag + commander role
ALTER TABLE "Guild" ADD COLUMN "commanderVoiceRoleId" TEXT;
ALTER TABLE "Guild" ADD COLUMN "voiceEnabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable Operation: LiveKit room names
ALTER TABLE "Operation" ADD COLUMN "globalVoiceRoom" TEXT;
ALTER TABLE "Operation" ADD COLUMN "commanderVoiceRoom" TEXT;
