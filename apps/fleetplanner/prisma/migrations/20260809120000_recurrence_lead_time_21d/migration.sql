-- Rolling-spawn horizon 7 days -> 21 days.
--
-- A fortnightly series only ever had one materialised occurrence in the
-- Fleetplanner while Discord already listed every future date, because an
-- occurrence became a real Operation seven days ahead. Existing rows are moved
-- along with the default: leadTimeHours is not settable through any route, so
-- every row carries the old default.
ALTER TABLE "OperationRecurrence" ALTER COLUMN "leadTimeHours" SET DEFAULT 504;
UPDATE "OperationRecurrence" SET "leadTimeHours" = 504 WHERE "leadTimeHours" = 168;
