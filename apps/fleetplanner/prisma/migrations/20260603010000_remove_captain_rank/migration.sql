-- Remove the unused Fleetplanner/GuildMembership rank "captain".
-- Unit captains remain modelled by FleetUnit.captainId.
UPDATE "User" SET "role" = 'crew' WHERE "role" = 'captain';
UPDATE "GuildMembership" SET "role" = 'crew' WHERE "role" = 'captain';
