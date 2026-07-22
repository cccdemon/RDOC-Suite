-- "What's new" popup: track the newest changelog version each user has acknowledged.
-- null = never acked → the popup shows the latest release once.
ALTER TABLE "User" ADD COLUMN "lastSeenChangelog" TEXT;
