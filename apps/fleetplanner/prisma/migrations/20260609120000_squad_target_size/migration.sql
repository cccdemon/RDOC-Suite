-- FR-P1 extension: CQB squads (CompositionGroup.kind='squad') get an optional
-- target size so players can join a named squad directly until it is full.

ALTER TABLE "CompositionGroup" ADD COLUMN "targetSize" INTEGER;
