-- Consent flag for the public "used by" panel on the start page.
--
-- Opt-in, never opt-out: no existing guild is published by this migration. A
-- guild appears only after its own fleet operator ticks the box AND a Discord
-- invite URL is set.
ALTER TABLE "Guild" ADD COLUMN "landingOptIn" BOOLEAN NOT NULL DEFAULT false;
