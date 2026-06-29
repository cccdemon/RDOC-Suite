-- FR-P3 stream-event: mark an operation as a streamed event (icon + filter, Discord marker).
ALTER TABLE "Operation" ADD COLUMN "isStreamEvent" BOOLEAN NOT NULL DEFAULT false;
