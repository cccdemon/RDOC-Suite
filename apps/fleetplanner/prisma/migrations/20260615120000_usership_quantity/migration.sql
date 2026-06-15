-- FR-P3 org-fleet: track how many hulls of a model a user owns.
-- UserShip is unique per (user, model); duplicates from the CCU-Game import now
-- collapse to one row carrying a count instead of being dropped.
ALTER TABLE "UserShip" ADD COLUMN "quantity" INTEGER NOT NULL DEFAULT 1;
