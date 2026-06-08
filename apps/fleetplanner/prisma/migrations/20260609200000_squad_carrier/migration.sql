-- FR-P1 Phase 4b: a CQB team (CompositionGroup kind='squad') can be embedded in
-- (ride in) a non-fighter ship via carrierUnitId.

ALTER TABLE "CompositionGroup" ADD COLUMN "carrierUnitId" TEXT;

CREATE INDEX "CompositionGroup_carrierUnitId_idx" ON "CompositionGroup"("carrierUnitId");

ALTER TABLE "CompositionGroup"
  ADD CONSTRAINT "CompositionGroup_carrierUnitId_fkey"
  FOREIGN KEY ("carrierUnitId") REFERENCES "FleetUnit"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
