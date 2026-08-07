-- Fleetyards.net fleet import.
-- The player's Fleetyards account (public hangar) so the import can be re-run
-- without retyping the username.
ALTER TABLE "User" ADD COLUMN "fleetyardsUsername" TEXT;

-- Loaner hulls, tracked separately from owned hulls (`quantity`) so a model that
-- is both owned and loaned keeps both counts.
ALTER TABLE "UserShip" ADD COLUMN "loanerQuantity" INTEGER NOT NULL DEFAULT 0;
