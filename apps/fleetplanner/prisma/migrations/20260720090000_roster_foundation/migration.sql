-- Roster-Fundament: Verband/Staffel nesting + positional captain slots.
-- All columns are additive and nullable, so existing rows stay valid.

-- Group nesting: a Staffel/Trupp can hang under a Verband (kind="formation").
ALTER TABLE "CompositionGroup" ADD COLUMN "parentId" TEXT;
CREATE INDEX "CompositionGroup_parentId_idx" ON "CompositionGroup"("parentId");
ALTER TABLE "CompositionGroup"
  ADD CONSTRAINT "CompositionGroup_parentId_fkey"
  FOREIGN KEY ("parentId") REFERENCES "CompositionGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Positional captain: slot 0 is always the Captain of the group.
ALTER TABLE "CqbSignup" ADD COLUMN "slotIndex" INTEGER;
ALTER TABLE "FleetUnit" ADD COLUMN "formationSlot" INTEGER;
