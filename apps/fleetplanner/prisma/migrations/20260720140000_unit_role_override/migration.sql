-- The role a ship plays in an operation is declared, not derived from the catalog.
-- Nullable: existing units keep falling back to the derived class.
ALTER TABLE "FleetUnit" ADD COLUMN "roleOverride" TEXT;
