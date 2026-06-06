-- Ground vehicle = crewable sub-unit carried by a parent ship unit.
ALTER TABLE "FleetUnit" ADD COLUMN "carrierUnitId" TEXT;

ALTER TABLE "FleetUnit"
  ADD CONSTRAINT "FleetUnit_carrierUnitId_fkey"
  FOREIGN KEY ("carrierUnitId") REFERENCES "FleetUnit"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "FleetUnit_carrierUnitId_idx" ON "FleetUnit"("carrierUnitId");
