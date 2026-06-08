-- FR-P1 Phase 4a: operator formations (Verbände). Ships are grouped into a
-- CompositionGroup with kind='formation' via FleetUnit.formationId.

ALTER TABLE "FleetUnit" ADD COLUMN "formationId" TEXT;

CREATE INDEX "FleetUnit_formationId_idx" ON "FleetUnit"("formationId");

ALTER TABLE "FleetUnit"
  ADD CONSTRAINT "FleetUnit_formationId_fkey"
  FOREIGN KEY ("formationId") REFERENCES "CompositionGroup"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
