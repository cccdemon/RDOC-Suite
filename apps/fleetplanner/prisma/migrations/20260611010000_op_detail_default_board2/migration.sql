-- Make the 4-column mission board the default op-detail layout.
-- Flip existing rows still on the old "classic" default; explicit board1/board2 stay.
ALTER TABLE "User" ALTER COLUMN "opDetailStyle" SET DEFAULT 'board2';
UPDATE "User" SET "opDetailStyle" = 'board2' WHERE "opDetailStyle" = 'classic';
