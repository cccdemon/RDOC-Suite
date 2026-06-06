-- FR-P4: per-operation mission cover reference (image rendered + stored by the
-- @rdoc-suite/mission-cover microservice; the fleetplanner keeps only a pointer).
CREATE TABLE "OpCover" (
    "opId" TEXT NOT NULL,
    "coverId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "preset" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OpCover_pkey" PRIMARY KEY ("opId")
);

ALTER TABLE "OpCover" ADD CONSTRAINT "OpCover_opId_fkey" FOREIGN KEY ("opId") REFERENCES "Operation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
