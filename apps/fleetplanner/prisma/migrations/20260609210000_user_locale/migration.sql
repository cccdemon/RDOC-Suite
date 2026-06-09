-- i18n Phase 1: per-user UI language preference (FR-P3-language-switch).
-- Single source of truth for Fleetplanner + (later) Companion + MissionCover.
-- Allowed values: de | en | en-US | fr | es. Default de.
ALTER TABLE "User" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'de';
