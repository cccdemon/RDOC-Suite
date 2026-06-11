-- Remove the Fleetplanner voice subsystem (to be redesigned later).
-- Drops the voice tables + voice columns on Operation/Guild. CASCADE clears
-- dependent FK constraints. eventVoiceChannelId stays (Discord event metadata).
DROP TABLE IF EXISTS "FleetVoiceChannel" CASCADE;
DROP TABLE IF EXISTS "MissionVoiceParticipant" CASCADE;
DROP TABLE IF EXISTS "GuildVoiceBot" CASCADE;

ALTER TABLE "Operation"
  DROP COLUMN IF EXISTS "globalVoiceRoom",
  DROP COLUMN IF EXISTS "commanderVoiceRoom";

ALTER TABLE "Guild"
  DROP COLUMN IF EXISTS "voiceChannelCategoryId",
  DROP COLUMN IF EXISTS "globalVoiceRoleId",
  DROP COLUMN IF EXISTS "commanderVoiceRoleId",
  DROP COLUMN IF EXISTS "voiceEnabled";
