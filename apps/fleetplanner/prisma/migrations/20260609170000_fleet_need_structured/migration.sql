-- FR-P1 fleet-need redesign, Phase 1: structured need fields on
-- CompositionRequirement (additive). Old category/label/count stay readable so
-- existing code keeps working; the editor/join UI switch over in later phases.

ALTER TABLE "CompositionRequirement" ADD COLUMN "needType" TEXT;
ALTER TABLE "CompositionRequirement" ADD COLUMN "shipType" TEXT;
ALTER TABLE "CompositionRequirement" ADD COLUMN "squadSize" INTEGER;

-- Backfill the structured shape from the legacy free-text category.
UPDATE "CompositionRequirement"
  SET "needType" = 'fighter_squad', "squadSize" = 2
  WHERE "category" = 'fighter';

UPDATE "CompositionRequirement"
  SET "needType" = 'cqb_team', "squadSize" = 4
  WHERE "category" IN ('fps', 'ground');

-- Everything else is a single-hull ship need; the legacy category doubles as
-- the (rough) ship type until the operator refines it in the new editor.
UPDATE "CompositionRequirement"
  SET "needType" = 'ship', "shipType" = "category"
  WHERE "needType" IS NULL;
