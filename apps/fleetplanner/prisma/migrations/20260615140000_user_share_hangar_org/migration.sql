-- FR-P3 org-fleet: per-user opt-in to list owned ships in the guild Org-Flotte.
ALTER TABLE "User" ADD COLUMN "shareHangarWithOrg" BOOLEAN NOT NULL DEFAULT false;
